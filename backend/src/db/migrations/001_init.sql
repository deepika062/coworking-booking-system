-- btree_gist lets one GiST index combine "=" on a uuid with "&&" on a time range,
-- which is what the double-booking exclusion constraint needs.
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- pg_trgm makes ILIKE '%term%' searches on space names index-assisted.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- Opaque refresh tokens. Only a SHA-256 hash is stored, so a DB leak does not leak live tokens.
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE spaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('desk', 'meeting_room', 'private_office')),
  capacity    integer NOT NULL CHECK (capacity > 0),
  amenities   text[] NOT NULL DEFAULT '{}',
  description text NOT NULL DEFAULT '',
  location    text NOT NULL DEFAULT '',
  deleted_at  timestamptz,           -- soft delete keeps booking history intact
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX spaces_name_active_key ON spaces (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX spaces_type_capacity_idx ON spaces (type, capacity) WHERE deleted_at IS NULL;
CREATE INDEX spaces_capacity_idx ON spaces (capacity) WHERE deleted_at IS NULL;
CREATE INDEX spaces_name_trgm_idx ON spaces USING gin (name gin_trgm_ops);

CREATE TABLE bookings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id      uuid NOT NULL REFERENCES spaces(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  start_at      timestamptz NOT NULL,
  end_at        timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  purpose       text NOT NULL DEFAULT '',
  status_reason text,
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bookings_valid_range CHECK (end_at > start_at),
  -- THE core concurrency guarantee: no two *active* bookings for the same space may have
  -- overlapping [start, end) ranges. PostgreSQL enforces it itself, so it holds even when
  -- two requests insert at the same instant (the loser gets SQLSTATE 23P01).
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    space_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status IN ('pending', 'approved'))
);
CREATE INDEX bookings_user_start_idx ON bookings (user_id, start_at DESC);
CREATE INDEX bookings_status_start_idx ON bookings (status, start_at);
CREATE INDEX bookings_space_start_idx ON bookings (space_id, start_at);

CREATE TABLE maintenance_windows (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id   uuid NOT NULL REFERENCES spaces(id),
  start_at   timestamptz NOT NULL,
  end_at     timestamptz NOT NULL,
  reason     text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_valid_range CHECK (end_at > start_at)
);
CREATE INDEX maintenance_space_range_idx
  ON maintenance_windows USING gist (space_id, tstzrange(start_at, end_at, '[)'));
