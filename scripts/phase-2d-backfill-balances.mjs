// Backfills Balance.Used Amount and Balance.Remaining Amount by aggregating
// from Usage Transactions (the actual source of truth). Then also refreshes
// Subscription summary columns. Runs every time as a recompute pass.

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
const colMapCache = new Map();

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
async function colMap(t) {
  if (colMapCache.has(t)) return colMapCache.get(t);
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[t]}`);
  const cols = r.columnsMetaData || r.data?.columnsMetaData || [];
  const m = {}; for (const c of cols) m[c.name] = c.id;
  colMapCache.set(t, m); return m;
}
async function fetchAll(t) {
  const all = []; let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[t]}/paged-record?pageNo=${page}&pageSize=200`, {});
    const batch = r?.data || []; all.push(...batch);
    if (batch.length < 200) break;
    page++; await sleep(500);
  }
  return all;
}
async function update(t, id, cellsByName) {
  const m = await colMap(t);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) if (m[k]) cellsById[m[k]] = v;
  return await api('PUT', `/v1/app-builder/table/${TABLE_IDS[t]}/record/${id}`, { cells: cellsById });
}

const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

async function main() {
  log('Loading Balances + Usage Transactions...');
  const balances = await fetchAll('Balances');
  const utxs = await fetchAll('Usage Transactions');
  const mBal = await colMap('Balances');
  const mUtx = await colMap('Usage Transactions');
  log(`  ${balances.length} balances, ${utxs.length} usage transactions`);

  // Group UTs by Balance ref
  const usedByBalance = new Map();
  for (const u of utxs) {
    const balId = u.cells[mUtx['Balance']]?.[0];
    if (!balId) continue;
    const used = Number(u.cells[mUtx['Used Amount']]) || 0;
    usedByBalance.set(balId, (usedByBalance.get(balId) || 0) + used);
  }

  // For each balance: write Used = sum, Remaining = Initial - Used, Status accordingly
  let updated = 0;
  for (const b of balances) {
    const initial = Number(b.cells[mBal['Initial Amount']]) || 0;
    const used = usedByBalance.get(b._id) || 0;
    const remaining = Math.max(0, initial - used);
    const status = remaining <= 0 ? [2] : [1];
    await update('Balances', b._id, {
      'Used Amount': Math.round(used * 100) / 100,
      'Remaining Amount': Math.round(remaining * 100) / 100,
      'Status': status,
    });
    updated++;
    if (updated % 10 === 0) log(`  ... ${updated}/${balances.length}`);
    await sleep(800);
  }
  log(`  ✓ Backfilled ${updated} balances`);

  // Now refresh Subscription summary cols
  log('Refreshing Subscription Data/Voice/SMS Remaining...');
  const subs = await fetchAll('Subscriptions');
  const balancesBySub = new Map();
  for (const b of balances) {
    const sid = b.cells[mBal['Subscription']]?.[0];
    if (!sid) continue;
    if (!balancesBySub.has(sid)) balancesBySub.set(sid, []);
    balancesBySub.get(sid).push(b);
  }

  let subUpdated = 0;
  for (const s of subs) {
    const sBal = balancesBySub.get(s._id) || [];
    let dataRem = 0, voiceRem = 0, smsRem = 0;
    for (const b of sBal) {
      const initial = Number(b.cells[mBal['Initial Amount']]) || 0;
      const used = usedByBalance.get(b._id) || 0;
      const rem = Math.max(0, initial - used);
      const rg = Number(b.cells[mBal['Rating Group']]) || 0;
      if (rg >= 10 && rg < 100) dataRem += rem;
      else if (rg >= 100 && rg < 200) voiceRem += rem;
      else if (rg >= 200 && rg < 300) smsRem += rem;
    }
    await update('Subscriptions', s._id, {
      'Data Remaining (MB)': Math.round(dataRem),
      'Voice Remaining (min)': Math.round(voiceRem * 100) / 100,
      'SMS Remaining': Math.round(smsRem),
    });
    subUpdated++;
    await sleep(800);
  }
  log(`  ✓ Refreshed ${subUpdated} subscription summaries`);
  log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
