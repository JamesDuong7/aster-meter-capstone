import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { openDatabase } from './db.js';
import { loadEnv } from './config.js';
import { ApiError, recordUsage, usageSummary } from './meter.js';
import { createCheckout, processStripeEvent, verifyStripeSignature } from './stripe.js';

loadEnv();
const db = openDatabase();

function send(res, status, body, headers = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json), ...headers });
  res.end(json);
}

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    req.on('data', chunk => {
      if (exceeded) return;
      size += chunk.length;
      if (size > 1_000_000) { exceeded = true; reject(new ApiError(413, 'body_too_large', 'Request body exceeds 1 MB.')); req.resume(); }
      else chunks.push(chunk);
    });
    req.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function parseJson(raw) {
  try { return JSON.parse(raw); }
  catch { throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON.'); }
}

function authenticate(req) {
  const key = req.headers['x-api-key'];
  if (typeof key !== 'string' || key.length < 16) throw new ApiError(401, 'unauthorized', 'A valid X-API-Key is required.');
  const hash = createHash('sha256').update(key).digest('hex');
  // Hashes are stored instead of API keys; the query is tenant scoped by the key itself.
  const tenant = db.prepare('SELECT id,name,stripe_customer_id FROM tenants WHERE api_key_hash=?').get(hash);
  if (!tenant) throw new ApiError(401, 'unauthorized', 'A valid X-API-Key is required.');
  return tenant;
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
    if (req.method === 'POST' && url.pathname === '/webhooks/stripe') {
      const raw = await rawBody(req);
      verifyStripeSignature(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
      return send(res, 200, processStripeEvent(db, parseJson(raw)));
    }
    if (req.method === 'GET' && url.pathname === '/checkout/success') return send(res, 200, { message: 'Checkout complete. Your plan updates when the verified Stripe webhook arrives.' });
    if (req.method === 'GET' && url.pathname === '/checkout/cancel') return send(res, 200, { message: 'Checkout canceled.' });
    if (req.method === 'GET' && url.pathname === '/usage') {
      const tenant = authenticate(req);
      const month = url.searchParams.get('month');
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, 'invalid_month', 'Month must be YYYY-MM.');
      return send(res, 200, usageSummary(db, tenant.id, month || undefined));
    }
    if (req.method === 'POST' && url.pathname === '/generate') {
      const tenant = authenticate(req);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
      const response = recordUsage(db, tenant.id, req.headers['idempotency-key'], parseJson(await rawBody(req)));
      return send(res, 200, response);
    }
    if (req.method === 'POST' && url.pathname === '/checkout') {
      const tenant = authenticate(req);
      if (usageSummary(db, tenant.id).plan === 'pro') throw new ApiError(409, 'already_pro', 'Tenant already has a Pro subscription.');
      const result = await createCheckout(tenant.id, tenant.stripe_customer_id);
      return send(res, 200, result);
    }
    throw new ApiError(404, 'not_found', 'Endpoint not found.');
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    if (status === 500) console.error('Internal error:', error);
    const headers = status === 429 ? { 'Retry-After': String(secondsUntilNextMonth()) } : {};
    send(res, status, { error: error instanceof ApiError ? error.code : 'internal_error', message: status === 500 ? 'Internal server error.' : error.message, ...(error.details || {}) }, headers);
  }
}

function secondsUntilNextMonth(now = new Date()) {
  return Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - now.getTime()) / 1000);
}

const port = Number(process.env.PORT || 3000);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
createServer(handle).listen(port, '127.0.0.1', () => console.log(`Aster Meter listening at http://localhost:${port}`));
