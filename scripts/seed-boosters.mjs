// Adds 2 booster Tariff Plans + their Plan Allowances + stacks them on top of
// 6 existing subscriptions (so we can demo plan stacking + priority depletion).

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
async function insert(t, cellsByName) {
  const m = await colMap(t);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) if (m[k]) cellsById[m[k]] = v;
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[t]}/record`, { cells: cellsById });
  await sleep(900);
  return r?.data?.[0]?._id || r?.data?._id || r?._id;
}

const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

async function main() {
  log('Loading existing data...');
  const services = await fetchAll('Services');
  const offerings = await fetchAll('Product Offerings');
  const tariffs = await fetchAll('Tariff Plans');
  const subs = await fetchAll('Subscriptions');

  const mSvc = await colMap('Services');
  const mOff = await colMap('Product Offerings');
  const mTariff = await colMap('Tariff Plans');
  const mSub = await colMap('Subscriptions');

  const svcData = services.find(s => s.cells[mSvc['Service Code']] === 'DATA_GPRS');
  const svcVoice = services.find(s => s.cells[mSvc['Service Code']] === 'VOICE_ONNET');

  // Skip if boosters already exist
  const existingBooster = tariffs.find(t => t.cells[mTariff['Plan Code']] === 'TP-BOOST-DATA');
  if (existingBooster) {
    log('  Boosters already exist, skipping creation');
  } else {
    log('=== Creating booster Product Offerings ===');
    const offBoostData = await insert('Product Offerings', {
      'Offering Code':'OFF-BOOST-DATA',
      'Offering Name':'+5GB Data Booster',
      'Description':'Add 5GB data on top of any active plan, valid 14 days',
      'Offering Type':[2], // Booster
      'Base Price': 3,
      'Validity Days': 14,
      'Status':[2],
      'Renewal Type':[1],
      'Launch Date':'2026-04-01',
    });
    const offBoostVoice = await insert('Product Offerings', {
      'Offering Code':'OFF-BOOST-VOICE',
      'Offering Name':'+200 min Voice Booster',
      'Description':'Add 200 minutes voice on top of any active plan, valid 14 days',
      'Offering Type':[2],
      'Base Price': 2,
      'Validity Days': 14,
      'Status':[2],
      'Renewal Type':[1],
      'Launch Date':'2026-04-01',
    });

    log('=== Creating booster Tariff Plans ===');
    const tpBoostData = await insert('Tariff Plans', {
      'Product Offering':[offBoostData],
      'Plan Code':'TP-BOOST-DATA',
      'Plan Name':'+5GB Data Booster',
      'Price': 3,
      'Currency':[1],
      'Plan Type':[5], // One Time Pack
      'Validity Days': 14,
      'Auto Renew Default': false,
      'Priority On Charge': 5, // Lower = depletes FIRST (before base plan priority 10)
      'Region':'Global',
      'Status':[2],
    });
    const tpBoostVoice = await insert('Tariff Plans', {
      'Product Offering':[offBoostVoice],
      'Plan Code':'TP-BOOST-VOICE',
      'Plan Name':'+200 min Voice Booster',
      'Price': 2,
      'Currency':[1],
      'Plan Type':[5],
      'Validity Days': 14,
      'Auto Renew Default': false,
      'Priority On Charge': 5,
      'Region':'Global',
      'Status':[2],
    });

    log('=== Creating booster Plan Allowances ===');
    await insert('Plan Allowances', {
      'Tariff Plan':[tpBoostData],
      'Service':[svcData?._id],
      'Rating Group': 10,
      'Service Context':[1],
      'Allowance Label':'Booster 5GB Data',
      'Unit Type':[1],
      'Initial Amount': 5120,
      'Overage Action':[1], // Block (booster only adds extra; base plan's behavior takes over after)
      'Priority': 1,
    });
    await insert('Plan Allowances', {
      'Tariff Plan':[tpBoostVoice],
      'Service':[svcVoice?._id],
      'Rating Group': 100,
      'Service Context':[2],
      'Allowance Label':'Booster 200 min Voice',
      'Unit Type':[2],
      'Initial Amount': 200,
      'Overage Action':[1],
      'Priority': 1,
    });

    // Stack data booster on 4 subs, voice booster on 2 subs (different ones)
    log('=== Stacking boosters on 6 subscriptions ===');
    const targets = subs.slice(0, 6);
    for (let i=0; i<targets.length; i++) {
      const s = targets[i];
      const useDataBooster = i < 4;
      const tpId = useDataBooster ? tpBoostData : tpBoostVoice;
      const tpName = useDataBooster ? '+5GB Data Booster' : '+200 min Voice Booster';

      const spaId = await insert('Subscription Plan Assignments', {
        'Subscription':[s._id],
        'Tariff Plan':[tpId],
        'Effective From': new Date().toISOString(),
        'Activation Source':[4], // Promotion
        'Renewal Count': 0,
        'Status':[1],
        'Price Paid': useDataBooster ? 3 : 2,
      });

      // Create the booster's Balance row
      await insert('Balances', {
        'Subscription':[s._id],
        'Subscription Plan Assignment':[spaId],
        'Balance Code':`BAL-BOOST-${i+1}`,
        'Rating Group': useDataBooster ? 10 : 100,
        'Service Context':[useDataBooster ? 1 : 2],
        'Allowance Label': useDataBooster ? 'Booster 5GB Data' : 'Booster 200 min Voice',
        'Unit Type':[useDataBooster ? 1 : 2],
        'Initial Amount': useDataBooster ? 5120 : 200,
        'Used Amount': 0,
        'Remaining Amount': useDataBooster ? 5120 : 200,
        'Cycle Start': new Date().toISOString(),
        'Cycle End': new Date(Date.now() + 14*86400000).toISOString(),
        'Status':[1],
      });

      log(`  ✓ Stacked ${tpName} on ${s.cells[mSub['MSISDN']]}`);
    }
  }

  log('');
  log('=== Booster seed complete ===');
}

main().catch(e => { console.error(e); process.exit(1); });
