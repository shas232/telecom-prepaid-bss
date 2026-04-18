// Ruthless full-app audit. Finds everything that's broken, empty, or inconsistent.
// Output: /tmp/telco-audit.json + console summary.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const TABLE_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.table-ids.json'), 'utf8'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  for (let i = 0; i < 4; i++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt, status: res.status }; }
    if (res.status === 429) { await sleep(2000); continue; }
    return data;
  }
}

async function fetchAll(tname) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/paged-record?pageNo=${page}&pageSize=300`, {});
    const b = r?.data || [];
    all.push(...b);
    if (b.length < 300) break;
    page++;
  }
  return all;
}

const SKIP_SYS = new Set(['ID','SFID','CTDT','UTDT','CTBY','UTBY','DFT']);
const SKIP_SYS_NAMES = new Set(['Created At','Updated At','Created By','Updated By','Draft','Sequence Format ID']);

async function main() {
  console.log('Loading schema for all tables...');
  const tables = {};
  for (const tn of Object.keys(TABLE_IDS)) {
    const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tn]}`);
    tables[tn] = r.columnsMetaData || [];
  }

  // id → tableName reverse map
  const idToName = {};
  for (const [n, i] of Object.entries(TABLE_IDS)) idToName[i] = n;

  console.log('Loading records for all tables...');
  const records = {};
  for (const tn of Object.keys(TABLE_IDS)) {
    records[tn] = await fetchAll(tn);
    console.log(`  ${tn}: ${records[tn].length}`);
  }

  const defects = [];

  // =====================================================================
  // AUDIT 1: Empty / dead tables  (tables with 0 records that should have some)
  // =====================================================================
  console.log('\n=== 1. Empty tables ===');
  for (const tn of Object.keys(tables)) {
    if (records[tn].length === 0) {
      defects.push({ sev: 'info', kind: 'empty_table', table: tn, note: 'Table has zero records' });
      console.log(`  EMPTY: ${tn}`);
    }
  }

  // =====================================================================
  // AUDIT 2: Column fill-rates — find columns with 0% fill that shouldn't be empty
  // =====================================================================
  console.log('\n=== 2. Column fill-rate audit ===');
  for (const tn of Object.keys(tables)) {
    const rows = records[tn];
    if (!rows.length) continue;
    const cols = tables[tn];
    for (const c of cols) {
      if (SKIP_SYS.has(c.id) || SKIP_SYS_NAMES.has(c.name)) continue;
      if (c.type === 'related_ref') continue;
      const nn = rows.filter(r => r.cells[c.id] != null && r.cells[c.id] !== '' && (Array.isArray(r.cells[c.id]) ? r.cells[c.id].length > 0 : true)).length;
      const pct = (nn / rows.length) * 100;
      if (nn === 0) {
        const sev = (c.required || c.type === 'ref' || c.type === 'formula' || c.type === 'rollup') ? 'high' : 'med';
        defects.push({ sev, kind: 'empty_column', table: tn, col: c.name, colType: c.type, required: !!c.required, fillRate: '0/' + rows.length });
        console.log(`  [${sev.toUpperCase()}] ${tn}.${c.name} (${c.type}${c.required?' *':''}) — 0/${rows.length}`);
      } else if (pct < 100 && (c.required || c.type === 'formula' || c.type === 'rollup')) {
        defects.push({ sev: 'low', kind: 'partial_column', table: tn, col: c.name, colType: c.type, fillRate: nn + '/' + rows.length });
      }
    }
  }

  // =====================================================================
  // AUDIT 3: Orphan refs — rows whose ref points to a non-existent record
  // =====================================================================
  console.log('\n=== 3. Orphan ref audit ===');
  const indexById = {};
  for (const tn of Object.keys(records)) {
    indexById[tn] = new Set(records[tn].map(r => r._id));
  }
  for (const tn of Object.keys(tables)) {
    const rows = records[tn];
    if (!rows.length) continue;
    for (const c of tables[tn]) {
      if (c.type !== 'ref') continue;
      const targetTableId = c.refTable?._id;
      const targetTable = idToName[targetTableId];
      if (!targetTable) continue;
      const tgtIds = indexById[targetTable];
      const orphans = [];
      for (const r of rows) {
        const v = r.cells[c.id];
        if (v == null) continue;
        const arr = Array.isArray(v) ? v : [v];
        for (const refId of arr) {
          if (!tgtIds.has(refId)) orphans.push({ rowId: r._id, refId });
        }
      }
      if (orphans.length) {
        defects.push({ sev: 'high', kind: 'orphan_ref', table: tn, col: c.name, target: targetTable, count: orphans.length, examples: orphans.slice(0, 3) });
        console.log(`  ORPHAN: ${tn}.${c.name} → ${targetTable} (${orphans.length} rows)`);
      }
    }
  }

  // =====================================================================
  // AUDIT 4: Missing required refs on child rows
  // =====================================================================
  console.log('\n=== 4. Required ref missing ===');
  for (const tn of Object.keys(tables)) {
    const rows = records[tn];
    if (!rows.length) continue;
    for (const c of tables[tn]) {
      if (c.type !== 'ref' || !c.required) continue;
      const missing = rows.filter(r => {
        const v = r.cells[c.id];
        return v == null || (Array.isArray(v) && v.length === 0);
      });
      if (missing.length) {
        defects.push({ sev: 'high', kind: 'missing_required_ref', table: tn, col: c.name, count: missing.length });
        console.log(`  MISSING: ${tn}.${c.name} (required) — ${missing.length}/${rows.length} rows missing ref`);
      }
    }
  }

  // =====================================================================
  // AUDIT 5: Subscriptions without Balances (critical — can't charge if no balances)
  // =====================================================================
  console.log('\n=== 5. Subscriptions without balances ===');
  const balSubCol = tables['Balances'].find(c => c.name === 'Subscription');
  const balSubIds = new Set();
  for (const r of records['Balances']) {
    const v = r.cells[balSubCol.id];
    if (v) (Array.isArray(v) ? v : [v]).forEach(id => balSubIds.add(id));
  }
  const subsNoBalance = records['Subscriptions'].filter(s => !balSubIds.has(s._id));
  if (subsNoBalance.length) {
    defects.push({ sev: 'high', kind: 'subs_without_balance', count: subsNoBalance.length, examples: subsNoBalance.slice(0, 5).map(s => ({ _id: s._id, MSISDN: s.cells['sDya'] })) });
    console.log(`  ${subsNoBalance.length} subs have NO balance buckets`);
    for (const s of subsNoBalance.slice(0, 10)) console.log(`    ${s._id} MSISDN=${s.cells['sDya']}`);
  }

  // =====================================================================
  // AUDIT 6: Customers without subscriptions
  // =====================================================================
  console.log('\n=== 6. Customers without subscriptions ===');
  const subCustCol = tables['Subscriptions'].find(c => c.name === 'Customer');
  const custWithSub = new Set();
  for (const r of records['Subscriptions']) {
    const v = r.cells[subCustCol.id];
    if (v) (Array.isArray(v) ? v : [v]).forEach(id => custWithSub.add(id));
  }
  const custsNoSub = records['Customers'].filter(c => !custWithSub.has(c._id));
  if (custsNoSub.length) {
    defects.push({ sev: 'med', kind: 'customers_without_sub', count: custsNoSub.length, examples: custsNoSub.slice(0, 5).map(c => ({ _id: c._id, Name: c.cells['YbBh'] })) });
    console.log(`  ${custsNoSub.length} customers have NO subscription`);
    for (const c of custsNoSub.slice(0, 10)) console.log(`    ${c.cells['YbBh']}`);
  }

  // =====================================================================
  // AUDIT 7: Usage Transactions without Balance ref (can't be rolled up)
  // =====================================================================
  console.log('\n=== 7. UTs without Balance ref ===');
  const utBalCol = tables['Usage Transactions'].find(c => c.name === 'Balance');
  const utsNoBalance = records['Usage Transactions'].filter(u => {
    const v = u.cells[utBalCol.id];
    return v == null || (Array.isArray(v) && v.length === 0);
  });
  if (utsNoBalance.length) {
    defects.push({ sev: 'high', kind: 'ut_without_balance', count: utsNoBalance.length });
    console.log(`  ${utsNoBalance.length}/${records['Usage Transactions'].length} UTs have NO Balance ref — won't roll up to Used Amount`);
  }

  // =====================================================================
  // AUDIT 8: Charging Sessions without any UT  (stuck/ghost sessions)
  // =====================================================================
  console.log('\n=== 8. Charging Sessions without UTs ===');
  const utSessCol = tables['Usage Transactions'].find(c => c.name === 'Charging Session');
  const sessWithUt = new Set();
  for (const r of records['Usage Transactions']) {
    const v = r.cells[utSessCol.id];
    if (v) (Array.isArray(v) ? v : [v]).forEach(id => sessWithUt.add(id));
  }
  const ghostSessions = records['Charging Sessions'].filter(s => !sessWithUt.has(s._id));
  if (ghostSessions.length) {
    defects.push({ sev: 'med', kind: 'ghost_sessions', count: ghostSessions.length });
    console.log(`  ${ghostSessions.length}/${records['Charging Sessions'].length} Charging Sessions have NO UTs`);
  }

  // =====================================================================
  // AUDIT 9: Balance math sanity — Used > Initial (impossible), Remaining < 0
  // =====================================================================
  console.log('\n=== 9. Balance math sanity ===');
  const bInitId = tables['Balances'].find(c => c.name === 'Initial Amount').id;
  const bUsedId = tables['Balances'].find(c => c.name === 'Used Amount').id;
  const bRemId  = tables['Balances'].find(c => c.name === 'Remaining Amount').id;
  const badMath = [];
  for (const r of records['Balances']) {
    const i = r.cells[bInitId] || 0;
    const u = r.cells[bUsedId] || 0;
    const rem = r.cells[bRemId];
    if (u > i) badMath.push({ _id: r._id, issue: 'used > initial', used: u, initial: i });
    if (rem != null && Math.abs((i - u) - rem) > 0.01) badMath.push({ _id: r._id, issue: 'remaining ≠ initial - used', initial: i, used: u, remaining: rem });
  }
  if (badMath.length) {
    defects.push({ sev: 'high', kind: 'balance_math_inconsistency', count: badMath.length, examples: badMath.slice(0, 5) });
    console.log(`  ${badMath.length} balances have math inconsistency`);
    for (const b of badMath.slice(0, 5)) console.log('   ', b);
  } else {
    console.log(`  All ${records['Balances'].length} balances pass math check`);
  }

  // =====================================================================
  // AUDIT 10: Wallets — Current Balance sanity vs recharges/debits
  // =====================================================================
  console.log('\n=== 10. Wallet balance sanity ===');
  const wtxWalletCol = tables['Wallet Transactions'].find(c => c.name === 'Wallet').id;
  const wtxAmtCol = tables['Wallet Transactions'].find(c => c.name === 'Amount').id;
  const wtxPerWallet = {};
  for (const r of records['Wallet Transactions']) {
    const wids = r.cells[wtxWalletCol] || [];
    const wid = Array.isArray(wids) ? wids[0] : wids;
    if (!wid) continue;
    wtxPerWallet[wid] = (wtxPerWallet[wid] || 0) + (r.cells[wtxAmtCol] || 0);
  }
  const walletBalCol = tables['Wallets'].find(c => c.name === 'Current Balance').id;
  const walletSanity = [];
  for (const w of records['Wallets']) {
    const balance = w.cells[walletBalCol] || 0;
    const wtxSum = wtxPerWallet[w._id] || 0;
    // Check: if there are tx's, the balance shouldn't be wildly off. Just flag negative balances.
    if (balance < 0) walletSanity.push({ _id: w._id, code: w.cells['MjRH'], balance });
  }
  if (walletSanity.length) {
    defects.push({ sev: 'med', kind: 'negative_wallet_balance', count: walletSanity.length, examples: walletSanity.slice(0, 5) });
    console.log(`  ${walletSanity.length} wallets have negative Current Balance`);
  } else {
    console.log(`  No negative wallet balances`);
  }

  // =====================================================================
  // AUDIT 11: Tariff Plans without subscribers
  // =====================================================================
  console.log('\n=== 11. Tariff Plans without active subscribers ===');
  const subPlanCol = tables['Subscriptions'].find(c => c.name === 'Current Plan').id;
  const plansUsed = new Set();
  for (const r of records['Subscriptions']) {
    const v = r.cells[subPlanCol];
    if (v) (Array.isArray(v) ? v : [v]).forEach(id => plansUsed.add(id));
  }
  const unusedPlans = records['Tariff Plans'].filter(p => !plansUsed.has(p._id));
  if (unusedPlans.length) {
    defects.push({ sev: 'info', kind: 'unused_tariff_plan', count: unusedPlans.length, examples: unusedPlans.slice(0, 5).map(p => ({ _id: p._id, name: p.cells['kSbg'] })) });
    console.log(`  ${unusedPlans.length}/${records['Tariff Plans'].length} tariff plans have NO subscribers`);
    for (const p of unusedPlans) console.log(`    ${p.cells['kSbg']}`);
  }

  // =====================================================================
  // AUDIT 12: Recharges without matching Wallet Transaction
  // =====================================================================
  console.log('\n=== 12. Recharges without matching Wallet Transaction ===');
  const wtxRefTypes = tables['Wallet Transactions'].find(c => c.name === 'Reference ID')?.id;
  const wtxRefs = new Set();
  if (wtxRefTypes) {
    for (const r of records['Wallet Transactions']) {
      const v = r.cells[wtxRefTypes];
      if (v) wtxRefs.add(v);
    }
  }
  const rechNoWtx = records['Recharges'].filter(r => !wtxRefs.has(r._id));
  if (rechNoWtx.length) {
    defects.push({ sev: 'med', kind: 'recharge_without_wtx', count: rechNoWtx.length });
    console.log(`  ${rechNoWtx.length}/${records['Recharges'].length} recharges have NO matching Wallet Transaction (no mqMb ref-link back)`);
  }

  // =====================================================================
  // AUDIT 13: Broken formula / rollup columns (still 0 fill across the board)
  // =====================================================================
  console.log('\n=== 13. Broken formula/rollup columns (0% fill) ===');
  const brokenComputed = defects.filter(d => d.kind === 'empty_column' && (d.colType === 'formula' || d.colType === 'rollup'));
  console.log(`  ${brokenComputed.length} computed columns are 0/N:`);
  for (const d of brokenComputed) console.log(`    ${d.table}.${d.col} (${d.colType})`);

  // =====================================================================
  // Summary
  // =====================================================================
  console.log('\n\n================ SUMMARY ================');
  const bySev = { high: 0, med: 0, low: 0, info: 0 };
  for (const d of defects) bySev[d.sev] = (bySev[d.sev] || 0) + 1;
  console.log(`  HIGH: ${bySev.high}   MED: ${bySev.med}   LOW: ${bySev.low}   INFO: ${bySev.info}`);
  console.log(`  Total defects: ${defects.length}`);

  fs.writeFileSync('/tmp/telco-audit.json', JSON.stringify(defects, null, 2));
  console.log('  Full report → /tmp/telco-audit.json');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
