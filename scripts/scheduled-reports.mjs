#!/usr/bin/env node
// scheduled-reports.mjs — ABI-005
// Reads Report Subscriptions where status=Active AND next_run_at<=now().
// Executes sql_query via /v1/agent/app/sql/execute, writes /tmp/report-<code>-<ts>.<ext>
// (CSV or JSON per format), updates the subscription row:
//   last_run_at=now, last_run_status=Success|Failed, last_run_row_count=N,
//   next_run_at = +1d|+7d|+30d|+90d based on schedule
//
// Usage:
//   node scripts/scheduled-reports.mjs
//   node scripts/scheduled-reports.mjs --dry-run
//   node scripts/scheduled-reports.mjs --report-code RPT-XXX

import fs from 'node:fs';
import { api, APP_ID, sleep } from './lib-common.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
function argVal(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const REPORT_CODE = argVal('--report-code');

const TID_RS = '836f64cc093cc97dde58fa73';

const RS = {
  ReportCode:      'OoCB',
  ReportName:      'v0uU',
  SqlQuery:        'evpi',
  Schedule:        'gILW', // 1=Daily,2=Weekly,3=Monthly,4=Quarterly,5=Ad-Hoc
  Format:          'HcXY', // 1=CSV,2=XLSX,3=PDF,4=JSON
  Recipients:      'N499',
  LastRunAt:       '9Jxz',
  NextRunAt:       'iqP6',
  LastRunStatus:   'hDay', // 1=Success,2=Failed,3=Skipped,4=Running
  LastRunRowCount: 'LEt3',
  Status:          '3J5A', // 1=Active,2=Paused,3=Disabled
};

function parseSelectId(v) {
  if (v == null || v === '' || v === '[]') return null;
  try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) && a.length ? Number(a[0]) : null; }
  catch { return null; }
}

async function sql(q, limit = 100000) {
  const r = await api('POST', '/v1/agent/app/sql/execute', { appId: APP_ID, sqlQuery: q, limit });
  return { ok: r.ok, status: r.status, rows: r.data?.data?.rows || [], error: r.ok ? null : JSON.stringify(r.data).slice(0, 400) };
}

async function updateRS(id, cells) {
  return api('PUT', `/v1/app-builder/table/${TID_RS}/record/${id}?appId=${APP_ID}`, { cells });
}

function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}

function nextRunIso(scheduleId) {
  const d = new Date();
  switch (scheduleId) {
    case 1: d.setUTCDate(d.getUTCDate() + 1); break;    // Daily
    case 2: d.setUTCDate(d.getUTCDate() + 7); break;    // Weekly
    case 3: d.setUTCMonth(d.getUTCMonth() + 1); break;  // Monthly
    case 4: d.setUTCMonth(d.getUTCMonth() + 3); break;  // Quarterly
    default: d.setUTCDate(d.getUTCDate() + 1);          // Ad-Hoc fallback
  }
  return d.toISOString();
}

async function main() {
  console.log(`== scheduled-reports == ${DRY ? '[DRY RUN]' : ''} ${REPORT_CODE ? `only=${REPORT_CODE}` : ''}`);

  let filter = `_deleted=0 AND status='[1]'`;
  if (REPORT_CODE) filter += ` AND report_code='${REPORT_CODE}'`;
  else filter += ` AND (next_run_at IS NULL OR next_run_at <= now())`;

  const rq = await sql(
    `SELECT _id, report_code, report_name, sql_query, schedule, format, recipients, next_run_at
     FROM a1776271424351_report_subscriptions WHERE ${filter}`
  );
  if (!rq.ok) { console.error('subscription fetch failed:', rq.error); process.exit(1); }
  console.log(`subscriptions to run: ${rq.rows.length}`);

  let ok = 0, failed = 0;
  for (const sub of rq.rows) {
    const code = sub.report_code;
    const fmtId = parseSelectId(sub.format) || 1;
    const schedId = parseSelectId(sub.schedule) || 1;
    const ext = fmtId === 4 ? 'json' : 'csv'; // only CSV + JSON actually written; xlsx/pdf fallback to CSV
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = `/tmp/report-${code}-${ts}.${ext}`;

    console.log(`\n[${code}] ${sub.report_name} fmt=${fmtId} sched=${schedId}`);
    console.log(`  recipients: ${sub.recipients || '(none)'} — email sending is OUT OF SCOPE`);

    if (!sub.sql_query) {
      console.log('  no sql_query; marking Skipped');
      if (!DRY) await updateRS(sub._id, {
        [RS.LastRunAt]: new Date().toISOString(),
        [RS.LastRunStatus]: [3],
        [RS.LastRunRowCount]: 0,
        [RS.NextRunAt]: nextRunIso(schedId),
      });
      continue;
    }

    const q = await sql(sub.sql_query, 100000);
    if (!q.ok) {
      console.log(`  SQL FAILED: ${q.error}`);
      failed++;
      if (!DRY) await updateRS(sub._id, {
        [RS.LastRunAt]: new Date().toISOString(),
        [RS.LastRunStatus]: [2],
        [RS.LastRunRowCount]: 0,
        [RS.NextRunAt]: nextRunIso(schedId),
      });
      continue;
    }

    let content;
    if (ext === 'json') content = JSON.stringify(q.rows, null, 2);
    else content = toCsv(q.rows);

    if (DRY) {
      console.log(`  DRY: would write ${outPath} (${q.rows.length} rows)`);
      continue;
    }
    fs.writeFileSync(outPath, content);
    console.log(`  wrote ${outPath} (${q.rows.length} rows)`);
    ok++;

    const upd = await updateRS(sub._id, {
      [RS.LastRunAt]: new Date().toISOString(),
      [RS.LastRunStatus]: [1],
      [RS.LastRunRowCount]: q.rows.length,
      [RS.NextRunAt]: nextRunIso(schedId),
    });
    if (!upd.ok) console.log(`  update failed: ${upd.status} ${JSON.stringify(upd.data).slice(0, 200)}`);
    await sleep(150);
  }

  console.log('\n== DONE ==');
  console.log(`ok=${ok} failed=${failed} total=${rq.rows.length}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
