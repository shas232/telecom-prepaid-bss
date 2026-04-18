#!/usr/bin/env node
// Loyalty Points Accrual workflow.
// Reads recharges + plan-purchase orders, writes Earn rows into
// Loyalty Points Transactions, then updates each customer's
// Loyalty Points and Loyalty Tier.

import { api, APP_ID, sleep } from './lib-common.mjs';

// ---- Table / column IDs ----
const LPT_TID = 'f203d5806798b331e85f98ea';
const CUST_TID = 'aed243e6c13b8f5194724d76';
const TIERS_TID = 'b16dec0823d32ce202887a42';

// LPT column ids
const LPT_COL = {
  TRANSACTION_CODE: 'XZfx',
  CUSTOMER: 'Sy4e',
  SUBSCRIPTION: '55HW',
  TYPE: 'EHo7',
  POINTS: 'qQtg',
  EARN_REASON: 'L7pF',
  REFERENCE_TYPE: 'bsXt',
  REFERENCE_ID: 'viA4',
  TIMESTAMP: 'rlqs',
  EXPIRY_DATE: 'LgL5',
};

// Customer column ids (Loyalty Points, Loyalty Tier)
const CUST_COL = {
  LOYALTY_POINTS: 'mFjL',
  LOYALTY_TIER: '4dFW',
};

// Loyalty Tier option ids on the customer's Loyalty Tier select
const TIER_OPTION = {
  Bronze: 1, Silver: 2, Gold: 3, Platinum: 4, Diamond: 5,
};

const EARN = [1];
const REASON_RECHARGE = [1];
const REASON_PLAN_PURCHASE = [2];
const REFTYPE_RECHARGE = [1];
const REFTYPE_ORDER = [2];

const ORDER_TYPE_PLAN_PURCHASE = 2;

// ---- helpers ----
async function sql(sqlQuery) {
  const r = await api('POST', '/v1/agent/app/sql/execute', {
    appId: APP_ID, sqlQuery, limit: 100000,
  });
  if (!r.ok) throw new Error('SQL failed: ' + JSON.stringify(r.data).slice(0, 400));
  return r.data?.data?.rows || [];
}

function parseSelectId(v) {
  // ClickHouse view returns select values as string like "[1]" or "[]"
  if (v == null || v === '' || v === '[]') return null;
  try {
    const arr = typeof v === 'string' ? JSON.parse(v) : v;
    if (Array.isArray(arr) && arr.length > 0) return Number(arr[0]);
    return null;
  } catch { return null; }
}

function dateToIso(d) {
  // input: "2026-03-05 07:51:32.757" → ISO
  if (!d) return null;
  const s = String(d).replace(' ', 'T');
  // assume UTC-ish; normalize
  const dt = new Date(s + (s.endsWith('Z') ? '' : 'Z'));
  if (isNaN(dt)) return null;
  return dt.toISOString();
}

function addDaysIso(iso, days) {
  const dt = new Date(iso);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString();
}

function tierForPoints(p) {
  if (p >= 50000) return 'Diamond';
  if (p >= 20000) return 'Platinum';
  if (p >= 5000) return 'Gold';
  if (p >= 1000) return 'Silver';
  return 'Bronze';
}

function yyyymmddUtc(iso) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function bulkInsert(tableId, rows) {
  if (!rows.length) return { inserted: 0, errors: [] };
  const errors = [];
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const r = await api(
      'POST',
      `/v1/app-builder/table/${tableId}/record-bulk?appId=${APP_ID}`,
      { arr: batch.map(cells => ({ cells })) },
    );
    if (!r.ok) {
      errors.push({ batchStart: i, status: r.status, body: JSON.stringify(r.data).slice(0, 2000) });
    } else {
      inserted += batch.length;
    }
    await sleep(150);
  }
  return { inserted, errors };
}

async function updateCustomer(id, cells) {
  const r = await api(
    'PUT',
    `/v1/app-builder/table/${CUST_TID}/record/${id}?appId=${APP_ID}`,
    { cells },
  );
  return r;
}

// ---- main ----
async function main() {
  console.log('== loyalty-accrual ==');

  // 1. Tiers — build map customerId → multiplier by looking up their current Loyalty Tier.
  // The customer's loyalty_tier column holds an option id ([1..5]) mapped to Bronze..Diamond.
  const tiers = await sql(`SELECT * FROM a1776271424351_loyalty_tiers WHERE _deleted=0`);
  const tierByName = {};
  for (const t of tiers) tierByName[t.tier_name] = Number(t.point_multiplier) || 1;
  const optIdToMultiplier = {
    1: tierByName.Bronze ?? 1,
    2: tierByName.Silver ?? 1,
    3: tierByName.Gold ?? 1,
    4: tierByName.Platinum ?? 1,
    5: tierByName.Diamond ?? 1,
  };
  console.log('tier multipliers:', optIdToMultiplier);

  // 2. Customers — needed for wallet→customer resolution, existing points, and current tier.
  const customers = await sql(`SELECT _id, loyalty_points, loyalty_tier FROM a1776271424351_customers WHERE _deleted=0`);
  const customerById = {};
  for (const c of customers) {
    const tierId = parseSelectId(c.loyalty_tier);
    customerById[c._id] = {
      loyalty_points: Number(c.loyalty_points) || 0,
      tierId,
      multiplier: (tierId && optIdToMultiplier[tierId]) || 1,
    };
  }
  console.log(`customers: ${customers.length}`);

  // 3. Wallets — recharges reference wallet, wallets reference customer.
  const wallets = await sql(`SELECT _id, customer FROM a1776271424351_wallets WHERE _deleted=0`);
  const walletToCustomer = {};
  for (const w of wallets) if (w.customer) walletToCustomer[w._id] = w.customer;
  console.log(`wallets: ${wallets.length}`);

  // 4. Recharges — successful / live ones only (not deleted).
  const recharges = await sql(`SELECT _id, wallet, amount, timestamp FROM a1776271424351_recharges WHERE _deleted=0`);
  console.log(`recharges: ${recharges.length}`);

  // 5. Orders with Order Type = Plan Purchase [2]
  const orders = await sql(`SELECT _id, customer, subscription, order_type, total_amount, submitted_at, created_at FROM a1776271424351_orders WHERE _deleted=0`);
  console.log(`orders (all live): ${orders.length}`);

  // 6. Existing LPT rows — for idempotency (reference_id match)
  const existingLpt = await sql(`SELECT reference_id FROM a1776271424351_loyalty_points_transactions WHERE _deleted=0`);
  const existingRefIds = new Set(existingLpt.map(r => r.reference_id).filter(Boolean));
  console.log(`existing LPT rows: ${existingLpt.length}`);

  // 7. Build new LPT rows
  const toInsert = [];
  let skipped = 0;
  let rechargeAccrued = 0, planAccrued = 0;
  let rechargeMissingCustomer = 0;
  const perDaySeq = {}; // yyyymmdd → running count

  function nextCode(iso) {
    const ymd = yyyymmddUtc(iso);
    perDaySeq[ymd] = (perDaySeq[ymd] || 0) + 1;
    return `LPT-${ymd}-${String(perDaySeq[ymd]).padStart(4, '0')}`;
  }

  // Recharges first
  for (const r of recharges) {
    if (existingRefIds.has(r._id)) { skipped++; continue; }
    const custId = walletToCustomer[r.wallet];
    if (!custId) { rechargeMissingCustomer++; continue; }
    const cust = customerById[custId];
    const mult = cust?.multiplier ?? 1;
    const amt = Number(r.amount) || 0;
    if (amt <= 0) continue;
    const points = Math.round(amt * 10 * mult);
    const ts = dateToIso(r.timestamp) || new Date().toISOString();
    const exp = addDaysIso(ts, 365);
    toInsert.push({
      [LPT_COL.TRANSACTION_CODE]: nextCode(ts),
      [LPT_COL.CUSTOMER]: [custId],
      [LPT_COL.TYPE]: EARN,
      [LPT_COL.POINTS]: points,
      [LPT_COL.EARN_REASON]: REASON_RECHARGE,
      [LPT_COL.REFERENCE_TYPE]: REFTYPE_RECHARGE,
      [LPT_COL.REFERENCE_ID]: r._id,
      [LPT_COL.TIMESTAMP]: ts,
      [LPT_COL.EXPIRY_DATE]: exp,
    });
    rechargeAccrued++;
  }

  // Plan-purchase orders
  let planSkippedType = 0;
  for (const o of orders) {
    const otype = parseSelectId(o.order_type);
    if (otype !== ORDER_TYPE_PLAN_PURCHASE) { planSkippedType++; continue; }
    if (existingRefIds.has(o._id)) { skipped++; continue; }
    const custId = o.customer;
    if (!custId) continue;
    const cust = customerById[custId];
    const mult = cust?.multiplier ?? 1;
    const amt = Number(o.total_amount) || 0;
    if (amt <= 0) continue;
    const points = Math.round(amt * 20 * mult);
    const ts = dateToIso(o.submitted_at) || dateToIso(o.created_at) || new Date().toISOString();
    const exp = addDaysIso(ts, 365);
    const cells = {
      [LPT_COL.TRANSACTION_CODE]: nextCode(ts),
      [LPT_COL.CUSTOMER]: [custId],
      [LPT_COL.TYPE]: EARN,
      [LPT_COL.POINTS]: points,
      [LPT_COL.EARN_REASON]: REASON_PLAN_PURCHASE,
      [LPT_COL.REFERENCE_TYPE]: REFTYPE_ORDER,
      [LPT_COL.REFERENCE_ID]: o._id,
      [LPT_COL.TIMESTAMP]: ts,
      [LPT_COL.EXPIRY_DATE]: exp,
    };
    if (o.subscription) cells[LPT_COL.SUBSCRIPTION] = [o.subscription];
    toInsert.push(cells);
    planAccrued++;
  }

  console.log(`prepared: ${toInsert.length} (recharge=${rechargeAccrued}, plan=${planAccrued}), skipped idempotent=${skipped}, recharges w/o customer=${rechargeMissingCustomer}, non-plan orders=${planSkippedType}`);

  // 8. Insert LPT rows (batches of 20)
  const { inserted, errors } = await bulkInsert(LPT_TID, toInsert);
  console.log(`inserted: ${inserted}/${toInsert.length}`);
  if (errors.length) {
    console.log('INSERT ERRORS:');
    for (const e of errors) console.log(JSON.stringify(e).slice(0, 800));
  }

  // 9. Sum per customer
  const addByCustomer = {};
  for (const cells of toInsert) {
    const cid = cells[LPT_COL.CUSTOMER];
    addByCustomer[cid] = (addByCustomer[cid] || 0) + (cells[LPT_COL.POINTS] || 0);
  }
  console.log(`customers with new points: ${Object.keys(addByCustomer).length}`);

  // 10. Update customers: new total + tier
  const updates = [];
  const updateErrors = [];
  for (const [cid, add] of Object.entries(addByCustomer)) {
    const prev = customerById[cid]?.loyalty_points ?? 0;
    const total = prev + add;
    const tierName = tierForPoints(total);
    const tierOptId = TIER_OPTION[tierName];
    const cells = {
      [CUST_COL.LOYALTY_POINTS]: total,
      [CUST_COL.LOYALTY_TIER]: [tierOptId],
    };
    const r = await updateCustomer(cid, cells);
    if (!r.ok) {
      updateErrors.push({ cid, status: r.status, body: JSON.stringify(r.data).slice(0, 600) });
    } else {
      updates.push({ cid, prev, add, total, tier: tierName });
    }
    await sleep(120);
  }
  console.log(`customer updates: ${updates.length}`);
  if (updateErrors.length) {
    console.log('UPDATE ERRORS (first 10):');
    for (const e of updateErrors.slice(0, 10)) console.log(JSON.stringify(e).slice(0, 600));
  }

  // Sample 3 customers
  const sample = updates.slice(0, 3);
  console.log('\nSAMPLE CUSTOMERS:');
  for (const s of sample) console.log(`  ${s.cid}  prev=${s.prev} +${s.add} → ${s.total}  [${s.tier}]`);

  console.log('\n== DONE ==');
  console.log(`inserted_lpt=${inserted} skipped=${skipped} customers_updated=${updates.length} errors=${errors.length + updateErrors.length}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
