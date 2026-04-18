// Spread Usage Transaction / Charging Session / CDR timestamps across the
// last 14 days with a realistic hour-of-day distribution (peak evenings,
// quiet nights). The simulator dumped everything at one timestamp, making
// all time-based charts look like a single spike.
//
// Strategy:
//   1. Group Usage Transactions by Charging Session
//   2. Pick a plausible start time per session (weighted random day + hour)
//   3. Distribute CCR events within that session (seconds apart)
//   4. Update session started_at / ended_at to match
//   5. Update matching CDR started_at / ended_at / duration

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
  const m = {};
  for (const c of cols) m[c.name] = c.id;
  colMapCache.set(t, m);
  return m;
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
async function update(t, id, cellsByName) {
  const m = await colMap(t);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) if (m[k]) cellsById[m[k]] = v;
  return api('PUT', `/v1/app-builder/table/${TABLE_IDS[t]}/record/${id}`, { cells: cellsById });
}

// Realistic hour-of-day distribution for a mobile subscriber
// Peak: 18-22 (evening), 08-10 (morning), Low: 00-06 (night)
const HOUR_WEIGHTS = [
  1, 1, 0.5, 0.5, 0.5, 0.8, 2, 4, 6, 7, 6, 5, 5, 5, 5, 6, 7, 8, 10, 11, 10, 8, 5, 2,
];
function pickHour() {
  const total = HOUR_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let h = 0; h < 24; h++) {
    r -= HOUR_WEIGHTS[h];
    if (r <= 0) return h;
  }
  return 20;
}

function randomSessionStart() {
  const now = Date.now();
  const daysAgo = Math.floor(Math.random() * 14); // 0–13 days ago
  const hour = pickHour();
  const min = Math.floor(Math.random() * 60);
  const sec = Math.floor(Math.random() * 60);
  const d = new Date(now - daysAgo * 86400000);
  d.setHours(hour, min, sec, 0);
  return d;
}

const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

async function main() {
  log('Loading sessions, usage transactions, CDRs...');
  const sessions = await fetchAll('Charging Sessions');
  const utxs = await fetchAll('Usage Transactions');
  const cdrs = await fetchAll('Call Detail Records');

  const mSess = await colMap('Charging Sessions');
  const mUtx = await colMap('Usage Transactions');
  const mCdr = await colMap('Call Detail Records');

  log(`  ${sessions.length} sessions, ${utxs.length} UTs, ${cdrs.length} CDRs`);

  // Group UTs by session
  const utxBySession = new Map();
  for (const u of utxs) {
    const sid = u.cells[mUtx['Charging Session']]?.[0];
    if (!sid) continue;
    if (!utxBySession.has(sid)) utxBySession.set(sid, []);
    utxBySession.get(sid).push(u);
  }

  // Sort UTs within each session by Request Number
  for (const arr of utxBySession.values()) {
    arr.sort((a, b) => (Number(a.cells[mUtx['Request Number']]) || 0) - (Number(b.cells[mUtx['Request Number']]) || 0));
  }

  // CDR lookup by session id
  const cdrBySession = new Map();
  for (const cdr of cdrs) {
    const sid = cdr.cells[mCdr['Charging Session']]?.[0];
    if (sid) cdrBySession.set(sid, cdr);
  }

  log('Assigning new timestamps...');
  let updatedSessions = 0, updatedUtxs = 0, updatedCdrs = 0;

  for (const session of sessions) {
    const sid = session._id;
    const events = utxBySession.get(sid) || [];
    const sessionStart = randomSessionStart();

    // Session duration — data sessions longer, voice calls shorter, SMS instant
    const serviceType = Number(String(session.cells[mSess['Service Type']] || '[1]').replace(/[\[\]]/g, ''));
    let durationSec;
    if (serviceType === 1) durationSec = Math.floor(120 + Math.random() * 600);     // Data: 2-12 min
    else if (serviceType >= 2 && serviceType <= 4) durationSec = Math.floor(30 + Math.random() * 900); // Voice: 30s - 15min
    else durationSec = 2; // SMS: instant

    const sessionEnd = new Date(sessionStart.getTime() + durationSec * 1000);

    // Space the events within the session
    const events_count = Math.max(1, events.length);
    const step = durationSec * 1000 / events_count;

    // Update each UT with a timestamp within the session window
    for (let i = 0; i < events.length; i++) {
      const ts = new Date(sessionStart.getTime() + Math.floor(i * step)).toISOString();
      await update('Usage Transactions', events[i]._id, { 'Timestamp': ts });
      updatedUtxs++;
      if (updatedUtxs % 50 === 0) log(`  ... ${updatedUtxs} UTs updated`);
    }

    // Update session
    await update('Charging Sessions', sid, {
      'Started At': sessionStart.toISOString(),
      'Ended At': sessionEnd.toISOString(),
    });
    updatedSessions++;

    // Update matching CDR
    const cdr = cdrBySession.get(sid);
    if (cdr) {
      await update('Call Detail Records', cdr._id, {
        'Started At': sessionStart.toISOString(),
        'Ended At': sessionEnd.toISOString(),
        'Duration Seconds': durationSec,
      });
      updatedCdrs++;
    }
  }

  log('');
  log('=== BACKFILL COMPLETE ===');
  log(`  Sessions: ${updatedSessions}`);
  log(`  Usage Transactions: ${updatedUtxs}`);
  log(`  CDRs: ${updatedCdrs}`);
}

main().catch(e => { console.error(e); process.exit(1); });
