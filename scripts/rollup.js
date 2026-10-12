import { openDatabase, transaction } from '../src/db.js';
import { loadEnv } from '../src/config.js';

loadEnv();
const db = openDatabase();
async function rebuild() {
  transaction(db, () => {
    db.exec(`INSERT INTO monthly_rollups (tenant_id,month,api_calls,tokens,cost_microcents,refreshed_at)
      SELECT tenant_id,month,SUM(api_calls),SUM(input_tokens+cached_input_tokens+output_tokens+reasoning_tokens),SUM(cost_microcents),datetime('now')
      FROM usage_events GROUP BY tenant_id,month
      ON CONFLICT(tenant_id,month) DO UPDATE SET api_calls=excluded.api_calls,tokens=excluded.tokens,cost_microcents=excluded.cost_microcents,refreshed_at=excluded.refreshed_at`);
  });
}
for (let attempt = 1; attempt <= 3; attempt++) {
  try { await rebuild(); console.log('Monthly rollups refreshed.'); process.exit(0); }
  catch (error) {
    console.error(`Rollup attempt ${attempt} failed:`, error.message);
    if (attempt === 3) { console.error('ALERT: monthly rollup job failed after 3 attempts.'); process.exit(1); }
    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
  }
}
