// PHASE 2: Make the activation/plan flow actually executable.
//
// A1. Backfill MSISDN Pool with all 27 currently-active MSISDNs (Status=Assigned)
// A2. Backfill SIM Inventory with all 27 currently-active SIMs (Status=Activated)
// A3. Add Current Plan ref column on Subscriptions + populate from active SPAs
// A4. Add Total Allowance Remaining rollup on Subscriptions (per-bucket needs filtering — skip)
// D1. Add Verification Method column to Customer Identifications (+ default values)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const APP_ID = 'afe8c4540708da6ca9e6fe79';

const TABLE_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.table-ids.json'), 'utf8'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const colMapCache = new Map();

async function api(method, url, body) {
  const opts = { method, headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  for (let i=0; i<6; i++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (res.status === 429) { await sleep(2500); continue; }
    return data;
  }
}
async function colMap(t) {
  if (colMapCache.has(t)) return colMapCache.get(t);
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[t]}`);
  const cols = r.columnsMetaData || r.data?.columnsMetaData || [];
  const m = {}; for (const c of cols) m[c.name] = c.id;
  colMapCache.set(t, m); return m;
}
async function fullCols(t) {
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[t]}`);
  return r.columnsMetaData || r.data?.columnsMetaData || [];
}
async function fetchAll(t, body = {}) {
  const all = []; let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[t]}/paged-record?pageNo=${page}&pageSize=200`, body);
    const batch = r?.data || []; all.push(...batch);
    if (batch.length < 200) break;
    page++; await sleep(500);
  }
  return all;
}
async function insert(t, cellsByName) {
  const m = await colMap(t);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) if (m[k]) cellsById[m[k]] = v;
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[t]}/record`, { cells: cellsById });
  await sleep(900);
  return r?.data?.[0]?._id || r?.data?._id || r?._id;
}
async function update(t, id, cellsByName) {
  const m = await colMap(t);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) if (m[k]) cellsById[m[k]] = v;
  const r = await api('PUT', `/v1/app-builder/table/${TABLE_IDS[t]}/record/${id}`, { cells: cellsById });
  await sleep(900);
  return r;
}
async function addColumn(t, colSpec) {
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[t]}/column/bulk`, { columns: [colSpec] });
  await sleep(1100);
  return r;
}

const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

// ============================================================================

async function main() {
  log('=== Loading existing data ===');
  const subs = await fetchAll('Subscriptions');
  const spas = await fetchAll('Subscription Plan Assignments');
  const tariffs = await fetchAll('Tariff Plans');
  const ids = await fetchAll('Customer Identifications');
  const pool = await fetchAll('MSISDN Pool');
  const sims = await fetchAll('SIM Inventory');

  const mSub = await colMap('Subscriptions');
  const mSpa = await colMap('Subscription Plan Assignments');
  const mPool = await colMap('MSISDN Pool');
  const mSim = await colMap('SIM Inventory');
  log(`  ${subs.length} subs, ${spas.length} SPAs, ${pool.length} pool entries, ${sims.length} SIM entries`);

  // ==========================================================================
  // A1. Backfill MSISDN Pool
  // ==========================================================================
  log('=== A1: Backfilling MSISDN Pool ===');
  const existingPoolMsisdns = new Set(pool.map(p => p.cells[mPool['MSISDN']]));
  let poolAdded = 0;
  for (const s of subs) {
    const msisdn = s.cells[mSub['MSISDN']];
    if (!msisdn) continue;
    if (existingPoolMsisdns.has(msisdn)) continue;
    await insert('MSISDN Pool', {
      'MSISDN': msisdn,
      'Status': [3], // Assigned
      'Tier': [1], // Standard
      'Last Assigned Date': s.cells[mSub['Activation Date']] || new Date().toISOString(),
      'Assigned Subscription': [s._id],
      'Notes': 'Backfilled from existing active subscription',
    });
    poolAdded++;
  }
  log(`  → Added ${poolAdded} MSISDNs to pool (now ${pool.length + poolAdded} total)`);

  // ==========================================================================
  // A2. Backfill SIM Inventory
  // ==========================================================================
  log('=== A2: Backfilling SIM Inventory ===');
  const existingIccids = new Set(sims.map(s => s.cells[mSim['ICCID']]));
  let simAdded = 0;
  for (const s of subs) {
    const iccid = s.cells[mSub['ICCID']];
    const imsi = s.cells[mSub['IMSI']];
    if (!iccid || existingIccids.has(iccid)) continue;
    await insert('SIM Inventory', {
      'ICCID': iccid,
      'IMSI': imsi || '',
      'Batch ID': 'BATCH-LEGACY-001',
      'Vendor': 'Gemalto',
      'Status': [3], // Activated
      'Warehouse Location': 'In Field',
      'Active Subscription': [s._id],
    });
    simAdded++;
  }
  log(`  → Added ${simAdded} SIMs to inventory (now ${sims.length + simAdded} total)`);

  // ==========================================================================
  // A3. Add Current Plan ref column on Subscriptions
  // ==========================================================================
  log('=== A3: Add Current Plan ref column on Subscriptions ===');
  const subCols = await fullCols('Subscriptions');
  const hasCurrentPlan = subCols.find(c => c.name === 'Current Plan');
  if (!hasCurrentPlan) {
    await addColumn('Subscriptions', {
      name: 'Current Plan',
      type: 'ref',
      refTable: { _id: TABLE_IDS['Tariff Plans'] },
      required: false,
    });
    log('  → Added Current Plan ref column');

    // Set refTable.colId so it shows the plan name
    const refreshed = await fullCols('Subscriptions');
    const cpCol = refreshed.find(c => c.name === 'Current Plan');
    const tariffCols = await fullCols('Tariff Plans');
    const planNameCol = tariffCols.find(c => c.name === 'Plan Name' && c.type === 'text');
    if (cpCol && planNameCol) {
      await api('PUT', `/v1/app-builder/table/${TABLE_IDS['Subscriptions']}/column/${cpCol.id}`,
        { refTable: { _id: TABLE_IDS['Tariff Plans'], colId: planNameCol.id } });
      log('  → Set refTable.colId so it displays Plan Name');
    }
  } else {
    log('  → Current Plan column already exists');
  }

  // Now populate it from active SPAs
  log('  Populating Current Plan from active SPAs...');
  let popCount = 0;
  for (const s of subs) {
    const activeSpa = spas.find(a =>
      a.cells[mSpa['Subscription']]?.[0] === s._id && !a.cells[mSpa['Effective To']]
    );
    if (!activeSpa) continue;
    const tariffId = activeSpa.cells[mSpa['Tariff Plan']]?.[0];
    if (!tariffId) continue;
    await update('Subscriptions', s._id, { 'Current Plan': [tariffId] });
    popCount++;
  }
  log(`  → Populated ${popCount} subscriptions with their current plan`);

  // ==========================================================================
  // A4. Add rollup columns on Subscriptions for Data/Voice/SMS Remaining
  //     Note: rollups can't filter by rating_group out of the box. We'll add
  //     a single "Total Allowance Buckets" rollup as a count, plus a separate
  //     summing approach via 3 rollups won't work without per-RG sub-references.
  //     Skipping per-bucket rollups — the dashboard handles per-bucket display.
  // ==========================================================================
  log('=== A4: Skipping per-bucket rollups (need filterable rollups; not supported)');

  // ==========================================================================
  // D1. Add Verification Method column to Customer Identifications
  // ==========================================================================
  log('=== D1: Add Verification Method column ===');
  const idCols = await fullCols('Customer Identifications');
  if (!idCols.find(c => c.name === 'Verification Method')) {
    await addColumn('Customer Identifications', {
      name: 'Verification Method',
      type: 'select',
      options: [
        { id: 1, name: 'Manual' },
        { id: 2, name: 'DigiLocker API' },
        { id: 3, name: 'OTP e-KYC' },
        { id: 4, name: 'Video KYC' },
        { id: 5, name: 'Document Upload' },
      ],
      required: false,
    });
    log('  → Added Verification Method column');
  } else {
    log('  → Verification Method already exists');
  }
  // Default existing ones to "Document Upload"
  const mId = await colMap('Customer Identifications');
  let kycSet = 0;
  for (const id of ids) {
    const verified = id.cells[mId['Verified']];
    const hasMethod = id.cells[mId['Verification Method']];
    if (verified && !hasMethod) {
      await update('Customer Identifications', id._id, { 'Verification Method': [5] });
      kycSet++;
    }
  }
  log(`  → Set Verification Method = "Document Upload" on ${kycSet} verified KYC records`);

  log('');
  log('=== PHASE 2 SCHEMA FIXES COMPLETE ===');
}

main().catch(e => { console.error(e); process.exit(1); });
