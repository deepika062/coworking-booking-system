# DeskSpace: Co-working Desk & Room Booking System

Members book desks and meeting rooms by time slot. Admins manage the space inventory, approve or reject requests and block out maintenance windows. Double-booking is prevented **at the database level**, so it holds even when two requests arrive at the same moment.

| Layer | Tech |
|---|---|
| Backend | Node.js 20+, Express 5, `pg`, zod (validation), jsonwebtoken, bcryptjs, express-rate-limit, helmet |
| Database | PostgreSQL 13+ (exclusion constraints via `btree_gist`, trigram search via `pg_trgm`) |
| Frontend | React 19, React Router 7, Axios, Vite. Hand-written responsive CSS and a custom slot calendar |
| Extras | Docker Compose, Swagger UI (`/api/docs`), email-notification stub, integration tests including a concurrency race test |

---

## Quick start

### Option A: Docker (one command)

```bash
docker compose up --build
```

| | URL |
|---|---|
| App | http://localhost:8080 |
| API docs (Swagger) | http://localhost:8080/api/docs |
| API | http://localhost:4000/api |

Migrations run automatically and demo data is seeded on first start.

### Option B: Run locally

You need Node 20+ and a PostgreSQL 13+ database.

```bash
# 1. Backend
cd backend
cp .env.example .env          # then edit DATABASE_URL / JWT_ACCESS_SECRET
npm install
npm run dev                   # runs migrations + seed, serves http://localhost:4000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /api to :4000)
```

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | `admin@cowork.test` | `Admin@123` |
| Member | `member@cowork.test` | `Member@123` |
| Member | `member2@cowork.test` | `Member@123` |

You can also register a new member from the UI.

### Tests

The integration tests run against a real PostgreSQL database. **Use a throwaway database, because the tests truncate every table.**

```bash
cd backend
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/coworking_test npm test
```

All 23 tests pass. They cover validation and the error shape, auth (refresh rotation and reuse detection), RBAC, search, filters and pagination, space CRUD, booking rules, **15 concurrent requests for the same slot (exactly 1 succeeds)**, the DB constraint on its own, approve with auto-reject, cancel rules, maintenance conflicts, availability, and rate limiting.

---

## Features

**Visitor (no login)**
- Lists all spaces with type, capacity, amenities and location, with pagination.
- Searches by name or type ("board", "meeting").
- Filters by type and minimum capacity, and by **date availability**: pick a date, plus an optional From/To range, and only spaces that are free then are shown.
- Shows a space's details with a **day calendar**: every 30-minute slot is coloured *free / pending / booked / maintenance / past*. Previous and next day navigation is included.
- Filters are kept in the URL, so you can share a link and the back button works.

**Member**
- Registers and logs in. The JWT access token expires after 15 minutes. A refresh token in an httpOnly cookie is rotated every time it is used.
- Books a space by clicking a free slot in the calendar, then clicking a later slot to extend the range. Each request is created as `pending`.
- Cannot book overlapping, past, out-of-hours or misaligned slots, or slots more than 60 days ahead.
- "My bookings" has Upcoming / Past / All tabs and a status filter, and shows the rejection or cancellation reason.
- Can cancel their own `pending` or `approved` booking if it hasn't started yet.

**Admin**
- Creates, edits and deletes spaces. Delete is a soft delete: the booking history is kept, and the space's future bookings are cancelled and the members notified.
- **Approval queue** shows pending requests oldest first, with Approve and Reject (with an optional reason). When a booking is approved, any overlapping pending requests are **auto-rejected**.
- **All bookings** can be filtered by status, date, space and member name or email.
- **Maintenance windows** block a space for a date-time range:
  - pending requests in the window are auto-rejected;
  - if *approved* bookings overlap, the API returns `409` with the list of affected bookings. The admin can then cancel them and create the window anyway (`force: true`).
- Every status change triggers a **notification stub**: a would-be email logged by the backend (`[email-stub] to=...`).

---

## How double-booking is prevented

This is the core requirement, so it is handled in three layers.

### 1. A database constraint (the actual guarantee)

```sql
CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
  space_id WITH =,
  tstzrange(start_at, end_at, '[)') WITH &&
) WHERE (status IN ('pending', 'approved'))
```

PostgreSQL itself refuses to store two *active* bookings for the same space whose time ranges overlap (`&&`). It checks this on its own index, inside its own locking, so two `INSERT`s that run at the same moment can't both succeed. The second one fails with SQLSTATE `23P01`, and the error middleware turns that into **`409 BOOKING_CONFLICT`**.

- `'[)'` makes the ranges half-open, so 09:00–10:00 and 10:00–11:00 can both exist (back-to-back is allowed).
- The `WHERE` clause means rejected and cancelled bookings don't block anything. Cancelling a booking frees the slot immediately.
- `btree_gist` lets one GiST index combine `=` on a uuid with `&&` on a range.

The code does a friendly "is it already taken?" check before inserting, but that check is **not** what makes it safe: two requests can both pass it. The constraint is what makes it safe. The test suite fires 15 simultaneous requests at one slot and asserts exactly one `201` and fourteen `409`s. Another test inserts overlapping rows directly with SQL to prove the database rejects them without any app code involved.

### 2. A row lock for maintenance windows

A constraint can't span two tables, and maintenance windows live in their own table. Without extra care, a booking could be inserted in the moment between "check for maintenance" and "insert", while an admin is adding a window. So:
- booking creation takes `SELECT ... FROM spaces WHERE id = $1 FOR SHARE`;
- maintenance creation (and space deletion) takes `FOR UPDATE` on the same row.

`FOR SHARE` locks don't block each other, so bookings for the same space still run in parallel and the constraint arbitrates between them. `FOR UPDATE` waits for in-flight bookings to finish and holds off new ones until the maintenance transaction commits.

### 3. Conditional updates for status changes

- Approve and reject lock the booking row (`SELECT ... FOR UPDATE`) and check that it is still `pending`. Two admins can't both approve the same request, and an approval can't race with the member cancelling it.
- Cancel is a single `UPDATE ... WHERE user_id = $me AND status IN ('pending','approved') AND start_at > now()`, which is atomic.

### Note on auto-reject

The spec asks for both of these:
- members can't book a slot that overlaps a *pending or approved* booking;
- approving one booking auto-rejects the *other overlapping pending* ones.

Because of the first rule (enforced by the constraint), overlapping pending bookings normally can't exist. The auto-reject step is still implemented in the same transaction as the approval, as a defensive and explicit rule. It would matter if the policy ever changed to let several pending requests compete for one slot. A test drops the constraint temporarily to prove the logic works. Auto-reject also does real work when a **maintenance window** is created over pending requests.

---

## Authentication

```
POST /auth/login   → body: { accessToken (JWT, 15 min) }   + Set-Cookie: refreshToken (httpOnly, SameSite=Strict, Path=/api/auth, 7 days)
GET  /bookings/me  → Authorization: Bearer <accessToken>
                   ← 401 { code: "TOKEN_EXPIRED" } once it expires
POST /auth/refresh → cookie sent automatically → old refresh token revoked, new pair issued (rotation)
POST /auth/logout  → refresh token revoked, cookie cleared
```

- **Access token**: an HS256 JWT holding `sub`, `role`, `name` and `email`. It is kept **only in memory** on the client, not in localStorage. When the page reloads, the session is restored by calling `/auth/refresh`.
- **Refresh token**: 48 random bytes. Only its **SHA-256 hash** is stored in `refresh_tokens`, so a leaked database doesn't leak working tokens. It is kept in an httpOnly cookie that JavaScript can't read, scoped to `/api/auth`.
- **Rotation and reuse detection**: every refresh revokes the token it used. If an already-rotated token shows up again more than 30 seconds later, it was probably stolen, so **every session for that user is revoked**. The 30-second grace covers harmless races such as two tabs refreshing at once.
- **Axios interceptor**: on `TOKEN_EXPIRED` it calls `/auth/refresh` once and retries the original request. Parallel requests share one in-flight refresh, which matters because rotation makes duplicate refreshes conflict.
- **RBAC**: `authenticate` verifies the JWT, and `authorize('admin')` guards the admin routes. The React route guards are only for UX. The API enforces everything itself.
- **Rate limiting**: `/auth/login` and `/auth/register` allow 10 requests per IP per 15 minutes (configurable). Over the limit they return `429 RATE_LIMITED`.
- Passwords are hashed with bcrypt. Login runs a bcrypt comparison even for unknown emails, so response timing doesn't reveal which emails are registered.

---

## API

Full interactive docs are at **`/api/docs`** (Swagger UI).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/meta` | – | Timezone, opening hours, slot size |
| POST | `/api/auth/register` | – (rate limited) | Register a member |
| POST | `/api/auth/login` | – (rate limited) | Log in |
| POST | `/api/auth/refresh` | cookie | Rotate the refresh token, get a new access token |
| POST | `/api/auth/logout` | cookie | Revoke the refresh token |
| GET | `/api/auth/me` | user | Current user |
| GET | `/api/spaces` | – | `q, type, minCapacity, maxCapacity, date, startTime, endTime, sort, page, limit` |
| GET | `/api/spaces/:id` | – | Space details |
| GET | `/api/spaces/:id/availability?date=` | – | Slot-by-slot day view and busy blocks |
| POST / PUT / DELETE | `/api/spaces[/:id]` | admin | Space CRUD (DELETE is a soft delete) |
| POST | `/api/bookings` | user | `{ spaceId, date, startTime, endTime, purpose? }` creates a pending booking |
| GET | `/api/bookings/me` | user | `status, when=upcoming\|past, page, limit` |
| PATCH | `/api/bookings/:id/cancel` | owner | Cancel a future pending or approved booking |
| GET | `/api/admin/bookings` | admin | `status, spaceId, date, q, page, limit` |
| PATCH | `/api/admin/bookings/:id/approve` | admin | Approve and auto-reject overlapping pending bookings |
| PATCH | `/api/admin/bookings/:id/reject` | admin | `{ reason? }` |
| GET / POST | `/api/admin/maintenance` | admin | List, or create `{ spaceId, start, end, reason?, force? }` |
| DELETE | `/api/admin/maintenance/:id` | admin | Remove a window |

### Error format

Every error, whatever produces it, goes through one middleware and comes back in the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [{ "field": "endTime", "message": "endTime must be after startTime" }] } }
```

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON`, `PAST_BOOKING`, `TOO_FAR_AHEAD`, `PAST_WINDOW` |
| 401 | `UNAUTHORIZED`, `TOKEN_EXPIRED`, `INVALID_TOKEN`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_REUSED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | `BOOKING_CONFLICT`, `MAINTENANCE_CONFLICT`, `INVALID_STATUS`, `BOOKING_STARTED`, `EMAIL_TAKEN`, `DUPLICATE_NAME` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR` (the message is hidden in production) |

Known PostgreSQL errors are mapped as well: `23P01` becomes 409, `23505` becomes 409 and `22P02` becomes 400.

---

## Data model and indexes

```
users              (id, name, email, password_hash, role)
refresh_tokens     (id, user_id → users, token_hash UNIQUE, expires_at, revoked_at)
spaces             (id, name, type, capacity, amenities text[], description, location, deleted_at)
bookings           (id, space_id → spaces, user_id → users, start_at, end_at, status, purpose,
                    status_reason, decided_by, decided_at, cancelled_at)
maintenance_windows(id, space_id → spaces, start_at, end_at, reason, created_by)
```

| Index | Used by |
|---|---|
| `bookings_no_overlap` (GiST on `space_id, tstzrange`) | The overlap constraint, plus every "is this range free?" query |
| `maintenance_space_range_idx` (GiST on `space_id, tstzrange`) | Maintenance overlap checks |
| `bookings (status, start_at)` | Admin list filtered by status or date, and the approval queue |
| `bookings (space_id, start_at)` | Admin filter by space, and availability |
| `bookings (user_id, start_at DESC)` | My bookings |
| `spaces (type, capacity)`, `spaces (capacity)`, partial `WHERE deleted_at IS NULL` | Type and capacity filters |
| `spaces USING gin (name gin_trgm_ops)` | `ILIKE '%term%'` search |
| `UNIQUE (lower(email))`, `UNIQUE (lower(name)) WHERE deleted_at IS NULL` | Case-insensitive uniqueness |

---

## Design decisions and assumptions

- **PostgreSQL rather than MongoDB.** The exclusion constraint gives a declarative, race-proof guarantee against double-booking. MongoDB would need transactions plus a hand-rolled locking scheme to get the same result.
- **Timezone.** A co-working space has one physical location, so all wall-clock times are interpreted in `BUSINESS_TIMEZONE` (default `Asia/Kolkata`) by PostgreSQL (`(date + time) AT TIME ZONE tz`). The API stores `timestamptz` and returns both the UTC instants and the local `date`, `startTime` and `endTime`. A user whose browser is in another timezone still sees the space's local times.
- **Slot rules** are configurable through environment variables: opening hours 08:00–20:00, 30-minute slots, at most 60 days in advance. Bookings must be in the future, fit inside opening hours and align to slot boundaries.
- **A booking reserves the whole space.** Capacity describes how many people the space holds. A desk is a single bookable unit.
- **Admins can book too**, so they can test the flow. The member-only rules, such as cancelling only your own bookings, still apply to them.
- **Soft delete for spaces** keeps the booking history and audit trail intact.
- **Notifications** are sent only *after* the transaction commits, so no one is told about a change that was rolled back.
- **Migrations** are plain SQL files run by a small forward-only runner (`src/db/migrate.js`), guarded by an advisory lock. They run on startup, and the seed step is idempotent.

## Project structure

```
backend/
  src/
    app.js                 Express app: middleware, routes, error handler
    server.js              migrate → seed → listen, graceful shutdown
    config.js              env parsing
    validators.js          zod schemas for every endpoint
    db/                    pool + transaction helper, migration runner, SQL migrations, seed
    middleware/            auth (JWT + RBAC), validate, rate limit, central error handler
    routes/                auth, spaces, bookings, admin
    services/              business logic (auth, spaces, bookings, maintenance, notifier)
    docs/openapi.js        Swagger spec
  tests/api.test.js        integration tests (node:test + supertest)
frontend/
  src/
    api/                   axios instance (token + refresh interceptor), endpoint functions
    context/               AuthContext (session), AppContext (meta + toasts)
    components/            Navbar, AvailabilityCalendar, Pagination, Modal, admin/*
    pages/                 Spaces, SpaceDetail, Login/Register, MyBookings, Admin
docker-compose.yml         db + backend + frontend (nginx proxies /api)
```

## Possible improvements

- Recurring bookings, and a week view in the calendar.
- A real email provider behind the notifier interface, sent through a job queue.
- A job that expires `pending` requests whose start time passes without a decision. Today they simply can't be approved any more.
- E2E tests (Playwright) and CI.
