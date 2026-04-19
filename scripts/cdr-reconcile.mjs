#!/usr/bin/env node
// cdr-reconcile.mjs — RAF-001
// Per day: compare SUM(usage_transactions.used_amount) vs SUM(cdrs.total_units) per subscription.
// If |delta| / billed > 5% → insert a Case (category=Other, priority=High, subject includes delta).
// PUT affected CDRs: is_reconciled=true, reconciliation_batch_id, reconciliation_notes.
//
// Usage:
//   node scripts/cdr-reconcile.mjs                          # yesterday
//   node scripts/cdr-reconcile.mjs --date 2026-04-18
//   node scripts/cdr-reconcile.mjs --dry-run

import { api, APP_ID, sleep } from './lib-common.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
function argVal(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }

const TID = {
  Cases: 'abb4445bc9dfd2ccd9b8eb5a',
  CDRs:  '6208bfec7d2a7ff07f870188',
};

// Cases cols
const C = {
  CaseCode:    '14zr',
  Subject:     'CamK',
  Description: 'LaSR',
  Category:    'lUL1', // 6=Other
  Priority:    'cZCE', // 3=High
  Status:      'wc3U', // 1=Open
  OpenedAt:    's8D6',
  Subscription:'uxAZ',
  Customer:    'PVug',
};

// CDR cols
const CDR = {
  IsReconciled:        'RBxJ',
  ReconBatchId:        'JXYT',
  ReconNotes:          'F2mp',
};

const THRESHOLD = 0.05; // 5%

function yesterdayISO() {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function sql(q) {
  const r = await api('POST', '/v1/agent/app/sql/execute', { appId: APP_ID, sqlQuery: q, limit: 100000 });
  if (!r.ok) throw new Error('SQL: ' + JSON.stringify(r.data).slice(0, 400));
  return r.data?.data?.rows || [];
}

async function bulkInsert(tableId, rows) {
  if (!rows.length) return { inserted: 0, ids: [], errors: [] };
  let inserted = 0; const ids = []; const errors = [];
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const r = await api('POST', `/v1/app-builder/table/${tableId}/record-bulk?appId=${APP_ID}`,
      { arr: batch.map(cells => ({ cells })) });
    if (!r.ok) errors.push({ start: i, status: r.status, body: JSON.stringify(r.data).slice(0, 400) });
    else {
      inserted += batch.length;
      const got = (r.data?.data || r.data?.arr || []).map(x => x?._id || x?.id).filter(Boolean);
      ids.push(...got);
    }
    await sleep(150);
  }
  return { inserted, ids, errors };
}

async function updateCdr(id, cells) {
  return api('PUT', `/v1/app-builder/table/${TID.CDRs}/record/${id}?appId=${APP_ID}`, { cells });
}

async function main() {
  const date = argVal('--date') || yesterdayISO();
  const batchId = `recon-${date}`;
  console.log(`== cdr-reconcile == date=${date} batch=${batchId} ${DRY ? '[DRY RUN]' : ''}`);

  // Idempotency: if any CDR row for that date already has this batch id, skip
  const already = await sql(
    `SELECT count() c FROM a1776271424351_call_detail_records
     WHERE _deleted=0 AND reconciliation_batch_id='${batchId}'`
  );
  if (already[0] && Number(already[0].c) > 0) {
    console.log(`already reconciled (${already[0].c} rows tagged ${batchId}); exiting`);
    return;
  }

  // Sum usage per subscription for the day
  const utRows = await sql(
    `SELECT subscription sub, sum(used_amount) used FROM a1776271424351_usage_transactions
     WHERE _deleted=0 AND toDate(timestamp)='${date}'
     GROUP BY subscription`
  );
  // Sum CDRs per subscription for the day + collect CDR ids for flagged subs later
  const cdrRows = await sql(
    `SELECT subscription sub, sum(total_units) billed FROM a1776271424351_call_detail_records
     WHERE _deleted=0 AND toDate(started_at)='${date}'
     GROUP BY subscription`
  );
  console.log(`ut_groups=${utRows.length} cdr_groups=${cdrRows.length}`);

  const used = new Map(utRows.map(r => [r.sub, Number(r.used) || 0]));
  const billed = new Map(cdrRows.map(r => [r.sub, Number(r.billed) || 0]));
  const subs = new Set([...used.keys(), ...billed.keys()]);

  const flagged = [];
  for (const sub of subs) {
    if (!sub) continue;
    const u = used.get(sub) || 0;
    const b = billed.get(sub) || 0;
    const denom = Math.max(u, b, 1);
    const delta = Math.abs(u - b);
    const pct = delta / denom;
    if (pct > THRESHOLD && delta > 0) {
      flagged.push({ sub, used: u, billed: b, delta, pct });
    }
  }
  console.log(`flagged subscriptions: ${flagged.length}`);

  if (!flagged.length) { console.log('no deltas above threshold; exiting'); return; }

  // Look up customer per flagged subscription
  const subList = flagged.map(f => `'${f.sub}'`).join(',');
  const subMeta = await sql(
    `SELECT _id, customer, msisdn FROM a1776271424351_subscriptions WHERE _deleted=0 AND _id IN (${subList})`
  );
  const subMap = new Map(subMeta.map(s => [s._id, s]));

  // Build case rows
  const nowIso = new Date().toISOString();
  const seq = (i) => `CASE-${date.replace(/-/g, '')}-${String(i + 1).padStart(4, '0')}-RA`;
  const caseRows = flagged.map((f, i) => {
    const meta = subMap.get(f.sub) || {};
    const cells = {
      [C.CaseCode]:    seq(i),
      [C.Subject]:     `CDR delta for sub ${meta.msisdn || f.sub.slice(0,8)} day ${date}: ${f.used} used but ${f.billed} billed`,
      [C.Description]: `Revenue Assurance reconciliation batch=${batchId}\nSubscription: ${f.sub}\nUsage Transactions sum: ${f.used}\nCDR total_units sum: ${f.billed}\nDelta: ${f.delta.toFixed(4)} (${(f.pct * 100).toFixed(2)}%)`,
      [C.Category]:    [6], // Other (closest to Revenue Assurance)
      [C.Priority]:    [3], // High
      [C.Status]:      [1], // Open
      [C.OpenedAt]:    nowIso,
      [C.Subscription]: [f.sub],
    };
    if (meta.customer) cells[C.Customer] = [meta.customer];
    return cells;
  });

  // Get CDR ids for flagged subs to stamp
  const cdrIdRows = await sql(
    `SELECT _id, subscription FROM a1776271424351_call_detail_records
     WHERE _deleted=0 AND toDate(started_at)='${date}' AND subscription IN (${subList})`
  );
  const cdrIdsBySub = new Map();
  for (const r of cdrIdRows) {
    if (!cdrIdsBySub.has(r.subscription)) cdrIdsBySub.set(r.subscription, []);
    cdrIdsBySub.get(r.subscription).push(r._id);
  }

  if (DRY) {
    console.log(`DRY: would insert ${caseRows.length} cases + stamp ${cdrIdRows.length} CDRs`);
    for (const f of flagged.slice(0, 5)) console.log(`  sub=${f.sub.slice(0,8)} used=${f.used} billed=${f.billed} delta=${f.delta.toFixed(2)} pct=${(f.pct*100).toFixed(1)}%`);
    return;
  }

  const { inserted, errors } = await bulkInsert(TID.Cases, caseRows);
  console.log(`cases inserted: ${inserted}/${caseRows.length}`);
  if (errors.length) { console.log('CASE ERRORS:'); for (const e of errors.slice(0, 5)) console.log(JSON.stringify(e).slice(0, 400)); }

  // Stamp CDRs
  let stamped = 0; const stampErrs = [];
  for (const f of flagged) {
    const ids = cdrIdsBySub.get(f.sub) || [];
    for (const id of ids) {
      const r = await updateCdr(id, {
        [CDR.IsReconciled]: true,
        [CDR.ReconBatchId]: batchId,
        [CDR.ReconNotes]: `delta=${f.delta.toFixed(4)} used=${f.used} billed=${f.billed}`,
      });
      if (!r.ok) stampErrs.push({ id, status: r.status });
      else stamped++;
      await sleep(120);
    }
  }
  console.log(`CDRs stamped: ${stamped}`);
  if (stampErrs.length) { console.log('STAMP ERRORS (first 5):'); for (const e of stampErrs.slice(0,5)) console.log(JSON.stringify(e).slice(0,300)); }

  console.log('\n== DONE ==');
  console.log(`cases=${inserted} cdrs_stamped=${stamped} errors=${errors.length + stampErrs.length}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
