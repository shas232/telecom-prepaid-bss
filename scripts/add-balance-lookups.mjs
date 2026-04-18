// Add the high-value lookup columns on Balances:
//   MSISDN                  (via Subscription)
//   Plan Validity Days      (via Tariff Plan)
//   Plan Priority           (via Tariff Plan)
//
// Then VERIFY by fetching a balance record and printing all lookup values.

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
  for (let i=0; i<6; i++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (res.status === 429) { await sleep(2500); continue; }
    return data;
  }
}

async function getCols(t) {
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[t]}`);
  return r.columnsMetaData || [];
}

async function addFormula(tname, name, refColId, targetColId, outputType = 'text') {
  const cols = await getCols(tname);
  if (cols.find(c => c.name === name)) {
    console.log(`  (exists) ${tname}.${name}`);
    return cols.find(c => c.name === name).id;
  }
  const spec = {
    name,
    type: 'formula',
    formula: {
      expression: '{V}',
      variablePath: { V: [refColId, targetColId] },
      outputType,
    },
  };
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/column/bulk`, { columns: [spec] });
  if (r.success) {
    const id = r?.columns?.[0]?.id;
    console.log(`  ✓ ${tname}.${name} (${id})`);
    await sleep(1100);
    return id;
  } else {
    console.log(`  ✗ ${tname}.${name}: ${JSON.stringify(r).slice(0, 200)}`);
    return null;
  }
}

async function main() {
  console.log('=== Adding balance lookups ===');

  const balCols = await getCols('Balances');
  const subCols = await getCols('Subscriptions');
  const tariffCols = await getCols('Tariff Plans');

  const balSubRef = balCols.find(c => c.name === 'Subscription' && c.type === 'ref');
  const balTariffRef = balCols.find(c => c.name === 'Tariff Plan' && c.type === 'ref');
  const subMsisdn = subCols.find(c => c.name === 'MSISDN');
  const tariffValidity = tariffCols.find(c => c.name === 'Validity Days');
  const tariffPriority = tariffCols.find(c => c.name === 'Priority On Charge');

  if (!balSubRef) { console.error('  ! Balance.Subscription ref not found'); process.exit(1); }
  if (!balTariffRef) { console.error('  ! Balance.Tariff Plan ref not found'); process.exit(1); }

  await addFormula('Balances', 'MSISDN', balSubRef.id, subMsisdn.id, 'text');
  await addFormula('Balances', 'Plan Validity Days', balTariffRef.id, tariffValidity.id, 'number');
  await addFormula('Balances', 'Plan Priority', balTariffRef.id, tariffPriority.id, 'number');

  console.log('');
  console.log('=== Triggering evaluation on the new formulas (and the existing ones) ===');
  const cols = await getCols('Balances');
  const lookupCols = cols.filter(c =>
    c.type === 'formula' && ['MSISDN', 'Plan Name', 'Plan Price', 'Plan Validity Days', 'Plan Priority', 'Remaining Amount'].includes(c.name)
  );
  // Get all balance IDs
  const allIds = [];
  let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS['Balances']}/paged-record?pageNo=${page}&pageSize=300`, {});
    const batch = r?.data || [];
    allIds.push(...batch.map(b => b._id));
    if (batch.length < 300) break;
    page++; await sleep(300);
  }
  console.log(`  → ${allIds.length} balance IDs`);

  for (const col of lookupCols) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS['Balances']}/evaluate/${col.id}?appId=${APP_ID}`, {
      sessionId: `eval-${col.id}-${Date.now()}`,
      filter: { ids: allIds },
    });
    console.log(`  ${r.success ? '✓' : '✗'} evaluate ${col.name} (${col.id})`);
    await sleep(5000);
  }

  console.log('');
  console.log('=== Verifying (sleeping 20s for async compute) ===');
  await sleep(20000);

  // Fetch a few balances and show their computed values
  const verify = await api('POST', `/v1/app-builder/table/${TABLE_IDS['Balances']}/paged-record?pageNo=1&pageSize=200`, {});
  const rows = verify?.data || [];
  const finalCols = await getCols('Balances');
  const codeCol = finalCols.find(c => c.name === 'Balance Code').id;
  const msisdnCol = finalCols.find(c => c.name === 'MSISDN')?.id;
  const planNameCol = finalCols.find(c => c.name === 'Plan Name')?.id;
  const planPriceCol = finalCols.find(c => c.name === 'Plan Price')?.id;
  const planValidityCol = finalCols.find(c => c.name === 'Plan Validity Days')?.id;
  const planPriorityCol = finalCols.find(c => c.name === 'Plan Priority')?.id;
  const usedCol = finalCols.find(c => c.name === 'Used Amount').id;
  const remainingCol = finalCols.find(c => c.name === 'Remaining Amount').id;

  console.log(`\n  Sample (first 5 balances):`);
  console.log(`  ${'Code'.padEnd(16)} ${'MSISDN'.padEnd(14)} ${'Plan Name'.padEnd(25)} ${'Price'.padEnd(8)} ${'Validity'.padEnd(10)} ${'Prio'.padEnd(6)} ${'Used'.padEnd(10)} ${'Remaining'}`);
  for (const b of rows.slice(0, 5)) {
    const c = b.cells;
    console.log(`  ${String(c[codeCol] || '').padEnd(16)} ${String(c[msisdnCol] || '—').padEnd(14)} ${String(c[planNameCol] || '—').padEnd(25)} ${String(c[planPriceCol] || '—').padEnd(8)} ${String(c[planValidityCol] || '—').padEnd(10)} ${String(c[planPriorityCol] || '—').padEnd(6)} ${String(c[usedCol] || '—').padEnd(10)} ${c[remainingCol] || '—'}`);
  }

  // Count how many records have non-null lookup values
  const msisdnFilled = rows.filter(r => r.cells[msisdnCol]).length;
  const planNameFilled = rows.filter(r => r.cells[planNameCol]).length;
  const planPriceFilled = rows.filter(r => r.cells[planPriceCol]).length;
  const usedFilled = rows.filter(r => r.cells[usedCol] != null).length;
  const remFilled = rows.filter(r => r.cells[remainingCol] != null).length;

  console.log(`\n  Fill rates:`);
  console.log(`    MSISDN:           ${msisdnFilled}/${rows.length}`);
  console.log(`    Plan Name:        ${planNameFilled}/${rows.length}`);
  console.log(`    Plan Price:       ${planPriceFilled}/${rows.length}`);
  console.log(`    Used Amount:      ${usedFilled}/${rows.length}`);
  console.log(`    Remaining Amount: ${remFilled}/${rows.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
