// Add lookup and formula columns everywhere they make the UI useful.
// No rollups (engine still being fixed).
//
// Lookups: pull values through a ref — no code, auto-updates when source changes.
// Formulas: compute values from other columns in the same record.

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

async function getCols(tname) {
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tname]}`);
  return r.columnsMetaData || [];
}

async function addCol(tname, spec) {
  const cols = await getCols(tname);
  if (cols.find(c => c.name === spec.name)) {
    console.log(`    (exists) ${tname}.${spec.name}`);
    return cols.find(c => c.name === spec.name).id;
  }
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/column/bulk`, { columns: [spec] });
  if (!r.success) {
    console.error(`    ✗ ${tname}.${spec.name}: ${JSON.stringify(r).slice(0,200)}`);
    return null;
  }
  const id = r?.columns?.[0]?.id;
  console.log(`    ✓ ${tname}.${spec.name} (${id})`);
  await sleep(1100);
  return id;
}

// Helper to build a lookup column spec
// Lookup = pull field X from a referenced record via ref column Y
function mkLookup(name, refColId, targetColId, outputType = 'text') {
  return {
    name,
    type: 'lookup',
    lookup: {
      source: refColId,
      target: targetColId,
    },
    // Some ERPAI versions use formula instead of lookup block — try both shapes
    formula: {
      expression: `LOOKUP({ref})`,
      variablePath: { ref: [refColId, targetColId] },
      outputType,
    },
  };
}

function mkFormula(name, expression, variablePath, outputType = 'number') {
  return {
    name,
    type: 'formula',
    formula: { expression, variablePath, outputType },
  };
}

const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

// ============================================================================

async function main() {
  // -------------------------------------------------------------------------
  // Prefetch all column IDs we need
  // -------------------------------------------------------------------------
  log('Loading column metadata...');
  const balCols = await getCols('Balances');
  const subCols = await getCols('Subscriptions');
  const custCols = await getCols('Customers');
  const tariffCols = await getCols('Tariff Plans');
  const utCols = await getCols('Usage Transactions');
  const sessCols = await getCols('Charging Sessions');
  const cdrCols = await getCols('Call Detail Records');
  const wltCols = await getCols('Wallets');
  const wtxCols = await getCols('Wallet Transactions');
  const rechCols = await getCols('Recharges');
  const ordCols = await getCols('Orders');
  const caseCols = await getCols('Cases');
  const commCols = await getCols('Partner Commissions');

  const c = {
    // Refs on each table
    balSubscription: balCols.find(x => x.name === 'Subscription' && x.type === 'ref')?.id,
    balTariffPlan: balCols.find(x => x.name === 'Tariff Plan' && x.type === 'ref')?.id,
    balInitial: balCols.find(x => x.name === 'Initial Amount')?.id,
    balUsed: balCols.find(x => x.name === 'Used Amount')?.id,
    subCustomer: subCols.find(x => x.name === 'Customer' && x.type === 'ref')?.id,
    subCurrentPlan: subCols.find(x => x.name === 'Current Plan' && x.type === 'ref')?.id,
    subMSISDN: subCols.find(x => x.name === 'MSISDN')?.id,

    custName: custCols.find(x => x.name === 'Name' && x.type === 'text')?.id,
    custEmail: custCols.find(x => x.name === 'Email')?.id,
    custPhone: custCols.find(x => x.name === 'Phone')?.id,

    tariffName: tariffCols.find(x => x.name === 'Plan Name')?.id,
    tariffPrice: tariffCols.find(x => x.name === 'Price')?.id,
    tariffValidity: tariffCols.find(x => x.name === 'Validity Days')?.id,
    tariffDataMb: tariffCols.find(x => x.name === 'Data Allowance (MB)')?.id,
    tariffVoiceMin: tariffCols.find(x => x.name === 'Voice Allowance (min)')?.id,
    tariffSmsCount: tariffCols.find(x => x.name === 'SMS Allowance')?.id,

    utSubscription: utCols.find(x => x.name === 'Subscription' && x.type === 'ref')?.id,
    utBalance: utCols.find(x => x.name === 'Balance' && x.type === 'ref')?.id,
    utChSession: utCols.find(x => x.name === 'Charging Session' && x.type === 'ref')?.id,

    sessSubscription: sessCols.find(x => x.name === 'Subscription' && x.type === 'ref')?.id,
    cdrSubscription: cdrCols.find(x => x.name === 'Subscription' && x.type === 'ref')?.id,
    cdrTariffPlan: cdrCols.find(x => x.name === 'Tariff Plan' && x.type === 'ref')?.id,

    wltCustomer: wltCols.find(x => x.name === 'Customer' && x.type === 'ref')?.id,
    wltCode: wltCols.find(x => x.name === 'Wallet Code')?.id,
    wltBalance: wltCols.find(x => x.name === 'Current Balance')?.id,

    wtxWallet: wtxCols.find(x => x.name === 'Wallet' && x.type === 'ref')?.id,

    rechWallet: rechCols.find(x => x.name === 'Wallet' && x.type === 'ref')?.id,
    rechAmount: rechCols.find(x => x.name === 'Amount')?.id,

    ordCustomer: ordCols.find(x => x.name === 'Customer' && x.type === 'ref')?.id,
    caseCustomer: caseCols.find(x => x.name === 'Customer' && x.type === 'ref')?.id,

    commPartner: commCols.find(x => x.name === 'Partner' && x.type === 'ref')?.id,
    commRecharge: commCols.find(x => x.name === 'Recharge' && x.type === 'ref')?.id,
  };

  for (const [k, v] of Object.entries(c)) {
    if (!v) console.warn(`  ! Missing column id: ${k}`);
  }

  // -------------------------------------------------------------------------
  // FORMULAS
  // -------------------------------------------------------------------------
  log('== FORMULAS ==');

  // Balance.Remaining Amount = Initial - Used
  // (Previously plain number, convert to formula so it auto-computes)
  const balRemaining = balCols.find(x => x.name === 'Remaining Amount');
  if (balRemaining && balRemaining.type !== 'formula') {
    log('Converting Balance.Remaining Amount to formula...');
    await api('DELETE', `/v1/app-builder/table/${TABLE_IDS['Balances']}/column/${balRemaining.id}`);
    await sleep(1100);
    await addCol('Balances', mkFormula('Remaining Amount',
      'SUBTRACT({Initial}, {Used})',
      { Initial: [c.balInitial], Used: [c.balUsed] },
      'number'
    ));
  } else {
    log('  Balance.Remaining already formula');
  }

  // -------------------------------------------------------------------------
  // LOOKUPS
  // -------------------------------------------------------------------------
  log('== LOOKUPS ==');

  log('On Balances:');
  if (c.balTariffPlan && c.tariffName)
    await addCol('Balances', mkLookup('Plan Name', c.balTariffPlan, c.tariffName, 'text'));
  if (c.balTariffPlan && c.tariffPrice)
    await addCol('Balances', mkLookup('Plan Price', c.balTariffPlan, c.tariffPrice, 'number'));

  log('On Subscriptions:');
  if (c.subCustomer && c.custName)
    await addCol('Subscriptions', mkLookup('Customer Name', c.subCustomer, c.custName, 'text'));
  if (c.subCurrentPlan && c.tariffPrice)
    await addCol('Subscriptions', mkLookup('Plan Price', c.subCurrentPlan, c.tariffPrice, 'number'));
  if (c.subCurrentPlan && c.tariffValidity)
    await addCol('Subscriptions', mkLookup('Plan Validity (days)', c.subCurrentPlan, c.tariffValidity, 'number'));
  if (c.subCurrentPlan && c.tariffDataMb)
    await addCol('Subscriptions', mkLookup('Plan Data Allowance (MB)', c.subCurrentPlan, c.tariffDataMb, 'number'));
  if (c.subCurrentPlan && c.tariffVoiceMin)
    await addCol('Subscriptions', mkLookup('Plan Voice Allowance (min)', c.subCurrentPlan, c.tariffVoiceMin, 'number'));
  if (c.subCurrentPlan && c.tariffSmsCount)
    await addCol('Subscriptions', mkLookup('Plan SMS Allowance', c.subCurrentPlan, c.tariffSmsCount, 'number'));

  log('On Charging Sessions:');
  if (c.sessSubscription && c.subMSISDN)
    await addCol('Charging Sessions', mkLookup('MSISDN', c.sessSubscription, c.subMSISDN, 'text'));

  log('On Usage Transactions:');
  if (c.utSubscription && c.subMSISDN)
    await addCol('Usage Transactions', mkLookup('MSISDN', c.utSubscription, c.subMSISDN, 'text'));

  log('On Call Detail Records:');
  if (c.cdrSubscription && c.subMSISDN)
    await addCol('Call Detail Records', mkLookup('MSISDN', c.cdrSubscription, c.subMSISDN, 'text'));
  if (c.cdrTariffPlan && c.tariffName)
    await addCol('Call Detail Records', mkLookup('Plan Name', c.cdrTariffPlan, c.tariffName, 'text'));

  log('On Wallets:');
  if (c.wltCustomer && c.custName)
    await addCol('Wallets', mkLookup('Customer Name', c.wltCustomer, c.custName, 'text'));
  if (c.wltCustomer && c.custPhone)
    await addCol('Wallets', mkLookup('Customer Phone', c.wltCustomer, c.custPhone, 'text'));

  log('On Wallet Transactions:');
  if (c.wtxWallet && c.wltCode)
    await addCol('Wallet Transactions', mkLookup('Wallet Code', c.wtxWallet, c.wltCode, 'text'));
  if (c.wtxWallet && c.wltBalance)
    await addCol('Wallet Transactions', mkLookup('Wallet Current Balance', c.wtxWallet, c.wltBalance, 'number'));

  log('On Recharges:');
  if (c.rechWallet && c.wltCode)
    await addCol('Recharges', mkLookup('Wallet Code', c.rechWallet, c.wltCode, 'text'));

  log('On Orders:');
  if (c.ordCustomer && c.custName)
    await addCol('Orders', mkLookup('Customer Name', c.ordCustomer, c.custName, 'text'));
  if (c.ordCustomer && c.custPhone)
    await addCol('Orders', mkLookup('Customer Phone', c.ordCustomer, c.custPhone, 'text'));

  log('On Cases:');
  if (c.caseCustomer && c.custName)
    await addCol('Cases', mkLookup('Customer Name', c.caseCustomer, c.custName, 'text'));

  log('On Partner Commissions:');
  if (c.commRecharge && c.rechAmount)
    await addCol('Partner Commissions', mkLookup('Recharge Amount', c.commRecharge, c.rechAmount, 'number'));

  log('');
  log('== LOOKUPS + FORMULAS COMPLETE ==');
}

main().catch(e => { console.error(e); process.exit(1); });
