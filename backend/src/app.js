import express from 'express';
import cors from 'cors';
import session from 'express-session';
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
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: env.session_secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: env.is_production,
    sameSite: env.is_production ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

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
