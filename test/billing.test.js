import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { openDatabase } from '../src/db.js';
import { costMicrocents, money } from '../src/pricing.js';
import { recordUsage, usageSummary } from '../src/meter.js';
import { processStripeEvent, verifyStripeSignature } from '../src/stripe.js';

function fixture() {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO tenants (id,name,api_key_hash) VALUES (?,?,?)').run('alpha','Alpha',createHash('sha256').update('alpha-key').digest('hex'));
  db.prepare('INSERT INTO tenants (id,name,api_key_hash) VALUES (?,?,?)').run('beta','Beta',createHash('sha256').update('beta-key').digest('hex'));
  db.prepare("INSERT INTO subscriptions (tenant_id,plan_id,status) VALUES ('alpha','free','active')").run();
  db.prepare("INSERT INTO subscriptions (tenant_id,plan_id,status) VALUES ('beta','free','active')").run();
  return db;
}

const now = new Date('2026-10-11T12:00:00Z');

test('cached input is cheaper and reasoning is priced as output with exact integers', () => {
  const cost = costMicrocents({ api_calls: 1, input_tokens: 1_000_000, cached_input_tokens: 1_000_000,
    output_tokens: 1_000_000, reasoning_tokens: 1_000_000 });
  assert.equal(cost, 1_850_500_000);
  assert.deepEqual(money(cost), { currency: 'USD', microcents: cost, centsRounded: 1851, dollars: '18.50500000' });
  assert.equal(money(50).dollars, '0.00000050');
});

test('retry mirrors first response and inserts one event; changed body conflicts', () => {
  const db = fixture();
  const first = recordUsage(db,'alpha','repeat-key-001',{ input_tokens: 100 },now);
  const second = recordUsage(db,'alpha','repeat-key-001',{ input_tokens: 100 },now);
  assert.deepEqual(second,first);
  assert.equal(db.prepare('SELECT count(*) AS n FROM usage_events').get().n,1);
  assert.throws(() => recordUsage(db,'alpha','repeat-key-001',{ input_tokens: 101 },now), e => e.status === 409);
  assert.equal(db.prepare('SELECT count(*) AS n FROM usage_events').get().n,1);
});

test('quota allows exact boundary and rejects one more with 429; tenants stay isolated', () => {
  const db = fixture();
  recordUsage(db,'alpha','boundary-001',{ input_tokens: 100_000 },now);
  const atBoundary = usageSummary(db,'alpha','2026-10');
  assert.equal(atBoundary.used.tokens,100_000);
  assert.equal(atBoundary.used.apiCalls,1);
  assert.throws(() => recordUsage(db,'alpha','boundary-002',{ input_tokens: 1 },now), e => e.status === 429 && e.code === 'quota_exceeded');
  assert.equal(usageSummary(db,'beta','2026-10').used.tokens,0);
});

test('inactive subscription returns 402 without recording usage', () => {
  const db = fixture();
  db.prepare("UPDATE subscriptions SET status='past_due' WHERE tenant_id='alpha'").run();
  assert.throws(() => recordUsage(db,'alpha','inactive-001',{},now), e => e.status === 402);
  assert.equal(db.prepare('SELECT count(*) AS n FROM usage_events').get().n,0);
});

test('bad input is a clean 400 and never writes usage', () => {
  const db = fixture();
  assert.throws(() => recordUsage(db,'alpha','bad-input-001',{ input_tokens: -1 },now), e => e.status === 400);
  assert.throws(() => recordUsage(db,'alpha','bad-input-002',{ input_tokens: 1.5 },now), e => e.status === 400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM usage_events').get().n,0);
});

test('signed checkout upgrades once, stale webhook cannot undo it, forged signature fails', () => {
  const db = fixture();
  const event = { id: 'evt_checkout_001', type: 'checkout.session.completed', created: 1_760_000_000,
    data: { object: { mode: 'subscription', payment_status: 'paid', client_reference_id: 'alpha', subscription: 'sub_123', customer: 'cus_123' } } };
  const raw = JSON.stringify(event);
  const t = 1_760_000_000;
  const secret = 'whsec_testsecret';
  const sig = createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex');
  verifyStripeSignature(raw,`t=${t},v1=${sig}`,secret,t);
  assert.throws(() => verifyStripeSignature(raw,`t=${t},v1=${'0'.repeat(64)}`,secret,t), e => e.status === 400);
  assert.deepEqual(processStripeEvent(db,event),{ received: true, duplicate: false });
  assert.deepEqual(processStripeEvent(db,event),{ received: true, duplicate: true });
  assert.equal(usageSummary(db,'alpha','2026-10').limit.tokens,10_000_000);
  const stale = { id: 'evt_old', type: 'customer.subscription.deleted', created: t - 1,
    data: { object: { id: 'sub_123', metadata: { tenant_id: 'alpha' } } } };
  processStripeEvent(db,stale);
  assert.equal(usageSummary(db,'alpha','2026-10').plan,'pro');
  assert.equal(db.prepare('SELECT count(*) AS n FROM stripe_events WHERE event_id=?').get(event.id).n,1);
});

test('unpaid and live-mode Stripe events never change the plan', () => {
  const db = fixture();
  const event = { id: 'evt_unpaid', type: 'checkout.session.completed', created: 1_760_000_000,
    data: { object: { mode: 'subscription', payment_status: 'unpaid', client_reference_id: 'alpha', subscription: 'sub_999', customer: 'cus_999' } } };
  assert.throws(() => processStripeEvent(db,event), e => e.status === 400);
  assert.throws(() => processStripeEvent(db,{ ...event, livemode: true, id: 'evt_live' }), e => e.status === 400);
  assert.equal(usageSummary(db,'alpha','2026-10').plan,'free');
});
