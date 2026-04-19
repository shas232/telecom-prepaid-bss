#!/usr/bin/env node
// unbilled-cdr-report.mjs — RAF-002
// Find CDRs where is_reconciled=false AND no matching balance-debit
// (heuristic: total_units > 0 AND total_charged_from_allowance=0 AND total_charged_from_wallet=0)
// Write /tmp/unbilled-cdr-<date>.json and create one Case per finding (tagged with batch id).
//
// Usage:
//   node scripts/unbilled-cdr-report.mjs --days 7
//   node scripts/unbilled-cdr-report.mjs --dry-run

import fs from 'node:fs';
import { api, APP_ID, sleep } from './lib-common.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
function argVal(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const DAYS = Number(argVal('--days')) || 7;

const TID = {
  Cases: 'abb4445bc9dfd2ccd9b8eb5a',
  CDRs:  '6208bfec7d2a7ff07f870188',
};

const C = {
  CaseCode:    '14zr',
  Subject:     'CamK',
  Description: 'LaSR',
  Category:    'lUL1',
  Priority:    'cZCE',
  Status:      'wc3U',
  OpenedAt:    's8D6',
  Subscription:'uxAZ',
  Customer:    'PVug',
};

async function sql(q) {
  const r = await api('POST', '/v1/agent/app/sql/execute', { appId: APP_ID, sqlQuery: q, limit: 100000 });
  if (!r.ok) throw new Error('SQL: ' + JSON.stringify(r.data).slice(0, 400));
  return r.data?.data?.rows || [];
}

async function bulkInsert(tableId, rows) {
  if (!rows.length) return { inserted: 0, errors: [] };
  let inserted = 0; const errors = [];
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const r = await api('POST', `/v1/app-builder/table/${tableId}/record-bulk?appId=${APP_ID}`,
      { arr: batch.map(cells => ({ cells })) });
    if (!r.ok) errors.push({ start: i, status: r.status, body: JSON.stringify(r.data).slice(0, 400) });
    else inserted += batch.length;
    await sleep(150);
  }
  return { inserted, errors };
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const batchId = `unbilled-${today}`;
  console.log(`== unbilled-cdr-report == days=${DAYS} batch=${batchId} ${DRY ? '[DRY RUN]' : ''}`);

  // Idempotency: bail if any case already exists with this batch tag in description
  // (cheap scan via SQL).
  const prior = await sql(
    `SELECT count() c FROM a1776271424351_cases WHERE _deleted=0 AND description LIKE '%${batchId}%'`
  );
  if (prior[0] && Number(prior[0].c) > 0) {
    console.log(`already ran for ${today} (${prior[0].c} cases with batch tag); exiting`);
    return;
  }

  const rows = await sql(
    `SELECT _id, subscription, customer, total_units, total_charged_from_wallet, total_charged_from_allowance,
            started_at, service_type, cdr_code
     FROM a1776271424351_call_detail_records
     WHERE _deleted=0
       AND is_reconciled=0
       AND total_units > 0
       AND (total_charged_from_wallet IS NULL OR total_charged_from_wallet = 0)
       AND (total_charged_from_allowance IS NULL OR total_charged_from_allowance = 0)
       AND started_at >= now() - INTERVAL ${DAYS} DAY`
  );
  console.log(`unbilled CDR rows: ${rows.length}`);

  // Write JSON artifact
  const outPath = `/tmp/unbilled-cdr-${today}.json`;
  const payload = { generated_at: new Date().toISOString(), batch_id: batchId, days: DAYS, count: rows.length, rows };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`wrote ${outPath}`);

  if (!rows.length) { console.log('no findings'); return; }

  const nowIso = new Date().toISOString();
  const caseRows = rows.map((r, i) => {
    const cells = {
      [C.CaseCode]:    `CASE-${today.replace(/-/g, '')}-${String(i + 1).padStart(4, '0')}-UB`,
      [C.Subject]:     `Unbilled CDR ${r.cdr_code || r._id.slice(0, 8)}: ${r.total_units} units uncharged`,
      [C.Description]: `Unbilled CDR revenue assurance batch=${batchId}\nCDR: ${r._id}\nSubscription: ${r.subscription}\nTotal Units: ${r.total_units}\nCharged from allowance: ${r.total_charged_from_allowance || 0}\nCharged from wallet: ${r.total_charged_from_wallet || 0}\nStarted: ${r.started_at}`,
      [C.Category]:    [6], // Other
      [C.Priority]:    [2], // Medium
      [C.Status]:      [1], // Open
      [C.OpenedAt]:    nowIso,
    };
    if (r.subscription) cells[C.Subscription] = [r.subscription];
    if (r.customer) cells[C.Customer] = [r.customer];
    return cells;
  });

  if (DRY) {
    console.log(`DRY: would insert ${caseRows.length} cases`);
    return;
  }

  const { inserted, errors } = await bulkInsert(TID.Cases, caseRows);
  console.log(`cases inserted: ${inserted}/${caseRows.length}`);
  if (errors.length) { console.log('CASE ERRORS:'); for (const e of errors.slice(0, 5)) console.log(JSON.stringify(e).slice(0, 400)); }

  console.log('\n== DONE ==');
  console.log(`findings=${rows.length} cases=${inserted} artifact=${outPath}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
