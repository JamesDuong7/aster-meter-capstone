import { createHmac, timingSafeEqual } from 'node:crypto';
import { transaction } from './db.js';
import { ApiError } from './meter.js';

export function verifyStripeSignature(raw, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret?.startsWith('whsec_')) throw new ApiError(503, 'stripe_unconfigured', 'Stripe webhook secret is not configured.');
  const parts = Object.fromEntries(String(header || '').split(',').map(part => part.trim().split('=', 2)));
  const timestamp = Number(parts.t);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) throw new ApiError(400, 'invalid_signature', 'Invalid Stripe signature or timestamp.');
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  const signatures = String(header).split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!signatures.some(signature => /^[a-f0-9]{64}$/.test(signature) && timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex')))) {
    throw new ApiError(400, 'invalid_signature', 'Invalid Stripe signature or timestamp.');
  }
}

function mapStatus(status) {
  if (status === 'active' || status === 'trialing') return status;
  if (status === 'past_due' || status === 'unpaid') return 'past_due';
  if (status === 'canceled') return 'canceled';
  return 'inactive';
}

export function processStripeEvent(db, event) {
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string' || !Number.isSafeInteger(event.created) || !event.data?.object) {
    throw new ApiError(400, 'invalid_event', 'Malformed Stripe event.');
  }
  if (event.livemode === true) throw new ApiError(400, 'live_mode_rejected', 'Only Stripe test-mode events are accepted.');
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM stripe_events WHERE event_id=?').get(event.id)) return { received: true, duplicate: true };
    const obj = event.data.object;
    if (event.type === 'checkout.session.completed') {
      const tenantId = obj.client_reference_id || obj.metadata?.tenant_id;
      const subscriptionId = typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id;
      const tenant = db.prepare('SELECT id FROM tenants WHERE id=?').get(tenantId);
      if (!tenant || obj.mode !== 'subscription' || !subscriptionId || !obj.customer || !['paid','no_payment_required'].includes(obj.payment_status)) throw new ApiError(400, 'invalid_checkout', 'Checkout event does not identify a paid or trialing tenant subscription.');
      // A completed subscription Checkout is Stripe's signed activation signal.
      db.prepare('UPDATE tenants SET stripe_customer_id=? WHERE id=?').run(obj.customer, tenantId);
      updateSubscription(db, tenantId, 'pro', 'active', subscriptionId, event);
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const tenantId = obj.metadata?.tenant_id || db.prepare('SELECT tenant_id FROM subscriptions WHERE stripe_subscription_id=?').get(obj.id)?.tenant_id;
      if (!tenantId || !db.prepare('SELECT 1 FROM tenants WHERE id=?').get(tenantId)) throw new ApiError(400, 'unknown_tenant', 'Subscription event does not identify a known tenant.');
      const status = event.type.endsWith('deleted') ? 'canceled' : mapStatus(obj.status);
      updateSubscription(db, tenantId, status === 'active' || status === 'trialing' ? 'pro' : 'free', status === 'canceled' ? 'active' : status, obj.id, event);
    }
    db.prepare('INSERT INTO stripe_events (event_id,event_type) VALUES (?,?)').run(event.id,event.type);
    return { received: true, duplicate: false };
  });
}

function updateSubscription(db, tenantId, plan, status, stripeId, event) {
  const current = db.prepare('SELECT last_stripe_event_created,last_stripe_event_id FROM subscriptions WHERE tenant_id=?').get(tenantId);
  if (!current) throw new ApiError(400, 'unknown_tenant', 'Tenant subscription does not exist.');
  if (event.created < current.last_stripe_event_created || (event.created === current.last_stripe_event_created && event.id <= current.last_stripe_event_id)) return;
  db.prepare(`UPDATE subscriptions SET plan_id=?,status=?,stripe_subscription_id=?,last_stripe_event_created=?,last_stripe_event_id=?,updated_at=datetime('now') WHERE tenant_id=?`)
    .run(plan,status,stripeId,event.created,event.id,tenantId);
}

export async function createCheckout(tenantId, customerId) {
  const key = process.env.STRIPE_SECRET_KEY;
  const price = process.env.STRIPE_PRO_PRICE_ID;
  const base = process.env.BASE_URL || 'http://localhost:3000';
  if (!key?.startsWith('sk_test_') || !price?.startsWith('price_')) throw new ApiError(503, 'stripe_unconfigured', 'Stripe test credentials and Pro price are required.');
  const body = new URLSearchParams({ mode: 'subscription', 'line_items[0][price]': price,
    'line_items[0][quantity]': '1', client_reference_id: tenantId,
    'payment_method_types[0]': 'card',
    'subscription_data[metadata][tenant_id]': tenantId,
    success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/checkout/cancel` });
  if (customerId) body.set('customer', customerId);
  let response;
  try { response = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: {
    Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded'
  }, body, signal: AbortSignal.timeout(10000) }); }
  catch { throw new ApiError(502, 'stripe_unavailable', 'Could not reach Stripe test mode.'); }
  const data = await response.json();
  if (!response.ok) throw new ApiError(502, 'stripe_checkout_failed', data.error?.message || 'Stripe rejected the Checkout session.');
  return { checkoutUrl: data.url, sessionId: data.id };
}
