// Finisher: add Usage Transactions for BAL-FAST balances and recompute.

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const APP_ID = 'afe8c4540708da6ca9e6fe79';
const TBL_BALANCES = '9daeb0991b806538ceab887f';
const TBL_USAGE_TX = '5d81244b8bef791c68fdbb49';
const TBL_CHARGING = 'a12c328f7b9c5df56d12ec6c';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function http(method, path, body) {
  const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  for (let i = 0; i < 5; i++) {
    const res = await fetch(BASE_URL + path, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (res.status === 429) { await sleep(3000); continue; }
    return { ok: res.ok, status: res.status, data };
  }
}

async function sql(q, limit = 1000) {
  const r = await http('POST', '/v1/agent/app/sql/execute', { appId: APP_ID, sqlQuery: q, limit });
  return r.data?.data?.rows || [];
}

async function main() {
  const newBal = await sql(`SELECT _id, subscription FROM a1776271424351_balances WHERE _deleted=0 AND balance_code LIKE 'BAL-FAST-%'`);
  const seen = new Set();
  const unique = newBal.filter(b => { if (seen.has(b._id)) return false; seen.add(b._id); return true; });
  console.log(`Unique BAL-FAST balances: ${unique.length}`);

  // Get a charging session to reference
  const cs = await sql(`SELECT _id FROM a1776271424351_charging_sessions WHERE _deleted=0 LIMIT 1`);
  const csId = cs[0]?._id;
  console.log(`Using charging session: ${csId}`);

  // Insert usage transactions
  const rows = unique.map(b => ({
    cells: {
      umgX: 1900,
      '2DAb': [b._id],
      ZaUH: b.subscription ? [b.subscription] : undefined,
      I5xQ: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
      xuuQ: 10,
      HtGT: [1],        // Unit Type = MB
      AjeI: [2],        // Message Type = CCR-U
      Beg1: [csId],     // Charging Session ref
    },
  }));
  // remove undefined
  for (const r of rows) for (const k of Object.keys(r.cells)) if (r.cells[k] === undefined) delete r.cells[k];

  const r = await http('POST', `/v1/app-builder/table/${TBL_USAGE_TX}/record-bulk?appId=${APP_ID}`, { arr: rows });
  console.log('Insert result:', JSON.stringify(r.data).slice(0, 400));

  // Touch balances to force recompute
  console.log('\nTouching balances...');
  for (const b of unique) {
    await http('PUT', `/v1/app-builder/table/${TBL_BALANCES}/record/${b._id}?appId=${APP_ID}`, { cells: {} });
    await sleep(200);
  }

  // Evaluate rollup + formulas
  console.log('Evaluating Used Amount, Remaining, Is Low Balance...');
  const ids = unique.map(b => b._id);
  for (const colId of ['mo1lqr6ldhc5w', 'ylwC', 'oso4']) {
    const r2 = await http('POST', `/v1/app-builder/table/${TBL_BALANCES}/evaluate/${colId}?appId=${APP_ID}`, {
      sessionId: `seed-${colId}-${Date.now()}`,
      filter: { ids },
    });
    console.log(`  ${colId}: ok=${r2.ok} status=${r2.status}`);
    await sleep(500);
  }

  console.log('\nWait 20s then verify...');
  await sleep(20000);

  const v = await sql(`SELECT balance_code, initial_amount, used_amount, remaining_amount, is_low_balance, cycle_start FROM a1776271424351_balances WHERE _deleted=0 AND balance_code LIKE 'BAL-FAST-%'`);
  const dedupedV = [];
  const s2 = new Set();
  for (const r of v) { const k = r.balance_code; if (!s2.has(k)) { s2.add(k); dedupedV.push(r); } }
  for (const r of dedupedV) console.log(`  ${r.balance_code} init=${r.initial_amount} used=${r.used_amount} rem=${r.remaining_amount} low=${r.is_low_balance} cs=${r.cycle_start}`);

  const q = await sql(`SELECT count() c FROM a1776271424351_balances WHERE _deleted=0 AND is_low_balance=1 AND cycle_start > now() - INTERVAL 2 DAY`);
  console.log(`\nLow-balance-in-2d count: ${q[0]?.c}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
