// Fix the 12 broken date formulas. ERPAI formula engine does NOT support
// DATEDIFF/TODAY/NOW/arithmetic-on-dates (confirmed via tests). So we:
//   1. Delete each broken formula column.
//   2. Recreate as a plain "number" column with the same name.
//   3. Compute values in JS and bulk-update every record.
//
// The resulting columns are snapshots of "as of script run time". Running this
// script on a schedule (daily) keeps "Days Since X", "Is Dormant", etc. fresh.

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
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MS_PER_DAY = 86400000;
const NOW = Date.now();

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

async function getCols(tname) {
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tname]}`);
  return r.data.columnsMetaData || [];
}
async function fetchAll(tname) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/paged-record?pageNo=${page}&pageSize=300`, {});
    const b = r.data?.data || [];
    all.push(...b);
    if (b.length < 300) break;
    page++;
  }
  return all;
}

async function replaceCol(tname, name) {
  const cols = await getCols(tname);
  const existing = cols.find(c => c.name === name);
  if (existing) {
    await api('DELETE', `/v1/app-builder/table/${TABLE_IDS[tname]}/column/${existing.id}`);
    await sleep(400);
  }
  const spec = { name, type: 'number', options: [] };
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/column/bulk`, { columns: [spec] });
  const id = r.data?.columns?.[0]?.id;
  console.log(`  ${r.data?.success ? '✓' : '✗'} ${tname}.${name} → number (${id})`);
  return id;
}

async function bulkUpdate(tname, updates) {
  // One record at a time via PUT record/:id — safest across ERPAI versions
  let done = 0, skipped = 0;
  for (const u of updates) {
    if (u.value == null) { skipped++; continue; }
    const body = { cells: { [u.colId]: u.value } };
    const r = await api('PUT', `/v1/app-builder/table/${TABLE_IDS[tname]}/record/${u.rowId}`, body);
    if (r.ok) done++;
    if (done % 50 === 0) await sleep(200);
  }
  console.log(`    updated ${done}/${updates.length} (${skipped} null)`);
}

function daysBetween(aMs, bMs) {
  if (!aMs || !bMs) return null;
  return Math.round((aMs - bMs) / MS_PER_DAY);
}

// ---------- Balances ----------
async function fixBalances() {
  console.log('\n=== Balances ===');
  const cols = await getCols('Balances');
  const effFrom = cols.find(c => c.name === 'Effective From');
  const effTo   = cols.find(c => c.name === 'Effective To');
  const rows = await fetchAll('Balances');

  const daysUntilExpiryId = await replaceCol('Balances', 'Days Until Expiry');
  const daysActiveId      = await replaceCol('Balances', 'Days Active');
  const isExpiredId       = await replaceCol('Balances', 'Is Expired');

  const u1 = [], u2 = [], u3 = [];
  for (const r of rows) {
    const to   = r.cells[effTo.id];
    const from = r.cells[effFrom.id];
    u1.push({ rowId: r._id, colId: daysUntilExpiryId, value: daysBetween(to, NOW) });
    u2.push({ rowId: r._id, colId: daysActiveId,      value: daysBetween(NOW, from) });
    u3.push({ rowId: r._id, colId: isExpiredId,       value: to != null ? (to < NOW ? 1 : 0) : null });
  }
  await bulkUpdate('Balances', u1);
  await bulkUpdate('Balances', u2);
  await bulkUpdate('Balances', u3);
}

// ---------- Wallets ----------
async function fixWallets() {
  console.log('\n=== Wallets ===');
  const cols = await getCols('Wallets');
  const lastRech = cols.find(c => c.name === 'Last Recharge Date');
  const rows = await fetchAll('Wallets');

  const daysSinceId = await replaceCol('Wallets', 'Days Since Last Recharge');
  const isStaleId   = await replaceCol('Wallets', 'Is Stale Wallet');

  const u1 = [], u2 = [];
  for (const r of rows) {
    const t = r.cells[lastRech.id];
    const d = daysBetween(NOW, t);
    u1.push({ rowId: r._id, colId: daysSinceId, value: d });
    u2.push({ rowId: r._id, colId: isStaleId,   value: (d != null && d > 60) ? 1 : 0 });
  }
  await bulkUpdate('Wallets', u1);
  await bulkUpdate('Wallets', u2);
}

// ---------- Cases ----------
async function fixCases() {
  console.log('\n=== Cases ===');
  const cols = await getCols('Cases');
  const opened = cols.find(c => c.name === 'Opened At');
  const resolved = cols.find(c => c.name === 'Resolved At');
  const rows = await fetchAll('Cases');

  const resDaysId  = await replaceCol('Cases', 'Resolution Days');
  const daysOpenId = await replaceCol('Cases', 'Days Open');

  const u1 = [], u2 = [];
  for (const r of rows) {
    const o = r.cells[opened.id];
    const rs = r.cells[resolved.id];
    u1.push({ rowId: r._id, colId: resDaysId,  value: daysBetween(rs, o) });
    u2.push({ rowId: r._id, colId: daysOpenId, value: rs ? daysBetween(rs, o) : daysBetween(NOW, o) });
  }
  await bulkUpdate('Cases', u1);
  await bulkUpdate('Cases', u2);
}

// ---------- Customers ----------
async function fixCustomers() {
  console.log('\n=== Customers ===');
  const cols = await getCols('Customers');
  const onboard = cols.find(c => c.name === 'Onboarded Date');
  const rows = await fetchAll('Customers');

  const daysCustId = await replaceCol('Customers', 'Days as Customer');

  const u = [];
  for (const r of rows) {
    u.push({ rowId: r._id, colId: daysCustId, value: daysBetween(NOW, r.cells[onboard.id]) });
  }
  await bulkUpdate('Customers', u);
}

// ---------- Subscriptions ----------
async function fixSubscriptions() {
  console.log('\n=== Subscriptions ===');
  const cols = await getCols('Subscriptions');
  const activation = cols.find(c => c.name === 'Activation Date');
  const lastUsage  = cols.find(c => c.name === 'Last Usage Date');
  const rows = await fetchAll('Subscriptions');

  const dsActId  = await replaceCol('Subscriptions', 'Days Since Activation');
  const dsUseId  = await replaceCol('Subscriptions', 'Days Since Last Usage');
  const dormId   = await replaceCol('Subscriptions', 'Is Dormant');

  const u1 = [], u2 = [], u3 = [];
  for (const r of rows) {
    const a = r.cells[activation.id];
    const l = r.cells[lastUsage.id];
    const dAct = daysBetween(NOW, a);
    const dUse = daysBetween(NOW, l);
    u1.push({ rowId: r._id, colId: dsActId, value: dAct });
    u2.push({ rowId: r._id, colId: dsUseId, value: dUse });
    u3.push({ rowId: r._id, colId: dormId,  value: (dUse != null && dUse > 30) ? 1 : 0 });
  }
  await bulkUpdate('Subscriptions', u1);
  await bulkUpdate('Subscriptions', u2);
  await bulkUpdate('Subscriptions', u3);
}

// ---------- Charging Sessions ----------
async function fixChargingSessions() {
  console.log('\n=== Charging Sessions ===');
  const cols = await getCols('Charging Sessions');
  const started = cols.find(c => c.name === 'Started At');
  const ended   = cols.find(c => c.name === 'Ended At');
  const rows = await fetchAll('Charging Sessions');

  const durId = await replaceCol('Charging Sessions', 'Session Duration (days)');

  const u = [];
  for (const r of rows) {
    const s = r.cells[started.id];
    const e = r.cells[ended.id];
    u.push({ rowId: r._id, colId: durId, value: (s && e) ? +((e - s) / MS_PER_DAY).toFixed(4) : null });
  }
  await bulkUpdate('Charging Sessions', u);
}

async function main() {
  await fixBalances();
  await fixWallets();
  await fixCases();
  await fixCustomers();
  await fixSubscriptions();
  await fixChargingSessions();
  console.log('\nDone.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
