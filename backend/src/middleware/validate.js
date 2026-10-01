import { badRequest } from '../utils/httpError.js';

function formatIssues(issues) {
  return issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

// Validates req[source] against a zod schema and replaces it with the parsed value
// (stored on req.valid because Express 5 makes req.query read-only).
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const details = formatIssues(result.error.issues);
      throw badRequest(details[0]?.message || 'Invalid request', details);
    }
    req.valid = { ...req.valid, [source]: result.data };
    next();
  };
}
