// Audit every table: record count, column list, and which cells are populated.
// Reports gaps so we can fix them.

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
  const res = await fetch(BASE_URL + url, opts);
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

async function getMeta(tname) {
  return api('GET', `/v1/app-builder/table/${TABLE_IDS[tname]}`);
}
async function fetchAll(tname) {
  const all = []; let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/paged-record?pageNo=${page}&pageSize=200`, {});
    const batch = r?.data || [];
    all.push(...batch);
    if (batch.length < 200) break;
    page++; await sleep(300);
  }
  return all;
}

const SYSTEM = new Set(['ID','CTDT','UTDT','CTBY','UTBY','DFT','SFID']);

async function main() {
  const report = {};
  const names = Object.keys(TABLE_IDS).sort();
  console.log(`Auditing ${names.length} tables...\n`);

  for (const name of names) {
    const meta = await getMeta(name);
    const cols = (meta.columnsMetaData || []).filter(c => !SYSTEM.has(c.id) && c.type !== 'related_ref');
    const records = await fetchAll(name);

    const colStats = cols.map(c => {
      let filled = 0;
      for (const r of records) {
        const v = r.cells[c.id];
        const isFilled = v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
        if (isFilled) filled++;
      }
      return {
        name: c.name,
        type: c.type,
        required: !!c.required,
        filled,
        total: records.length,
        pct: records.length ? Math.round((filled / records.length) * 100) : 0,
      };
    });

    report[name] = {
      recordCount: records.length,
      columns: colStats,
    };
    await sleep(200);
  }

  // Pretty print
  for (const [name, info] of Object.entries(report)) {
    console.log(`\n═══ ${name} (${info.recordCount} rows) ═══`);
    for (const c of info.columns) {
      const bar = c.pct === 100 ? '✓' : c.pct >= 50 ? '~' : c.pct > 0 ? '·' : '✗';
      const req = c.required ? ' [REQ]' : '';
      const note = c.pct < 100 && c.required ? ' ⚠️ REQUIRED BUT INCOMPLETE' : '';
      console.log(`  ${bar} ${c.name.padEnd(35)} ${c.type.padEnd(15)} ${c.filled}/${c.total} (${c.pct}%)${req}${note}`);
    }
  }

  // Gap summary
  console.log('\n\n═══ GAPS TO FIX ═══');
  for (const [name, info] of Object.entries(report)) {
    const gaps = info.columns.filter(c => c.pct < 100 && info.recordCount > 0);
    if (gaps.length === 0) continue;
    // Skip optional nullables like notes, address
    const serious = gaps.filter(c => c.required || ['Plan Name','MSISDN','Name','Used Amount','Remaining Amount','Tariff Plan','Current Plan','Customer','Subscription','Price','Initial Amount','Effective From','Wallet','Recharge','Partner'].some(keyword => c.name.includes(keyword)));
    if (serious.length === 0) continue;
    console.log(`\n  ${name}:`);
    for (const c of serious) {
      console.log(`    ${c.name.padEnd(35)} ${c.filled}/${c.total}`);
    }
  }

  fs.writeFileSync(path.join(ROOT, '.audit-report.json'), JSON.stringify(report, null, 2));
  console.log('\nFull report saved to .audit-report.json');
}

main().catch(e => { console.error(e); process.exit(1); });
