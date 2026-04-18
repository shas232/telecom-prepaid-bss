// Seed fraud-triggering demo data so dormant fraud rules produce alerts.
// Targets: FRU-AMT-LRG (recharges > 500), FRU-IMEI-CHG (>2 IMEI events per sub),
// FRU-DEP-FST (is_low_balance=1 with recent cycle_start).
//
// Usage: node scripts/seed-fraud-demo.mjs

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const APP_ID = 'afe8c4540708da6ca9e6fe79';

const TBL_RECHARGES = '4f5d0c07bc1db0dcef8e2c02';
const TBL_IMEI_EVENTS = 'dc5493f44edc3cf2ec9844bb';
const TBL_BALANCES = '9daeb0991b806538ceab887f';
const TBL_USAGE_TX = '5d81244b8bef791c68fdbb49';

// Recharge column ids
const R = {
  rechargeCode:     'UhkZ',
  amount:           'Y39a',
  currency:         'WzsW',
  channel:          'cqLl',
  status:           'MMab',
  timestamp:        'UG1r',
  wallet:           'fa5r',
  taxAmount:        'xw3H',
  netAmount:        'Qxij',
  walletCode:       'piIP',
  gatewayReference: 'tKyH',
};

// IMEI event column ids
const I = {
  eventCode:       'ds04',
  subscription:    'StgF',
  oldImei:         'WVyX',
  newImei:         'GJSK',
  changedAt:       'lAIm',
  hoursSincePrev:  'wXFC',
  suspicious:      'ZESV',
  reviewStatus:    'EtAC',
};

// Balance column ids
const B = {
  balanceCode:      'ucLa',
  subscription:     'yw1p',
  unitType:         'yutm',
  serviceContext:   'Esuj',
  ratingGroup:      'dOSd',
  allowanceLabel:   'g3QJ',
  initialAmount:    'aGu1',
  cycleStart:       'o4qw',
  cycleEnd:         'DXPX',
  effectiveFrom:    'zlob',
  effectiveTo:      'GVKg',
  status:           'VrcT',
};

// Usage Transactions column ids
const U = {
  usedAmount:    'umgX',
  balance:       '2DAb',
  subscription:  'ZaUH',
  timestamp:     'I5xQ',
  ratingGroup:   'xuuQ',
  unitType:      'HtGT',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function http(method, path, body) {
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0',
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(BASE_URL + path, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (res.status === 429) { await sleep(3000); continue; }
    return { ok: res.ok, status: res.status, data };
  }
  throw new Error(`retries: ${method} ${path}`);
}

async function sql(sqlQuery, limit = 1000) {
  const r = await http('POST', '/v1/agent/app/sql/execute', { appId: APP_ID, sqlQuery, limit });
  if (!r.ok) throw new Error(`sql failed: ${r.status}`);
  return r.data?.data?.rows || [];
}

async function bulkInsert(tableId, rowsCells) {
  const ids = [];
  const errors = [];
  for (let i = 0; i < rowsCells.length; i += 20) {
    const chunk = rowsCells.slice(i, i + 20);
    const body = { arr: chunk.map(cells => ({ cells })) };
    const r = await http('POST', `/v1/app-builder/table/${tableId}/record-bulk?appId=${APP_ID}`, body);
    if (!r.ok || r.data?.success === false) {
      errors.push({ i, status: r.status, body: JSON.stringify(r.data).slice(0, 500) });
      console.error(`  chunk ${i} err:`, JSON.stringify(r.data).slice(0, 300));
    } else {
      const createdIds = (r.data?.data || r.data?.arr || []).map(x => x?._id || x?.id).filter(Boolean);
      ids.push(...createdIds);
    }
    await sleep(150);
  }
  return { ids, errors };
}

function randImei() {
  let s = '';
  for (let i = 0; i < 15; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function isoHoursAgo(h) {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

async function main() {
  console.log('═══ Seed Fraud Demo Data ═══');

  // ── 1. Recharges (amount > 500) ───────────────────────────────────────
  console.log('\n[1] Seeding 5 large recharges...');
  const wallets = await sql(
    `SELECT _id, wallet_code, customer FROM a1776271424351_wallets WHERE _deleted=0 LIMIT 5`
  );
  console.log(`  Got ${wallets.length} wallets`);
  const amounts = [650, 750, 850, 1200, 2000];
  const hoursOffsets = [3, 10, 18, 28, 40]; // last 48h
  const rechargeRows = wallets.map((w, idx) => ({
    [R.rechargeCode]: `RCH-FRAUD-${String(idx + 1).padStart(2, '0')}`,
    [R.amount]: amounts[idx],
    [R.currency]: [1],          // USD (same as existing sample)
    [R.channel]: [3],           // App
    [R.status]: [2],            // Successful
    [R.timestamp]: isoHoursAgo(hoursOffsets[idx]),
    [R.wallet]: [w._id],
    [R.taxAmount]: 0,
    [R.netAmount]: amounts[idx],
    [R.walletCode]: w.wallet_code || '',
    [R.gatewayReference]: `GW-REF-FRAUD-${String(idx + 1).padStart(2, '0')}`,
  }));
  const rchRes = await bulkInsert(TBL_RECHARGES, rechargeRows);
  console.log(`  Recharges inserted: ${rchRes.ids.length} errors=${rchRes.errors.length}`);

  // ── 2. IMEI change events ─────────────────────────────────────────────
  console.log('\n[2] Seeding 6 IMEI change events (3 each for 2 subs)...');
  const subsForImei = await sql(
    `SELECT _id, msisdn FROM a1776271424351_subscriptions WHERE _deleted=0 LIMIT 2`
  );
  console.log(`  Got ${subsForImei.length} subs`);
  const imeiRows = [];
  let seq = 1;
  for (const sub of subsForImei) {
    const hours = [8, 12, 18];
    let prevImei = randImei();
    for (let j = 0; j < 3; j++) {
      const newImei = randImei();
      const hoursAgo = 48 - (j + 1) * (48 / 4);
      imeiRows.push({
        [I.eventCode]: `IMEI-CHG-FRAUD-${String(seq).padStart(2, '0')}`,
        [I.subscription]: [sub._id],
        [I.oldImei]: prevImei,
        [I.newImei]: newImei,
        [I.changedAt]: isoHoursAgo(hoursAgo),
        [I.hoursSincePrev]: hours[j],
        [I.suspicious]: true,
        [I.reviewStatus]: [1], // Pending
      });
      prevImei = newImei;
      seq++;
    }
  }
  const imeiRes = await bulkInsert(TBL_IMEI_EVENTS, imeiRows);
  console.log(`  IMEI events inserted: ${imeiRes.ids.length} errors=${imeiRes.errors.length}`);

  // ── 3. Balances with fast depletion ───────────────────────────────────
  console.log('\n[3] Seeding 4 balances with fast depletion...');
  const subsForBal = await sql(
    `SELECT _id, msisdn FROM a1776271424351_subscriptions WHERE _deleted=0 LIMIT 4 OFFSET 5`
  );
  console.log(`  Got ${subsForBal.length} subs`);
  const initialAmt = 2048;
  const usedAmt = 1900; // 7.2% remaining → is_low_balance formula = 1
  const balanceRows = subsForBal.map((sub, idx) => ({
    [B.balanceCode]: `BAL-FAST-${String(idx + 1).padStart(2, '0')}`,
    [B.subscription]: [sub._id],
    [B.unitType]: [1],         // MB
    [B.serviceContext]: [1],   // 32251@3gpp.org (Data)
    [B.ratingGroup]: 10,
    [B.allowanceLabel]: 'Fast-depleted Data Pack',
    [B.initialAmount]: initialAmt,
    [B.cycleStart]: '2026-04-16T00:00:00.000Z',
    [B.cycleEnd]: '2026-05-16T00:00:00.000Z',
    [B.effectiveFrom]: '2026-04-16T00:00:00.000Z',
    [B.effectiveTo]: '2026-05-16T00:00:00.000Z',
    [B.status]: [1], // Active
  }));
  const balRes = await bulkInsert(TBL_BALANCES, balanceRows);
  console.log(`  Balances inserted: ${balRes.ids.length} errors=${balRes.errors.length}`);

  // Fetch the newly-created balance _ids
  const newBal = await sql(
    `SELECT _id, subscription FROM a1776271424351_balances WHERE _deleted=0 AND balance_code LIKE 'BAL-FAST-%'`
  );
  console.log(`  Retrieved ${newBal.length} new balances via SQL`);

  // Insert Usage Transactions to drive the Used Amount rollup to 1900
  console.log('  Inserting Usage Transactions to feed Used Amount rollup...');
  const utxRows = [];
  for (const bal of newBal) {
    utxRows.push({
      [U.usedAmount]: usedAmt,
      [U.balance]: [bal._id],
      [U.subscription]: bal.subscription ? [bal.subscription] : undefined,
      [U.timestamp]: isoHoursAgo(6),
      [U.ratingGroup]: 10,
      [U.unitType]: [1],
    });
  }
  // Remove undefined keys
  for (const r of utxRows) for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  const utxRes = await bulkInsert(TBL_USAGE_TX, utxRows);
  console.log(`  Usage Tx inserted: ${utxRes.ids.length} errors=${utxRes.errors.length}`);

  // Touch balance records to force recompute of rollup/formula
  console.log('  Touching balance records to trigger recompute...');
  for (const bal of newBal) {
    await http('PUT', `/v1/app-builder/table/${TBL_BALANCES}/record/${bal._id}?appId=${APP_ID}`, { cells: {} });
    await sleep(150);
  }

  // Explicitly evaluate formula columns
  console.log('  Evaluating computed columns (Used Amount, Remaining, Is Low Balance)...');
  const balIdList = newBal.map(b => b._id);
  for (const colId of ['mo1lqr6ldhc5w', 'ylwC', 'oso4']) {
    await http('POST', `/v1/app-builder/table/${TBL_BALANCES}/evaluate/${colId}?appId=${APP_ID}`, {
      sessionId: `seed-fraud-${colId}-${Date.now()}`,
      filter: { ids: balIdList },
    });
    await sleep(400);
  }

  console.log('\nWaiting 15s for formula propagation...');
  await sleep(15000);

  // ── Verification ──────────────────────────────────────────────────────
  console.log('\n═══ Verification ═══');
  const vRch = await sql(`SELECT count() c FROM a1776271424351_recharges WHERE _deleted=0 AND amount > 500`);
  console.log(`Recharges amount>500: ${vRch[0]?.c}`);
  const vImei = await sql(`SELECT subscription, count() c FROM a1776271424351_imei_change_events WHERE _deleted=0 GROUP BY subscription HAVING c > 2`);
  console.log(`Subscriptions with >2 IMEI events: ${vImei.length}`);
  const vBal = await sql(`SELECT count() c FROM a1776271424351_balances WHERE _deleted=0 AND is_low_balance=1 AND cycle_start > now() - INTERVAL 2 DAY`);
  console.log(`Balances with is_low_balance=1 in last 2 days: ${vBal[0]?.c}`);
  const vBalRaw = await sql(`SELECT balance_code, initial_amount, used_amount, remaining_amount, is_low_balance, cycle_start FROM a1776271424351_balances WHERE _deleted=0 AND balance_code LIKE 'BAL-FAST-%'`);
  console.log(`Raw BAL-FAST rows:`);
  for (const r of vBalRaw) console.log(`  ${r.balance_code} init=${r.initial_amount} used=${r.used_amount} rem=${r.remaining_amount} low=${r.is_low_balance} cs=${r.cycle_start}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
