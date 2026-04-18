// Rebuild all broken {V}-style lookup formulas into the proper
// ${Reference Table->Target Column} format, fix the Balances.Remaining
// Amount variablePath (stale column id), and add useful rollups
// across the core tables.

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
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  for (let i = 0; i < 6; i++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt, status: res.status }; }
    if (res.status === 429) { await sleep(2500); continue; }
    return { ok: res.ok, status: res.status, data };
  }
}

const _tcache = new Map();
async function getTable(tname) {
  if (_tcache.has(tname)) return _tcache.get(tname);
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tname]}`);
  const v = { cols: r.data.columnsMetaData || [] };
  _tcache.set(tname, v);
  return v;
}
function invalidate(tname) { _tcache.delete(tname); }

async function colByName(tname, name) {
  const t = await getTable(tname);
  return t.cols.find(c => c.name === name);
}

async function deleteCol(tname, colId) {
  const r = await api('DELETE', `/v1/app-builder/table/${TABLE_IDS[tname]}/column/${colId}`);
  invalidate(tname);
  return r.ok;
}

async function createLookup(tname, name, refName, refId, targetName, targetId, outputType) {
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
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/column/bulk`, { columns: [spec] });
  invalidate(tname);
  const id = r.data?.columns?.[0]?.id;
  const ok = r.data?.success;
  console.log(`    ${ok ? '✓' : '✗'} ${tname}.${name} (${id || JSON.stringify(r.data).slice(0, 180)})`);
  return id;
}

// Rollup schema based on observed shape of Balances.Used Amount:
//   refTable: { _id: <childTableId>, colId: <childRefColId> }
//   formula:  { expression: "SUM(${Child Table->Target Col})", variablePath: {...}, outputType }
//   typeOptions: { aggregation: "SUM" }
async function createRollup(tname, name, childTable, childRefColId, targetColId, targetColName, fn, outputType = 'number') {
  const aggUpper = fn.toUpperCase();
  const varName = `${childTable}->${targetColName}`;
  const spec = {
    name,
    type: 'rollup',
    refTable: { _id: TABLE_IDS[childTable], colId: childRefColId },
    formula: {
      expression: `${aggUpper}(\${${varName}})`,
      variablePath: { [varName]: [childRefColId, targetColId] },
      outputType,
    },
    typeOptions: { aggregation: aggUpper },
  };
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/column/bulk`, { columns: [spec] });
  invalidate(tname);
  const id = r.data?.columns?.[0]?.id;
  const ok = r.data?.success;
  console.log(`    ${ok ? '✓' : '✗'} rollup ${tname}.${name} (${id || JSON.stringify(r.data).slice(0, 220)})`);
  return id;
}

async function fetchAllIds(tname) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/paged-record?pageNo=${page}&pageSize=300`, {});
    const batch = r.data?.data || [];
    all.push(...batch.map(b => b._id));
    if (batch.length < 300) break;
    page++;
  }
  return all;
}

async function evalCol(tname, colId, ids) {
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/evaluate/${colId}?appId=${APP_ID}`, {
    sessionId: `eval-${colId}-${Date.now()}`,
    filter: { ids },
  });
  return r.data?.success;
}

// ---------------------------------------------------------------------------
// Step 1: Fix Balances.Remaining Amount (stale variablePath → Used)
// ---------------------------------------------------------------------------
async function fixRemainingAmount() {
  console.log('\n=== Fix Balances.Remaining Amount ===');
  const remaining = await colByName('Balances', 'Remaining Amount');
  const used = await colByName('Balances', 'Used Amount');
  const initial = await colByName('Balances', 'Initial Amount');
  if (remaining) {
    console.log(`  deleting existing Remaining Amount (${remaining.id})...`);
    await deleteCol('Balances', remaining.id);
    await sleep(800);
  }
  // Use ${Column Name} syntax that ERPAI formula engine resolves by name
  const spec = {
    name: 'Remaining Amount',
    type: 'formula',
    formula: {
      expression: '${Initial Amount} - ${Used Amount}',
      variablePath: {
        'Initial Amount': [initial.id],
        'Used Amount': [used.id],
      },
      outputType: 'number',
    },
  };
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS['Balances']}/column/bulk`, { columns: [spec] });
  invalidate('Balances');
  const nid = r.data?.columns?.[0]?.id;
  console.log(`  ${r.data?.success ? '✓' : '✗'} recreated Remaining Amount (${nid})`);
}

// ---------------------------------------------------------------------------
// Step 2: Rebuild all broken {V}-style lookup formulas
// ---------------------------------------------------------------------------
// Config: [table, colName, refColName, targetTable, targetColName, outputType]
const LOOKUPS = [
  ['Orders',                'Customer Name',          'Customer',     'Customers',      'Name',              'text'],
  ['Orders',                'Customer Phone',         'Customer',     'Customers',      'Phone',             'text'],
  ['Recharges',             'Wallet Code',            'Wallet',       'Wallets',        'Wallet Code',       'text'],
  ['Call Detail Records',   'MSISDN',                 'Subscription', 'Subscriptions',  'MSISDN',            'text'],
  ['Call Detail Records',   'Plan Name',              'Tariff Plan',  'Tariff Plans',   'Plan Name',         'text'],
  ['Cases',                 'Customer Name',          'Customer',     'Customers',      'Name',              'text'],
  ['Subscriptions',         'Customer Name',          'Customer',     'Customers',      'Name',              'text'],
  ['Subscriptions',         'Plan Price',             'Current Plan', 'Tariff Plans',   'Price',             'number'],
  ['Subscriptions',         'Plan Validity (days)',   'Current Plan', 'Tariff Plans',   'Validity Days',     'number'],
  ['Subscriptions',         'Plan Data Allowance (MB)',    'Current Plan', 'Tariff Plans',   'Data Allowance (MB)',     'number'],
  ['Subscriptions',         'Plan Voice Allowance (min)',  'Current Plan', 'Tariff Plans',   'Voice Allowance (min)',   'number'],
  ['Subscriptions',         'Plan SMS Allowance',          'Current Plan', 'Tariff Plans',   'SMS Allowance',           'number'],
  ['Usage Transactions',    'MSISDN',                 'Subscription', 'Subscriptions',  'MSISDN',            'text'],
  ['Partner Commissions',   'Recharge Amount',        'Recharge',     'Recharges',      'Amount',            'number'],
  ['Charging Sessions',     'MSISDN',                 'Subscription', 'Subscriptions',  'MSISDN',            'text'],
  ['Wallet Transactions',   'Wallet Code',            'Wallet',       'Wallets',        'Wallet Code',       'text'],
  ['Wallet Transactions',   'Wallet Current Balance', 'Wallet',       'Wallets',        'Current Balance',   'number'],
];

async function rebuildLookups() {
  console.log('\n=== Rebuild broken {V} lookup formulas ===');
  for (const [tname, name, refName, , targetName, outputType] of LOOKUPS) {
    const existing = await colByName(tname, name);
    const ref = await colByName(tname, refName);
    // ref shape: { refTable: { _id, colId } }
    const refTableId = ref?.refTable?._id;
    if (!existing || !ref || !refTableId) {
      console.log(`  skip ${tname}.${name} (missing ref/target; ref=${!!ref} refTable._id=${refTableId})`);
      continue;
    }
    const targetTableName = Object.entries(TABLE_IDS).find(([, v]) => v === refTableId)?.[0];
    if (!targetTableName) { console.log(`  skip ${tname}.${name} (unknown target table id ${refTableId})`); continue; }
    const targetCol = await colByName(targetTableName, targetName);
    if (!targetCol) { console.log(`  skip ${tname}.${name} (target col "${targetName}" not found in ${targetTableName})`); continue; }
    if (existing.formula?.expression !== '{V}') {
      console.log(`  (already fixed) ${tname}.${name}`);
      continue;
    }
    console.log(`  rebuilding ${tname}.${name}`);
    await deleteCol(tname, existing.id);
    await sleep(800);
    await createLookup(tname, name, refName, ref.id, targetName, targetCol.id, outputType);
    await sleep(800);
  }
}

// ---------------------------------------------------------------------------
// Step 3: Add useful rollups
// ---------------------------------------------------------------------------
async function addRollups() {
  console.log('\n=== Add rollups ===');

  // Helper: lookup the child ref column id (the forward ref on the child table
  // pointing at the parent — that's what rollups key off of)
  async function childRef(childTable, refName) {
    const c = await colByName(childTable, refName);
    return c?.id;
  }

  // Customers
  console.log('\n-- Customers --');
  {
    const subsRef   = await childRef('Subscriptions', 'Customer');
    const rechRef   = await childRef('Recharges', 'Customer');
    const caseRef   = await childRef('Cases', 'Customer');
    const subMsisdn = (await colByName('Subscriptions', 'MSISDN'))?.id;
    const rechAmt   = (await colByName('Recharges', 'Amount'))?.id;
    const caseId    = (await colByName('Cases', 'Case ID'))?.id;
    if (!(await colByName('Customers', 'Subscription Count')) && subsRef && subMsisdn)
      await createRollup('Customers', 'Subscription Count', 'Subscriptions', subsRef, subMsisdn, 'MSISDN', 'count');
    if (!(await colByName('Customers', 'Lifetime Recharge')) && rechRef && rechAmt)
      await createRollup('Customers', 'Lifetime Recharge', 'Recharges', rechRef, rechAmt, 'Amount', 'sum', 'number');
    if (!(await colByName('Customers', 'Recharge Count')) && rechRef && rechAmt)
      await createRollup('Customers', 'Recharge Count', 'Recharges', rechRef, rechAmt, 'Amount', 'count');
    if (!(await colByName('Customers', 'Case Count')) && caseRef && caseId)
      await createRollup('Customers', 'Case Count', 'Cases', caseRef, caseId, 'Case ID', 'count');
  }

  // Wallets
  console.log('\n-- Wallets --');
  {
    const rechWalletRef = await childRef('Recharges', 'Wallet');
    const wtxWalletRef  = await childRef('Wallet Transactions', 'Wallet');
    const rechAmt = (await colByName('Recharges', 'Amount'))?.id;
    const wtxAmt  = (await colByName('Wallet Transactions', 'Amount'))?.id;
    if (!(await colByName('Wallets', 'Total Recharges')) && rechWalletRef && rechAmt)
      await createRollup('Wallets', 'Total Recharges', 'Recharges', rechWalletRef, rechAmt, 'Amount', 'sum', 'number');
    if (!(await colByName('Wallets', 'Recharge Count')) && rechWalletRef && rechAmt)
      await createRollup('Wallets', 'Recharge Count', 'Recharges', rechWalletRef, rechAmt, 'Amount', 'count');
    if (!(await colByName('Wallets', 'Transaction Count')) && wtxWalletRef && wtxAmt)
      await createRollup('Wallets', 'Transaction Count', 'Wallet Transactions', wtxWalletRef, wtxAmt, 'Amount', 'count');
  }

  // Tariff Plans — active subscribers + total balance seeded
  console.log('\n-- Tariff Plans --');
  {
    const subTariffRef = await childRef('Subscriptions', 'Current Plan');
    const balTariffRef = await childRef('Balances', 'Tariff Plan');
    const subMsisdn    = (await colByName('Subscriptions', 'MSISDN'))?.id;
    const balInitial   = (await colByName('Balances', 'Initial Amount'))?.id;
    if (!(await colByName('Tariff Plans', 'Active Subscribers')) && subTariffRef && subMsisdn)
      await createRollup('Tariff Plans', 'Active Subscribers', 'Subscriptions', subTariffRef, subMsisdn, 'MSISDN', 'count');
    if (!(await colByName('Tariff Plans', 'Total Seeded Balance')) && balTariffRef && balInitial)
      await createRollup('Tariff Plans', 'Total Seeded Balance', 'Balances', balTariffRef, balInitial, 'Initial Amount', 'sum', 'number');
  }

  // Subscriptions — balance totals + usage count
  console.log('\n-- Subscriptions --');
  {
    const balSubRef = await childRef('Balances', 'Subscription');
    const utxSubRef = await childRef('Usage Transactions', 'Subscription');
    const cdrSubRef = await childRef('Call Detail Records', 'Subscription');
    const sessSubRef= await childRef('Charging Sessions', 'Subscription');
    const balInit   = (await colByName('Balances', 'Initial Amount'))?.id;
    const balUsed   = (await colByName('Balances', 'Used Amount'))?.id;
    const utxUsed   = (await colByName('Usage Transactions', 'Used Amount'))?.id;
    const cdrCharge = (await colByName('Call Detail Records', 'Charge Amount'))?.id
                    || (await colByName('Call Detail Records', 'Amount'))?.id;
    const cdrChargeName = (await colByName('Call Detail Records', 'Charge Amount')) ? 'Charge Amount' : 'Amount';
    const sessChargeObj = (await colByName('Charging Sessions', 'Total Charged Amount'))
                       || (await colByName('Charging Sessions', 'Total Amount Charged'));
    const sessCharge = sessChargeObj?.id;
    const sessChargeName = sessChargeObj?.name;
    if (!(await colByName('Subscriptions', 'Total Initial Balance')) && balSubRef && balInit)
      await createRollup('Subscriptions', 'Total Initial Balance', 'Balances', balSubRef, balInit, 'Initial Amount', 'sum', 'number');
    if (!(await colByName('Subscriptions', 'Total Used Balance')) && balSubRef && balUsed)
      await createRollup('Subscriptions', 'Total Used Balance', 'Balances', balSubRef, balUsed, 'Used Amount', 'sum', 'number');
    if (!(await colByName('Subscriptions', 'UT Count')) && utxSubRef && utxUsed)
      await createRollup('Subscriptions', 'UT Count', 'Usage Transactions', utxSubRef, utxUsed, 'Used Amount', 'count');
    if (!(await colByName('Subscriptions', 'Total UT Usage')) && utxSubRef && utxUsed)
      await createRollup('Subscriptions', 'Total UT Usage', 'Usage Transactions', utxSubRef, utxUsed, 'Used Amount', 'sum', 'number');
    if (!(await colByName('Subscriptions', 'Session Count')) && sessSubRef && sessCharge)
      await createRollup('Subscriptions', 'Session Count', 'Charging Sessions', sessSubRef, sessCharge, sessChargeName, 'count');
    if (!(await colByName('Subscriptions', 'CDR Count')) && cdrSubRef && cdrCharge)
      await createRollup('Subscriptions', 'CDR Count', 'Call Detail Records', cdrSubRef, cdrCharge, cdrChargeName, 'count');
    if (!(await colByName('Subscriptions', 'Total CDR Charge')) && cdrSubRef && cdrCharge)
      await createRollup('Subscriptions', 'Total CDR Charge', 'Call Detail Records', cdrSubRef, cdrCharge, cdrChargeName, 'sum', 'number');
  }

  // Charging Sessions — UT aggregates
  console.log('\n-- Charging Sessions --');
  {
    const utxSessRef = await childRef('Usage Transactions', 'Charging Session');
    const utxUsed    = (await colByName('Usage Transactions', 'Used Amount'))?.id;
    if (!(await colByName('Charging Sessions', 'UT Count')) && utxSessRef && utxUsed)
      await createRollup('Charging Sessions', 'UT Count', 'Usage Transactions', utxSessRef, utxUsed, 'Used Amount', 'count');
    if (!(await colByName('Charging Sessions', 'Total UT Used')) && utxSessRef && utxUsed)
      await createRollup('Charging Sessions', 'Total UT Used', 'Usage Transactions', utxSessRef, utxUsed, 'Used Amount', 'sum', 'number');
  }

  // Balances — UT aggregate (link via Balance ref on UT if present)
  console.log('\n-- Balances --');
  {
    const utxBalObj = (await colByName('Usage Transactions', 'Balance'))
                   || (await colByName('Usage Transactions', 'Balance Bucket'));
    const utxBalRef = utxBalObj?.id;
    const utxUsed = (await colByName('Usage Transactions', 'Used Amount'))?.id;
    if (utxBalRef && utxUsed && !(await colByName('Balances', 'UT Count')))
      await createRollup('Balances', 'UT Count', 'Usage Transactions', utxBalRef, utxUsed, 'Used Amount', 'count');
  }
}

// ---------------------------------------------------------------------------
// Step 4: Trigger evaluation on every formula/rollup we just touched
// ---------------------------------------------------------------------------
async function evalAll() {
  console.log('\n=== Triggering evaluation ===');
  const tablesToEval = [
    'Balances','Orders','Recharges','Call Detail Records','Cases',
    'Subscriptions','Usage Transactions','Partner Commissions',
    'Charging Sessions','Wallet Transactions','Customers','Wallets','Tariff Plans',
  ];
  for (const tname of tablesToEval) {
    invalidate(tname);
    const t = await getTable(tname);
    const computed = (t.cols || []).filter(c => c.type === 'formula' || c.type === 'rollup');
    if (!computed.length) continue;
    const ids = await fetchAllIds(tname);
    if (!ids.length) continue;
    console.log(`  ${tname} (${ids.length} rows, ${computed.length} computed cols)`);
    for (const c of computed) {
      const ok = await evalCol(tname, c.id, ids);
      console.log(`    ${ok ? '✓' : '✗'} ${c.name}`);
      await sleep(1500);
    }
  }
}

// ---------------------------------------------------------------------------
// Step 5: Verify
// ---------------------------------------------------------------------------
async function verify() {
  console.log('\n=== Verification ===');
  const tables = [
    'Balances','Orders','Recharges','Call Detail Records','Cases',
    'Subscriptions','Usage Transactions','Partner Commissions',
    'Charging Sessions','Wallet Transactions','Customers','Wallets','Tariff Plans',
  ];
  for (const tname of tables) {
    invalidate(tname);
    const t = await getTable(tname);
    const computed = (t.cols || []).filter(c => c.type === 'formula' || c.type === 'rollup');
    if (!computed.length) continue;
    const rows = [];
    let page = 1;
    while (true) {
      const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/paged-record?pageNo=${page}&pageSize=300`, {});
      const b = r.data?.data || [];
      rows.push(...b);
      if (b.length < 300) break;
      page++;
    }
    console.log(`\n  ${tname} (${rows.length})`);
    for (const c of computed) {
      const nn = rows.filter(r => r.cells[c.id] != null && r.cells[c.id] !== '').length;
      const tag = c.type === 'formula' ? 'F' : 'R';
      console.log(`    [${tag}] ${c.name.padEnd(28)} ${nn}/${rows.length} ${nn === 0 ? '❌' : nn === rows.length ? '✓' : '~'}`);
    }
  }
}

async function main() {
  await fixRemainingAmount();
  await rebuildLookups();
  await addRollups();
  console.log('\n--- Waiting 10s before evaluation trigger ---');
  await sleep(10000);
  await evalAll();
  console.log('\n--- Waiting 30s for async settle ---');
  await sleep(30000);
  await verify();
}

main().catch(e => { console.error(e); process.exit(1); });
