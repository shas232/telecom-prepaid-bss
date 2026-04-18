// Add the 9 §6 rollup/lookup columns still missing from the app.
// Reuses the rollup / formula shapes validated by rebuild-formulas-and-rollups.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const APP_ID = 'afe8c4540708da6ca9e6fe79';
const TABLE_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.table-ids.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  for (let i = 0; i < 4; i++) {
    const r = await fetch(BASE_URL + url, opts);
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { d = { raw: t, status: r.status }; }
    if (r.status === 429) { await sleep(2000); continue; }
    return { ok: r.ok, status: r.status, data: d };
  }
}
const cache = new Map();
async function getCols(tname) {
  if (cache.has(tname)) return cache.get(tname);
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tname]}`);
  const v = r.data.columnsMetaData || [];
  cache.set(tname, v);
  return v;
}
const invalidate = tn => cache.delete(tn);
async function col(tname, name) {
  const cs = await getCols(tname);
  return cs.find(c => c.name === name);
}

async function fetchAllIds(tname) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/paged-record?pageNo=${page}&pageSize=300`, {});
    const b = r.data?.data || [];
    all.push(...b.map(x => x._id));
    if (b.length < 300) break;
    page++;
  }
  return all;
}

async function createLookup(tname, name, refCol, targetTable, targetColName, outputType = 'number') {
  if (await col(tname, name)) { console.log(`  ~ exists ${tname}.${name}`); return; }
  const tgt = await col(targetTable, targetColName);
  if (!tgt) { console.log(`  ✗ target ${targetTable}.${targetColName} not found`); return; }
  const varName = `${refCol.name}->${targetColName}`;
  const spec = {
    name, type: 'formula',
    formula: {
      expression: `\${${varName}}`,
      variablePath: { [varName]: [refCol.id, tgt.id] },
      outputType,
    },
  };
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/column/bulk`, { columns: [spec] });
  invalidate(tname);
  const id = r.data?.columns?.[0]?.id;
  console.log(`  ${r.data?.success ? '✓' : '✗'} lookup ${tname}.${name} (${id || JSON.stringify(r.data).slice(0, 160)})`);
  return id;
}

async function createRollup(tname, name, childTable, childRefColId, targetCol, fn, outputType = 'number') {
  if (await col(tname, name)) { console.log(`  ~ exists ${tname}.${name}`); return; }
  const aggUpper = fn.toUpperCase();
  const varName = `${childTable}->${targetCol.name}`;
  const spec = {
    name, type: 'rollup',
    refTable: { _id: TABLE_IDS[childTable], colId: childRefColId },
    formula: {
      expression: `${aggUpper}(\${${varName}})`,
      variablePath: { [varName]: [childRefColId, targetCol.id] },
      outputType,
    },
    typeOptions: { aggregation: aggUpper },
  };
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/column/bulk`, { columns: [spec] });
  invalidate(tname);
  const id = r.data?.columns?.[0]?.id;
  console.log(`  ${r.data?.success ? '✓' : '✗'} rollup ${fn} ${tname}.${name} (${id || JSON.stringify(r.data).slice(0, 160)})`);
  return id;
}

async function evalCol(tname, colId) {
  const ids = await fetchAllIds(tname);
  if (!ids.length) return;
  await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/evaluate/${colId}?appId=${APP_ID}`, {
    sessionId: `eval-${colId}-${Date.now()}`, filter: { ids },
  });
}

async function main() {
  const added = [];

  console.log('\n=== Customers ===');
  {
    const walletRef = await col('Customers', 'Wallet');
    if (walletRef) {
      const id = await createLookup('Customers', 'Wallet Balance', walletRef, 'Wallets', 'Current Balance', 'number');
      if (id) added.push(['Customers', id]);
    } else console.log('  ✗ Customers.Wallet ref not found');

    const caseCustRef = await col('Cases', 'Customer');
    const caseId = await col('Cases', 'Case ID') || await col('Cases', 'Subject');
    if (caseCustRef && caseId) {
      const id = await createRollup('Customers', 'Total Cases', 'Cases', caseCustRef.id, caseId, 'count');
      if (id) added.push(['Customers', id]);
    }

    const ixCustRef = await col('Customer Interactions', 'Customer');
    const ixKey = await col('Customer Interactions', 'Interaction Type') || await col('Customer Interactions', 'Timestamp');
    if (ixCustRef && ixKey) {
      const id = await createRollup('Customers', 'Total Interactions', 'Customer Interactions', ixCustRef.id, ixKey, 'count');
      if (id) added.push(['Customers', id]);
    }
  }

  console.log('\n=== Distribution Partners ===');
  {
    const pcPartnerRef = await col('Partner Commissions', 'Partner')
                      || await col('Partner Commissions', 'Distribution Partner');
    const pcAmt = await col('Partner Commissions', 'Commission Amount');
    if (pcPartnerRef && pcAmt) {
      const id = await createRollup('Distribution Partners', 'Total Commission', 'Partner Commissions', pcPartnerRef.id, pcAmt, 'sum');
      if (id) added.push(['Distribution Partners', id]);
    }

    const recPartnerRef = await col('Recharges', 'Distribution Partner') || await col('Recharges', 'Partner');
    const recAmt = await col('Recharges', 'Amount');
    if (recPartnerRef && recAmt) {
      const id1 = await createRollup('Distribution Partners', 'Total Recharges', 'Recharges', recPartnerRef.id, recAmt, 'count');
      if (id1) added.push(['Distribution Partners', id1]);
      const id2 = await createRollup('Distribution Partners', 'Recharge Volume', 'Recharges', recPartnerRef.id, recAmt, 'sum');
      if (id2) added.push(['Distribution Partners', id2]);
    } else console.log('  ✗ Recharges.Distribution Partner ref not found');
  }

  console.log('\n=== Promotions ===');
  {
    const prRef = await col('Promotion Redemptions', 'Promotion');
    const valGranted = await col('Promotion Redemptions', 'Value Granted');
    if (prRef && valGranted) {
      const id1 = await createRollup('Promotions', 'Redemption Count', 'Promotion Redemptions', prRef.id, valGranted, 'count');
      if (id1) added.push(['Promotions', id1]);
      const id2 = await createRollup('Promotions', 'Value Given', 'Promotion Redemptions', prRef.id, valGranted, 'sum');
      if (id2) added.push(['Promotions', id2]);
    }
  }

  console.log('\n=== Charging Sessions ===');
  {
    const utSessRef = await col('Usage Transactions', 'Charging Session');
    const utTs = await col('Usage Transactions', 'Timestamp') || await col('Usage Transactions', 'Event Timestamp');
    if (utSessRef && utTs) {
      const id = await createRollup('Charging Sessions', 'Last Event', 'Usage Transactions', utSessRef.id, utTs, 'max');
      if (id) added.push(['Charging Sessions', id]);
    } else console.log('  ✗ Usage Transactions.Timestamp/Charging Session not found');
  }

  console.log('\n--- Waiting 8s then triggering evaluations ---');
  await sleep(8000);
  for (const [tname, cid] of added) {
    await evalCol(tname, cid);
    await sleep(1000);
  }
  console.log(`\nAdded ${added.length} columns. Eval triggered.`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
