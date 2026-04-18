#!/usr/bin/env node
// Touch every parent record so rollups/formulas/lookups recompute.
// Per HANDOFF §4.2: rollups only evaluate when a parent is touched
// after children are created. PUT-empty `cells` is idempotent and
// forces the reactive pipeline to re-fire.
//
// Usage:
//   node scripts/touch-all-parents.mjs
//   node scripts/touch-all-parents.mjs --table Customers
//   node scripts/touch-all-parents.mjs --dry-run

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const APP_ID = 'afe8c4540708da6ca9e6fe79';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Parent tables with reactive columns (rollups / formulas / lookups).
// Order: heaviest-child-tables first so downstream tables benefit
// when later tables' rollups include values produced by earlier touches.
const PARENTS = [
  { name: 'Charging Sessions',     id: 'a12c328f7b9c5df56d12ec6c' }, // 3 rollups
  { name: 'Balances',              id: '9daeb0991b806538ceab887f' }, // 1 rollup + 4 formulas
  { name: 'Subscriptions',         id: '495e7f2e36663583722c8ec8' }, // 6 rollups
  { name: 'Wallets',               id: '1ec21f333aa5965f9d9be874' }, // 3 rollups
  { name: 'Roaming Zones',         id: '24d1094cb8dbfe986796b47f' }, // 3 rollups
  { name: 'Roaming Partners',      id: '67677403a5c8dfdc635d5db7' }, // 5 rollups
  { name: 'Device TAC Database',   id: '4c04b742de84d393553ad6bc' }, // 1 rollup
  { name: 'Devices',               id: '7999dd671c34dd97d96c3355' }, // 1 rollup
  { name: 'Tariff Plans',          id: 'f2e797515f347f862e71a641' }, // 2 rollups + formula
  { name: 'Promotions',            id: '97001d68b5c1521d0332eb06' }, // 2 rollups
  { name: 'Distribution Partners', id: '516584eb1195eaacb54404d9' }, // 3 rollups
  { name: 'Customers',             id: 'aed243e6c13b8f5194724d76' }, // 8 rollups — touched last
];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const TABLE_FLAG_IDX = args.indexOf('--table');
const TABLE_FILTER = TABLE_FLAG_IDX >= 0 ? args[TABLE_FLAG_IDX + 1] : null;

// Rate limit: 60 req/min. 150ms sleep + pool of 3 keeps us under cap.
const PUT_INTERVAL_MS = 150;
const PUT_POOL = 3;

async function api(method, url, body) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (touch-all-parents)',
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  for (let attempt = 0; attempt < 6; attempt++) {
    let res, txt;
    try {
      res = await fetch(BASE_URL + url, opts);
      txt = await res.text();
    } catch (e) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (res.status === 429) {
      await sleep(3000);
      continue;
    }
    return { ok: res.ok, status: res.status, data };
  }
  return { ok: false, status: 0, data: { error: 'exhausted retries' } };
}

async function fetchAllIds(tableId, tableName) {
  const ids = [];
  let page = 1;
  while (true) {
    const r = await api(
      'POST',
      `/v1/app-builder/table/${tableId}/paged-record?pageNo=${page}&pageSize=300&appId=${APP_ID}`,
      {},
    );
    if (!r.ok) {
      console.error(`  [${tableName}] page ${page} fetch failed: ${r.status}`);
      break;
    }
    const batch = r.data?.data || [];
    for (const row of batch) if (row?._id) ids.push(row._id);
    if (batch.length < 300) break;
    page++;
  }
  return ids;
}

async function touchRecord(tableId, recordId) {
  return api(
    'PUT',
    `/v1/app-builder/table/${tableId}/record/${recordId}?appId=${APP_ID}`,
    { cells: {} },
  );
}

async function touchTable(parent, results) {
  const { name, id } = parent;
  console.log(`\n=== ${name} (${id}) ===`);
  const recordIds = await fetchAllIds(id, name);
  console.log(`  Found ${recordIds.length} live records`);
  results.perTable[name] = { total: recordIds.length, touched: 0, failed: 0, errors: [] };

  if (DRY_RUN) {
    console.log(`  [dry-run] would touch ${recordIds.length} records`);
    return;
  }

  // Async pool: PUT_POOL in flight, min PUT_INTERVAL_MS between PUT dispatches.
  let idx = 0;
  let lastDispatch = 0;
  let rate429 = 0;

  async function worker() {
    while (true) {
      const myIdx = idx++;
      if (myIdx >= recordIds.length) return;
      // Global pacing across all workers.
      const now = Date.now();
      const wait = Math.max(0, lastDispatch + PUT_INTERVAL_MS - now);
      if (wait > 0) await sleep(wait);
      lastDispatch = Date.now();

      const rid = recordIds[myIdx];
      const r = await touchRecord(id, rid);
      if (r.ok) {
        results.perTable[name].touched++;
      } else {
        results.perTable[name].failed++;
        if (r.status === 429) rate429++;
        if (results.perTable[name].errors.length < 10) {
          results.perTable[name].errors.push(
            `id=${rid} status=${r.status} ${JSON.stringify(r.data).slice(0, 140)}`,
          );
        }
      }
      if ((myIdx + 1) % 50 === 0) {
        console.log(`  ... ${myIdx + 1}/${recordIds.length} (failed=${results.perTable[name].failed})`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(PUT_POOL, recordIds.length) }, worker);
  await Promise.all(workers);
  results.perTable[name].rate429 = rate429;
  console.log(
    `  Done: touched=${results.perTable[name].touched} failed=${results.perTable[name].failed} 429s=${rate429}`,
  );
}

async function main() {
  const t0 = Date.now();
  const targets = TABLE_FILTER ? PARENTS.filter(p => p.name === TABLE_FILTER) : PARENTS;
  if (!targets.length) {
    console.error(`No table matches --table "${TABLE_FILTER}". Available: ${PARENTS.map(p => p.name).join(', ')}`);
    process.exit(1);
  }

  console.log(
    `touch-all-parents.mjs  tables=${targets.length}  dry-run=${DRY_RUN}  pool=${PUT_POOL}  interval=${PUT_INTERVAL_MS}ms`,
  );

  const results = { perTable: {}, totalTouched: 0, totalFailed: 0, total429: 0 };

  for (const parent of targets) {
    await touchTable(parent, results);
  }

  for (const t of Object.values(results.perTable)) {
    results.totalTouched += t.touched || 0;
    results.totalFailed += t.failed || 0;
    results.total429 += t.rate429 || 0;
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n=============== SUMMARY ===============`);
  console.log(`Elapsed: ${elapsed}s`);
  console.log(`Total records touched: ${results.totalTouched}`);
  console.log(`Total failures: ${results.totalFailed}`);
  console.log(`Total 429s: ${results.total429}`);
  console.log(`\nPer-table counts:`);
  for (const [name, t] of Object.entries(results.perTable)) {
    console.log(`  ${name.padEnd(24)} total=${String(t.total).padStart(5)}  touched=${String(t.touched || 0).padStart(5)}  failed=${String(t.failed || 0).padStart(3)}`);
  }
  if (results.totalFailed > 0) {
    console.log(`\nFirst errors:`);
    for (const [name, t] of Object.entries(results.perTable)) {
      if (!t.errors?.length) continue;
      console.log(`  [${name}]`);
      for (const e of t.errors.slice(0, 10)) console.log(`    ${e}`);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
