// Generate many more Usage Transactions with wide day/hour coverage so the
// heatmap actually looks like a real telco network. Target: ~800 total events
// spread evenly-ish across 14 days × 24 hours with realistic peaks.
//
// We create new Usage Transactions against existing Charging Sessions (reuse
// them) to avoid touching other tables. Each new UT gets a random recent
// timestamp from our weighted hour distribution.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
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
  const cols = r.columnsMetaData || [];
  const m = {}; for (const c of cols) m[c.name] = c.id;
  colMapCache.set(t, m); return m;
}
async function fetchAll(t) {
  const all = []; let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[t]}/paged-record?pageNo=${page}&pageSize=300`, {});
    const batch = r?.data || [];
    all.push(...batch);
    if (batch.length < 300) break;
    page++; await sleep(300);
  }
  return all;
}
async function insert(t, cellsByName) {
  const m = await colMap(t);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) if (m[k]) cellsById[m[k]] = v;
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[t]}/record`, { cells: cellsById });
  return r?.data?.[0]?._id;
}
async function update(t, id, cellsByName) {
  const m = await colMap(t);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) if (m[k]) cellsById[m[k]] = v;
  return api('PUT', `/v1/app-builder/table/${TABLE_IDS[t]}/record/${id}`, { cells: cellsById });
}

// Realistic hour weights — flatter than before so every cell has SOMETHING.
// Peaks at 9-11am and 18-22, dips 01-05, everything else baseline
const HOUR_WEIGHTS = [
  3, 2, 2, 2, 2, 2, 3, 5, 7, 9, 10, 9, 7, 6, 6, 7, 8, 10, 12, 13, 12, 10, 7, 4,
];
function pickHour() {
  const total = HOUR_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let h = 0; h < 24; h++) { r -= HOUR_WEIGHTS[h]; if (r <= 0) return h; }
  return 20;
}
// Day weights — weekends slightly higher
const DAY_WEIGHTS = [7, 5, 5, 5, 5, 6, 8]; // Sun..Sat
function pickDayOffset(maxDays = 14) {
  // Pick a random day within last 14 days, weighted by day-of-week
  const dayOffset = Math.floor(Math.random() * maxDays);
  return dayOffset;
}
function randomTimestamp() {
  const now = Date.now();
  const offset = pickDayOffset();
  const hour = pickHour();
  const min = Math.floor(Math.random() * 60);
  const sec = Math.floor(Math.random() * 60);
  const d = new Date(now - offset * 86400000);
  d.setHours(hour, min, sec, Math.floor(Math.random() * 1000));
  return d.toISOString();
}

const rnd = (a,b) => a + Math.random() * (b-a);
const rndInt = (a,b) => Math.floor(rnd(a, b+1));
const pick = (arr) => arr[rndInt(0, arr.length-1)];

const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

async function main() {
  log('Loading existing data...');
  const subs = await fetchAll('Subscriptions');
  const balances = await fetchAll('Balances');
  const sessions = await fetchAll('Charging Sessions');
  const mSub = await colMap('Subscriptions');
  const mBal = await colMap('Balances');
  const mSess = await colMap('Charging Sessions');

  // Index balances by subscription + rating group
  const balancesBySubRG = new Map();
  for (const b of balances) {
    const sid = b.cells[mBal['Subscription']]?.[0];
    const rg = Number(b.cells[mBal['Rating Group']]) || 0;
    if (!sid) continue;
    const k = `${sid}:${rg}`;
    if (!balancesBySubRG.has(k)) balancesBySubRG.set(k, []);
    balancesBySubRG.get(k).push(b);
  }

  // Pool of charging sessions to reuse (or we create 60 new ones across days)
  log('Creating 60 new Charging Sessions spread across 14 days...');
  const newSessions = [];
  const SERVICE_CONFIGS = [
    { type: 'data', svcCtx: [1], svcType: [1], rg: 10,  unitType: [1], maxUsed: 200 },  // Data
    { type: 'voice', svcCtx: [2], svcType: [2], rg: 100, unitType: [2], maxUsed: 15 },   // Voice on-net
    { type: 'sms', svcCtx: [3], svcType: [5], rg: 200, unitType: [3], maxUsed: 1 },    // SMS dom
  ];

  for (let i = 0; i < 60; i++) {
    const sub = pick(subs);
    const cfg = pick(SERVICE_CONFIGS);
    const ts = randomTimestamp();
    const durSec = cfg.type === 'data' ? rndInt(120, 900) : cfg.type === 'voice' ? rndInt(30, 600) : 2;
    const endTs = new Date(new Date(ts).getTime() + durSec*1000).toISOString();
    const sessionId = `sim-${crypto.randomBytes(4).toString('hex')};${Math.floor(Math.random()*1e6)};${i}`;
    const msisdn = sub.cells[mSub['MSISDN']];

    const newSessId = await insert('Charging Sessions', {
      'Subscription': [sub._id],
      'Session ID': sessionId,
      'Service Context': cfg.svcCtx,
      'Service Type': cfg.svcType,
      'Started At': ts,
      'Ended At': endTs,
      'Status': [2], // Terminated
      'Termination Cause': [1],
      'Calling Party': msisdn,
      'APN': 'internet',
      'RAT Type': [1],
    });
    if (!newSessId) continue;
    newSessions.push({ id: newSessId, sub, cfg, ts, durSec });
    if ((i+1) % 10 === 0) log(`  ... ${i+1}/60 sessions`);
    await sleep(700);
  }
  log(`  → created ${newSessions.length} sessions`);

  // Now create 5-15 Usage Transactions per session
  log('Creating ~500 Usage Transactions...');
  let totalUTs = 0;
  for (const sess of newSessions) {
    const eventCount = sess.cfg.type === 'sms' ? 1 : rndInt(3, 10);
    const startMs = new Date(sess.ts).getTime();
    const step = (sess.durSec * 1000) / eventCount;
    const bKey = `${sess.sub._id}:${sess.cfg.rg}`;
    const balArr = balancesBySubRG.get(bKey);
    const balId = balArr?.[0]?._id;

    for (let j = 0; j < eventCount; j++) {
      const ts = new Date(startMs + j * step).toISOString();
      const msgType = j === 0 ? [1] : j === eventCount - 1 ? [3] : [2]; // CCR-I, CCR-U, CCR-T
      const used = sess.cfg.type === 'sms' ? 1 : rnd(0.1, sess.cfg.maxUsed / eventCount);
      const cells = {
        'Charging Session': [sess.id],
        'Subscription': [sess.sub._id],
        'Message Type': msgType,
        'Request Number': j,
        'Timestamp': ts,
        'Rating Group': sess.cfg.rg,
        'Service Identifier': sess.cfg.rg * 10 + 1,
        'Used Amount': Math.round(used * 100) / 100,
        'Unit Type': sess.cfg.unitType,
        'Result Code': 2001,
        'FUI Action': [1],
        'Raw Event': JSON.stringify({ session_id: sess.id, request_number: j, used_amount: used }),
      };
      if (balId) cells['Balance'] = [balId];
      await insert('Usage Transactions', cells);
      totalUTs++;
      if (totalUTs % 50 === 0) log(`  ... ${totalUTs} UTs created`);
      await sleep(500);
    }
  }

  log('');
  log(`=== DENSE EVENT GENERATION COMPLETE ===`);
  log(`  New sessions: ${newSessions.length}`);
  log(`  New UTs: ${totalUTs}`);
}

main().catch(e => { console.error(e); process.exit(1); });
