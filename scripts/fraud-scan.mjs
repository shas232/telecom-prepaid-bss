// Fraud Scan — ERPAI Telecom BSS
// Reads active Fraud Rules from a1776271424351_fraud_rules_1, runs per-rule
// detection SQL against existing data, and inserts rows into Fraud Alerts
// (1d1928f5e52e1ac196aeb4ea). Idempotent: skips duplicates within 24h.
//
// Usage: node scripts/fraud-scan.mjs
//
// Rate limit: 200ms between writes; bulk up to 20 per call.

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

// ─── Config ──────────────────────────────────────────────────────────────
const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const APP_ID = 'afe8c4540708da6ca9e6fe79';
const SCHEMA = 'a1776271424351_';

const TBL_FRAUD_ALERTS = '1d1928f5e52e1ac196aeb4ea';
const TBL_FRAUD_RULES = '615c37ab3900b57ed5d5f175';
const TBL_SUBSCRIPTIONS = '495e7f2e36663583722c8ec8';
const TBL_CUSTOMERS = 'aed243e6c13b8f5194724d76';
const TBL_WALLETS = '1ec21f333aa5965f9d9be874';
const TBL_RECHARGES = '4f5d0c07bc1db0dcef8e2c02';

// Fraud Alerts column ID map (from GET /v1/app-builder/table/1d1928f5e52e1ac196aeb4ea)
const FA = {
  alertCode:       'nRM5',
  triggeredAt:     'JzAd',
  severity:        'NtK6',   // select: 1=Low, 2=Med, 3=High, 4=Critical
  status:          '5pTP',   // select: 1=New
  score:           '5MsR',
  triggerData:     '0mA0',
  autoActionTaken: 'pGZK',   // select: 1=None
  msisdn:          '8SU3',
  lossEstimate:    'vfuA',
  rule:            '6g9h',   // ref -> fraud rule uuid
  subscription:    'V08A',
  customer:        'Zy17',
  wallet:          '5pOY',
  partner:         'slBG',
  relatedCase:     'zv1b',
};

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

// Insert up to 20 alerts per call, 200ms pacing
async function bulkInsertAlerts(rows) {
  if (!rows.length) return { inserted: 0, ids: [], errors: [] };
  const ids = [], errors = [];
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    const body = { arr: chunk.map(cells => ({ cells })) };
    const r = await http('POST', `/v1/app-builder/table/${TBL_FRAUD_ALERTS}/record-bulk?appId=${APP_ID}`, body);
    if (!r.ok || r.data?.success === false) {
      errors.push({ chunkIndex: i, status: r.status, body: JSON.stringify(r.data).slice(0, 600) });
      console.error(`  chunk ${i} failed: ${r.status} — ${JSON.stringify(r.data).slice(0, 300)}`);
    } else {
      const createdIds = (r.data?.data || r.data?.arr || r.data?.ids || []).map(x => x?._id || x?.id || x).filter(Boolean);
      ids.push(...createdIds);
      inserted += chunk.length;
    }
    await sleep(200);
  }
  return { inserted, ids, errors };
}

// ─── Alert code sequence ─────────────────────────────────────────────────
let ALERT_SEQ_DATE = '';
let ALERT_SEQ_NUM = 0;
function nextAlertCode() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const date = `${y}${m}${d}`;
  if (date !== ALERT_SEQ_DATE) { ALERT_SEQ_DATE = date; ALERT_SEQ_NUM = 0; }
  ALERT_SEQ_NUM++;
  return `FAL-${date}-${String(ALERT_SEQ_NUM).padStart(4, '0')}`;
}

// Severity "[N]" → number N; map rule severity to alert severity + score
function parseSeverity(sev) {
  if (!sev) return 1;
  try {
    const n = Number(JSON.parse(sev)[0]);
    return Number.isFinite(n) ? n : 1;
  } catch {
    const m = /\d+/.exec(String(sev)); return m ? Number(m[0]) : 1;
  }
}
function scoreFor(sev) {
  // rough 50-95 based on severity 1-4
  return { 1: 55, 2: 70, 3: 85, 4: 95 }[sev] || 60;
}

// Load existing fraud alerts from last 24h for idempotency
async function loadRecentAlertSignatures() {
  // Use record endpoint so we read back the cells with actual colIds
  const signatures = new Set();  // strings: "<ruleId>|sub:<id>" or "|rch:<id>" etc
  let pageNo = 1;
  while (true) {
    const r = await http('GET',
      `/v1/app-builder/table/${TBL_FRAUD_ALERTS}/record?appId=${APP_ID}&pageSize=200&pageNo=${pageNo}`);
    if (!r.ok) break;
    // Response is a bare array of {_id, cells, ...}
    const rows = Array.isArray(r.data) ? r.data : (r.data?.data?.data || r.data?.data || []);
    if (!rows.length) break;
    const cutoff = Date.now() - 24 * 3600 * 1000;
    for (const row of rows) {
      const cells = row.cells || {};
      const triggeredAt = cells[FA.triggeredAt];
      let triggeredMs = 0;
      if (typeof triggeredAt === 'number') triggeredMs = triggeredAt;
      else if (triggeredAt) triggeredMs = new Date(triggeredAt).getTime();
      if (triggeredMs && triggeredMs < cutoff) continue;
      const ruleRef = cells[FA.rule];
      const ruleId = Array.isArray(ruleRef) ? ruleRef[0] : ruleRef;
      const triggerData = cells[FA.triggerData];
      let target = '';
      try {
        const parsed = typeof triggerData === 'string' ? JSON.parse(triggerData) : triggerData;
        target = parsed?.target || '';
      } catch {}
      signatures.add(`${ruleId}|${target}`);
    }
    if (rows.length < 200) break;
    pageNo++;
    if (pageNo > 25) break;
  }
  return signatures;
}

// ─── Rule runners ────────────────────────────────────────────────────────

// FRU-VEL-RCH: wallets with >3 recharges (any 24-hour window approximated by
// grouping by wallet over the dataset — demo dataset has no long history).
async function runVelocityRecharge(rule, skipSigs) {
  const rows = await sql(
    `SELECT wallet, count() c FROM ${SCHEMA}recharges WHERE _deleted=0 GROUP BY wallet HAVING c > 3`
  );
  if (!rows.length) return { rule: rule.rule_code, status: 'no-op: no data', alerts: [] };

  // Join wallet → customer, then customer → first subscription
  const walletIds = rows.map(r => r.wallet).filter(Boolean);
  if (!walletIds.length) return { rule: rule.rule_code, status: 'no-op: no wallet ids', alerts: [] };
  const walletList = walletIds.map(w => `'${w}'`).join(',');
  const joinRows = await sql(
    `SELECT w._id wallet_id, w.customer customer_id, s._id sub_id, s.msisdn msisdn
     FROM ${SCHEMA}wallets w
     LEFT JOIN ${SCHEMA}subscriptions s ON s.customer = w.customer AND s._deleted = 0
     WHERE w._deleted=0 AND w._id IN (${walletList})`
  );
  const byWallet = new Map();
  for (const j of joinRows) {
    if (!byWallet.has(j.wallet_id)) byWallet.set(j.wallet_id, j);  // pick first sub per wallet
  }

  const sev = parseSeverity(rule.severity);
  const score = scoreFor(sev);
  const alerts = [];
  for (const row of rows) {
    const link = byWallet.get(row.wallet);
    const target = `wallet:${row.wallet}`;
    if (skipSigs.has(`${rule._id}|${target}`)) continue;
    const cells = {
      [FA.alertCode]: nextAlertCode(),
      [FA.triggeredAt]: new Date().toISOString(),
      [FA.severity]: [sev],
      [FA.status]: [1],
      [FA.score]: score,
      [FA.autoActionTaken]: [1],
      [FA.rule]: [rule._id],
      [FA.wallet]: [row.wallet],
      [FA.triggerData]: JSON.stringify({ target, rule_code: rule.rule_code, recharge_count: Number(row.c), wallet: row.wallet }),
    };
    if (link?.sub_id) cells[FA.subscription] = [link.sub_id];
    if (link?.customer_id) cells[FA.customer] = [link.customer_id];
    if (link?.msisdn) cells[FA.msisdn] = link.msisdn;
    alerts.push(cells);
  }
  return { rule: rule.rule_code, status: `prepared ${alerts.length}`, alerts };
}

// FRU-AMT-LRG: recharges with amount > 500 — single-row per recharge
async function runAmountLarge(rule, skipSigs) {
  const rows = await sql(
    `SELECT r._id recharge_id, r.amount amount, r.wallet wallet_id, w.customer customer_id, s._id sub_id, s.msisdn msisdn
     FROM ${SCHEMA}recharges r
     LEFT JOIN ${SCHEMA}wallets w ON w._id = r.wallet AND w._deleted=0
     LEFT JOIN ${SCHEMA}subscriptions s ON s.customer = w.customer AND s._deleted=0
     WHERE r._deleted=0 AND r.amount > 500`
  );
  if (!rows.length) return { rule: rule.rule_code, status: 'no-op: no data (no recharges > 500)', alerts: [] };

  const sev = parseSeverity(rule.severity);
  const score = scoreFor(sev);
  const alerts = [];
  const seenRecharge = new Set();
  for (const row of rows) {
    if (seenRecharge.has(row.recharge_id)) continue;
    seenRecharge.add(row.recharge_id);
    const target = `recharge:${row.recharge_id}`;
    if (skipSigs.has(`${rule._id}|${target}`)) continue;
    const amount = Number(row.amount) || 0;
    const cells = {
      [FA.alertCode]: nextAlertCode(),
      [FA.triggeredAt]: new Date().toISOString(),
      [FA.severity]: [sev],
      [FA.status]: [1],
      [FA.score]: score,
      [FA.autoActionTaken]: [1],
      [FA.rule]: [rule._id],
      [FA.lossEstimate]: amount,
      [FA.triggerData]: JSON.stringify({ target, rule_code: rule.rule_code, recharge_id: row.recharge_id, amount, wallet: row.wallet_id }),
    };
    if (row.wallet_id) cells[FA.wallet] = [row.wallet_id];
    if (row.sub_id) cells[FA.subscription] = [row.sub_id];
    if (row.customer_id) cells[FA.customer] = [row.customer_id];
    if (row.msisdn) cells[FA.msisdn] = row.msisdn;
    alerts.push(cells);
  }
  return { rule: rule.rule_code, status: `prepared ${alerts.length}`, alerts };
}

// FRU-IMEI-CHG: subscriptions with >2 IMEI change events
async function runImeiChange(rule, skipSigs) {
  const rows = await sql(
    `SELECT subscription, count() c FROM ${SCHEMA}imei_change_events WHERE _deleted=0 GROUP BY subscription HAVING c > 2`
  );
  if (!rows.length) return { rule: rule.rule_code, status: 'no-op: no subscriptions with >2 IMEI changes', alerts: [] };

  const subIds = rows.map(r => r.subscription).filter(Boolean);
  const subList = subIds.map(s => `'${s}'`).join(',');
  const subRows = await sql(
    `SELECT _id, customer, msisdn FROM ${SCHEMA}subscriptions WHERE _deleted=0 AND _id IN (${subList})`
  );
  const subMap = new Map(subRows.map(s => [s._id, s]));

  const sev = parseSeverity(rule.severity);
  const score = scoreFor(sev);
  const alerts = [];
  for (const row of rows) {
    const target = `subscription:${row.subscription}`;
    if (skipSigs.has(`${rule._id}|${target}`)) continue;
    const sub = subMap.get(row.subscription);
    const cells = {
      [FA.alertCode]: nextAlertCode(),
      [FA.triggeredAt]: new Date().toISOString(),
      [FA.severity]: [sev],
      [FA.status]: [1],
      [FA.score]: score,
      [FA.autoActionTaken]: [1],
      [FA.rule]: [rule._id],
      [FA.subscription]: [row.subscription],
      [FA.triggerData]: JSON.stringify({ target, rule_code: rule.rule_code, subscription: row.subscription, imei_change_count: Number(row.c) }),
    };
    if (sub?.customer) cells[FA.customer] = [sub.customer];
    if (sub?.msisdn) cells[FA.msisdn] = sub.msisdn;
    alerts.push(cells);
  }
  return { rule: rule.rule_code, status: `prepared ${alerts.length}`, alerts };
}

// FRU-DEP-FST: balances with is_low_balance=1 AND cycle_start within last 2 days
async function runFastDepletion(rule, skipSigs) {
  const rows = await sql(
    `SELECT b._id balance_id, b.subscription subscription_id, b.initial_amount initial_amount,
            b.cycle_start cycle_start, b.balance_code balance_code,
            s.customer customer_id, s.msisdn msisdn
     FROM ${SCHEMA}balances b
     LEFT JOIN ${SCHEMA}subscriptions s ON s._id = b.subscription AND s._deleted=0
     WHERE b._deleted=0 AND b.is_low_balance=1 AND b.cycle_start > now() - INTERVAL 2 DAY`
  );
  if (!rows.length) return { rule: rule.rule_code, status: 'no-op: no low-balance records in last 2 days', alerts: [] };

  const sev = parseSeverity(rule.severity);
  const score = scoreFor(sev);
  const alerts = [];
  for (const row of rows) {
    const target = `balance:${row.balance_id}`;
    if (skipSigs.has(`${rule._id}|${target}`)) continue;
    const cells = {
      [FA.alertCode]: nextAlertCode(),
      [FA.triggeredAt]: new Date().toISOString(),
      [FA.severity]: [sev],
      [FA.status]: [1],
      [FA.score]: score,
      [FA.autoActionTaken]: [1],
      [FA.rule]: [rule._id],
      [FA.triggerData]: JSON.stringify({
        target, rule_code: rule.rule_code, balance_id: row.balance_id,
        balance_code: row.balance_code, subscription: row.subscription_id,
        cycle_start: row.cycle_start, initial_amount: Number(row.initial_amount) || 0,
      }),
    };
    if (row.subscription_id) cells[FA.subscription] = [row.subscription_id];
    if (row.customer_id) cells[FA.customer] = [row.customer_id];
    if (row.msisdn) cells[FA.msisdn] = row.msisdn;
    alerts.push(cells);
  }
  return { rule: rule.rule_code, status: `prepared ${alerts.length}`, alerts };
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══ Fraud Scan — ERPAI Telecom BSS ═══');
  console.log(`Target: ${TBL_FRAUD_ALERTS} (Fraud Alerts)`);

  // 1. Load active rules
  const rules = await sql(
    `SELECT _id, rule_code, rule_name, severity, enabled FROM ${SCHEMA}fraud_rules_1 WHERE _deleted=0 AND enabled=1`
  );
  console.log(`Loaded ${rules.length} active rules.`);

  // 2. Load recent alert signatures for idempotency
  console.log('Loading existing alert signatures (24h window)…');
  let skipSigs = new Set();
  try { skipSigs = await loadRecentAlertSignatures(); } catch (e) { console.error('  (idempotency load failed, proceeding):', e.message); }
  console.log(`  ${skipSigs.size} existing signatures.`);

  // 3. Run rule handlers
  const handlers = {
    'FRU-VEL-RCH': runVelocityRecharge,
    'FRU-AMT-LRG': runAmountLarge,
    'FRU-IMEI-CHG': runImeiChange,
    'FRU-DEP-FST': runFastDepletion,
  };

  const summary = [];
  const insertedByRule = {};
  const allErrors = [];
  const sampleIds = [];

  for (const rule of rules) {
    const handler = handlers[rule.rule_code];
    if (!handler) {
      summary.push({ rule: rule.rule_code, status: 'no-op: no data / not implemented', inserted: 0 });
      insertedByRule[rule.rule_code] = 0;
      console.log(`[${rule.rule_code}] no-op: no data (handler not implemented)`);
      continue;
    }
    console.log(`\n[${rule.rule_code}] ${rule.rule_name}`);
    let result;
    try { result = await handler(rule, skipSigs); }
    catch (e) {
      console.error(`  ERROR running ${rule.rule_code}:`, e.message);
      summary.push({ rule: rule.rule_code, status: `error: ${e.message}`, inserted: 0 });
      insertedByRule[rule.rule_code] = 0;
      continue;
    }
    console.log(`  ${result.status}`);
    if (!result.alerts.length) {
      summary.push({ rule: rule.rule_code, status: result.status, inserted: 0 });
      insertedByRule[rule.rule_code] = 0;
      continue;
    }
    const { inserted, ids, errors } = await bulkInsertAlerts(result.alerts);
    console.log(`  inserted=${inserted} ids_sample=${ids.slice(0, 2).join(',')}`);
    if (errors.length) allErrors.push({ rule: rule.rule_code, errors });
    summary.push({ rule: rule.rule_code, status: result.status, inserted });
    insertedByRule[rule.rule_code] = inserted;
    if (ids.length && sampleIds.length < 2) sampleIds.push(...ids.slice(0, 2 - sampleIds.length));
  }

  // 4. Verification SQL
  console.log('\n═══ Verification ═══');
  try {
    const verify = await sql(
      `SELECT severity, count() c FROM ${SCHEMA}fraud_alerts WHERE _deleted=0 GROUP BY severity`
    );
    console.log('Fraud alerts by severity:');
    for (const r of verify) console.log(`  severity=${r.severity}  count=${r.c}`);
  } catch (e) {
    console.error('  verification SQL failed:', e.message);
  }

  console.log('\n═══ Summary ═══');
  for (const s of summary) console.log(`  ${s.rule.padEnd(14)}  inserted=${s.inserted}  — ${s.status}`);
  console.log(`\nSample alert _ids: ${sampleIds.join(', ') || '(none)'}`);
  if (allErrors.length) {
    console.log('\nErrors:');
    for (const e of allErrors) {
      console.log(`  ${e.rule}:`);
      for (const err of e.errors.slice(0, 3)) console.log(`    status=${err.status} body=${err.body.slice(0, 400)}`);
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
