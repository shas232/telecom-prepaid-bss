// Diameter CCR Simulator for the Telecom Prepaid Billing System.
//
// Generates realistic CCR (Credit Control Request) events for data sessions,
// voice calls, and SMS, writes them to Charging Sessions + Usage Transactions,
// and decrements the corresponding Balances.
//
// Usage:
//   node diameter-simulator.mjs [count]   # generate N sessions (default 20)
//   node diameter-simulator.mjs stream    # continuously generate 1 event per 3s

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
const APP_ID = 'afe8c4540708da6ca9e6fe79';

const TABLE_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.table-ids.json'), 'utf8'));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const colMapCache = new Map();

async function api(method, url, body) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (res.status === 429) { await sleep(2500); continue; }
    return data;
  }
}

async function getColMap(tableName) {
  if (colMapCache.has(tableName)) return colMapCache.get(tableName);
  const tid = TABLE_IDS[tableName];
  const resp = await api('GET', `/v1/app-builder/table/${tid}`);
  const cols = resp.columnsMetaData || resp.data?.columnsMetaData || [];
  const map = {};
  for (const c of cols) map[c.name] = c.id;
  colMapCache.set(tableName, map);
  return map;
}

async function insert(tableName, cellsByName) {
  const tid = TABLE_IDS[tableName];
  const map = await getColMap(tableName);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) {
    if (map[k]) cellsById[map[k]] = v;
  }
  const resp = await api('POST', `/v1/app-builder/table/${tid}/record`, { cells: cellsById });
  const rid = resp?.data?.[0]?._id || resp?.data?._id || resp?._id;
  if (!rid) console.error(`  ✗ ${tableName}:`, JSON.stringify(resp).slice(0,200));
  return rid;
}

async function update(tableName, recordId, cellsByName) {
  const tid = TABLE_IDS[tableName];
  const map = await getColMap(tableName);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) {
    if (map[k]) cellsById[map[k]] = v;
  }
  const resp = await api('PUT', `/v1/app-builder/table/${tid}/record/${recordId}`, { cells: cellsById });
  return resp;
}

async function fetchRecords(tableName, body = {}) {
  const tid = TABLE_IDS[tableName];
  const resp = await api('POST', `/v1/app-builder/table/${tid}/paged-record?pageNo=1&pageSize=200`, body);
  return resp.data || [];
}

// ============================================================================
// Refresh Subscription summary columns after a session decrements a balance.
// (Denormalized rollup — ERPAI rollups can't filter by rating_group.)
// ============================================================================

async function refreshSubSummary(subId) {
  // Fetch fresh balances for this sub
  const balances = await fetchRecords('Balances', {
    filterCriteria: { condition:'AND', rules: [
      { id: (await getColMap('Balances'))['Subscription'], operator:'equals', value: subId }
    ]}
  });
  const bMap = await getColMap('Balances');
  let dataRem = 0, voiceRem = 0, smsRem = 0;
  for (const b of balances) {
    const rg = Number(b.cells[bMap['Rating Group']]) || 0;
    const rem = Number(b.cells[bMap['Remaining Amount']]) || 0;
    if (rg >= 10 && rg < 100) dataRem += rem;
    else if (rg >= 100 && rg < 200) voiceRem += rem;
    else if (rg >= 200 && rg < 300) smsRem += rem;
  }
  await update('Subscriptions', subId, {
    'Data Remaining (MB)': Math.round(dataRem),
    'Voice Remaining (min)': Math.round(voiceRem * 100) / 100,
    'SMS Remaining': Math.round(smsRem),
  });
}

// ============================================================================
// Diameter message synthesis
// ============================================================================

const SVC_CTX = {
  DATA: '32251@3gpp.org',
  VOICE: '32260@3gpp.org',
  SMS:  '32274@3gpp.org',
};

// Rating Group → select index (Service Context) mapping for cell values
const CTX_IDX = {
  [SVC_CTX.DATA]: [1],
  [SVC_CTX.VOICE]:[2],
  [SVC_CTX.SMS]:  [3],
};

// Message types select indices: CCR-I=1, CCR-U=2, CCR-T=3, CCR-E=4
const MSG_TYPE_IDX = { 'CCR-I':[1], 'CCR-U':[2], 'CCR-T':[3], 'CCR-E':[4] };

// Service Type indices: Data=1, Voice On-net=2, Voice Off-net=3, Voice Intl=4, SMS Dom=5, SMS Intl=6
const SVC_TYPE_IDX = { data:[1], vonnet:[2], voffnet:[3], vintl:[4], smsdom:[5], smsintl:[6] };

// Generate a unique session id like a real Diameter Session-Id AVP
const sessionIdGen = () => `pgw01.op.com;${Math.floor(Date.now()/1000)};${Math.floor(Math.random()*1e5)};${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const rnd = (min, max) => min + Math.random()*(max-min);
const rndInt = (min, max) => Math.floor(rnd(min, max+1));

// ============================================================================
// Core flow: generate one session
// ============================================================================

async function getActiveSubsWithBalances() {
  // Fetch all balances ONCE and group client-side (ref column 'equals' filter
  // is unreliable in ERPAI, so we group in memory instead).
  const subs = await fetchRecords('Subscriptions');
  const allBalances = await fetchRecords('Balances');
  const bMap = await getColMap('Balances');

  const balancesBySub = new Map();
  for (const b of allBalances) {
    const sid = b.cells[bMap['Subscription']]?.[0];
    if (!sid) continue;
    if (!balancesBySub.has(sid)) balancesBySub.set(sid, []);
    balancesBySub.get(sid).push(b);
  }

  const subsData = [];
  for (const s of subs) {
    const balances = balancesBySub.get(s._id) || [];
    if (balances.length) subsData.push({ sub: s, balances });
  }
  return subsData;
}

// Build balance by-rating-group map. Returns a Map of rg → array of balances
// (sorted by SPA priority — boosters [low priority] first, base [high] last).
async function balancesByRG(balances, sub) {
  const bMap = await getColMap('Balances');
  const spaMap = await getColMap('Subscription Plan Assignments');
  const tariffMap = await getColMap('Tariff Plans');

  // Resolve each balance's plan priority (lower = depletes first)
  const enriched = [];
  for (const b of balances) {
    const rg = Number(b.cells[bMap['Rating Group']]);
    const remaining = Number(b.cells[bMap['Remaining Amount']]) || 0;
    const status = String(b.cells[bMap['Status']] || '[1]');
    if (rg == null || isNaN(rg)) continue;
    if (remaining <= 0) continue; // skip depleted
    if (!status.includes('1')) continue; // skip non-Active

    // Look up SPA → Tariff Plan → Priority
    const spaId = b.cells[bMap['Subscription Plan Assignment']]?.[0];
    let priority = 10;
    if (spaId) {
      const spa = (await fetchRecords('Subscription Plan Assignments', {
        ids: [spaId],
      }))[0];
      const tariffId = spa?.cells[spaMap['Tariff Plan']]?.[0];
      if (tariffId) {
        const tariff = (await fetchRecords('Tariff Plans', { ids: [tariffId] }))[0];
        priority = Number(tariff?.cells[tariffMap['Priority On Charge']]) || 10;
      }
    }
    enriched.push({ balance: b, rg, priority, remaining });
  }
  // Group by rg, sort by priority ascending (booster first)
  const map = new Map();
  for (const e of enriched) {
    if (!map.has(e.rg)) map.set(e.rg, []);
    map.get(e.rg).push(e);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.priority - b.priority);
  return map;
}

// Decrement balances for a rating group across multiple plans (boosters first).
// Returns total amount consumed (may be less than requested if all empty).
async function consumeAcrossBalances(balances, amount) {
  const bMap = await getColMap('Balances');
  let remaining = amount;
  for (const e of balances) {
    if (remaining <= 0) break;
    const init = Number(e.balance.cells[bMap['Initial Amount']]) || 0;
    const priorUsed = Number(e.balance.cells[bMap['Used Amount']]) || 0;
    const avail = Math.max(0, init - priorUsed);
    if (avail <= 0) continue;
    const consume = Math.min(avail, remaining);
    const newUsed = priorUsed + consume;
    const newRemaining = Math.max(0, init - newUsed);
    const status = newRemaining <= 0 ? [2] : [1];
    await update('Balances', e.balance._id, {
      'Used Amount': newUsed,
      'Remaining Amount': newRemaining,
      'Status': status,
    });
    e.balance.cells[bMap['Used Amount']] = newUsed;
    e.balance.cells[bMap['Remaining Amount']] = newRemaining;
    remaining -= consume;
  }
  return amount - remaining; // total consumed
}

// Simulate a DATA session: CCR-I + several CCR-Us + CCR-T
async function simulateDataSession({ sub, balances }) {
  const bRG = await balancesByRG(balances, sub);
  const dataBalances = bRG.get(10) || [];
  if (!dataBalances.length) { console.log('  no data balance'); return; }

  const bMap = await getColMap('Balances');
  const totalRemaining = dataBalances.reduce((sum, e) => sum + e.remaining, 0);
  const dataBalance = dataBalances[0].balance; // for ref column on Usage Transaction (booster first)
  const remainingInitial = totalRemaining;
  if (remainingInitial <= 0) { console.log(`  ${sub.cells[(await getColMap('Subscriptions'))['MSISDN']]} data depleted, skipping`); return; }

  const sessionId = sessionIdGen();
  const startedAt = new Date().toISOString();
  const subM = await getColMap('Subscriptions');
  const msisdn = sub.cells[subM['MSISDN']];
  const imsi = sub.cells[subM['IMSI']];

  // Create Charging Session
  const chSession = await insert('Charging Sessions', {
    'Subscription':[sub._id],
    'Session ID': sessionId,
    'Service Context': CTX_IDX[SVC_CTX.DATA],
    'Service Type': SVC_TYPE_IDX.data,
    'Started At': startedAt,
    'Status':[1], // Active
    'APN':'internet',
    'RAT Type':[1], // EUTRAN
    'Request Count':0,
  });
  if (!chSession) return;

  // Size of the session (in MB): random between 50MB and 500MB, capped by remaining
  const totalSessionMB = Math.min(rndInt(50, 500), remainingInitial);
  let usedSoFar = 0;
  let reqNum = 0;

  // CCR-I: initial request, grant a 10MB chunk
  const initialGrant = Math.min(10, remainingInitial);
  await insert('Usage Transactions', {
    'Charging Session':[chSession],
    'Subscription':[sub._id],
    'Balance':[dataBalance._id],
    'Message Type': MSG_TYPE_IDX['CCR-I'],
    'Request Number': reqNum,
    'Timestamp': new Date().toISOString(),
    'Rating Group':10,
    'Service Identifier':1001,
    'Used Amount':0,
    'Unit Type':[1],
    'Input Octets':0,
    'Output Octets':0,
    'Requested Amount': initialGrant,
    'Granted Amount': initialGrant,
    'Result Code':2001,
    'Validity Time':3600,
    'FUI Action':[1], // None
    'APN':'internet',
    'Raw Event': JSON.stringify({ session_id:sessionId, message_type:'CCR-I', msisdn, imsi, rating_group:10, requested:{ total_octets: initialGrant*1024*1024 } }),
  });

  // CCR-Us: consume in chunks of ~5-25MB each
  while (usedSoFar < totalSessionMB) {
    reqNum++;
    const chunk = Math.min(rndInt(5, 25), totalSessionMB - usedSoFar);
    usedSoFar += chunk;
    const input = Math.floor(chunk * 0.3 * 1024 * 1024);  // ~30% uplink
    const output = Math.floor(chunk * 0.7 * 1024 * 1024); // ~70% downlink
    const nextGrant = Math.min(10, totalSessionMB - usedSoFar) || 0;
    const resultCode = (usedSoFar < remainingInitial) ? 2001 : 4012;
    const fuiAction = resultCode === 4012 ? [2] : [1]; // Terminate or None

    await insert('Usage Transactions', {
      'Charging Session':[chSession],
      'Subscription':[sub._id],
      'Balance':[dataBalance._id],
      'Message Type': MSG_TYPE_IDX['CCR-U'],
      'Request Number': reqNum,
      'Timestamp': new Date().toISOString(),
      'Rating Group':10,
      'Service Identifier':1001,
      'Used Amount': chunk,
      'Unit Type':[1],
      'Input Octets': input,
      'Output Octets': output,
      'Requested Amount': nextGrant,
      'Granted Amount': nextGrant,
      'Result Code': resultCode,
      'Validity Time':3600,
      'FUI Action': fuiAction,
      'APN':'internet',
      'Raw Event': JSON.stringify({ session_id:sessionId, message_type:'CCR-U', request_number:reqNum, used:{ input_octets:input, output_octets:output, total_octets:input+output } }),
    });

    if (resultCode === 4012) break;
    await sleep(150);
  }

  // CCR-T: session termination
  reqNum++;
  await insert('Usage Transactions', {
    'Charging Session':[chSession],
    'Subscription':[sub._id],
    'Balance':[dataBalance._id],
    'Message Type': MSG_TYPE_IDX['CCR-T'],
    'Request Number': reqNum,
    'Timestamp': new Date().toISOString(),
    'Rating Group':10,
    'Used Amount':0,
    'Unit Type':[1],
    'Result Code':2001,
    'Validity Time':0,
    'FUI Action':[1],
    'APN':'internet',
    'Raw Event': JSON.stringify({ session_id:sessionId, message_type:'CCR-T', termination_cause:'LOGOUT' }),
  });

  // Update Charging Session
  await update('Charging Sessions', chSession, {
    'Ended At': new Date().toISOString(),
    'Status':[2], // Terminated
    'Termination Cause':[1], // LOGOUT
    'Request Count': reqNum+1,
    'Total Used Amount': usedSoFar,
  });

  // Decrement balance(s) — boosters first, then base
  const consumed = await consumeAcrossBalances(dataBalances, usedSoFar);
  // Refresh subscription summary
  await refreshSubSummary(sub._id);
  const tag = dataBalances.length > 1 ? ` (across ${dataBalances.length} plans)` : '';
  console.log(`  ✓ data ${msisdn}: ${consumed}MB in ${reqNum+1} events${tag}`);
}

async function simulateVoiceCall({ sub, balances }) {
  const bRG = await balancesByRG(balances, sub);
  const voiceBalances = bRG.get(100) || [];
  if (!voiceBalances.length) return;
  const voiceBalance = voiceBalances[0].balance;
  const remaining = voiceBalances.reduce((s, e) => s + e.remaining, 0);
  if (remaining <= 0) return;

  const sessionId = sessionIdGen();
  const startedAt = new Date().toISOString();
  const subM = await getColMap('Subscriptions');
  const callerMsisdn = sub.cells[subM['MSISDN']];
  const calledMsisdn = '9198100' + String(rndInt(10000,99999)).padStart(5,'0');
  const durationMin = Math.min(Math.round(rnd(0.5, 15)*100)/100, remaining);

  const chSession = await insert('Charging Sessions', {
    'Subscription':[sub._id],
    'Session ID': sessionId,
    'Service Context': CTX_IDX[SVC_CTX.VOICE],
    'Service Type': SVC_TYPE_IDX.vonnet,
    'Started At': startedAt,
    'Status':[1],
    'Calling Party': callerMsisdn,
    'Called Party': calledMsisdn,
    'Request Count':0,
  });
  if (!chSession) return;

  // CCR-I grant 60 seconds (1 min)
  await insert('Usage Transactions', {
    'Charging Session':[chSession],
    'Subscription':[sub._id],
    'Balance':[voiceBalance._id],
    'Message Type': MSG_TYPE_IDX['CCR-I'],
    'Request Number':0,
    'Timestamp': new Date().toISOString(),
    'Rating Group':100,
    'Service Identifier':2001,
    'Used Amount':0,
    'Unit Type':[2],
    'CC Time Seconds':0,
    'Requested Amount':1,
    'Granted Amount':1,
    'Result Code':2001,
    'Validity Time':60,
    'FUI Action':[1],
    'Calling Party':callerMsisdn,
    'Called Party':calledMsisdn,
    'Raw Event': JSON.stringify({ session_id:sessionId, message_type:'CCR-I', calling:callerMsisdn, called:calledMsisdn, requested:{ cc_time:60 } }),
  });

  // CCR-T with final used
  await insert('Usage Transactions', {
    'Charging Session':[chSession],
    'Subscription':[sub._id],
    'Balance':[voiceBalance._id],
    'Message Type': MSG_TYPE_IDX['CCR-T'],
    'Request Number':1,
    'Timestamp': new Date().toISOString(),
    'Rating Group':100,
    'Service Identifier':2001,
    'Used Amount': durationMin,
    'Unit Type':[2],
    'CC Time Seconds': Math.round(durationMin*60),
    'Result Code':2001,
    'Validity Time':0,
    'FUI Action':[1],
    'Calling Party':callerMsisdn,
    'Called Party':calledMsisdn,
    'Raw Event': JSON.stringify({ session_id:sessionId, message_type:'CCR-T', used:{ cc_time:Math.round(durationMin*60) }, termination_cause:'LOGOUT' }),
  });

  await update('Charging Sessions', chSession, {
    'Ended At': new Date().toISOString(),
    'Status':[2],
    'Termination Cause':[1],
    'Request Count':2,
    'Total Used Amount': durationMin,
  });

  await consumeAcrossBalances(voiceBalances, durationMin);
  await refreshSubSummary(sub._id);
  const tag = voiceBalances.length > 1 ? ` (across ${voiceBalances.length} plans)` : '';
  console.log(`  ✓ voice ${callerMsisdn} → ${calledMsisdn}: ${durationMin}min${tag}`);
}

async function simulateSMSEvent({ sub, balances }) {
  const bRG = await balancesByRG(balances, sub);
  const smsBalances = bRG.get(200) || [];
  if (!smsBalances.length) return;
  const smsBalance = smsBalances[0].balance;
  const remaining = smsBalances.reduce((s, e) => s + e.remaining, 0);
  if (remaining <= 0) return;

  const sessionId = sessionIdGen();
  const subM = await getColMap('Subscriptions');
  const from = sub.cells[subM['MSISDN']];
  const to = '9198100' + String(rndInt(10000,99999)).padStart(5,'0');

  const chSession = await insert('Charging Sessions', {
    'Subscription':[sub._id],
    'Session ID': sessionId,
    'Service Context': CTX_IDX[SVC_CTX.SMS],
    'Service Type': SVC_TYPE_IDX.smsdom,
    'Started At': new Date().toISOString(),
    'Ended At': new Date().toISOString(),
    'Status':[2], // Terminated (single event)
    'Termination Cause':[1],
    'Calling Party':from,
    'Called Party':to,
    'Request Count':1,
    'Total Used Amount':1,
  });
  if (!chSession) return;

  // CCR-E: single event
  await insert('Usage Transactions', {
    'Charging Session':[chSession],
    'Subscription':[sub._id],
    'Balance':[smsBalance._id],
    'Message Type': MSG_TYPE_IDX['CCR-E'],
    'Request Number':0,
    'Timestamp': new Date().toISOString(),
    'Rating Group':200,
    'Service Identifier':3001,
    'Used Amount':1,
    'Unit Type':[3],
    'Result Code':2001,
    'Validity Time':0,
    'FUI Action':[1],
    'Calling Party':from,
    'Called Party':to,
    'Raw Event': JSON.stringify({ session_id:sessionId, message_type:'CCR-E', from, to, used:{ units:1 } }),
  });

  await consumeAcrossBalances(smsBalances, 1);
  await refreshSubSummary(sub._id);
  console.log(`  ✓ SMS ${from} → ${to}`);
}

// ============================================================================
// Runner
// ============================================================================

async function runSession(activeSubs) {
  const pick = activeSubs[rndInt(0, activeSubs.length-1)];
  const dice = Math.random();
  if (dice < 0.55) await simulateDataSession(pick);
  else if (dice < 0.85) await simulateVoiceCall(pick);
  else await simulateSMSEvent(pick);
}

async function main() {
  const arg = process.argv[2] || '20';
  console.log('Fetching active subscriptions with balances...');
  const activeSubs = await getActiveSubsWithBalances();
  console.log(`→ ${activeSubs.length} subscriptions ready`);

  if (arg === 'stream') {
    console.log('Streaming mode — Ctrl+C to stop');
    while (true) {
      await runSession(activeSubs);
      await sleep(3000);
    }
  } else {
    const n = parseInt(arg, 10);
    console.log(`Generating ${n} sessions...`);
    for (let i=0; i<n; i++) {
      console.log(`[${i+1}/${n}]`);
      await runSession(activeSubs);
    }
    console.log('Done.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
