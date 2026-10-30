// Request IDs, the access log and error answers. Clients never see internal details: a 5xx answer
// only carries a reference (the request ID). The full error goes to the logs under that ID; on AWS
// the logs are in S3 too, so the reference finds the incident (infra/scripts/find-in-logs.sh).

import { randomUUID } from 'node:crypto';
import { errorFields, log, logError, warn } from '../lib/log.js';

const SERVER_ERROR = 'Something went wrong on our side. Please try again later; if it keeps happening, contact SIIT ICT with this reference.';

// Every request gets an ID, sent back in X-Request-Id, and one access log line when it ends.
// Health checks are logged only when they fail (the ALB checks every few seconds).
export function requestContext(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path.startsWith('/health') && res.statusCode < 400) return;
    const fields = {
      request_id: req.id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode,
      ms: Number((process.hrtime.bigint() - started) / 1_000_000n), account: req.user?.account_id ?? null, ip: req.ip,
    };
    (res.statusCode >= 500 ? logError : res.statusCode >= 400 ? warn : log)('http.request', fields);
  });
  next();
}

function clientError(req, res, status, body) {
  res.status(status).json({ ...body, reference: req.id });
}

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // Validation error (from Zod): the field messages are written for the user.
  if (err.name === 'ZodError') return clientError(req, res, 400, { message: 'Validation error', errors: err.errors });
  // express.json(): unreadable or oversized bodies.
  if (err.type === 'entity.parse.failed') return clientError(req, res, 400, { message: 'The request body is not valid JSON' });
  if (err.type === 'entity.too.large') return clientError(req, res, 413, { message: 'The request body is too large' });
  // Prisma errors
  if (err.code === 'P2002') return clientError(req, res, 409, { message: 'Unique constraint violation' });
  if (err.code === 'P2025') return clientError(req, res, 404, { message: 'Record not found' });
  // Application errors with a status below 500 carry a message written for the user.
  if (err.statusCode >= 400 && err.statusCode < 500) return clientError(req, res, err.statusCode, { message: err.message });

  logError('http.error', { request_id: req.id, method: req.method, path: req.originalUrl.split('?')[0], error: errorFields(err) });
  res.status(500).json({ message: SERVER_ERROR, reference: req.id });
}

export function notFoundHandler(req, res) {
  clientError(req, res, 404, { message: 'Not found' });
}
