// Period Rollover — ERPAI Telecom BSS
// Snapshots monthly aggregates from live data into the Billing Periods table.
// Idempotent via Source Hash: unchanged → skip, changed → PUT update, new → POST.
//
// Usage:
//   node scripts/period-rollover.mjs                # default: 2026-02, 2026-03, 2026-04
//   node scripts/period-rollover.mjs --dry-run      # print table, write nothing
//   node scripts/period-rollover.mjs --month 2026-03  # single month override

import dns from 'node:dns';
import crypto from 'node:crypto';
dns.setDefaultResultOrder('ipv4first');

// ─── Config ──────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const APP_ID = 'afe8c4540708da6ca9e6fe79';
const SCHEMA = 'a1776271424351_';

const TBL_BILLING_PERIODS = '22188b9502bd5f1d3db811f6';

// Billing Periods column ID map (from GET /v1/app-builder/table/<tid>)
const BP = {
  periodCode:         'MrwW',
  periodType:         'Fl8l',  // select 1=Daily 2=Weekly 3=Monthly 4=Quarterly 5=Yearly
  periodStart:        'Nt8Q',
  periodEnd:          '8xVw',
  status:             'T8xm',  // 1=Open 2=Closed 3=Finalized 4=Reopened
  region:             'HUsJ',
  currency:           'vTiI',  // 1=USD 2=EUR 3=GBP 4=INR 5=BWP 6=ZAR 7=KES 8=NGN
  totalRechargesCount:'gx6z',
  totalRechargeAmount:'f9sH',
  totalPlanPurchases: 'JJQt',
  totalPlanRevenue:   'cMUm',
  totalWalletDebits:  'Yw8P',
  totalTaxCollected:  'YkcP',
  totalUsoLevy:       'lbb1',
  totalCommAccrued:   'eSOM',
  totalCommSettled:   '4CbV',
  activeSubscribers:  'x5QS',
  newSubscribers:     'sQne',
  churnedSubscribers: 'B9WT',
  totalDataMB:        '4EGM',
  totalVoiceMinutes:  'FtPN',
  totalSMS:           'dyxR',
  totalRoamingRev:    'IWh8',
  arpu:               'IKXR',
  fraudAlerts:        '79CR',
  loyaltyEarned:      'dHpC',
  loyaltyRedeemed:    'cBHD',
  computedAt:         'Ajd1',
  computedBy:         'pJ4B',
  sourceHash:         'Q17S',
  notes:              'c8Ff',
};

// ─── CLI flags ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const monthIdx = args.indexOf('--month');
const MONTH_OVERRIDE = monthIdx >= 0 ? args[monthIdx + 1] : null;

// ─── HTTP helpers ────────────────────────────────────────────────────────
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
  throw new Error(`retries exhausted: ${method} ${path}`);
}

async function sql(sqlQuery, limit = 1000) {
  const r = await http('POST', '/v1/agent/app/sql/execute', { appId: APP_ID, sqlQuery, limit });
  if (!r.ok) throw new Error(`sql failed: ${r.status} ${JSON.stringify(r.data).slice(0, 400)}`);
  return r.data?.data?.rows || [];
}

// ─── Period helpers ──────────────────────────────────────────────────────
function monthBounds(code) {
  // code like "2026-03"
  const [y, m] = code.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const endExcl = new Date(Date.UTC(y, m, 1));          // next month, exclusive upper bound
  const endIncl = new Date(endExcl.getTime() - 1000);    // last second of month for display
  const fmtDate = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return {
    startSQL: `${fmtDate(start)} 00:00:00`,
    endExclSQL: `${fmtDate(endExcl)} 00:00:00`,
    periodStartISO: start.toISOString(),
    periodEndISO: endIncl.toISOString(),
  };
}

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

// Build WHERE clause fragment for timestamp range on a given column
// Works with string timestamps comparing lexicographically with ClickHouse.
function tsRange(col, b) {
  return `${col} >= '${b.startSQL}' AND ${col} < '${b.endExclSQL}'`;
}

// ─── Aggregation per period ──────────────────────────────────────────────
// NOTE: ClickHouse views keep every version of a record (ReplacingMergeTree-style).
// Between merges, a single logical record can appear as multiple rows (different
// `_version` values). Naive `SUM(amount) WHERE _deleted=0` then double-counts
// updates (e.g. amount 30 → 130 is summed as 160, not 130). Fix: collapse to the
// latest version per `_id` via argMax(..., _version) BEFORE aggregating.
// See TC-TIME-07 / Wave-T5 for repro.
async function aggregateMonth(code) {
  const b = monthBounds(code);

  // Recharges (successful only for count; amount sum over all non-deleted in period)
  const recRows = await sql(
    `SELECT countIf(del=0 AND st='[1]') AS c_success,
            sumIf(amount, del=0 AND st='[1]') AS amt_total,
            sumIf(tax_amount, del=0 AND st='[1]') AS tax_total
     FROM (
       SELECT argMax(amount, _version) AS amount,
              argMax(tax_amount, _version) AS tax_amount,
              argMax(_deleted, _version) AS del,
              argMax(status, _version) AS st,
              argMax(timestamp, _version) AS ts
       FROM ${SCHEMA}recharges
       GROUP BY _id
     )
     WHERE ts >= '${b.startSQL}' AND ts < '${b.endExclSQL}'`
  );
  const totalRechargesCount = num(recRows[0]?.c_success);
  const totalRechargeAmount = num(recRows[0]?.amt_total);
  const totalTaxCollected = num(recRows[0]?.tax_total);

  // Orders — "plan purchase" = order_type [2]; use submitted_at for the period
  const orderRows = await sql(
    `SELECT countIf(del=0 AND ot='[2]') AS c,
            sumIf(total_amount, del=0 AND ot='[2]') AS amt
     FROM (
       SELECT argMax(total_amount, _version) AS total_amount,
              argMax(order_type, _version) AS ot,
              argMax(_deleted, _version) AS del,
              argMax(submitted_at, _version) AS sa
       FROM ${SCHEMA}orders
       GROUP BY _id
     )
     WHERE sa >= '${b.startSQL}' AND sa < '${b.endExclSQL}'`
  );
  const totalPlanPurchases = num(orderRows[0]?.c);
  const totalPlanRevenue = num(orderRows[0]?.amt);

  // Wallet debits: amount < 0 → sum of -amount (positive debit total)
  const wtxRows = await sql(
    `SELECT sumIf(-amount, del=0 AND amount < 0) AS debit_total
     FROM (
       SELECT argMax(amount, _version) AS amount,
              argMax(_deleted, _version) AS del,
              argMax(timestamp, _version) AS ts
       FROM ${SCHEMA}wallet_transactions
       GROUP BY _id
     )
     WHERE ts >= '${b.startSQL}' AND ts < '${b.endExclSQL}'`
  );
  const totalWalletDebits = num(wtxRows[0]?.debit_total);

  // Partner commissions — accrued vs settled by respective date columns
  const commAccruedRows = await sql(
    `SELECT sumIf(commission_amount, del=0) AS s
     FROM (
       SELECT argMax(commission_amount, _version) AS commission_amount,
              argMax(_deleted, _version) AS del,
              argMax(accrued_date, _version) AS ad
       FROM ${SCHEMA}partner_commissions
       GROUP BY _id
     )
     WHERE ad >= '${b.startSQL}' AND ad < '${b.endExclSQL}'`
  );
  const totalCommAccrued = num(commAccruedRows[0]?.s);

  const commSettledRows = await sql(
    `SELECT sumIf(commission_amount, del=0) AS s
     FROM (
       SELECT argMax(commission_amount, _version) AS commission_amount,
              argMax(_deleted, _version) AS del,
              argMax(settled_date, _version) AS sd
       FROM ${SCHEMA}partner_commissions
       GROUP BY _id
     )
     WHERE sd >= '${b.startSQL}' AND sd < '${b.endExclSQL}'`
  );
  const totalCommSettled = num(commSettledRows[0]?.s);

  // Subscribers
  // Active = status=[1] AND activation_date <= period end
  const activeRows = await sql(
    `SELECT countIf(del=0 AND st='[1]' AND ad < '${b.endExclSQL}') AS c
     FROM (
       SELECT argMax(status, _version) AS st,
              argMax(_deleted, _version) AS del,
              argMax(activation_date, _version) AS ad
       FROM ${SCHEMA}subscriptions
       GROUP BY _id
     )`
  );
  const activeSubscribers = num(activeRows[0]?.c);

  const newRows = await sql(
    `SELECT countIf(del=0) AS c
     FROM (
       SELECT argMax(_deleted, _version) AS del,
              argMax(activation_date, _version) AS ad
       FROM ${SCHEMA}subscriptions
       GROUP BY _id
     )
     WHERE ad >= '${b.startSQL}' AND ad < '${b.endExclSQL}'`
  );
  const newSubscribers = num(newRows[0]?.c);

  // termination_date may be epoch-zero when unset; restrict to non-zero year
  const churnedRows = await sql(
    `SELECT countIf(del=0 AND td > '1971-01-01 00:00:00') AS c
     FROM (
       SELECT argMax(_deleted, _version) AS del,
              argMax(termination_date, _version) AS td
       FROM ${SCHEMA}subscriptions
       GROUP BY _id
     )
     WHERE td >= '${b.startSQL}' AND td < '${b.endExclSQL}'`
  );
  const churnedSubscribers = num(churnedRows[0]?.c);

  // Usage transactions by unit_type
  const utxRows = await sql(
    `SELECT unit_type, sumIf(used_amount, del=0) AS s, countIf(del=0) AS c
     FROM (
       SELECT argMax(unit_type, _version) AS unit_type,
              argMax(used_amount, _version) AS used_amount,
              argMax(_deleted, _version) AS del,
              argMax(timestamp, _version) AS ts
       FROM ${SCHEMA}usage_transactions
       GROUP BY _id
     )
     WHERE ts >= '${b.startSQL}' AND ts < '${b.endExclSQL}'
     GROUP BY unit_type`
  );
  let totalDataMB = 0, totalVoiceMin = 0, totalSMS = 0;
  for (const r of utxRows) {
    if (r.unit_type === '[1]') totalDataMB = num(r.s);
    else if (r.unit_type === '[2]') totalVoiceMin = num(r.s);
    else if (r.unit_type === '[3]') totalSMS = num(r.s);
  }

  // Roaming revenue
  const roamRows = await sql(
    `SELECT sumIf(total_charged, del=0) AS s
     FROM (
       SELECT argMax(total_charged, _version) AS total_charged,
              argMax(_deleted, _version) AS del,
              argMax(entered_at, _version) AS ea
       FROM ${SCHEMA}roaming_sessions
       GROUP BY _id
     )
     WHERE ea >= '${b.startSQL}' AND ea < '${b.endExclSQL}'`
  );
  const totalRoamingRev = num(roamRows[0]?.s);

  // Fraud alerts
  const fraudRows = await sql(
    `SELECT countIf(del=0) AS c
     FROM (
       SELECT argMax(_deleted, _version) AS del,
              argMax(triggered_at, _version) AS ta
       FROM ${SCHEMA}fraud_alerts
       GROUP BY _id
     )
     WHERE ta >= '${b.startSQL}' AND ta < '${b.endExclSQL}'`
  );
  const fraudAlerts = num(fraudRows[0]?.c);

  // Loyalty points earned / redeemed
  const loyEarnedRows = await sql(
    `SELECT sumIf(points, del=0 AND tp='[1]') AS s
     FROM (
       SELECT argMax(points, _version) AS points,
              argMax(type, _version) AS tp,
              argMax(_deleted, _version) AS del,
              argMax(timestamp, _version) AS ts
       FROM ${SCHEMA}loyalty_points_transactions
       GROUP BY _id
     )
     WHERE ts >= '${b.startSQL}' AND ts < '${b.endExclSQL}'`
  );
  const loyaltyEarned = num(loyEarnedRows[0]?.s);

  const loyRedeemedRows = await sql(
    `SELECT sumIf(points, del=0 AND tp='[2]') AS s
     FROM (
       SELECT argMax(points, _version) AS points,
              argMax(type, _version) AS tp,
              argMax(_deleted, _version) AS del,
              argMax(timestamp, _version) AS ts
       FROM ${SCHEMA}loyalty_points_transactions
       GROUP BY _id
     )
     WHERE ts >= '${b.startSQL}' AND ts < '${b.endExclSQL}'`
  );
  const loyaltyRedeemed = num(loyRedeemedRows[0]?.s);

  // ARPU — compute client-side, skip if active=0
  const arpu = activeSubscribers > 0 ? (totalRechargeAmount / activeSubscribers) : 0;

  return {
    periodCode: code,
    periodStartISO: b.periodStartISO,
    periodEndISO: b.periodEndISO,
    totalRechargesCount,
    totalRechargeAmount,
    totalPlanPurchases,
    totalPlanRevenue,
    totalWalletDebits,
    totalTaxCollected,
    totalCommAccrued,
    totalCommSettled,
    activeSubscribers,
    newSubscribers,
    churnedSubscribers,
    totalDataMB,
    totalVoiceMin,
    totalSMS,
    totalRoamingRev,
    arpu,
    fraudAlerts,
    loyaltyEarned,
    loyaltyRedeemed,
  };
}

// ─── Hash for idempotency ────────────────────────────────────────────────
function sourceHash(agg) {
  const fields = [
    agg.periodCode,
    agg.totalRechargesCount,
    agg.totalRechargeAmount,
    agg.totalPlanPurchases,
    agg.totalPlanRevenue,
    agg.totalWalletDebits,
    agg.totalTaxCollected,
    agg.totalCommAccrued,
    agg.totalCommSettled,
    agg.activeSubscribers,
    agg.newSubscribers,
    agg.churnedSubscribers,
    agg.totalDataMB,
    agg.totalVoiceMin,
    agg.totalSMS,
    agg.totalRoamingRev,
    agg.fraudAlerts,
    agg.loyaltyEarned,
    agg.loyaltyRedeemed,
  ].map(v => typeof v === 'number' ? (Math.round(v * 100) / 100).toString() : String(v));
  return crypto.createHash('sha1').update(fields.join('|')).digest('hex');
}

// ─── Cells builder ───────────────────────────────────────────────────────
function buildCells(agg, statusId) {
  const hash = sourceHash(agg);
  const cells = {
    [BP.periodCode]:          agg.periodCode,
    [BP.periodType]:          [3],                                   // Monthly
    [BP.periodStart]:         agg.periodStartISO,
    [BP.periodEnd]:           agg.periodEndISO,
    [BP.status]:              [statusId],                            // 1=Open, 2=Closed
    [BP.currency]:            [5],                                   // BWP
    [BP.totalRechargesCount]: agg.totalRechargesCount,
    [BP.totalRechargeAmount]: agg.totalRechargeAmount,
    [BP.totalPlanPurchases]:  agg.totalPlanPurchases,
    [BP.totalPlanRevenue]:    agg.totalPlanRevenue,
    [BP.totalWalletDebits]:   agg.totalWalletDebits,
    [BP.totalTaxCollected]:   agg.totalTaxCollected,
    [BP.totalCommAccrued]:    agg.totalCommAccrued,
    [BP.totalCommSettled]:    agg.totalCommSettled,
    [BP.activeSubscribers]:   agg.activeSubscribers,
    [BP.newSubscribers]:      agg.newSubscribers,
    [BP.churnedSubscribers]:  agg.churnedSubscribers,
    [BP.totalDataMB]:         agg.totalDataMB,
    [BP.totalVoiceMinutes]:   agg.totalVoiceMin,
    [BP.totalSMS]:            agg.totalSMS,
    [BP.totalRoamingRev]:     agg.totalRoamingRev,
    [BP.fraudAlerts]:         agg.fraudAlerts,
    [BP.loyaltyEarned]:       agg.loyaltyEarned,
    [BP.loyaltyRedeemed]:     agg.loyaltyRedeemed,
    [BP.computedAt]:          new Date().toISOString(),
    [BP.computedBy]:          'system:period-rollover.mjs',
    [BP.sourceHash]:          hash,
  };
  if (agg.arpu > 0) cells[BP.arpu] = agg.arpu;
  return { cells, hash };
}

// ─── Load existing rows ──────────────────────────────────────────────────
async function loadExistingPeriods() {
  const byCode = new Map();
  let pageNo = 1;
  while (true) {
    const r = await http('GET',
      `/v1/app-builder/table/${TBL_BILLING_PERIODS}/record?appId=${APP_ID}&pageSize=200&pageNo=${pageNo}`);
    if (!r.ok) break;
    const rows = Array.isArray(r.data) ? r.data : (r.data?.data?.data || r.data?.data || []);
    if (!rows.length) break;
    for (const row of rows) {
      const cells = row.cells || {};
      const code = cells[BP.periodCode];
      const hash = cells[BP.sourceHash];
      if (code) byCode.set(code, { _id: row._id, hash });
    }
    if (rows.length < 200) break;
    pageNo++;
    if (pageNo > 25) break;
  }
  return byCode;
}

// ─── Write logic (bulk for inserts; PUT for updates) ─────────────────────
async function insertOne(cells) {
  const body = { arr: [{ cells }] };
  const r = await http('POST',
    `/v1/app-builder/table/${TBL_BILLING_PERIODS}/record-bulk?appId=${APP_ID}`, body);
  if (!r.ok || r.data?.success === false) {
    throw new Error(`insert failed: ${r.status} ${JSON.stringify(r.data).slice(0, 400)}`);
  }
  const createdIds = (r.data?.data || r.data?.arr || r.data?.ids || []).map(x => x?._id || x?.id || x).filter(Boolean);
  return createdIds[0] || null;
}

async function updateOne(id, cells) {
  const r = await http('PUT',
    `/v1/app-builder/table/${TBL_BILLING_PERIODS}/record/${id}?appId=${APP_ID}`, { cells });
  if (!r.ok) throw new Error(`update failed: ${r.status} ${JSON.stringify(r.data).slice(0, 400)}`);
  return id;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══ Period Rollover — ERPAI Telecom BSS ═══');
  console.log(`Target table: ${TBL_BILLING_PERIODS} (Billing Periods)`);
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'WRITE'}`);

  // Determine months to snapshot
  let months;
  if (MONTH_OVERRIDE) {
    months = [{ code: MONTH_OVERRIDE, status: MONTH_OVERRIDE === '2026-04' ? 1 : 2 }];
  } else {
    months = [
      { code: '2026-02', status: 2 },  // Closed
      { code: '2026-03', status: 2 },  // Closed
      { code: '2026-04', status: 1 },  // Open (current month)
    ];
  }

  // Aggregate each
  const results = [];
  for (const m of months) {
    console.log(`\n─── Aggregating ${m.code} ───`);
    try {
      const agg = await aggregateMonth(m.code);
      const { cells, hash } = buildCells(agg, m.status);
      results.push({ month: m, agg, cells, hash });
      console.log(`  recharges=${agg.totalRechargesCount} amt=${agg.totalRechargeAmount.toFixed(2)} ` +
        `active=${agg.activeSubscribers} arpu=${agg.arpu.toFixed(2)} fraud=${agg.fraudAlerts} ` +
        `data_mb=${agg.totalDataMB} voice_min=${agg.totalVoiceMin} sms=${agg.totalSMS}`);
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
      results.push({ month: m, error: e.message });
    }
  }

  // Print table summary
  console.log('\n═══ Aggregation Table ═══');
  console.log(
    'period  status  rech#  rech_amt    plans  plan_rev   wallet_deb  tax     comm_acc comm_set ' +
    'active  new  churn  data_mb  voice_m  sms  roam    arpu     fraud  loy_e  loy_r'
  );
  for (const r of results) {
    if (r.error) { console.log(`  ${r.month.code}  ERROR: ${r.error}`); continue; }
    const a = r.agg;
    console.log(
      `  ${a.periodCode} ${r.month.status === 1 ? 'Open  ' : 'Closed'} ` +
      `${String(a.totalRechargesCount).padStart(5)} ${a.totalRechargeAmount.toFixed(2).padStart(10)} ` +
      `${String(a.totalPlanPurchases).padStart(6)} ${a.totalPlanRevenue.toFixed(2).padStart(9)} ` +
      `${a.totalWalletDebits.toFixed(2).padStart(11)} ${a.totalTaxCollected.toFixed(2).padStart(7)} ` +
      `${a.totalCommAccrued.toFixed(2).padStart(8)} ${a.totalCommSettled.toFixed(2).padStart(8)} ` +
      `${String(a.activeSubscribers).padStart(6)} ${String(a.newSubscribers).padStart(4)} ` +
      `${String(a.churnedSubscribers).padStart(5)} ${String(a.totalDataMB).padStart(8)} ` +
      `${String(a.totalVoiceMin).padStart(8)} ${String(a.totalSMS).padStart(4)} ` +
      `${a.totalRoamingRev.toFixed(2).padStart(7)} ${a.arpu.toFixed(2).padStart(8)} ` +
      `${String(a.fraudAlerts).padStart(5)} ${String(a.loyaltyEarned).padStart(6)} ${String(a.loyaltyRedeemed).padStart(6)}`
    );
  }

  if (DRY_RUN) {
    console.log('\n(dry-run — no writes)');
    return;
  }

  // Load existing periods
  console.log('\n─── Loading existing Billing Periods rows ───');
  const existing = await loadExistingPeriods();
  console.log(`  ${existing.size} existing period rows.`);

  // Write each
  let created = 0, updated = 0, unchanged = 0;
  const errors = [];
  for (const r of results) {
    if (r.error) { errors.push({ code: r.month.code, msg: r.error }); continue; }
    const prev = existing.get(r.month.code);
    try {
      if (prev && prev.hash === r.hash) {
        console.log(`  ${r.month.code}: unchanged (hash=${r.hash.slice(0, 8)})`);
        unchanged++;
      } else if (prev) {
        await updateOne(prev._id, r.cells);
        console.log(`  ${r.month.code}: updated id=${prev._id} hash=${r.hash.slice(0, 8)}`);
        updated++;
      } else {
        const id = await insertOne(r.cells);
        console.log(`  ${r.month.code}: created id=${id} hash=${r.hash.slice(0, 8)}`);
        created++;
      }
      await sleep(1100);  // rate limit pacing
    } catch (e) {
      console.error(`  ${r.month.code} write ERROR: ${e.message}`);
      errors.push({ code: r.month.code, msg: e.message });
    }
  }

  // Summary
  console.log('\n═══ Summary ═══');
  console.log(`  Created:   ${created}`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  Errors:    ${errors.length}`);
  if (errors.length) {
    for (const e of errors) console.log(`    [${e.code}] ${e.msg}`);
  }

  // Verification
  console.log('\n═══ Verification ═══');
  try {
    const verify = await sql(
      `SELECT period_code, period_type, status, total_recharge_amount, active_subscribers, arpu
       FROM ${SCHEMA}billing_periods WHERE _deleted=0 ORDER BY period_code`
    );
    for (const v of verify) {
      console.log(`  ${v.period_code}  type=${v.period_type}  status=${v.status}  ` +
        `rech_amt=${v.total_recharge_amount}  active=${v.active_subscribers}  arpu=${v.arpu}`);
    }
  } catch (e) {
    console.error('  verification SQL failed:', e.message);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
