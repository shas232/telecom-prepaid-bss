// Usage Counters Compute — ERPAI Telecom BSS
// Populates the Usage Counters table (per-subscription daily/monthly accumulators)
// from Usage Transactions, Recharges, Wallet Transactions, Orders, and Roaming
// Sessions. Supports OCR-015 (period accumulators) and BSS fraud velocity checks.
//
// Usage:
//   node scripts/compute-counters.mjs                          # default: daily+monthly, all subs
//   node scripts/compute-counters.mjs --dry-run                # preview, no writes
//   node scripts/compute-counters.mjs --period-type daily      # daily|monthly|both
//   node scripts/compute-counters.mjs --subscription <uuid>    # scope to one sub

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

// ─── Config ─────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.erpai.studio';
const TOKEN    = 'erp_pat_live_REDACTED';
const APP_ID   = 'afe8c4540708da6ca9e6fe79';
const SCHEMA   = 'a1776271424351_';

const TBL_USAGE_COUNTERS = 'f61a9434584c2edc58a7caf3';

// Column id map (from GET /v1/app-builder/table/<tid>)
const UC = {
  counterCode:      'BLf2',
  subscription:     'Kxt6',
  customer:         'jwrU',
  msisdn:           'h0Lo',
  periodType:       'qXnx',  // [1]=Daily [2]=Weekly [3]=Monthly
  periodStart:      'znJG',
  periodEnd:        'KWuQ',
  dataMBUsed:       'O1Mh',
  voiceMinutesUsed: 'Bxw8',
  smsCount:         'XSAC',
  rechargesCount:   'R6WC',
  rechargeAmount:   'MaVP',
  walletDebits:     'bKum',
  planChangesCount: 'tOgW',
  roamingEvents:    'ajnl',
  roamingAmount:    'TRaJ',
  crossBorderEvents:'QR0H',
  uniqueDestinations:'StTh',
  lastActivityAt:   'GRNX',
  isAnomalous:      '7e0a',
  computedAt:       'TcTb',
  status:           '6Tho',  // [1]=Open [2]=Closed [3]=Archived
};

const DAILY_LOOKBACK_DAYS = 60;
const MONTHS = ['2026-02', '2026-03', '2026-04']; // last 3 months (today = 2026-04-17)
const TODAY = new Date('2026-04-17T00:00:00Z');   // anchor for "current" period semantics

// Anomaly thresholds (demo OCR-015)
const THRESH_DATA_MB = 5000;
const THRESH_VOICE_MIN = 300;
const THRESH_RECHARGES = 10;

// Rate limit + batching
const WRITE_SLEEP_MS = 100;
const BULK_SIZE = 20;

// ─── CLI flags ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const ptIdx = argv.indexOf('--period-type');
const PERIOD_MODE = (ptIdx >= 0 ? argv[ptIdx + 1] : 'both').toLowerCase(); // daily|monthly|both
const subIdx = argv.indexOf('--subscription');
const ONLY_SUB = subIdx >= 0 ? argv[subIdx + 1] : null;

if (!['daily', 'monthly', 'both'].includes(PERIOD_MODE)) {
  console.error(`Bad --period-type: ${PERIOD_MODE}. Use daily|monthly|both.`);
  process.exit(1);
}

// ─── HTTP helpers ───────────────────────────────────────────────────────
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

async function sql(sqlQuery, limit = 10000) {
  const r = await http('POST', '/v1/agent/app/sql/execute', { appId: APP_ID, sqlQuery, limit });
  if (!r.ok) throw new Error(`sql failed: ${r.status} ${JSON.stringify(r.data).slice(0, 400)}`);
  return r.data?.data?.rows || [];
}

// ─── Date helpers ───────────────────────────────────────────────────────
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

function fmtDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function toSqlTs(d) { return `${fmtDate(d)} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}:${String(d.getUTCSeconds()).padStart(2,'0')}`; }

function dayBounds(dateStr /* YYYY-MM-DD */) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const endExcl = new Date(Date.UTC(y, m - 1, d + 1));
  const endIncl = new Date(endExcl.getTime() - 1000);
  return {
    dateKey: dateStr,
    yyyymmdd: dateStr.replaceAll('-', ''),
    startSQL: `${fmtDate(start)} 00:00:00`,
    endExclSQL: `${fmtDate(endExcl)} 00:00:00`,
    periodStartISO: start.toISOString(),
    periodEndISO: endIncl.toISOString(),
  };
}
function monthBounds(code /* YYYY-MM */) {
  const [y, m] = code.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const endExcl = new Date(Date.UTC(y, m, 1));
  const endIncl = new Date(endExcl.getTime() - 1000);
  return {
    dateKey: `${code}-01`,
    yyyymmdd: `${code.replace('-', '')}01`,
    startSQL: `${fmtDate(start)} 00:00:00`,
    endExclSQL: `${fmtDate(endExcl)} 00:00:00`,
    periodStartISO: start.toISOString(),
    periodEndISO: endIncl.toISOString(),
  };
}

// Lookback window for the daily scan.
function lookbackStartSQL() {
  const d = new Date(TODAY.getTime() - DAILY_LOOKBACK_DAYS * 86400000);
  return `${fmtDate(d)} 00:00:00`;
}

// ─── Load subscriptions + wallets ───────────────────────────────────────
async function loadSubs() {
  const where = ONLY_SUB ? ` AND _id='${ONLY_SUB}'` : '';
  // argMax(..., _version) GROUP BY _id to always take the latest version.
  const rows = await sql(
    `SELECT _id,
            argMax(customer, _version) AS customer,
            argMax(msisdn, _version)   AS msisdn,
            argMax(_deleted, _version) AS del
     FROM ${SCHEMA}subscriptions
     WHERE 1=1${where}
     GROUP BY _id`
  );
  return rows.filter(r => Number(r.del) === 0);
}

async function loadWalletsByCustomer() {
  const rows = await sql(
    `SELECT _id,
            argMax(customer, _version) AS customer,
            argMax(_deleted, _version) AS del
     FROM ${SCHEMA}wallets
     GROUP BY _id`
  );
  const byCustomer = new Map(); // customer_id -> [walletId,...]
  for (const r of rows) {
    if (Number(r.del) !== 0) continue;
    const arr = byCustomer.get(r.customer) || [];
    arr.push(r._id);
    byCustomer.set(r.customer, arr);
  }
  return byCustomer;
}

// ─── Bulk aggregate queries ─────────────────────────────────────────────
// Return Map<subId, Map<dateKey, agg>>
async function aggUsageDaily(startSql) {
  const rows = await sql(
    `SELECT sub AS subscription,
            toString(toDate(ts)) AS day,
            sumIf(amount, unit='[1]') AS data_mb,
            sumIf(amount, unit='[2]') AS voice_min,
            sumIf(amount, unit='[3]') AS sms,
            max(ts) AS last_ts
     FROM (
       SELECT argMax(subscription, _version) AS sub,
              argMax(timestamp, _version)    AS ts,
              argMax(used_amount, _version)  AS amount,
              argMax(unit_type, _version)    AS unit,
              argMax(_deleted, _version)     AS del
       FROM ${SCHEMA}usage_transactions
       GROUP BY _id
     )
     WHERE del=0 AND ts >= '${startSql}'
     GROUP BY sub, day`,
    100000
  );
  const out = new Map();
  for (const r of rows) {
    if (!r.subscription) continue;
    if (!out.has(r.subscription)) out.set(r.subscription, new Map());
    out.get(r.subscription).set(r.day, {
      dataMB: num(r.data_mb),
      voiceMin: num(r.voice_min),
      sms: num(r.sms),
      lastTs: r.last_ts,
    });
  }
  return out;
}

async function aggUsageMonthly(months) {
  const inList = months.map(c => `'${c}'`).join(',');
  const rows = await sql(
    `SELECT sub AS subscription,
            formatDateTime(ts, '%Y-%m') AS ym,
            sumIf(amount, unit='[1]') AS data_mb,
            sumIf(amount, unit='[2]') AS voice_min,
            sumIf(amount, unit='[3]') AS sms,
            max(ts) AS last_ts
     FROM (
       SELECT argMax(subscription, _version) AS sub,
              argMax(timestamp, _version)    AS ts,
              argMax(used_amount, _version)  AS amount,
              argMax(unit_type, _version)    AS unit,
              argMax(_deleted, _version)     AS del
       FROM ${SCHEMA}usage_transactions
       GROUP BY _id
     )
     WHERE del=0
     GROUP BY sub, ym
     HAVING ym IN (${inList})`,
    100000
  );
  const out = new Map();
  for (const r of rows) {
    if (!r.subscription) continue;
    if (!out.has(r.subscription)) out.set(r.subscription, new Map());
    out.get(r.subscription).set(r.ym, {
      dataMB: num(r.data_mb),
      voiceMin: num(r.voice_min),
      sms: num(r.sms),
      lastTs: r.last_ts,
    });
  }
  return out;
}

async function aggRechargesDaily(startSql) {
  const rows = await sql(
    `SELECT w AS wallet,
            toString(toDate(ts)) AS day,
            count() AS c,
            sum(amt) AS amt
     FROM (
       SELECT argMax(wallet, _version)    AS w,
              argMax(timestamp, _version) AS ts,
              argMax(amount, _version)    AS amt,
              argMax(_deleted, _version)  AS del
       FROM ${SCHEMA}recharges
       GROUP BY _id
     )
     WHERE del=0 AND ts >= '${startSql}'
     GROUP BY w, day`,
    100000
  );
  return rows;
}
async function aggRechargesMonthly(months) {
  const inList = months.map(c => `'${c}'`).join(',');
  const rows = await sql(
    `SELECT w AS wallet,
            formatDateTime(ts, '%Y-%m') AS ym,
            count() AS c,
            sum(amt) AS amt
     FROM (
       SELECT argMax(wallet, _version)    AS w,
              argMax(timestamp, _version) AS ts,
              argMax(amount, _version)    AS amt,
              argMax(_deleted, _version)  AS del
       FROM ${SCHEMA}recharges
       GROUP BY _id
     )
     WHERE del=0
     GROUP BY w, ym
     HAVING ym IN (${inList})`,
    100000
  );
  return rows;
}

async function aggWalletDebitsDaily(startSql) {
  const rows = await sql(
    `SELECT w AS wallet,
            toString(toDate(ts)) AS day,
            sum(abs(amt)) AS debit
     FROM (
       SELECT argMax(wallet, _version)    AS w,
              argMax(timestamp, _version) AS ts,
              argMax(amount, _version)    AS amt,
              argMax(_deleted, _version)  AS del
       FROM ${SCHEMA}wallet_transactions
       GROUP BY _id
     )
     WHERE del=0 AND amt < 0 AND ts >= '${startSql}'
     GROUP BY w, day`,
    100000
  );
  return rows;
}
async function aggWalletDebitsMonthly(months) {
  const inList = months.map(c => `'${c}'`).join(',');
  const rows = await sql(
    `SELECT w AS wallet,
            formatDateTime(ts, '%Y-%m') AS ym,
            sum(abs(amt)) AS debit
     FROM (
       SELECT argMax(wallet, _version)    AS w,
              argMax(timestamp, _version) AS ts,
              argMax(amount, _version)    AS amt,
              argMax(_deleted, _version)  AS del
       FROM ${SCHEMA}wallet_transactions
       GROUP BY _id
     )
     WHERE del=0 AND amt < 0
     GROUP BY w, ym
     HAVING ym IN (${inList})`,
    100000
  );
  return rows;
}

async function aggPlanChangesDaily(startSql) {
  // order_type [2] = plan purchase/change approximation
  const rows = await sql(
    `SELECT sub AS subscription,
            toString(toDate(ts)) AS day,
            count() AS c
     FROM (
       SELECT argMax(subscription, _version) AS sub,
              argMax(submitted_at, _version)  AS ts,
              argMax(order_type, _version)    AS otype,
              argMax(_deleted, _version)      AS del
       FROM ${SCHEMA}orders
       GROUP BY _id
     )
     WHERE del=0 AND otype='[2]' AND ts >= '${startSql}'
     GROUP BY sub, day`,
    100000
  );
  return rows;
}
async function aggPlanChangesMonthly(months) {
  const inList = months.map(c => `'${c}'`).join(',');
  const rows = await sql(
    `SELECT sub AS subscription,
            formatDateTime(ts, '%Y-%m') AS ym,
            count() AS c
     FROM (
       SELECT argMax(subscription, _version) AS sub,
              argMax(submitted_at, _version)  AS ts,
              argMax(order_type, _version)    AS otype,
              argMax(_deleted, _version)      AS del
       FROM ${SCHEMA}orders
       GROUP BY _id
     )
     WHERE del=0 AND otype='[2]'
     GROUP BY sub, ym
     HAVING ym IN (${inList})`,
    100000
  );
  return rows;
}

async function aggRoamingDaily(startSql) {
  const rows = await sql(
    `SELECT sub AS subscription,
            toString(toDate(ts)) AS day,
            count() AS c,
            sum(charged) AS amt
     FROM (
       SELECT argMax(subscription, _version) AS sub,
              argMax(entered_at, _version)   AS ts,
              argMax(total_charged, _version) AS charged,
              argMax(_deleted, _version)     AS del
       FROM ${SCHEMA}roaming_sessions
       GROUP BY _id
     )
     WHERE del=0 AND ts >= '${startSql}'
     GROUP BY sub, day`,
    100000
  );
  return rows;
}
async function aggRoamingMonthly(months) {
  const inList = months.map(c => `'${c}'`).join(',');
  const rows = await sql(
    `SELECT sub AS subscription,
            formatDateTime(ts, '%Y-%m') AS ym,
            count() AS c,
            sum(charged) AS amt
     FROM (
       SELECT argMax(subscription, _version) AS sub,
              argMax(entered_at, _version)   AS ts,
              argMax(total_charged, _version) AS charged,
              argMax(_deleted, _version)     AS del
       FROM ${SCHEMA}roaming_sessions
       GROUP BY _id
     )
     WHERE del=0
     GROUP BY sub, ym
     HAVING ym IN (${inList})`,
    100000
  );
  return rows;
}

// ─── Load existing counters (idempotency index) ─────────────────────────
async function loadExistingCounters() {
  // Keyed by `${subId}|${periodTypeInt}|${periodStartDate}` -> {_id}
  const index = new Map();
  let pageNo = 1;
  while (true) {
    const r = await http('GET',
      `/v1/app-builder/table/${TBL_USAGE_COUNTERS}/record?appId=${APP_ID}&pageSize=200&pageNo=${pageNo}`);
    if (!r.ok) break;
    // Response shape can be: [array directly], or {data:{data:[]}}, or {data:[]}
    let rows;
    if (Array.isArray(r.data)) rows = r.data;
    else if (Array.isArray(r.data?.data?.data)) rows = r.data.data.data;
    else if (Array.isArray(r.data?.data)) rows = r.data.data;
    else rows = [];
    if (!rows.length) break;
    for (const row of rows) {
      const cells = row.cells || {};
      const subCell = cells[UC.subscription];
      const subId = Array.isArray(subCell) ? (subCell[0]?._id || subCell[0]?.id || subCell[0]) : subCell;
      let ptRaw = cells[UC.periodType];
      if (Array.isArray(ptRaw)) ptRaw = ptRaw[0];
      const pt = typeof ptRaw === 'object' ? ptRaw?.id : ptRaw;
      const start = cells[UC.periodStart];
      if (!subId || !pt || start == null) continue;
      // Normalize start: could be ISO string or epoch millis integer
      let day;
      if (typeof start === 'number') {
        day = new Date(start).toISOString().slice(0, 10);
      } else if (typeof start === 'string' && /^\d+$/.test(start)) {
        day = new Date(Number(start)).toISOString().slice(0, 10);
      } else {
        day = String(start).slice(0, 10);
      }
      index.set(`${subId}|${pt}|${day}`, { _id: row._id });
    }
    if (rows.length < 200) break;
    pageNo++;
    if (pageNo > 50) break;
  }
  return index;
}

// ─── Build one counter cells payload ────────────────────────────────────
function buildCells({ sub, customer, msisdn, periodTypeId, bounds, metrics, status }) {
  const letter = periodTypeId === 1 ? 'D' : (periodTypeId === 3 ? 'M' : 'W');
  const shortId = sub.slice(0, 6);
  const counterCode = `UCT-${shortId}-${letter}-${bounds.yyyymmdd}`;

  const isAnom = metrics.dataMB > THRESH_DATA_MB
              || metrics.voiceMin > THRESH_VOICE_MIN
              || metrics.rechargesCount > THRESH_RECHARGES;

  const cells = {
    [UC.counterCode]:      counterCode,
    [UC.subscription]:     [sub],
    [UC.customer]:         customer ? [customer] : undefined,
    [UC.msisdn]:           msisdn || '',
    [UC.periodType]:       [periodTypeId],
    [UC.periodStart]:      bounds.periodStartISO,
    [UC.periodEnd]:        bounds.periodEndISO,
    [UC.dataMBUsed]:       metrics.dataMB,
    [UC.voiceMinutesUsed]: metrics.voiceMin,
    [UC.smsCount]:         metrics.sms,
    [UC.rechargesCount]:   metrics.rechargesCount,
    [UC.rechargeAmount]:   metrics.rechargeAmount,
    [UC.walletDebits]:     metrics.walletDebits,
    [UC.planChangesCount]: metrics.planChanges,
    [UC.roamingEvents]:    metrics.roamingEvents,
    [UC.roamingAmount]:    metrics.roamingAmount,
    [UC.crossBorderEvents]:metrics.roamingEvents, // approximation per spec
    [UC.lastActivityAt]:   metrics.lastActivity || bounds.periodStartISO,
    [UC.isAnomalous]:      isAnom,
    [UC.computedAt]:       new Date().toISOString(),
    [UC.status]:           [status], // 1=Open 2=Closed
  };
  // Remove any undefined keys (customer may be missing)
  for (const k of Object.keys(cells)) if (cells[k] === undefined) delete cells[k];
  return { cells, counterCode, isAnom };
}

// ─── Bulk insert / update ───────────────────────────────────────────────
async function bulkInsert(cellsArray) {
  if (!cellsArray.length) return [];
  const body = { arr: cellsArray.map(c => ({ cells: c })) };
  const r = await http('POST',
    `/v1/app-builder/table/${TBL_USAGE_COUNTERS}/record-bulk?appId=${APP_ID}`, body);
  if (!r.ok || r.data?.success === false) {
    throw new Error(`bulk insert failed: ${r.status} ${JSON.stringify(r.data).slice(0, 400)}`);
  }
  const created = (r.data?.data || r.data?.arr || r.data?.ids || []).map(x => x?._id || x?.id || x).filter(Boolean);
  return created;
}
async function updateOne(id, cells) {
  const r = await http('PUT',
    `/v1/app-builder/table/${TBL_USAGE_COUNTERS}/record/${id}?appId=${APP_ID}`, { cells });
  if (!r.ok) throw new Error(`update failed: ${r.status} ${JSON.stringify(r.data).slice(0, 400)}`);
  return id;
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log('═══ Usage Counters Compute — ERPAI Telecom BSS ═══');
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN' : 'WRITE'}  |  period-type=${PERIOD_MODE}  |  only-sub=${ONLY_SUB || '(all)'}`);
  console.log(`Target table: ${TBL_USAGE_COUNTERS} (Usage Counters)`);
  console.log(`Daily lookback: ${DAILY_LOOKBACK_DAYS} days  |  Months: ${MONTHS.join(', ')}`);

  // Load subs + wallet→customer
  console.log('\n─── Loading subscriptions & wallets ───');
  const subs = await loadSubs();
  console.log(`  ${subs.length} active subscriptions`);
  const walletsByCustomer = await loadWalletsByCustomer();
  console.log(`  ${walletsByCustomer.size} customers with wallets`);

  // Build subId → { customer, msisdn, walletIds[] }
  const subInfo = new Map();
  for (const s of subs) {
    const walletIds = walletsByCustomer.get(s.customer) || [];
    subInfo.set(s._id, { customer: s.customer, msisdn: s.msisdn, walletIds });
  }

  // ─── Aggregate ─────────────────────────────────────────────────────
  const lb = lookbackStartSQL();
  const needDaily   = PERIOD_MODE === 'daily'   || PERIOD_MODE === 'both';
  const needMonthly = PERIOD_MODE === 'monthly' || PERIOD_MODE === 'both';

  console.log('\n─── Aggregating usage ───');
  const usageDaily   = needDaily   ? await aggUsageDaily(lb)          : new Map();
  const usageMonthly = needMonthly ? await aggUsageMonthly(MONTHS)    : new Map();
  console.log(`  usage daily: ${sizeMap(usageDaily)} sub-day cells`);
  console.log(`  usage monthly: ${sizeMap(usageMonthly)} sub-month cells`);

  console.log('─── Aggregating recharges / wallet / orders / roaming ───');
  const [rechDaily, rechMonthly, wtxDaily, wtxMonthly, planDaily, planMonthly, roamDaily, roamMonthly] =
    await Promise.all([
      needDaily   ? aggRechargesDaily(lb)       : Promise.resolve([]),
      needMonthly ? aggRechargesMonthly(MONTHS) : Promise.resolve([]),
      needDaily   ? aggWalletDebitsDaily(lb)    : Promise.resolve([]),
      needMonthly ? aggWalletDebitsMonthly(MONTHS) : Promise.resolve([]),
      needDaily   ? aggPlanChangesDaily(lb)     : Promise.resolve([]),
      needMonthly ? aggPlanChangesMonthly(MONTHS) : Promise.resolve([]),
      needDaily   ? aggRoamingDaily(lb)         : Promise.resolve([]),
      needMonthly ? aggRoamingMonthly(MONTHS)   : Promise.resolve([]),
    ]);

  // Index wallet-keyed rows by wallet
  const rechDailyByWallet   = indexBy(rechDaily, 'wallet', 'day');
  const rechMonthlyByWallet = indexBy(rechMonthly, 'wallet', 'ym');
  const wtxDailyByWallet    = indexBy(wtxDaily, 'wallet', 'day');
  const wtxMonthlyByWallet  = indexBy(wtxMonthly, 'wallet', 'ym');
  const planDailyBySub      = indexBy(planDaily, 'subscription', 'day');
  const planMonthlyBySub    = indexBy(planMonthly, 'subscription', 'ym');
  const roamDailyBySub      = indexBy(roamDaily, 'subscription', 'day');
  const roamMonthlyBySub    = indexBy(roamMonthly, 'subscription', 'ym');

  // ─── Build list of counter rows to write ───────────────────────────
  const toWrite = [];

  // Daily: for each (sub, day) that has *any* usage in last 60 days
  if (needDaily) {
    for (const [subId, byDay] of usageDaily.entries()) {
      if (ONLY_SUB && subId !== ONLY_SUB) continue;
      const info = subInfo.get(subId);
      if (!info) continue;
      for (const [day, u] of byDay.entries()) {
        const bounds = dayBounds(day);
        // Aggregate wallet-linked metrics across all wallets for this sub's customer
        let rechCount = 0, rechAmt = 0, wtxDebit = 0;
        for (const w of info.walletIds) {
          const rec = rechDailyByWallet.get(`${w}|${day}`);
          if (rec) { rechCount += num(rec.c); rechAmt += num(rec.amt); }
          const wtx = wtxDailyByWallet.get(`${w}|${day}`);
          if (wtx) { wtxDebit += num(wtx.debit); }
        }
        const pl = planDailyBySub.get(`${subId}|${day}`);
        const ro = roamDailyBySub.get(`${subId}|${day}`);
        const isCurrentPeriod = day === fmtDate(TODAY);
        const metrics = {
          dataMB: u.dataMB, voiceMin: u.voiceMin, sms: u.sms,
          rechargesCount: rechCount, rechargeAmount: rechAmt,
          walletDebits: wtxDebit,
          planChanges: pl ? num(pl.c) : 0,
          roamingEvents: ro ? num(ro.c) : 0,
          roamingAmount: ro ? num(ro.amt) : 0,
          lastActivity: u.lastTs ? new Date(u.lastTs.replace(' ', 'T') + 'Z').toISOString() : null,
        };
        const built = buildCells({
          sub: subId, customer: info.customer, msisdn: info.msisdn,
          periodTypeId: 1, bounds, metrics,
          status: isCurrentPeriod ? 1 : 2,
        });
        toWrite.push({ key: `${subId}|1|${bounds.dateKey}`, ...built });
      }
    }
  }

  // Monthly: only months with any usage for the sub
  if (needMonthly) {
    for (const [subId, byYm] of usageMonthly.entries()) {
      if (ONLY_SUB && subId !== ONLY_SUB) continue;
      const info = subInfo.get(subId);
      if (!info) continue;
      for (const [ym, u] of byYm.entries()) {
        if (!MONTHS.includes(ym)) continue;
        const bounds = monthBounds(ym);
        let rechCount = 0, rechAmt = 0, wtxDebit = 0;
        for (const w of info.walletIds) {
          const rec = rechMonthlyByWallet.get(`${w}|${ym}`);
          if (rec) { rechCount += num(rec.c); rechAmt += num(rec.amt); }
          const wtx = wtxMonthlyByWallet.get(`${w}|${ym}`);
          if (wtx) { wtxDebit += num(wtx.debit); }
        }
        const pl = planMonthlyBySub.get(`${subId}|${ym}`);
        const ro = roamMonthlyBySub.get(`${subId}|${ym}`);
        const currentYm = `${TODAY.getUTCFullYear()}-${String(TODAY.getUTCMonth()+1).padStart(2,'0')}`;
        const isCurrentPeriod = ym === currentYm;
        const metrics = {
          dataMB: u.dataMB, voiceMin: u.voiceMin, sms: u.sms,
          rechargesCount: rechCount, rechargeAmount: rechAmt,
          walletDebits: wtxDebit,
          planChanges: pl ? num(pl.c) : 0,
          roamingEvents: ro ? num(ro.c) : 0,
          roamingAmount: ro ? num(ro.amt) : 0,
          lastActivity: u.lastTs ? new Date(u.lastTs.replace(' ', 'T') + 'Z').toISOString() : null,
        };
        const built = buildCells({
          sub: subId, customer: info.customer, msisdn: info.msisdn,
          periodTypeId: 3, bounds, metrics,
          status: isCurrentPeriod ? 1 : 2,
        });
        toWrite.push({ key: `${subId}|3|${bounds.dateKey}`, ...built });
      }
    }
  }

  const dailyRows = toWrite.filter(w => w.key.split('|')[1] === '1').length;
  const monthlyRows = toWrite.filter(w => w.key.split('|')[1] === '3').length;
  console.log(`\n─── Planned rows: ${toWrite.length}  (daily=${dailyRows}, monthly=${monthlyRows}) ───`);

  // Anomaly preview
  const anomalous = toWrite.filter(w => w.isAnom);
  console.log(`  Anomalous rows flagged: ${anomalous.length}`);
  for (const a of anomalous.slice(0, 5)) {
    console.log(`    ${a.counterCode}  (isAnomalous=true)`);
  }

  if (DRY_RUN) {
    console.log('\n(dry-run — no writes)');
    // Show first 5 preview
    for (const w of toWrite.slice(0, 5)) {
      console.log(`  ${w.counterCode}`, JSON.stringify({
        dataMB: w.cells[UC.dataMBUsed], voice: w.cells[UC.voiceMinutesUsed],
        sms: w.cells[UC.smsCount], rech: w.cells[UC.rechargesCount],
        anom: w.cells[UC.isAnomalous],
      }));
    }
    return;
  }

  // ─── Idempotency: load existing counters ───────────────────────────
  console.log('\n─── Loading existing counters for idempotency ───');
  const existing = await loadExistingCounters();
  console.log(`  ${existing.size} existing rows indexed`);

  // ─── Write: split into new (bulk) vs existing (update) ─────────────
  const toInsert = [];
  const toUpdate = [];
  for (const w of toWrite) {
    const prev = existing.get(w.key);
    if (prev) toUpdate.push({ id: prev._id, cells: w.cells, code: w.counterCode });
    else toInsert.push({ cells: w.cells, code: w.counterCode });
  }
  console.log(`  New inserts: ${toInsert.length}   Updates: ${toUpdate.length}`);

  // Track created ids for sample reporting
  const sampleCreated = [];

  // Bulk insert
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BULK_SIZE) {
    const batch = toInsert.slice(i, i + BULK_SIZE);
    try {
      const ids = await bulkInsert(batch.map(b => b.cells));
      inserted += batch.length;
      for (let j = 0; j < Math.min(ids.length, batch.length); j++) {
        sampleCreated.push({ _id: ids[j], code: batch[j].code, cells: batch[j].cells });
      }
      process.stdout.write(`  inserted ${inserted}/${toInsert.length}\r`);
    } catch (e) {
      console.error(`\n  bulk insert error at offset ${i}: ${e.message}`);
    }
    await sleep(WRITE_SLEEP_MS);
  }
  console.log('');

  // Updates
  let updated = 0;
  for (const u of toUpdate) {
    try {
      await updateOne(u.id, u.cells);
      updated++;
      if (updated % 10 === 0) process.stdout.write(`  updated ${updated}/${toUpdate.length}\r`);
    } catch (e) {
      console.error(`\n  update error [${u.code}]: ${e.message}`);
    }
    await sleep(WRITE_SLEEP_MS);
  }
  console.log('');

  // ─── Summary ──────────────────────────────────────────────────────
  console.log('\n═══ Summary ═══');
  console.log(`  Inserted:  ${inserted}   (daily=${toInsert.filter(r=>r.cells[UC.periodType][0]===1).length}, monthly=${toInsert.filter(r=>r.cells[UC.periodType][0]===3).length})`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Anomalous: ${anomalous.length}`);

  if (sampleCreated.length >= 2) {
    console.log('\n─── Sample created rows ───');
    for (const s of sampleCreated.slice(0, 2)) {
      console.log(`  _id=${s._id}  code=${s.code}`);
      console.log(`    dataMB=${s.cells[UC.dataMBUsed]}  voice=${s.cells[UC.voiceMinutesUsed]}  sms=${s.cells[UC.smsCount]}  rech=${s.cells[UC.rechargesCount]}  anom=${s.cells[UC.isAnomalous]}`);
    }
  }

  // ─── Verification SQL ─────────────────────────────────────────────
  // Use argMax(..., _version) GROUP BY _id to dedupe across ClickHouse versions.
  console.log('\n─── Verification SQL ───');
  try {
    const rows = await sql(
      `SELECT period_type, count() AS cnt, sum(data_mb_used) AS data_mb,
              sum(voice_minutes_used) AS voice_min, sum(recharges_count) AS rech
       FROM (
         SELECT _id,
                argMax(period_type, _version)        AS period_type,
                argMax(data_mb_used, _version)       AS data_mb_used,
                argMax(voice_minutes_used, _version) AS voice_minutes_used,
                argMax(recharges_count, _version)    AS recharges_count,
                argMax(_deleted, _version)           AS del
         FROM ${SCHEMA}usage_counters
         GROUP BY _id
       )
       WHERE del=0
       GROUP BY period_type`
    );
    for (const r of rows) {
      console.log(`  period_type=${r.period_type}  cnt=${r.cnt}  data_mb=${r.data_mb}  voice_min=${r.voice_min}  rech=${r.rech}`);
    }
    console.log(`\n  Raw SQL spec query (period-rollover pattern):`);
    console.log(`    SELECT period_type, count(), sum(data_mb_used), sum(voice_minutes_used), sum(recharges_count) FROM ${SCHEMA}usage_counters WHERE _deleted=0 GROUP BY period_type`);
  } catch (e) {
    console.error(`  verify SQL failed: ${e.message}`);
  }

  if (anomalous.length) {
    console.log('\n─── Flagged anomalous (isAnomalous=true) ───');
    const bySub = new Map();
    for (const a of anomalous) {
      const subId = Array.isArray(a.cells[UC.subscription]) ? a.cells[UC.subscription][0] : a.cells[UC.subscription];
      bySub.set(subId, (bySub.get(subId) || 0) + 1);
    }
    for (const [sub, count] of [...bySub.entries()].slice(0, 10)) {
      console.log(`  sub=${sub}  anomalous_rows=${count}`);
    }
  }
}

// ─── Utility ────────────────────────────────────────────────────────────
function sizeMap(m) {
  let n = 0;
  for (const v of m.values()) n += v.size;
  return n;
}
function indexBy(rows, keyA, keyB) {
  const m = new Map();
  for (const r of rows) {
    if (!r[keyA]) continue;
    m.set(`${r[keyA]}|${r[keyB]}`, r);
  }
  return m;
}

main().catch(e => { console.error(e); process.exit(1); });
