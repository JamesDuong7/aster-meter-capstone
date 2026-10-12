import { createHash } from 'node:crypto';
import { costMicrocents, money, tokenTotal } from './pricing.js';
import { transaction } from './db.js';

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validateUsage(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'invalid_body', 'Expected a JSON object.');
  const allowed = new Set(['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_tokens']);
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw new ApiError(400, 'invalid_field', `Unexpected field: ${key}`);
  const usage = { api_calls: 1 };
  for (const key of allowed) {
    const value = body[key] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0 || value > 10_000_000) throw new ApiError(400, 'invalid_quantity', `${key} must be an integer from 0 to 10,000,000.`);
    usage[key] = value;
  }
  return usage;
}

export function currentMonth(now = new Date()) { return now.toISOString().slice(0, 7); }

export function usageSummary(db, tenantId, month = currentMonth()) {
  const row = db.prepare(`SELECT COALESCE(SUM(api_calls),0) AS api_calls,
    COALESCE(SUM(input_tokens),0) AS input_tokens,
    COALESCE(SUM(cached_input_tokens),0) AS cached_input_tokens,
    COALESCE(SUM(output_tokens),0) AS output_tokens,
    COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens,
    COALESCE(SUM(cost_microcents),0) AS cost_microcents
    FROM usage_events WHERE tenant_id=? AND month=?`).get(tenantId, month);
  const sub = db.prepare(`SELECT s.plan_id, s.status, p.api_call_limit, p.token_limit
    FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.tenant_id=?`).get(tenantId);
  if (!sub) throw new ApiError(404, 'tenant_not_found', 'Tenant subscription was not found.');
  return {
    tenantId, month,
    plan: sub.plan_id, subscriptionStatus: sub.status,
    used: { apiCalls: row.api_calls, tokens: row.input_tokens + row.cached_input_tokens + row.output_tokens + row.reasoning_tokens,
      inputTokens: row.input_tokens, cachedInputTokens: row.cached_input_tokens,
      outputTokens: row.output_tokens, reasoningTokens: row.reasoning_tokens },
    limit: { apiCalls: sub.api_call_limit, tokens: sub.token_limit },
    cost: money(row.cost_microcents)
  };
}

export function recordUsage(db, tenantId, key, body, now = new Date()) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new ApiError(400, 'invalid_idempotency_key', 'Idempotency-Key must be 8–128 letters, digits, dots, underscores, colons, or hyphens.');
  const usage = validateUsage(body);
  const hash = createHash('sha256').update(JSON.stringify(usage)).digest('hex');
  return transaction(db, () => {
    const prior = db.prepare('SELECT request_hash, response_json FROM usage_events WHERE tenant_id=? AND idempotency_key=?').get(tenantId, key);
    if (prior) {
      if (prior.request_hash !== hash) throw new ApiError(409, 'idempotency_conflict', 'This Idempotency-Key was already used with different quantities.');
      return JSON.parse(prior.response_json);
    }
    const month = currentMonth(now);
    const summary = usageSummary(db, tenantId, month);
    if (!['active', 'trialing'].includes(summary.subscriptionStatus)) throw new ApiError(402, 'subscription_inactive', 'Subscription is inactive; complete payment or upgrade to continue.', { plan: summary.plan });
    const proposedCalls = summary.used.apiCalls + 1;
    const proposedTokens = summary.used.tokens + tokenTotal(usage);
    if (proposedCalls > summary.limit.apiCalls || proposedTokens > summary.limit.tokens) {
      throw new ApiError(429, 'quota_exceeded', 'Monthly usage quota exceeded. Try again next month or upgrade your plan.', {
        used: summary.used, limit: summary.limit, requested: { apiCalls: 1, tokens: tokenTotal(usage) }
      });
    }
    const cost = costMicrocents(usage);
    const response = {
      accepted: true, tenantId, month, usage: {
        apiCalls: 1, inputTokens: usage.input_tokens, cachedInputTokens: usage.cached_input_tokens,
        outputTokens: usage.output_tokens, reasoningTokens: usage.reasoning_tokens,
        tokens: tokenTotal(usage)
      }, cost: money(cost)
    };
    db.prepare(`INSERT INTO usage_events
      (tenant_id,idempotency_key,request_hash,month,api_calls,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,cost_microcents,response_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(tenantId,key,hash,month,1,usage.input_tokens,usage.cached_input_tokens,usage.output_tokens,usage.reasoning_tokens,cost,JSON.stringify(response));
    return response;
  });
}
