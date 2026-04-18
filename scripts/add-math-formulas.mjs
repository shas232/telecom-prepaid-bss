// Add computed math formulas across the telecom BSS.
// Each formula uses the ${Column Name} syntax with variablePath mapping.
//
// The engine accepts: +, -, *, /, literal numbers, TODAY(), DATEDIFF(a, b),
// IF(cond, then, else), and > < >= <= == comparisons (verified by probe).

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

const _cache = new Map();
async function cols(tname) {
  if (_cache.has(tname)) return _cache.get(tname);
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tname]}`);
  const v = r.data.columnsMetaData || [];
  _cache.set(tname, v);
  return v;
}
function invalidate(t) { _cache.delete(t); }

async function col(tname, name) {
  const c = await cols(tname);
  return c.find(x => x.name === name);
}

async function exists(tname, name) {
  return !!(await col(tname, name));
}

async function addFormula(tname, name, expression, variablePath, outputType = 'number') {
  if (await exists(tname, name)) {
    console.log(`  (exists) ${tname}.${name}`);
    return (await col(tname, name)).id;
  }
  const spec = { name, type: 'formula', formula: { expression, variablePath, outputType } };
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/column/bulk`, { columns: [spec] });
  invalidate(tname);
  const id = r.data?.columns?.[0]?.id;
  const ok = r.data?.success;
  console.log(`  ${ok ? '✓' : '✗'} ${tname}.${name} (${id || JSON.stringify(r.data).slice(0, 200)})`);
  return id;
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

async function evalCol(tname, colId, ids) {
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/evaluate/${colId}?appId=${APP_ID}`, {
    sessionId: `eval-${colId}-${Date.now()}`,
    filter: { ids },
  });
  return r.data?.success;
}

async function main() {
  console.log('=== Adding math formulas ===\n');

  // ----------------------------------------------------------------
  // Balances
  // ----------------------------------------------------------------
  console.log('## Balances');
  const balInitial = (await col('Balances', 'Initial Amount'))?.id;          // aGu1
  const balUsed = (await col('Balances', 'Used Amount'))?.id;                 // mo1lqr6ldhc5w (rollup)
  let balRemaining = (await col('Balances', 'Remaining Amount'))?.id;
  // Remaining Amount may have been cleaned up — recreate if missing
  if (!balRemaining) {
    console.log('  recreating Remaining Amount...');
    balRemaining = await addFormula('Balances', 'Remaining Amount',
      '${Initial Amount} - ${Used Amount}',
      { 'Initial Amount': [balInitial], 'Used Amount': [balUsed] },
      'number');
  }
  const balCycleStart = (await col('Balances', 'Cycle Start'))?.id;
  const balCycleEnd = (await col('Balances', 'Cycle End'))?.id;
  const balEffFrom = (await col('Balances', 'Effective From'))?.id;
  const balEffTo = (await col('Balances', 'Effective To'))?.id;

  // Usage % = Used / Initial * 100
  await addFormula('Balances', 'Usage %',
    '${Used Amount} / ${Initial Amount} * 100',
    { 'Used Amount': [balUsed], 'Initial Amount': [balInitial] },
    'number');

  // Remaining % = Remaining / Initial * 100
  await addFormula('Balances', 'Remaining %',
    '${Remaining Amount} / ${Initial Amount} * 100',
    { 'Remaining Amount': [balRemaining], 'Initial Amount': [balInitial] },
    'number');

  // Days Until Expiry = DATEDIFF(Effective To, TODAY())
  if (balEffTo) {
    await addFormula('Balances', 'Days Until Expiry',
      'DATEDIFF(${Effective To}, TODAY())',
      { 'Effective To': [balEffTo] },
      'number');
  }

  // Days Since Activation = DATEDIFF(TODAY(), Effective From)
  if (balEffFrom) {
    await addFormula('Balances', 'Days Active',
      'DATEDIFF(TODAY(), ${Effective From})',
      { 'Effective From': [balEffFrom] },
      'number');
  }

  // Is Expired = IF(Days Until Expiry < 0, 1, 0) -- but simpler: compare date
  if (balEffTo) {
    await addFormula('Balances', 'Is Expired',
      'IF(DATEDIFF(${Effective To}, TODAY()) < 0, 1, 0)',
      { 'Effective To': [balEffTo] },
      'number');
  }

  // Is Low Balance = IF(Remaining % < 20, 1, 0)
  await addFormula('Balances', 'Is Low Balance',
    'IF(${Remaining Amount} / ${Initial Amount} * 100 < 20, 1, 0)',
    { 'Remaining Amount': [balRemaining], 'Initial Amount': [balInitial] },
    'number');

  // ----------------------------------------------------------------
  // Subscriptions
  // ----------------------------------------------------------------
  console.log('\n## Subscriptions');
  const subActivation = (await col('Subscriptions', 'Activation Date'))?.id;
  const subLastUsage = (await col('Subscriptions', 'Last Usage Date'))?.id;
  const subTotalInit = (await col('Subscriptions', 'Total Initial Balance'))?.id;
  const subTotalUsed = (await col('Subscriptions', 'Total Used Balance'))?.id;
  const subPlanPrice = (await col('Subscriptions', 'Plan Price'))?.id;
  const subPlanValidity = (await col('Subscriptions', 'Plan Validity (days)'))?.id;

  if (subActivation) {
    await addFormula('Subscriptions', 'Days Since Activation',
      'DATEDIFF(TODAY(), ${Activation Date})',
      { 'Activation Date': [subActivation] },
      'number');
  }

  if (subLastUsage) {
    await addFormula('Subscriptions', 'Days Since Last Usage',
      'DATEDIFF(TODAY(), ${Last Usage Date})',
      { 'Last Usage Date': [subLastUsage] },
      'number');
  }

  if (subTotalInit && subTotalUsed) {
    await addFormula('Subscriptions', 'Plan Utilization %',
      '${Total Used Balance} / ${Total Initial Balance} * 100',
      { 'Total Used Balance': [subTotalUsed], 'Total Initial Balance': [subTotalInit] },
      'number');

    await addFormula('Subscriptions', 'Plan Remaining Balance',
      '${Total Initial Balance} - ${Total Used Balance}',
      { 'Total Initial Balance': [subTotalInit], 'Total Used Balance': [subTotalUsed] },
      'number');
  }

  // Is Dormant: no usage for >30 days
  if (subLastUsage) {
    await addFormula('Subscriptions', 'Is Dormant',
      'IF(DATEDIFF(TODAY(), ${Last Usage Date}) > 30, 1, 0)',
      { 'Last Usage Date': [subLastUsage] },
      'number');
  }

  // Cost per day of plan = plan price / validity days
  if (subPlanPrice && subPlanValidity) {
    await addFormula('Subscriptions', 'Plan Cost per Day',
      '${Plan Price} / ${Plan Validity (days)}',
      { 'Plan Price': [subPlanPrice], 'Plan Validity (days)': [subPlanValidity] },
      'number');
  }

  // ----------------------------------------------------------------
  // Wallets
  // ----------------------------------------------------------------
  console.log('\n## Wallets');
  const walletBalance = (await col('Wallets', 'Current Balance'))?.id;
  const walletLifetimeRech = (await col('Wallets', 'Lifetime Recharge'))?.id;
  const walletLifetimeSpend = (await col('Wallets', 'Lifetime Spend'))?.id;
  const walletLastRech = (await col('Wallets', 'Last Recharge Date'))?.id;
  const walletLastUsage = (await col('Wallets', 'Last Usage Date'))?.id;
  const walletRechCount = (await col('Wallets', 'Recharge Count'))?.id;
  const walletTotalRech = (await col('Wallets', 'Total Recharges'))?.id;

  // Avg Recharge Amount = Total Recharges / Recharge Count
  if (walletTotalRech && walletRechCount) {
    await addFormula('Wallets', 'Avg Recharge Amount',
      'IF(${Recharge Count} > 0, ${Total Recharges} / ${Recharge Count}, 0)',
      { 'Total Recharges': [walletTotalRech], 'Recharge Count': [walletRechCount] },
      'number');
  }

  // Days Since Last Recharge
  if (walletLastRech) {
    await addFormula('Wallets', 'Days Since Last Recharge',
      'DATEDIFF(TODAY(), ${Last Recharge Date})',
      { 'Last Recharge Date': [walletLastRech] },
      'number');
  }

  // Net Balance (lifetime in - lifetime out)
  if (walletLifetimeRech && walletLifetimeSpend) {
    await addFormula('Wallets', 'Net Lifetime Flow',
      '${Lifetime Recharge} - ${Lifetime Spend}',
      { 'Lifetime Recharge': [walletLifetimeRech], 'Lifetime Spend': [walletLifetimeSpend] },
      'number');
  }

  // Spend ratio = spend / recharge * 100  (>100 means overspent)
  if (walletLifetimeRech && walletLifetimeSpend) {
    await addFormula('Wallets', 'Spend Ratio %',
      'IF(${Lifetime Recharge} > 0, ${Lifetime Spend} / ${Lifetime Recharge} * 100, 0)',
      { 'Lifetime Recharge': [walletLifetimeRech], 'Lifetime Spend': [walletLifetimeSpend] },
      'number');
  }

  // Is Stale: no recharge in 60d
  if (walletLastRech) {
    await addFormula('Wallets', 'Is Stale Wallet',
      'IF(DATEDIFF(TODAY(), ${Last Recharge Date}) > 60, 1, 0)',
      { 'Last Recharge Date': [walletLastRech] },
      'number');
  }

  // ----------------------------------------------------------------
  // Recharges (line-level math)
  // ----------------------------------------------------------------
  console.log('\n## Recharges');
  const rAmt = (await col('Recharges', 'Amount'))?.id;
  const rTax = (await col('Recharges', 'Tax Amount'))?.id;
  const rNet = (await col('Recharges', 'Net Amount'))?.id;

  // Effective Tax Rate %
  if (rAmt && rTax) {
    await addFormula('Recharges', 'Tax Rate %',
      'IF(${Amount} > 0, ${Tax Amount} / ${Amount} * 100, 0)',
      { 'Amount': [rAmt], 'Tax Amount': [rTax] },
      'number');
  }

  // ----------------------------------------------------------------
  // Tariff Plans
  // ----------------------------------------------------------------
  console.log('\n## Tariff Plans');
  const tpPrice = (await col('Tariff Plans', 'Price'))?.id;
  const tpValidity = (await col('Tariff Plans', 'Validity Days'))?.id;
  const tpData = (await col('Tariff Plans', 'Data Allowance (MB)'))?.id;
  const tpVoice = (await col('Tariff Plans', 'Voice Allowance (min)'))?.id;
  const tpSms = (await col('Tariff Plans', 'SMS Allowance'))?.id;
  const tpActiveSubs = (await col('Tariff Plans', 'Active Subscribers'))?.id;

  if (tpPrice && tpValidity) {
    await addFormula('Tariff Plans', 'Price per Day',
      '${Price} / ${Validity Days}',
      { 'Price': [tpPrice], 'Validity Days': [tpValidity] },
      'number');
  }

  if (tpPrice && tpData) {
    await addFormula('Tariff Plans', 'Price per MB',
      'IF(${Data Allowance (MB)} > 0, ${Price} / ${Data Allowance (MB)}, 0)',
      { 'Price': [tpPrice], 'Data Allowance (MB)': [tpData] },
      'number');
  }

  if (tpPrice && tpVoice) {
    await addFormula('Tariff Plans', 'Price per Minute',
      'IF(${Voice Allowance (min)} > 0, ${Price} / ${Voice Allowance (min)}, 0)',
      { 'Price': [tpPrice], 'Voice Allowance (min)': [tpVoice] },
      'number');
  }

  if (tpPrice && tpActiveSubs) {
    await addFormula('Tariff Plans', 'Monthly Plan Revenue',
      '${Price} * ${Active Subscribers}',
      { 'Price': [tpPrice], 'Active Subscribers': [tpActiveSubs] },
      'number');
  }

  // ----------------------------------------------------------------
  // Charging Sessions
  // ----------------------------------------------------------------
  console.log('\n## Charging Sessions');
  const csStart = (await col('Charging Sessions', 'Started At'))?.id;
  const csEnd = (await col('Charging Sessions', 'Ended At'))?.id;
  const csTotalCharged = (await col('Charging Sessions', 'Total Charged'))?.id;
  const csTotalUsed = (await col('Charging Sessions', 'Total Used Amount'))?.id;
  const csUtCount = (await col('Charging Sessions', 'UT Count'))?.id;

  if (csStart && csEnd) {
    await addFormula('Charging Sessions', 'Session Duration (days)',
      'DATEDIFF(${Ended At}, ${Started At})',
      { 'Started At': [csStart], 'Ended At': [csEnd] },
      'number');
  }

  if (csTotalCharged && csUtCount) {
    await addFormula('Charging Sessions', 'Avg Charge per Event',
      'IF(${UT Count} > 0, ${Total Charged} / ${UT Count}, 0)',
      { 'Total Charged': [csTotalCharged], 'UT Count': [csUtCount] },
      'number');
  }

  // ----------------------------------------------------------------
  // Call Detail Records
  // ----------------------------------------------------------------
  console.log('\n## Call Detail Records');
  const cdrFromWallet = (await col('Call Detail Records', 'Total Charged from Wallet'))?.id;
  const cdrFromAllowance = (await col('Call Detail Records', 'Total Charged from Allowance'))?.id;
  const cdrDuration = (await col('Call Detail Records', 'Duration Seconds'))?.id;
  const cdrMb = (await col('Call Detail Records', 'Total MB'))?.id;

  if (cdrFromWallet && cdrFromAllowance) {
    await addFormula('Call Detail Records', 'Total Charged',
      '${Total Charged from Wallet} + ${Total Charged from Allowance}',
      { 'Total Charged from Wallet': [cdrFromWallet], 'Total Charged from Allowance': [cdrFromAllowance] },
      'number');

    await addFormula('Call Detail Records', 'Wallet Charge %',
      'IF((${Total Charged from Wallet} + ${Total Charged from Allowance}) > 0, ${Total Charged from Wallet} / (${Total Charged from Wallet} + ${Total Charged from Allowance}) * 100, 0)',
      { 'Total Charged from Wallet': [cdrFromWallet], 'Total Charged from Allowance': [cdrFromAllowance] },
      'number');
  }

  if (cdrDuration) {
    await addFormula('Call Detail Records', 'Duration Minutes',
      '${Duration Seconds} / 60',
      { 'Duration Seconds': [cdrDuration] },
      'number');
  }

  // ----------------------------------------------------------------
  // Cases
  // ----------------------------------------------------------------
  console.log('\n## Cases');
  const caseOpened = (await col('Cases', 'Opened At'))?.id;
  const caseResolved = (await col('Cases', 'Resolved At'))?.id;

  if (caseOpened && caseResolved) {
    await addFormula('Cases', 'Resolution Days',
      'DATEDIFF(${Resolved At}, ${Opened At})',
      { 'Opened At': [caseOpened], 'Resolved At': [caseResolved] },
      'number');
  }

  if (caseOpened) {
    await addFormula('Cases', 'Days Open',
      'DATEDIFF(TODAY(), ${Opened At})',
      { 'Opened At': [caseOpened] },
      'number');
  }

  // ----------------------------------------------------------------
  // Customers (needs the cascaded rollup of Lifetime Recharge first)
  // ----------------------------------------------------------------
  console.log('\n## Customers');
  const custOnboarded = (await col('Customers', 'Onboarded Date'))?.id;
  const custLifetimeRech = (await col('Customers', 'Lifetime Recharge'))?.id;
  const custSubCount = (await col('Customers', 'Subscription Count'))?.id;

  // Need to add Lifetime Recharge rollup if it doesn't already exist
  // (already added as 'Lifetime Recharge' rollup earlier)
  if (custOnboarded) {
    await addFormula('Customers', 'Days as Customer',
      'DATEDIFF(TODAY(), ${Onboarded Date})',
      { 'Onboarded Date': [custOnboarded] },
      'number');

    if (custLifetimeRech) {
      // ARPU per day (revenue / days as customer)
      await addFormula('Customers', 'Revenue per Day',
        'IF(DATEDIFF(TODAY(), ${Onboarded Date}) > 0, ${Lifetime Recharge} / DATEDIFF(TODAY(), ${Onboarded Date}), 0)',
        { 'Onboarded Date': [custOnboarded], 'Lifetime Recharge': [custLifetimeRech] },
        'number');

      // ARPU per month = Revenue per Day * 30
      await addFormula('Customers', 'ARPU (monthly est)',
        'IF(DATEDIFF(TODAY(), ${Onboarded Date}) > 0, ${Lifetime Recharge} / DATEDIFF(TODAY(), ${Onboarded Date}) * 30, 0)',
        { 'Onboarded Date': [custOnboarded], 'Lifetime Recharge': [custLifetimeRech] },
        'number');
    }
  }

  if (custSubCount) {
    await addFormula('Customers', 'Is Multi-Line',
      'IF(${Subscription Count} > 1, 1, 0)',
      { 'Subscription Count': [custSubCount] },
      'number');
  }

  // ----------------------------------------------------------------
  // Trigger evaluate on every newly added formula
  // ----------------------------------------------------------------
  console.log('\n\n=== Triggering evaluation ===');
  const tablesToEval = ['Balances','Subscriptions','Wallets','Recharges','Tariff Plans','Charging Sessions','Call Detail Records','Cases','Customers'];
  for (const tn of tablesToEval) {
    invalidate(tn);
    const cs = await cols(tn);
    const forms = cs.filter(c => c.type === 'formula');
    if (!forms.length) continue;
    const ids = await fetchAllIds(tn);
    if (!ids.length) continue;
    console.log(`  ${tn} (${ids.length} rows, ${forms.length} formulas)`);
    for (const c of forms) {
      const ok = await evalCol(tn, c.id, ids);
      console.log(`    ${ok ? '✓' : '✗'} ${c.name}`);
      await sleep(800);
    }
  }

  console.log('\n--- Waiting 30s for async settle ---');
  await sleep(30000);

  // Verify
  console.log('\n=== Verification ===');
  for (const tn of tablesToEval) {
    invalidate(tn);
    const cs = await cols(tn);
    const forms = cs.filter(c => c.type === 'formula');
    if (!forms.length) continue;
    const rows = [];
    let page = 1;
    while (true) {
      const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tn]}/paged-record?pageNo=${page}&pageSize=300`, {});
      const b = r.data?.data || [];
      rows.push(...b);
      if (b.length < 300) break;
      page++;
    }
    console.log(`\n  ${tn} (${rows.length})`);
    for (const c of forms) {
      const nn = rows.filter(r => r.cells[c.id] != null && r.cells[c.id] !== '').length;
      const status = nn === 0 ? '❌' : nn === rows.length ? '✓' : '~';
      console.log(`    [F] ${c.name.padEnd(34)} ${nn}/${rows.length} ${status}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
