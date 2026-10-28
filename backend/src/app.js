import express from 'express';
import cors from 'cors';
import env from './config/env.js';
import prisma from './lib/prisma.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import auth_routes from './routes/auth.routes.js';
import user_routes from './routes/user.routes.js';
import request_routes from './routes/request.routes.js';
import reviewer_routes from './routes/reviewer.routes.js';

const app = express();

// On AWS the requests come through CloudFront and the ALB; TRUST_PROXY is the number of those
// hops, so req.protocol and req.ip come from their X-Forwarded-* headers.
if (env.trust_proxy) app.set('trust proxy', env.trust_proxy);

// CORS Configuration
app.use(cors({
  origin: env.frontend_url,
  credentials: true,
  // The CSV export's file name, readable by the page when it is on another origin (local dev).
  exposedHeaders: ['Content-Disposition'],
}));

// Middleware. JSON bodies only: an HTML form on another site can't send JSON (B5).
app.use(express.json());

// CSRF (B5): the sign-in cookie is SameSite=Lax; on top of that, refuse state changes that a
// browser sent from another origin. Requests without an Origin header (not from a browser) pass.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (SAFE_METHODS.has(req.method) || !origin || origin === new URL(env.frontend_url).origin) return next();
  res.status(403).json({ message: 'Forbidden: request from another site' });
});

// Health check: liveness for the ALB target group, so a slow database doesn't cycle the tasks.
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Readiness: the database answers.
app.get('/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'database unavailable' });
  }
});

// Routes
app.use('/api/auth', auth_routes);
app.use('/api/users', user_routes);
app.use('/api/requests', request_routes);
app.use('/api/reviewer', reviewer_routes);

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

export default app;
