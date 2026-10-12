import { createHash } from 'node:crypto';
import { openDatabase, transaction } from '../src/db.js';
import { loadEnv } from '../src/config.js';

loadEnv();
const db = openDatabase();
const demo = [
  { id: 'demo-orbit', name: 'Orbit Studio', key: 'demo_orbit_key_2026_local_only' },
  { id: 'demo-harbor', name: 'Harbor Studio', key: 'demo_harbor_key_2026_local_only' }
];
transaction(db, () => {
  for (const item of demo) {
    db.prepare('INSERT OR IGNORE INTO tenants (id,name,api_key_hash) VALUES (?,?,?)')
      .run(item.id,item.name,createHash('sha256').update(item.key).digest('hex'));
    db.prepare("INSERT OR IGNORE INTO subscriptions (tenant_id,plan_id,status) VALUES (?,'free','active')").run(item.id);
  }
});
console.log('Seeded demo tenants. These fixed API keys are local demo credentials only:');
for (const item of demo) console.log(`${item.id}: ${item.key}`);
