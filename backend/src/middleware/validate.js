/**
 * Validates req.body / req.query / req.params against zod schemas and puts the parsed
 * (coerced, defaulted, stripped) values on `req.valid`. Express 5 makes `req.query` a
 * read-only getter, so we never mutate the originals.
 * A failure throws a ZodError, which the central error handler turns into a 400.
 */
export const validate =
  ({ body, query, params } = {}) =>
  (req, res, next) => {
    req.valid = {
      body: body ? body.parse(req.body ?? {}) : undefined,
      query: query ? query.parse(req.query ?? {}) : undefined,
      params: params ? params.parse(req.params ?? {}) : undefined,
    };
    next();
  };
