// Force recompute of all Balance formula/rollup columns by touching
// each balance record (no-op update). Sometimes this triggers compute
// that trigger eval doesn't.

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
  for (let i=0; i<6; i++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (res.status === 429) { await sleep(2500); continue; }
    return data;
  }
}

async function main() {
  const BAL = TABLE_IDS['Balances'];

  // Get all balance IDs
  const all = [];
  let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${BAL}/paged-record?pageNo=${page}&pageSize=300`, {});
    const batch = r?.data || [];
    all.push(...batch);
    if (batch.length < 300) break;
    page++;
  }
  console.log(`Touching ${all.length} balances to force recompute...`);

  // Touch each balance (empty cells update) to trigger formula re-evaluation
  for (let i = 0; i < all.length; i++) {
    await api('PUT', `/v1/app-builder/table/${BAL}/record/${all[i]._id}`, { cells: {} });
    if ((i+1) % 20 === 0) console.log(`  ... ${i+1}/${all.length}`);
    await sleep(600);
  }

  console.log('Waiting 30s for async settle...');
  await sleep(30000);

  // Verify
  const verify = await api('POST', `/v1/app-builder/table/${BAL}/paged-record?pageNo=1&pageSize=300`, {});
  const rows = verify?.data || [];
  const fillRate = (col) => rows.filter(r => r.cells[col] != null).length;

  console.log(`\nFill rates after touch (of ${rows.length}):`);
  console.log(`  MSISDN (jR4k):           ${fillRate('jR4k')}`);
  console.log(`  Plan Name (4eMZ):        ${fillRate('4eMZ')}`);
  console.log(`  Plan Price (H3Lp):       ${fillRate('H3Lp')}`);
  console.log(`  Plan Validity (FkIx):    ${fillRate('FkIx')}`);
  console.log(`  Plan Priority (eLvz):    ${fillRate('eLvz')}`);
  console.log(`  Used Amount (tT6Q):      ${fillRate('tT6Q')}`);
  console.log(`  Remaining (ZbjL):        ${fillRate('ZbjL')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
