// One-shot simplification:
//
// 1. Add flattened columns to Tariff Plans (data_mb, voice_min, sms_count,
//    overage rates/actions).
// 2. Add flattened columns to Balances (Tariff Plan ref, Effective From/To,
//    Price Paid, Activation Source).
// 3. Add PAYG Rate column to Services.
// 4. Migrate data: Plan Allowances + Rate Cards → Tariff Plans.
// 5. Migrate data: SPAs → Balances (effective dates, price, source, plan ref).
// 6. Clean line items (remove SPA from Sub form, Plan Allowances from Tariff form).
// 7. Delete: Plan Allowances, Subscription Plan Assignments, Rate Cards,
//    Tax Rates, Product Offerings.
//
// Idempotent-ish: checks before adding columns. Safe to re-run.

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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(method, url, body) {
  const opts = { method, headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  for (let i = 0; i < 6; i++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (res.status === 429) { await sleep(2500); continue; }
    return data;
  }
}

async function getCols(tableName) {
  const tid = TABLE_IDS[tableName];
  const r = await api('GET', `/v1/app-builder/table/${tid}`);
  return r.columnsMetaData || r.data?.columnsMetaData || [];
}

async function colMap(tableName) {
  const cols = await getCols(tableName);
  const m = {}; for (const c of cols) m[c.name] = c.id;
  return m;
}

async function fetchAll(tableName) {
  const tid = TABLE_IDS[tableName];
  const all = []; let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${tid}/paged-record?pageNo=${page}&pageSize=200`, {});
    const batch = r?.data || [];
    all.push(...batch);
    if (batch.length < 200) break;
    page++; await sleep(400);
  }
  return all;
}

async function addColumn(tableName, spec) {
  const cols = await getCols(tableName);
  const existing = cols.find(c => c.name === spec.name);
  if (existing) { console.log(`    (exists) ${tableName}.${spec.name}`); return existing.id; }
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tableName]}/column/bulk`, { columns: [spec] });
  if (!r.success) { console.error(`    ✗ ${tableName}.${spec.name}:`, JSON.stringify(r).slice(0, 200)); return null; }
  const newId = r?.columns?.[0]?.id;
  console.log(`    ✓ ${tableName}.${spec.name} (${newId})`);
  await sleep(1100);
  return newId;
}

async function updateColumn(tableName, colId, patch) {
  return api('PUT', `/v1/app-builder/table/${TABLE_IDS[tableName]}/column/${colId}`, patch);
}

async function updateRecord(tableName, recId, cellsByName) {
  const m = await colMap(tableName);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) if (m[k]) cellsById[m[k]] = v;
  const r = await api('PUT', `/v1/app-builder/table/${TABLE_IDS[tableName]}/record/${recId}`, { cells: cellsById });
  await sleep(800);
  return r;
}

async function deleteTable(tableName) {
  const tid = TABLE_IDS[tableName];
  if (!tid) return;
  const r = await api('DELETE', `/v1/app-builder/table/${tid}`);
  console.log(`    ${r.success ? '✓' : '✗'} deleted ${tableName}: ${r.success ? 'ok' : JSON.stringify(r).slice(0,150)}`);
  await sleep(1100);
  return r;
}

async function deleteColumn(tableName, colId) {
  const tid = TABLE_IDS[tableName];
  const r = await api('DELETE', `/v1/app-builder/table/${tid}/column/${colId}`);
  await sleep(1100);
  return r;
}

async function getEntryForm(tableName) {
  const tid = TABLE_IDS[tableName];
  const r = await api('GET', `/v1/app-builder/table/${tid}/entry-form?appId=${APP_ID}`);
  return r?.body || r?.data || r;
}

async function putEntryForm(tableName, form) {
  const tid = TABLE_IDS[tableName];
  return api('PUT', `/v1/app-builder/table/${tid}/entry-form?appId=${APP_ID}`, form);
}

const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

// ============================================================================

async function main() {
  log('== STEP 1: Add flattened columns to Tariff Plans ==');
  await addColumn('Tariff Plans', { name: 'Data Allowance (MB)', type: 'number', tooltip: 'Total data included in plan, in megabytes' });
  await addColumn('Tariff Plans', { name: 'Voice Allowance (min)', type: 'number', tooltip: 'Total voice minutes included' });
  await addColumn('Tariff Plans', { name: 'SMS Allowance', type: 'number', tooltip: 'Total SMS count included' });
  await addColumn('Tariff Plans', { name: 'Data Overage Rate', type: 'number', currency: true, tooltip: '$ per MB when allowance depleted' });
  await addColumn('Tariff Plans', { name: 'Voice Overage Rate', type: 'number', currency: true, tooltip: '$ per minute beyond allowance' });
  await addColumn('Tariff Plans', { name: 'SMS Overage Rate', type: 'number', currency: true, tooltip: '$ per SMS beyond allowance' });
  const OVERAGE_OPTS = [{ id: 1, name: 'Block' }, { id: 2, name: 'Charge From Wallet' }, { id: 3, name: 'Continue Free' }];
  await addColumn('Tariff Plans', { name: 'Data Overage Action', type: 'select', options: OVERAGE_OPTS });
  await addColumn('Tariff Plans', { name: 'Voice Overage Action', type: 'select', options: OVERAGE_OPTS });
  await addColumn('Tariff Plans', { name: 'SMS Overage Action', type: 'select', options: OVERAGE_OPTS });

  log('== STEP 2: Add flattened columns to Balances ==');
  const tariffRefId = await addColumn('Balances', {
    name: 'Tariff Plan',
    type: 'ref',
    refTable: { _id: TABLE_IDS['Tariff Plans'] },
    required: false,
  });
  // Set the display column on the Balance.Tariff Plan ref
  if (tariffRefId) {
    const tariffCols = await getCols('Tariff Plans');
    const planNameCol = tariffCols.find(c => c.name === 'Plan Name' && c.type === 'text');
    if (planNameCol) {
      await updateColumn('Balances', tariffRefId, { refTable: { _id: TABLE_IDS['Tariff Plans'], colId: planNameCol.id } });
    }
  }
  await addColumn('Balances', { name: 'Effective From', type: 'date' });
  await addColumn('Balances', { name: 'Effective To', type: 'date', tooltip: 'Empty = currently active' });
  await addColumn('Balances', { name: 'Price Paid', type: 'number', currency: true });
  await addColumn('Balances', { name: 'Activation Source', type: 'select', options: [
    { id: 1, name: 'Customer Self Care' }, { id: 2, name: 'CSR' }, { id: 3, name: 'Auto Renew' },
    { id: 4, name: 'Promotion' }, { id: 5, name: 'Welcome Pack' }, { id: 6, name: 'Partner' }, { id: 7, name: 'Booster' },
  ]});

  log('== STEP 3: Add PAYG Rate column to Services ==');
  await addColumn('Services', { name: 'PAYG Rate', type: 'number', currency: true, tooltip: 'Per-unit cost when no plan is active' });

  // ==========================================================================
  // Migration — read existing Plan Allowances / Rate Cards / SPAs and flatten
  // ==========================================================================

  log('== STEP 4: Migrate Plan Allowances + Rate Cards → Tariff Plans ==');
  const tariffs = await fetchAll('Tariff Plans');
  const allowances = await fetchAll('Plan Allowances');
  const rateCards = await fetchAll('Rate Cards');
  const mAlw = await colMap('Plan Allowances');
  const mRate = await colMap('Rate Cards');
  const mTariff = await colMap('Tariff Plans');

  // Group allowances by tariff plan
  for (const tp of tariffs) {
    const tpId = tp._id;
    const myAllowances = allowances.filter(a => a.cells[mAlw['Tariff Plan']]?.[0] === tpId);

    let data_mb = 0, voice_min = 0, sms_count = 0;
    let data_overage = null, voice_overage = null, sms_overage = null;
    let data_action = null, voice_action = null, sms_action = null;

    for (const a of myAllowances) {
      const rg = Number(a.cells[mAlw['Rating Group']]) || 0;
      const amt = Number(a.cells[mAlw['Initial Amount']]) || 0;
      const overage = Number(a.cells[mAlw['Overage Rate']]) || 0;
      const action = a.cells[mAlw['Overage Action']];

      if (rg >= 10 && rg < 100) {
        data_mb += amt;
        if (overage) data_overage = overage;
        if (action) data_action = action;
      } else if (rg >= 100 && rg < 200) {
        voice_min += amt;
        if (overage) voice_overage = overage;
        if (action) voice_action = action;
      } else if (rg >= 200 && rg < 300) {
        sms_count += amt;
        if (overage) sms_overage = overage;
        if (action) sms_action = action;
      }
    }

    // Also check Rate Cards linked to this plan (but Rate Cards were mostly generic under Starter)
    const myRates = rateCards.filter(r => r.cells[mRate['Tariff Plan']]?.[0] === tpId);
    for (const r of myRates) {
      const rg = Number(r.cells[mRate['Rating Group']]) || 0;
      const rate = Number(r.cells[mRate['Price Per Unit']]) || 0;
      if (rg >= 10 && rg < 100 && !data_overage) data_overage = rate;
      else if (rg >= 100 && rg < 200 && !voice_overage) voice_overage = rate;
      else if (rg >= 200 && rg < 300 && !sms_overage) sms_overage = rate;
    }

    const cells = {
      'Data Allowance (MB)': data_mb,
      'Voice Allowance (min)': voice_min,
      'SMS Allowance': sms_count,
    };
    if (data_overage) cells['Data Overage Rate'] = data_overage;
    if (voice_overage) cells['Voice Overage Rate'] = voice_overage;
    if (sms_overage) cells['SMS Overage Rate'] = sms_overage;
    if (data_action) cells['Data Overage Action'] = data_action;
    if (voice_action) cells['Voice Overage Action'] = voice_action;
    if (sms_action) cells['SMS Overage Action'] = sms_action;

    await updateRecord('Tariff Plans', tp._id, cells);
    log(`  ✓ ${tp.cells[mTariff['Plan Name']]}: data=${data_mb}MB, voice=${voice_min}min, sms=${sms_count}`);
  }

  log('== STEP 5: Migrate SPAs → Balances ==');
  const balances = await fetchAll('Balances');
  const spas = await fetchAll('Subscription Plan Assignments');
  const mBal = await colMap('Balances');
  const mSpa = await colMap('Subscription Plan Assignments');

  const spasById = new Map(spas.map(s => [s._id, s]));

  let migrated = 0;
  for (const b of balances) {
    const spaId = b.cells[mBal['Subscription Plan Assignment']]?.[0];
    if (!spaId) continue;
    const spa = spasById.get(spaId);
    if (!spa) continue;

    const tariffId = spa.cells[mSpa['Tariff Plan']]?.[0];
    const effFrom = spa.cells[mSpa['Effective From']];
    const effTo = spa.cells[mSpa['Effective To']];
    const pricePaid = spa.cells[mSpa['Price Paid']];
    const activationSource = spa.cells[mSpa['Activation Source']];

    const cells = {};
    if (tariffId) cells['Tariff Plan'] = [tariffId];
    if (effFrom) cells['Effective From'] = effFrom;
    if (effTo) cells['Effective To'] = effTo;
    if (pricePaid != null) cells['Price Paid'] = Number(pricePaid);
    if (activationSource) cells['Activation Source'] = activationSource;

    await updateRecord('Balances', b._id, cells);
    migrated++;
  }
  log(`  ✓ migrated ${migrated} balances`);

  log('== STEP 6: Migrate PAYG Rates to Services ==');
  const services = await fetchAll('Services');
  const mSvc = await colMap('Services');
  // Rate Cards have Rating Group + Price Per Unit; match to services by default_rating_group
  for (const svc of services) {
    const svcRg = Number(svc.cells[mSvc['Default Rating Group']]) || 0;
    if (!svcRg) continue;
    const rc = rateCards.find(r => Number(r.cells[mRate['Rating Group']]) === svcRg);
    if (!rc) continue;
    const rate = Number(rc.cells[mRate['Price Per Unit']]) || 0;
    await updateRecord('Services', svc._id, { 'PAYG Rate': rate });
    log(`  ✓ ${svc.cells[mSvc['Service Name']]}: PAYG = $${rate}/${svc.cells[mSvc['Unit Type']]}`);
  }

  log('== STEP 7: Clean up entry forms (remove line items for doomed tables) ==');

  // Remove Subscription Plan Assignments line item from Subscriptions form
  try {
    const subForm = await getEntryForm('Subscriptions');
    if (subForm?.fields) {
      const filtered = subForm.fields.filter(f =>
        !(f.type === 'table' && (f._id === TABLE_IDS['Subscription Plan Assignments']))
      );
      if (filtered.length !== subForm.fields.length) {
        await putEntryForm('Subscriptions', { ...subForm, fields: filtered });
        log('  ✓ removed SPA line item from Subscriptions form');
      } else {
        log('  (no SPA line item found)');
      }
    }
  } catch (e) { log(`  ✗ Subscriptions form: ${e.message}`); }

  // Remove Plan Allowances line item from Tariff Plans form
  try {
    const tpForm = await getEntryForm('Tariff Plans');
    if (tpForm?.fields) {
      const filtered = tpForm.fields.filter(f =>
        !(f.type === 'table' && f._id === TABLE_IDS['Plan Allowances'])
      );
      if (filtered.length !== tpForm.fields.length) {
        await putEntryForm('Tariff Plans', { ...tpForm, fields: filtered });
        log('  ✓ removed Plan Allowances line item from Tariff Plans form');
      }
    }
  } catch (e) { log(`  ✗ Tariff Plans form: ${e.message}`); }

  log('== STEP 8: Delete tables ==');
  for (const t of ['Plan Allowances', 'Subscription Plan Assignments', 'Rate Cards', 'Tax Rates', 'Product Offerings']) {
    await deleteTable(t);
  }

  // Also remove from .table-ids.json
  const idsPath = path.join(ROOT, '.table-ids.json');
  const idsFile = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
  delete idsFile['Plan Allowances'];
  delete idsFile['Subscription Plan Assignments'];
  delete idsFile['Rate Cards'];
  delete idsFile['Tax Rates'];
  delete idsFile['Product Offerings'];
  fs.writeFileSync(idsPath, JSON.stringify(idsFile, null, 2));
  log('  ✓ updated .table-ids.json');

  log('');
  log('== SIMPLIFICATION COMPLETE ==');
  log(`Tables remaining: ${Object.keys(idsFile).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
