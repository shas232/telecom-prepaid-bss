// Second attempt — use formula type with variablePath: [refCol, targetCol]
// (the discovered ERPAI equivalent of "lookup" — formulas can traverse refs).
//
// Also: clean up orphaned columns (dangling SPA ref, stray test rollup).

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

async function getCols(tname) {
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tname]}`);
  return r.columnsMetaData || [];
}

async function addFormula(tname, name, refColId, targetColId, outputType = 'text') {
  const cols = await getCols(tname);
  if (cols.find(c => c.name === name)) {
    console.log(`    (exists) ${tname}.${name}`);
    return;
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
    console.log(`    ✓ ${tname}.${name}`);
  } else {
    console.log(`    ✗ ${tname}.${name}: ${JSON.stringify(r).slice(0, 200)}`);
  }
  await sleep(1100);
}

async function deleteCol(tname, colId) {
  const r = await api('DELETE', `/v1/app-builder/table/${TABLE_IDS[tname]}/column/${colId}`);
  await sleep(1100);
  return r;
}

const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

async function main() {
  log('== CLEANUP orphaned columns ==');
  // Balances: remove dangling Subscription Plan Assignment ref + stray 'test' column
  const balCols = await getCols('Balances');
  const spaRef = balCols.find(c => c.name === 'Subscription Plan Assignment');
  if (spaRef) {
    log('  Deleting Balances.Subscription Plan Assignment (dangling ref to deleted table)');
    await deleteCol('Balances', spaRef.id);
  }
  const testCol = balCols.find(c => c.name === 'test');
  if (testCol) {
    log('  Deleting Balances.test (stray experimental column)');
    await deleteCol('Balances', testCol.id);
  }

  log('== RELOAD metadata ==');
  const [balCols2, subCols, custCols, tariffCols, utCols, sessCols, cdrCols,
         wltCols, wtxCols, rechCols, ordCols, caseCols, commCols] = await Promise.all([
    getCols('Balances'),
    getCols('Subscriptions'),
    getCols('Customers'),
    getCols('Tariff Plans'),
    getCols('Usage Transactions'),
    getCols('Charging Sessions'),
    getCols('Call Detail Records'),
    getCols('Wallets'),
    getCols('Wallet Transactions'),
    getCols('Recharges'),
    getCols('Orders'),
    getCols('Cases'),
    getCols('Partner Commissions'),
  ]);

  // Helper to find a col id by name
  const f = (cols, name, type = null) => {
    const found = cols.find(c => c.name === name && (type ? c.type === type : true));
    if (!found) console.warn(`  ! col not found: ${name}`);
    return found?.id;
  };

  // -------------------------------------------------------------------------
  log('== FORMULA-BASED LOOKUPS ==');

  // Balances
  const balTariffRef = f(balCols2, 'Tariff Plan', 'ref');
  const tariffPrice = f(tariffCols, 'Price');
  if (balTariffRef && tariffPrice) {
    await addFormula('Balances', 'Plan Price', balTariffRef, tariffPrice, 'number');
  }

  // Subscriptions
  const subCustomerRef = f(subCols, 'Customer', 'ref');
  const subCurrentPlanRef = f(subCols, 'Current Plan', 'ref');
  const custName = f(custCols, 'Name', 'text');
  const tariffName = f(tariffCols, 'Plan Name');
  const tariffValidity = f(tariffCols, 'Validity Days');
  const tariffDataMb = f(tariffCols, 'Data Allowance (MB)');
  const tariffVoiceMin = f(tariffCols, 'Voice Allowance (min)');
  const tariffSmsCount = f(tariffCols, 'SMS Allowance');

  log('Subscriptions:');
  if (subCustomerRef && custName) await addFormula('Subscriptions', 'Customer Name', subCustomerRef, custName, 'text');
  if (subCurrentPlanRef && tariffPrice) await addFormula('Subscriptions', 'Plan Price', subCurrentPlanRef, tariffPrice, 'number');
  if (subCurrentPlanRef && tariffValidity) await addFormula('Subscriptions', 'Plan Validity (days)', subCurrentPlanRef, tariffValidity, 'number');
  if (subCurrentPlanRef && tariffDataMb) await addFormula('Subscriptions', 'Plan Data Allowance (MB)', subCurrentPlanRef, tariffDataMb, 'number');
  if (subCurrentPlanRef && tariffVoiceMin) await addFormula('Subscriptions', 'Plan Voice Allowance (min)', subCurrentPlanRef, tariffVoiceMin, 'number');
  if (subCurrentPlanRef && tariffSmsCount) await addFormula('Subscriptions', 'Plan SMS Allowance', subCurrentPlanRef, tariffSmsCount, 'number');

  // Usage Transactions
  const utSubRef = f(utCols, 'Subscription', 'ref');
  const subMsisdn = f(subCols, 'MSISDN');
  log('Usage Transactions:');
  if (utSubRef && subMsisdn) await addFormula('Usage Transactions', 'MSISDN', utSubRef, subMsisdn, 'text');

  // Charging Sessions
  const sessSubRef = f(sessCols, 'Subscription', 'ref');
  log('Charging Sessions:');
  if (sessSubRef && subMsisdn) await addFormula('Charging Sessions', 'MSISDN', sessSubRef, subMsisdn, 'text');

  // Call Detail Records
  const cdrSubRef = f(cdrCols, 'Subscription', 'ref');
  const cdrTariffRef = f(cdrCols, 'Tariff Plan', 'ref');
  log('Call Detail Records:');
  if (cdrSubRef && subMsisdn) await addFormula('Call Detail Records', 'MSISDN', cdrSubRef, subMsisdn, 'text');
  if (cdrTariffRef && tariffName) await addFormula('Call Detail Records', 'Plan Name', cdrTariffRef, tariffName, 'text');

  // Wallets
  const wltCustomerRef = f(wltCols, 'Customer', 'ref');
  const custPhone = f(custCols, 'Phone');
  log('Wallets:');
  if (wltCustomerRef && custName) await addFormula('Wallets', 'Customer Name', wltCustomerRef, custName, 'text');
  if (wltCustomerRef && custPhone) await addFormula('Wallets', 'Customer Phone', wltCustomerRef, custPhone, 'text');

  // Wallet Transactions
  const wtxWalletRef = f(wtxCols, 'Wallet', 'ref');
  const wltCode = f(wltCols, 'Wallet Code');
  const wltBalance = f(wltCols, 'Current Balance');
  log('Wallet Transactions:');
  if (wtxWalletRef && wltCode) await addFormula('Wallet Transactions', 'Wallet Code', wtxWalletRef, wltCode, 'text');
  if (wtxWalletRef && wltBalance) await addFormula('Wallet Transactions', 'Wallet Current Balance', wtxWalletRef, wltBalance, 'number');

  // Recharges
  const rechWalletRef = f(rechCols, 'Wallet', 'ref');
  log('Recharges:');
  if (rechWalletRef && wltCode) await addFormula('Recharges', 'Wallet Code', rechWalletRef, wltCode, 'text');

  // Orders
  const ordCustomerRef = f(ordCols, 'Customer', 'ref');
  log('Orders:');
  if (ordCustomerRef && custName) await addFormula('Orders', 'Customer Name', ordCustomerRef, custName, 'text');
  if (ordCustomerRef && custPhone) await addFormula('Orders', 'Customer Phone', ordCustomerRef, custPhone, 'text');

  // Cases
  const caseCustomerRef = f(caseCols, 'Customer', 'ref');
  log('Cases:');
  if (caseCustomerRef && custName) await addFormula('Cases', 'Customer Name', caseCustomerRef, custName, 'text');

  // Partner Commissions
  const commRechargeRef = f(commCols, 'Recharge', 'ref');
  const rechAmount = f(rechCols, 'Amount');
  log('Partner Commissions:');
  if (commRechargeRef && rechAmount) await addFormula('Partner Commissions', 'Recharge Amount', commRechargeRef, rechAmount, 'number');

  log('');
  log('== ADD FORMULAS COMPLETE ==');
  log('');
  log('NOTE: formula values will show null until the rollup/formula engine is fixed.');
  log('Structure is in place — values will populate automatically once the engine computes.');
}

main().catch(e => { console.error(e); process.exit(1); });
