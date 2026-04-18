// Adds Data/Voice/SMS Remaining columns on Subscriptions + populates them
// from current Balances (denormalized rollup, since ERPAI rollups can't filter
// by rating_group). The workflow runner refreshes these on every run.

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
async function fullCols(t) {
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[t]}`);
  return r.columnsMetaData || r.data?.columnsMetaData || [];
}
async function fetchAll(t, body = {}) {
  const all = []; let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[t]}/paged-record?pageNo=${page}&pageSize=200`, body);
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
  log('Adding Data/Voice/SMS Remaining columns on Subscriptions...');
  const subCols = await fullCols('Subscriptions');
  const newCols = [
    { name: 'Data Remaining (MB)', type: 'number', tooltip: 'Live: sum of remaining_amount across all data balances (rating group 10)' },
    { name: 'Voice Remaining (min)', type: 'number', tooltip: 'Live: sum of remaining_amount across all voice balances (rating groups 100/101/102)' },
    { name: 'SMS Remaining', type: 'number', tooltip: 'Live: sum of remaining_amount across all SMS balances (rating groups 200/201)' },
  ];
  for (const col of newCols) {
    if (!subCols.find(c => c.name === col.name)) {
      await api('POST', `/v1/app-builder/table/${TABLE_IDS['Subscriptions']}/column/bulk`, { columns: [col] });
      log(`  ✓ added "${col.name}"`);
      await sleep(1100);
    } else {
      log(`  (exists) "${col.name}"`);
    }
  }

  // Now populate from current Balances
  log('Populating from current Balances...');
  const subs = await fetchAll('Subscriptions');
  const balances = await fetchAll('Balances');
  const mSub = await colMap('Subscriptions');
  const mBal = await colMap('Balances');

  // Force refresh column map after column add
  colMapCache.delete('Subscriptions');
  const mSubFresh = await colMap('Subscriptions');

  const balancesBySub = new Map();
  for (const b of balances) {
    const sid = b.cells[mBal['Subscription']]?.[0];
    if (!sid) continue;
    if (!balancesBySub.has(sid)) balancesBySub.set(sid, []);
    balancesBySub.get(sid).push(b);
  }

  let count = 0;
  for (const s of subs) {
    const sBalances = balancesBySub.get(s._id) || [];
    let dataRem = 0, voiceRem = 0, smsRem = 0;
    for (const b of sBalances) {
      const rg = Number(b.cells[mBal['Rating Group']]) || 0;
      const remaining = Number(b.cells[mBal['Remaining Amount']]) || 0;
      if (rg === 10 || rg === 20 || rg === 30) dataRem += remaining;
      else if (rg >= 100 && rg < 200) voiceRem += remaining;
      else if (rg >= 200 && rg < 300) smsRem += remaining;
    }
    await update('Subscriptions', s._id, {
      'Data Remaining (MB)': Math.round(dataRem),
      'Voice Remaining (min)': Math.round(voiceRem * 100) / 100,
      'SMS Remaining': Math.round(smsRem),
    });
    count++;
    await sleep(900);
  }
  log(`  ✓ Updated ${count} subscriptions with current allowance summary`);
}

main().catch(e => { console.error(e); process.exit(1); });
