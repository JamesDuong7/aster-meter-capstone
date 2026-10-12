PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  api_call_limit INTEGER NOT NULL CHECK (api_call_limit > 0),
  token_limit INTEGER NOT NULL CHECK (token_limit > 0)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK (status IN ('active','trialing','inactive','past_due','canceled')),
  stripe_subscription_id TEXT UNIQUE,
  last_stripe_event_created INTEGER NOT NULL DEFAULT 0,
  last_stripe_event_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  month TEXT NOT NULL,
  api_calls INTEGER NOT NULL CHECK (api_calls >= 0),
  input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
  cached_input_tokens INTEGER NOT NULL CHECK (cached_input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  reasoning_tokens INTEGER NOT NULL CHECK (reasoning_tokens >= 0),
  cost_microcents INTEGER NOT NULL CHECK (cost_microcents >= 0),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_usage_tenant_month ON usage_events(tenant_id, month);
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS monthly_rollups (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  month TEXT NOT NULL,
  api_calls INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  cost_microcents INTEGER NOT NULL,
  refreshed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, month)
);
