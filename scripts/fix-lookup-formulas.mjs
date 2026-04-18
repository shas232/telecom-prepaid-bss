// Delete the broken lookup columns (using {V}) and recreate with the
// actual target column name as the variable — the ERPAI formula engine
// resolves by NAME, not by variablePath mapping.
//
// We delete and recreate MSISDN, Plan Validity Days, Plan Priority, Plan Name,
// Plan Price — keeping Price as the template since it already works.

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

async function main() {
  const BAL = TABLE_IDS['Balances'];

  // Step 1: delete the broken lookup columns
  const balCols = await getCols('Balances');
  const broken = balCols.filter(c =>
    c.type === 'formula' &&
    c.formula?.expression === '{V}' &&
    ['MSISDN', 'Plan Validity Days', 'Plan Priority', 'Plan Name'].includes(c.name)
  );
  console.log(`Found ${broken.length} broken lookup columns`);
  for (const col of broken) {
    console.log(`  deleting ${col.name} (${col.id})...`);
    await api('DELETE', `/v1/app-builder/table/${BAL}/column/${col.id}`);
    await sleep(1100);
  }

  // Step 2: recreate using the ACTUAL target column name in the expression
  // The template 'Tariff Plan->Price' works — the key is using a meaningful name
  // that the engine can resolve. Try using the target field's display name.
  console.log('\nRecreating lookups with correct expression format...');

  const subCols = await getCols('Subscriptions');
  const tariffCols = await getCols('Tariff Plans');

  const balSubRef = balCols.find(c => c.name === 'Subscription' && c.type === 'ref');
  const balTariffRef = balCols.find(c => c.name === 'Tariff Plan' && c.type === 'ref');
  const subMsisdnCol = subCols.find(c => c.name === 'MSISDN');
  const tariffPlanNameCol = tariffCols.find(c => c.name === 'Plan Name');
  const tariffValidityCol = tariffCols.find(c => c.name === 'Validity Days');
  const tariffPriorityCol = tariffCols.find(c => c.name === 'Priority On Charge');

  // Mimic the working Price formula shape exactly
  // Price formula: expression = "${Tariff Plan->Price}", variablePath = { "Tariff Plan->Price": [refId, targetId] }
  async function addLookup(name, refName, refId, targetName, targetId, outputType) {
    const varName = `${refName}->${targetName}`;
    const spec = {
      name,
      type: 'formula',
      formula: {
        expression: `\${${varName}}`,
        variablePath: { [varName]: [refId, targetId] },
        outputType,
      },
    };
    const r = await api('POST', `/v1/app-builder/table/${BAL}/column/bulk`, { columns: [spec] });
    const ok = r.success;
    const id = r?.columns?.[0]?.id;
    console.log(`  ${ok ? '✓' : '✗'} ${name} (${id || JSON.stringify(r).slice(0,150)})`);
    await sleep(1100);
    return id;
  }

  await addLookup('MSISDN', 'Subscription', balSubRef.id, 'MSISDN', subMsisdnCol.id, 'text');
  await addLookup('Plan Name', 'Tariff Plan', balTariffRef.id, 'Plan Name', tariffPlanNameCol.id, 'text');
  await addLookup('Plan Validity Days', 'Tariff Plan', balTariffRef.id, 'Validity Days', tariffValidityCol.id, 'number');
  await addLookup('Plan Priority', 'Tariff Plan', balTariffRef.id, 'Priority On Charge', tariffPriorityCol.id, 'number');

  // Step 3: trigger evaluation
  console.log('\nTriggering evaluation...');
  const allIds = [];
  let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${BAL}/paged-record?pageNo=${page}&pageSize=300`, {});
    const batch = r?.data || [];
    allIds.push(...batch.map(b => b._id));
    if (batch.length < 300) break;
    page++;
  }

  const fresh = await getCols('Balances');
  for (const colName of ['MSISDN', 'Plan Name', 'Plan Validity Days', 'Plan Priority']) {
    const col = fresh.find(c => c.name === colName && c.type === 'formula');
    if (!col) continue;
    const r = await api('POST', `/v1/app-builder/table/${BAL}/evaluate/${col.id}?appId=${APP_ID}`, {
      sessionId: `eval-${col.id}-${Date.now()}`,
      filter: { ids: allIds },
    });
    console.log(`  ${r.success ? '✓' : '✗'} evaluate ${colName}`);
    await sleep(3000);
  }

  console.log('\nWaiting 30s for async settle...');
  await sleep(30000);

  // Verify
  const verify = await api('POST', `/v1/app-builder/table/${BAL}/paged-record?pageNo=1&pageSize=300`, {});
  const rows = verify?.data || [];
  const finalCols = await getCols('Balances');
  const finalMap = {};
  for (const c of finalCols) finalMap[c.name] = c.id;

  const fillRate = (name) => {
    const cid = finalMap[name]; if (!cid) return 'no col';
    return `${rows.filter(r => r.cells[cid] != null && r.cells[cid] !== '').length}/${rows.length}`;
  };
  console.log(`\nFill rates:`);
  console.log(`  MSISDN:              ${fillRate('MSISDN')}`);
  console.log(`  Plan Name:           ${fillRate('Plan Name')}`);
  console.log(`  Plan Price:          ${fillRate('Plan Price')}`);
  console.log(`  Plan Validity Days:  ${fillRate('Plan Validity Days')}`);
  console.log(`  Plan Priority:       ${fillRate('Plan Priority')}`);

  // Show a sample
  console.log(`\nSample (first 5):`);
  for (const b of rows.slice(0, 5)) {
    const c = b.cells;
    console.log(`  ${c[finalMap['Balance Code']] || '—'.padEnd(14)} MSISDN=${c[finalMap['MSISDN']] || '—'}  Plan=${c[finalMap['Plan Name']] || '—'}  $${c[finalMap['Plan Price']] || '—'}  validity=${c[finalMap['Plan Validity Days']] || '—'}d  prio=${c[finalMap['Plan Priority']] || '—'}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
