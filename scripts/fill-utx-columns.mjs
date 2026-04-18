// Every Usage Transaction should have every column populated realistically.
// Fill in: FUI Action, Calling Party, Called Party, APN, CC Time Seconds,
// Input/Output Octets, Requested Amount, Granted Amount, Validity Time, Service Identifier.
//
// Values depend on Rating Group (data/voice/sms) and the session's subscription.

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
async function update(t, id, cellsByName) {
  const m = await colMap(t);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) if (m[k]) cellsById[m[k]] = v;
  return api('PUT', `/v1/app-builder/table/${TABLE_IDS[t]}/record/${id}`, { cells: cellsById });
}

const rnd = (a, b) => a + Math.random() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
const pickInt = (arr) => arr[rndInt(0, arr.length - 1)];

// Generate a plausible called party MSISDN (different from calling party)
function genCalledMsisdn(callerMsisdn) {
  const prefix = callerMsisdn.slice(0, 4);
  const suffix = String(rndInt(100000, 999999)).padStart(6, '0');
  // Mix on-net (same prefix) and off-net
  return Math.random() < 0.6 ? `${prefix}${rndInt(10000000, 99999999)}`.slice(0, 12) : `9198${rndInt(10000000, 99999999)}`;
}

const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

async function main() {
  log('Loading data...');
  const utxs = await fetchAll('Usage Transactions');
  const sessions = await fetchAll('Charging Sessions');
  const subs = await fetchAll('Subscriptions');
  const mUtx = await colMap('Usage Transactions');
  const mSess = await colMap('Charging Sessions');
  const mSub = await colMap('Subscriptions');
  log(`  ${utxs.length} UTs, ${sessions.length} sessions, ${subs.length} subs`);

  const sessById = new Map(sessions.map(s => [s._id, s]));
  const subById = new Map(subs.map(s => [s._id, s]));

  // Rating group → unit type + typical chunk sizes
  const RG_CONFIG = {
    10: { kind: 'data', grantUnit: 10 * 1024 * 1024, unitFactor: 1024 * 1024 }, // 10 MB chunks, report in octets
    100: { kind: 'voice', grantUnit: 60, unitFactor: 1 }, // 60 sec chunks
    200: { kind: 'sms', grantUnit: 1, unitFactor: 1 },
  };

  let updated = 0;
  for (const u of utxs) {
    const sessId = u.cells[mUtx['Charging Session']]?.[0];
    const sess = sessById.get(sessId);
    const subId = u.cells[mUtx['Subscription']]?.[0];
    const sub = subById.get(subId);
    const rg = Number(u.cells[mUtx['Rating Group']]) || 10;
    const cfg = RG_CONFIG[rg] || RG_CONFIG[10];
    const used = Number(u.cells[mUtx['Used Amount']]) || 0;
    const msgType = String(u.cells[mUtx['Message Type']] || '[1]');

    const callerMsisdn = sub?.cells[mSub['MSISDN']] || '';
    const sessApn = sess?.cells[mSess['APN']] || 'internet';
    const calledParty = sess?.cells[mSess['Called Party']] || genCalledMsisdn(callerMsisdn);
    const callingParty = sess?.cells[mSess['Calling Party']] || callerMsisdn;

    // Build the update
    const patch = {
      'FUI Action': [1], // None — most events are successful grants
      'Calling Party': callingParty,
      'APN': sessApn,
      'Service Identifier': rg * 10 + 1,
      'Validity Time': cfg.kind === 'sms' ? 0 : 3600,
    };

    // Voice / SMS have called party; data sessions don't (APN-based)
    if (cfg.kind !== 'data') patch['Called Party'] = calledParty;

    // Data-specific: Input/Output Octets (30% uplink / 70% downlink of used MB)
    if (cfg.kind === 'data') {
      const usedOctets = used * 1024 * 1024;
      patch['Input Octets'] = Math.floor(usedOctets * 0.3);
      patch['Output Octets'] = Math.floor(usedOctets * 0.7);
    }
    // Voice-specific: CC Time Seconds = used minutes × 60
    if (cfg.kind === 'voice') {
      patch['CC Time Seconds'] = Math.round(used * 60);
    }

    // Requested / Granted — non-trivial only for CCR-I and CCR-U
    if (msgType !== '[3]') { // not CCR-T
      patch['Requested Amount'] = Math.round(cfg.grantUnit / (cfg.kind === 'data' ? cfg.unitFactor : 1));
      patch['Granted Amount'] = Math.round(cfg.grantUnit / (cfg.kind === 'data' ? cfg.unitFactor : 1));
    } else {
      patch['Requested Amount'] = 0;
      patch['Granted Amount'] = 0;
    }

    // Special cases: if result code is 4012 (credit limit reached), FUI=Terminate
    const resultCode = Number(u.cells[mUtx['Result Code']]);
    if (resultCode === 4012) {
      patch['FUI Action'] = [2]; // Terminate
      patch['FUI Redirect URL'] = 'https://topup.op.com/recharge';
      patch['Granted Amount'] = 0;
    }

    await update('Usage Transactions', u._id, patch);
    updated++;
    if (updated % 30 === 0) log(`  ... ${updated}/${utxs.length}`);
    await sleep(500);
  }

  log('');
  log(`=== Updated ${updated} Usage Transactions ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
