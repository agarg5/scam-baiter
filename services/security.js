require('dotenv').config();
const crypto = require('crypto');
const twilio = require('twilio');

/**
 * Security helpers for a server that is meant to sit on a public tunnel.
 *
 * Every guard here is "secure when configured, loud when not": if the relevant
 * secret is set in the environment the guard enforces it; if it's missing the
 * guard logs a one-time warning and allows the request through, so an
 * out-of-the-box clone still runs while a real deployment is protected.
 */

const API_SECRET = process.env.API_SECRET;
const WS_TOKEN = process.env.WS_TOKEN;
const SIGNALWIRE_API_TOKEN = process.env.SIGNALWIRE_API_TOKEN;
const SKIP_SIGNATURE_VALIDATION = process.env.SKIP_SIGNATURE_VALIDATION === 'true';

const warnedOnce = new Set();
function warnOnce(key, message) {
  if (warnedOnce.has(key)) return;
  warnedOnce.add(key);
  console.warn(message);
}

/**
 * Constant-time string comparison that doesn't leak length via early return.
 */
function safeEqual(a, b) {
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
function requireApiKey(req, res, next) {
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
  return res.status(401).json({ error: 'unauthorized' });
}

/**
 * Reconstruct the public URL SignalWire used when it signed the request.
 * Behind a tunnel/proxy the local host header is wrong, so prefer PUBLIC_HOST.
 */
function publicUrl(req) {
  const base = process.env.PUBLIC_HOST
    ? process.env.PUBLIC_HOST.replace(/\/$/, '')
    : `https://${req.headers.host}`;
  return base + req.originalUrl;
}

/**
 * Express middleware: verify the X-Twilio-Signature header SignalWire sends on
 * every webhook (voice, SMS, status). This stops anyone from POSTing forged
 * webhooks to burn your OpenAI/ElevenLabs credits or trigger calls.
 *
 * Requires SIGNALWIRE_API_TOKEN (the signing key). Set SKIP_SIGNATURE_VALIDATION=true
 * to bypass for local testing without a real provider.
 */
function validateSignalWireSignature(req, res, next) {
  if (SKIP_SIGNATURE_VALIDATION) return next();

  if (!SIGNALWIRE_API_TOKEN) {
    warnOnce('sw-token', '[security] SIGNALWIRE_API_TOKEN not set — webhook signatures are NOT validated.');
    return next();
  }

  const signature = req.get('x-twilio-signature');
  const url = publicUrl(req);
  const valid = twilio.validateRequest(SIGNALWIRE_API_TOKEN, signature, url, req.body || {});

  if (valid) return next();

  console.warn(`[security] Rejected webhook with bad signature: ${req.method} ${req.originalUrl}`);
  return res.status(403).type('text/plain').send('invalid signature');
}

/**
 * Express middleware for the log dashboard. Browsers can't easily send a custom
 * header, so this also accepts the secret as a `?key=` query param. Uses
 * DASHBOARD_KEY if set, otherwise falls back to API_SECRET.
 */
function requireDashboardKey(req, res, next) {
  const secret = process.env.DASHBOARD_KEY || API_SECRET;
  if (!secret) {
    warnOnce('dashboard-key', '[security] Neither DASHBOARD_KEY nor API_SECRET set — /dashboard is UNPROTECTED.');
    return next();
  }

  const provided = req.get('x-api-key') || req.query.key;
  if (provided && safeEqual(provided, secret)) return next();
  return res.status(401).type('text/plain').send('unauthorized — append ?key=YOUR_KEY');
}

/**
 * Generate the token appended to the media-stream WebSocket URL in LaML and
 * checked when the socket connects. Falls back to '' when WS_TOKEN is unset.
 */
function streamToken() {
  return WS_TOKEN || '';
}

/**
 * Validate the token on an incoming media-stream WebSocket upgrade. Returns
 * true if the connection should be allowed.
 */
function validateStreamToken(token) {
  if (!WS_TOKEN) {
    warnOnce('ws-token', '[security] WS_TOKEN not set — /media-stream accepts any connection.');
    return true;
  }
  return Boolean(token) && safeEqual(token, WS_TOKEN);
}

module.exports = {
  requireApiKey,
  requireDashboardKey,
  validateSignalWireSignature,
  streamToken,
  validateStreamToken,
  safeEqual,
};
