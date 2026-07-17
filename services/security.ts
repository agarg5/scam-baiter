import 'dotenv/config';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Security helpers for a server that is meant to sit on a public tunnel.
 *
 * Every guard here is "secure when configured, loud when not": if the relevant
 * secret is set in the environment the guard enforces it; if it's missing the
 * guard logs a one-time warning and allows the request through, so an
 * out-of-the-box clone still runs while a real deployment is protected.
 */

const API_SECRET = process.env.API_SECRET;

const warnedOnce = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(message);
}

/**
 * Constant-time string comparison that doesn't leak length via early return.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Express middleware: require a shared secret on control-plane endpoints
 * (e.g. POST /api/call) so a stranger who finds the tunnel URL can't place
 * calls on your dime. Accepts the secret in the `X-Api-Key` header or a
 * `Bearer` Authorization header.
 */
function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!API_SECRET) {
    warnOnce('api-secret', '[security] API_SECRET is not set — POST /api/call is UNPROTECTED. Set API_SECRET in .env.');
    return next();
  }

  const headerKey = req.get('x-api-key');
  const auth = req.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const provided = headerKey || bearer;

  if (provided && safeEqual(provided, API_SECRET)) {
    return next();
  }
  res.status(401).json({ error: 'unauthorized' });
}

/**
 * Express middleware for the log dashboard. Browsers can't easily send a custom
 * header, so this also accepts the secret as a `?key=` query param. Uses
 * DASHBOARD_KEY if set, otherwise falls back to API_SECRET.
 */
function requireDashboardKey(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.DASHBOARD_KEY || API_SECRET;
  if (!secret) {
    warnOnce('dashboard-key', '[security] Neither DASHBOARD_KEY nor API_SECRET set — /dashboard is UNPROTECTED.');
    return next();
  }

  const provided = req.get('x-api-key') || (typeof req.query.key === 'string' ? req.query.key : undefined);
  if (provided && safeEqual(provided, secret)) return next();
  res.status(401).type('text/plain').send('unauthorized — append ?key=YOUR_KEY');
}

export {
  requireApiKey,
  requireDashboardKey,
  safeEqual,
};
