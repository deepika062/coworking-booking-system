// OpenAPI 3 description served by Swagger UI at /api/docs.
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ content: { 'application/json': { schema } } });
const dataOf = (schema) => json({ type: 'object', properties: { data: schema } });
const paged = (item) =>
  json({ type: 'object', properties: { data: { type: 'array', items: item }, pagination: ref('Pagination') } });
const err = (description) => ({ description, ...json(ref('Error')) });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const q = (name, schema, description) => ({ name, in: 'query', schema, description });
const pageParams = [q('page', { type: 'integer', minimum: 1 }), q('limit', { type: 'integer', minimum: 1 })];
const bearer = [{ bearerAuth: [] }];

const statusEnum = { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'] };
const typeEnum = { type: 'string', enum: ['desk', 'meeting_room', 'private_office'] };

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Co-working Space Booking API',
    version: '1.0.0',
    description:
      'Access tokens are short-lived JWTs sent as `Authorization: Bearer <token>`. ' +
      'The refresh token is an httpOnly cookie set by /auth/login and /auth/register and rotated by /auth/refresh.\n\n' +
      'All errors use the shape `{ "error": { "code", "message", "details?" } }`. ' +
      'Dates/times are wall-clock values in the business timezone (see /meta).',
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'BOOKING_CONFLICT' },
              message: { type: 'string' },
              details: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          email: { type: 'string' },
          role: { type: 'string', enum: ['member', 'admin'] },
        },
      },
      Session: {
        type: 'object',
        properties: { user: ref('User'), accessToken: { type: 'string' }, accessTokenExpiresIn: { type: 'string' } },
      },
      Space: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          type: typeEnum,
          capacity: { type: 'integer' },
          amenities: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
          location: { type: 'string' },
        },
      },
      SpaceInput: {
        type: 'object',
        required: ['name', 'type', 'capacity'],
        properties: {
          name: { type: 'string', example: 'Huddle Room 2' },
          type: typeEnum,
          capacity: { type: 'integer', example: 4 },
          amenities: { type: 'array', items: { type: 'string' }, example: ['WiFi', 'TV screen'] },
          description: { type: 'string' },
          location: { type: 'string', example: 'Floor 2' },
        },
      },
      Booking: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          spaceId: { type: 'string', format: 'uuid' },
          spaceName: { type: 'string' },
          userName: { type: 'string' },
          userEmail: { type: 'string' },
          date: { type: 'string', example: '2026-10-07' },
          startTime: { type: 'string', example: '10:00' },
          endTime: { type: 'string', example: '11:30' },
          startAt: { type: 'string', format: 'date-time' },
          endAt: { type: 'string', format: 'date-time' },
          status: statusEnum,
          statusReason: { type: 'string', nullable: true },
          purpose: { type: 'string' },
          isUpcoming: { type: 'boolean' },
        },
      },
      Availability: {
        type: 'object',
        properties: {
          space: ref('Space'),
          date: { type: 'string' },
          timezone: { type: 'string' },
          openingTime: { type: 'string' },
          closingTime: { type: 'string' },
          slotMinutes: { type: 'integer' },
          slots: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                start: { type: 'string' },
                end: { type: 'string' },
                status: { type: 'string', enum: ['free', 'pending', 'booked', 'maintenance', 'past'] },
              },
            },
          },
        },
      },
      Maintenance: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          spaceId: { type: 'string', format: 'uuid' },
          spaceName: { type: 'string' },
          start: { type: 'string', example: '2026-10-08T09:00' },
          end: { type: 'string', example: '2026-10-08T13:00' },
          reason: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/health': { get: { tags: ['Meta'], summary: 'Health check', responses: { 200: { description: 'OK' } } } },
    '/meta': { get: { tags: ['Meta'], summary: 'Business hours, slot size, timezone', responses: { 200: { description: 'OK' } } } },

    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a member (rate limited)',
        requestBody: json({
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', example: 'Jane Doe' },
            email: { type: 'string', example: 'jane@example.com' },
            password: { type: 'string', example: 'Passw0rd!' },
          },
        }),
        responses: { 201: { description: 'Created; sets refresh cookie', ...dataOf(ref('Session')) }, 400: err('Validation'), 409: err('Email taken'), 429: err('Rate limited') },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in (rate limited)',
        requestBody: json({
          type: 'object',
          required: ['email', 'password'],
          properties: { email: { type: 'string', example: 'member@cowork.test' }, password: { type: 'string', example: 'Member@123' } },
        }),
        responses: { 200: { description: 'OK; sets refresh cookie', ...dataOf(ref('Session')) }, 401: err('Invalid credentials'), 429: err('Rate limited') },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate the refresh-token cookie and get a new access token',
        responses: { 200: { description: 'OK', ...dataOf(ref('Session')) }, 401: err('Invalid / expired / reused refresh token') },
      },
    },
    '/auth/logout': { post: { tags: ['Auth'], summary: 'Revoke refresh token', responses: { 204: { description: 'Logged out' } } } },
    '/auth/me': { get: { tags: ['Auth'], security: bearer, summary: 'Current user', responses: { 200: dataOf(ref('User')), 401: err('Unauthenticated') } } },

    '/spaces': {
      get: {
        tags: ['Spaces'],
        summary: 'List / search / filter spaces (public)',
        parameters: [
          q('q', { type: 'string' }, 'Search by name or type'),
          q('type', typeEnum),
          q('minCapacity', { type: 'integer' }),
          q('maxCapacity', { type: 'integer' }),
          q('date', { type: 'string', example: '2026-10-07' }, 'Only spaces free on this date'),
          q('startTime', { type: 'string', example: '10:00' }, 'With endTime: only spaces free in this range'),
          q('endTime', { type: 'string', example: '12:00' }),
          q('sort', { type: 'string', enum: ['name', 'capacity', '-capacity', 'newest'] }),
          ...pageParams,
        ],
        responses: { 200: paged(ref('Space')), 400: err('Validation') },
      },
      post: {
        tags: ['Spaces'],
        security: bearer,
        summary: 'Create space (admin)',
        requestBody: json(ref('SpaceInput')),
        responses: { 201: dataOf(ref('Space')), 400: err('Validation'), 403: err('Not admin'), 409: err('Duplicate name') },
      },
    },
    '/spaces/{id}': {
      get: { tags: ['Spaces'], summary: 'Space details (public)', parameters: [idParam], responses: { 200: dataOf(ref('Space')), 404: err('Not found') } },
      put: {
        tags: ['Spaces'],
        security: bearer,
        summary: 'Update space (admin, partial)',
        parameters: [idParam],
        requestBody: json(ref('SpaceInput')),
        responses: { 200: dataOf(ref('Space')), 404: err('Not found') },
      },
      delete: {
        tags: ['Spaces'],
        security: bearer,
        summary: 'Soft-delete space (admin); cancels its future bookings',
        parameters: [idParam],
        responses: { 200: { description: 'Deleted' }, 404: err('Not found') },
      },
    },
    '/spaces/{id}/availability': {
      get: {
        tags: ['Spaces'],
        summary: 'Slot-by-slot availability for one day (public)',
        parameters: [idParam, { ...q('date', { type: 'string', example: '2026-10-07' }), required: true }],
        responses: { 200: dataOf(ref('Availability')), 404: err('Not found') },
      },
    },

    '/bookings': {
      post: {
        tags: ['Bookings'],
        security: bearer,
        summary: 'Request a booking (status = pending)',
        requestBody: json({
          type: 'object',
          required: ['spaceId', 'date', 'startTime', 'endTime'],
          properties: {
            spaceId: { type: 'string', format: 'uuid' },
            date: { type: 'string', example: '2026-10-07' },
            startTime: { type: 'string', example: '10:00' },
            endTime: { type: 'string', example: '11:30' },
            purpose: { type: 'string' },
          },
        }),
        responses: {
          201: dataOf(ref('Booking')),
          400: err('Validation / past booking'),
          409: err('BOOKING_CONFLICT or MAINTENANCE_CONFLICT'),
        },
      },
    },
    '/bookings/me': {
      get: {
        tags: ['Bookings'],
        security: bearer,
        summary: 'My bookings',
        parameters: [q('status', statusEnum), q('when', { type: 'string', enum: ['upcoming', 'past'] }), ...pageParams],
        responses: { 200: paged(ref('Booking')) },
      },
    },
    '/bookings/{id}/cancel': {
      patch: {
        tags: ['Bookings'],
        security: bearer,
        summary: 'Cancel my pending/approved future booking',
        parameters: [idParam],
        responses: { 200: dataOf(ref('Booking')), 404: err('Not found'), 409: err('Not cancellable') },
      },
    },

    '/admin/bookings': {
      get: {
        tags: ['Admin'],
        security: bearer,
        summary: 'All bookings, filterable',
        parameters: [
          q('status', statusEnum),
          q('spaceId', { type: 'string', format: 'uuid' }),
          q('date', { type: 'string', example: '2026-10-07' }),
          q('q', { type: 'string' }, 'Member name or email'),
          ...pageParams,
        ],
        responses: { 200: paged(ref('Booking')), 403: err('Not admin') },
      },
    },
    '/admin/bookings/{id}/approve': {
      patch: {
        tags: ['Admin'],
        security: bearer,
        summary: 'Approve; auto-rejects overlapping pending bookings',
        parameters: [idParam],
        responses: { 200: dataOf({ type: 'object', properties: { booking: ref('Booking'), autoRejected: { type: 'array', items: ref('Booking') } } }), 409: err('Not pending / started') },
      },
    },
    '/admin/bookings/{id}/reject': {
      patch: {
        tags: ['Admin'],
        security: bearer,
        summary: 'Reject a pending booking',
        parameters: [idParam],
        requestBody: json({ type: 'object', properties: { reason: { type: 'string' } } }),
        responses: { 200: dataOf(ref('Booking')), 409: err('Not pending') },
      },
    },
    '/admin/maintenance': {
      get: {
        tags: ['Admin'],
        security: bearer,
        summary: 'List maintenance windows',
        parameters: [q('spaceId', { type: 'string', format: 'uuid' }), q('includePast', { type: 'boolean' })],
        responses: { 200: dataOf({ type: 'array', items: ref('Maintenance') }) },
      },
      post: {
        tags: ['Admin'],
        security: bearer,
        summary: 'Block a space for maintenance',
        description: 'Overlapping pending bookings are auto-rejected. Overlapping approved bookings cause a 409 unless `force` is true, in which case they are cancelled.',
        requestBody: json({
          type: 'object',
          required: ['spaceId', 'start', 'end'],
          properties: {
            spaceId: { type: 'string', format: 'uuid' },
            start: { type: 'string', example: '2026-10-08T09:00' },
            end: { type: 'string', example: '2026-10-08T13:00' },
            reason: { type: 'string', example: 'AC repair' },
            force: { type: 'boolean', default: false },
          },
        }),
        responses: { 201: { description: 'Created' }, 409: err('MAINTENANCE_CONFLICT') },
      },
    },
    '/admin/maintenance/{id}': {
      delete: { tags: ['Admin'], security: bearer, summary: 'Remove a maintenance window', parameters: [idParam], responses: { 204: { description: 'Deleted' } } },
    },
  },
};
