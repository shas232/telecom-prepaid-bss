// Remove duplicate Balance rows (same Balance Code existing multiple times).
// Keep the oldest, delete newer duplicates.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const TABLE_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.table-ids.json'), 'utf8'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(method, url, body) {
  const opts = { method, headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  for (let i=0; i<6; i++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (res.status === 429) { await sleep(2500); continue; }
    return data;
  }
}

async function main() {
  const tid = TABLE_IDS['Balances'];
  const all = [];
  let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${tid}/paged-record?pageNo=${page}&pageSize=200`, {});
    const batch = r?.data || [];
    all.push(...batch);
    if (batch.length < 200) break;
    page++; await sleep(300);
  }
  console.log(`Total balances: ${all.length}`);

  // Group by Balance Code
  const codeCol = 'ucLa'; // Balance Code
  const byCode = new Map();
  for (const b of all) {
    const code = b.cells[codeCol];
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(b);
  }

  // Find dupes
  let dupeCount = 0, deletedCount = 0;
  for (const [code, rows] of byCode) {
    if (rows.length <= 1) continue;
    dupeCount++;
    // Sort by createdAt, keep oldest, delete rest
    rows.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const keep = rows[0];
    const toDelete = rows.slice(1);
    console.log(`  ${code}: ${rows.length} copies — keeping oldest, deleting ${toDelete.length}`);
    for (const d of toDelete) {
      await api('DELETE', `/v1/app-builder/table/${tid}/record/${d._id}`);
      deletedCount++;
      await sleep(600);
    }
  }
  console.log(`\nFound ${dupeCount} dupe groups, deleted ${deletedCount} duplicate balances`);
  console.log(`Remaining: ${all.length - deletedCount}`);
}

main().catch(e => { console.error(e); process.exit(1); });
