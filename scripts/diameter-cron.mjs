// 🛰  DIAMETER CRON — live event simulator for the b-mobile BSS demo.
//
// Runs in a loop, emits Diameter-style charging events (CCR-I / CCR-U / CCR-T)
// into Usage Transactions + Charging Sessions + Call Detail Records, feeding
// the rollup chain → Balance.Used → Subscription rollups → Customer rollups.
//
// Usage:
//   node scripts/diameter-cron.mjs                    # default: tick every 15s
//   TICK_MS=5000 node scripts/diameter-cron.mjs       # faster (5s)
//   TICK_MS=60000 node scripts/diameter-cron.mjs      # slower (1 min)
//   BURST=1 node scripts/diameter-cron.mjs            # emit a 5-event burst each tick
//   DEMO_MODE=1 node scripts/diameter-cron.mjs        # loud logging for live pitch
//
// Background launch:
//   nohup node scripts/diameter-cron.mjs > /tmp/diameter-cron.log 2>&1 &
//   # then watch:
//   tail -f /tmp/diameter-cron.log
//
// Stop background:
//   pkill -f diameter-cron.mjs

import * as L from './lib-common.mjs';

const TABLE_IDS = L.loadTableIds();
const TICK_MS = Number(process.env.TICK_MS || 15000);
const BURST = Number(process.env.BURST || 1);
const DEMO_MODE = process.env.DEMO_MODE === '1';

// Event-type probability weights for each tick
const WEIGHTS = {
  ccrUpdate:   50,   // CCR-U — most common: add usage to an active session
  ccrInitial:  30,   // CCR-I — open a new session
  ccrTerminate: 20,  // CCR-T — close an active session + write CDR
};

// ──────────────────────────────────────────────────────────────
// Column maps cache
let C = {};
async function loadColumnMaps() {
  for (const tn of ['Usage Transactions','Charging Sessions','Call Detail Records','Balances','Subscriptions','Customers','Tariff Plans']) {
    const cols = await L.getTableSchema(TABLE_IDS[tn]);
    C[tn] = Object.fromEntries(cols.map(c => [c.name, c.id]));
  }
}

// ──────────────────────────────────────────────────────────────
// In-memory cache of active context
let activeSubs = [];            // [{ subId, msisdn, planId, customerId }]
let balancesBySub = {};          // { subId: [{ balId, rg, initial, context }] }
let openSessionIds = [];         // session ids still Active

async function refreshContext() {
  const [subs, bals, sessions] = await Promise.all([
    L.fetchAll(TABLE_IDS['Subscriptions']),
    L.fetchAll(TABLE_IDS['Balances']),
    L.fetchAll(TABLE_IDS['Charging Sessions']),
  ]);
  activeSubs = [];
  balancesBySub = {};
  for (const s of subs) {
    const status = s.cells[C['Subscriptions']['Status']];
    const sid = Array.isArray(status) ? status[0] : status;
    if (sid !== 1) continue; // only Active subs
    const msisdn = s.cells[C['Subscriptions']['MSISDN']];
    const planRef = s.cells[C['Subscriptions']['Current Plan']];
    const planId = Array.isArray(planRef) ? planRef[0] : planRef;
    const customerRef = s.cells[C['Subscriptions']['Customer']];
    const customerId = Array.isArray(customerRef) ? customerRef[0] : customerRef;
    if (!msisdn || !planId || !customerId) continue;
    activeSubs.push({ subId: s._id, msisdn, planId, customerId });
  }
  for (const b of bals) {
    const subRef = b.cells[C['Balances']['Subscription']];
    const subId = Array.isArray(subRef) ? subRef[0] : subRef;
    if (!subId) continue;
    const rg = b.cells[C['Balances']['Rating Group']];
    const initial = b.cells[C['Balances']['Initial Amount']] || 0;
    const ctxVal = b.cells[C['Balances']['Service Context']];
    const ctx = Array.isArray(ctxVal) ? ctxVal[0] : ctxVal;
    const list = balancesBySub[subId] || (balancesBySub[subId] = []);
    list.push({ balId: b._id, rg, initial, context: ctx });
  }
  openSessionIds = [];
  for (const s of sessions) {
    const statusVal = s.cells[C['Charging Sessions']['Status']];
    const status = Array.isArray(statusVal) ? statusVal[0] : statusVal;
    if (status === 1) openSessionIds.push({ id: s._id, subRef: s.cells[C['Charging Sessions']['Subscription']] });
  }
}

// ──────────────────────────────────────────────────────────────
// Event emitters

function pickWeighted(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [k, w] of Object.entries(weights)) {
    if ((r -= w) <= 0) return k;
  }
  return Object.keys(weights)[0];
}

// CCR-I: open a new Charging Session + emit first UT
async function ccrInitial() {
  if (!activeSubs.length) return null;
  const sub = L.pick(activeSubs);
  const bals = balancesBySub[sub.subId];
  if (!bals || !bals.length) return null;
  // Pick balance type (weighted: 70% data, 25% voice, 5% SMS)
  const serviceRoll = Math.random();
  const bal = bals.find(b => b.rg >= 10 && b.rg <= 13 && serviceRoll < 0.7)
    || bals.find(b => b.rg >= 100 && b.rg <= 102 && serviceRoll < 0.95)
    || bals[0];
  if (!bal) return null;

  const serviceType = bal.rg >= 10 && bal.rg <= 13 ? 1 : bal.rg >= 100 && bal.rg <= 102 ? 2 : 5;
  const serviceCtx = bal.rg >= 10 && bal.rg <= 13 ? 1 : bal.rg >= 100 && bal.rg <= 102 ? 1 : 3;  // 32251 for PS, 32270 for MMS/SMS
  const unitType = bal.rg >= 10 && bal.rg <= 13 ? 1 : bal.rg >= 100 && bal.rg <= 102 ? 2 : 3;
  const nowMs = Date.now();

  const destinations = serviceType === 1 ? ['netflix.com','youtube.com','tiktok.com','whatsapp.net','spotify.com','facebook.com','google.com'] :
                        serviceType === 2 ? ['267'+L.pick(['71','72','75','77'])+String(L.rand(100000,999999)), '27'+L.rand(600000000, 899999999)] :
                        ['267'+L.pick(['71','72','75','77'])+String(L.rand(100000,999999))];

  const sessId = await L.createRecord(TABLE_IDS['Charging Sessions'], {
    [C['Charging Sessions']['Session ID']]: `SESS-${sub.msisdn.slice(-4)}-${nowMs.toString(36).slice(-6).toUpperCase()}`,
    [C['Charging Sessions']['Subscription']]: [sub.subId],
    [C['Charging Sessions']['Service Type']]: [serviceType],
    [C['Charging Sessions']['Service Context']]: [serviceCtx],
    [C['Charging Sessions']['Started At']]: nowMs,
    [C['Charging Sessions']['Status']]: [1], // Active
    [C['Charging Sessions']['Calling Party']]: sub.msisdn,
    [C['Charging Sessions']['Called Party']]: L.pick(destinations),
    [C['Charging Sessions']['APN']]: serviceType === 1 ? 'internet.btc.bw' : null,
    [C['Charging Sessions']['RAT Type']]: [L.pick([1,1,1,5])],  // Mostly EUTRAN, sometimes NR
    [C['Charging Sessions']['Location Info']]: 'LAC' + L.rand(1000, 9999) + '-CI' + L.rand(1000, 9999),
    [C['Charging Sessions']['Request Count']]: 1,
    [C['Charging Sessions']['Total Used Amount']]: 0,
    [C['Charging Sessions']['Total Charged']]: 0,
  });

  // CCR-I UT: reserve initial quota
  const reserveAmount = serviceType === 1 ? L.rand(50, 300) : serviceType === 2 ? L.rand(1, 5) : 1;
  await L.createRecord(TABLE_IDS['Usage Transactions'], {
    [C['Usage Transactions']['Timestamp']]: nowMs,
    [C['Usage Transactions']['Message Type']]: [1], // CCR-I
    [C['Usage Transactions']['Rating Group']]: bal.rg,
    [C['Usage Transactions']['Service Identifier']]: 1,
    [C['Usage Transactions']['Requested Amount']]: reserveAmount,
    [C['Usage Transactions']['Granted Amount']]: reserveAmount,
    [C['Usage Transactions']['Used Amount']]: 0,
    [C['Usage Transactions']['Validity Time']]: 600,
    [C['Usage Transactions']['Result Code']]: 2001,
    [C['Usage Transactions']['Unit Type']]: [unitType],
    [C['Usage Transactions']['FUI Action']]: [1],
    [C['Usage Transactions']['Request Number']]: 1,
    [C['Usage Transactions']['Calling Party']]: sub.msisdn,
    [C['Usage Transactions']['Called Party']]: '*',
    [C['Usage Transactions']['APN']]: serviceType === 1 ? 'internet.btc.bw' : null,
    [C['Usage Transactions']['Charging Session']]: [sessId],
    [C['Usage Transactions']['Subscription']]: [sub.subId],
    [C['Usage Transactions']['Balance']]: [bal.balId],
  });

  return { type: 'CCR-I', msisdn: sub.msisdn, rg: bal.rg, reserved: reserveAmount, sessId };
}

// CCR-U: append usage to an open session
async function ccrUpdate() {
  if (!openSessionIds.length) return null;
  const sess = L.pick(openSessionIds);
  // Re-fetch to get current state
  const subRef = sess.subRef;
  const subId = Array.isArray(subRef) ? subRef[0] : subRef;
  const bals = balancesBySub[subId];
  if (!bals || !bals.length) return null;
  const bal = bals[0]; // use first balance (data usually)
  const nowMs = Date.now();
  const unitType = bal.rg >= 10 && bal.rg <= 13 ? 1 : bal.rg >= 100 && bal.rg <= 102 ? 2 : 3;
  const used = unitType === 1 ? L.rand(20, 200) : unitType === 2 ? L.rand(1, 8) : 1;

  await L.createRecord(TABLE_IDS['Usage Transactions'], {
    [C['Usage Transactions']['Timestamp']]: nowMs,
    [C['Usage Transactions']['Message Type']]: [2], // CCR-U
    [C['Usage Transactions']['Rating Group']]: bal.rg,
    [C['Usage Transactions']['Service Identifier']]: 1,
    [C['Usage Transactions']['Requested Amount']]: used,
    [C['Usage Transactions']['Granted Amount']]: used,
    [C['Usage Transactions']['Used Amount']]: used,
    [C['Usage Transactions']['Validity Time']]: 600,
    [C['Usage Transactions']['Result Code']]: 2001,
    [C['Usage Transactions']['Unit Type']]: [unitType],
    [C['Usage Transactions']['FUI Action']]: [1],
    [C['Usage Transactions']['Request Number']]: L.rand(2, 8),
    [C['Usage Transactions']['Input Octets']]: unitType === 1 ? used * 524288 : 0,
    [C['Usage Transactions']['Output Octets']]: unitType === 1 ? used * 524288 : 0,
    [C['Usage Transactions']['CC Time Seconds']]: L.rand(30, 300),
    [C['Usage Transactions']['Calling Party']]: (activeSubs.find(s => s.subId === subId) || {}).msisdn || '',
    [C['Usage Transactions']['Charging Session']]: [sess.id],
    [C['Usage Transactions']['Subscription']]: [subId],
    [C['Usage Transactions']['Balance']]: [bal.balId],
  });

  const s = activeSubs.find(a => a.subId === subId);
  return { type: 'CCR-U', msisdn: s?.msisdn || '?', rg: bal.rg, used, sessId: sess.id };
}

// CCR-T: close a session + write CDR
async function ccrTerminate() {
  if (!openSessionIds.length) return null;
  const sess = openSessionIds.shift();   // remove from open pool immediately
  const nowMs = Date.now();

  // Fetch session detail
  const sesDet = await L.api('GET', `/v1/app-builder/table/${TABLE_IDS['Charging Sessions']}/record/${sess.id}`);
  const sessionRow = sesDet.data?.data?.[0] || sesDet.data;
  if (!sessionRow) return null;
  const startedAt = sessionRow.cells[C['Charging Sessions']['Started At']];
  const msisdn = sessionRow.cells[C['Charging Sessions']['Calling Party']];
  const serviceType = sessionRow.cells[C['Charging Sessions']['Service Type']];
  const st = Array.isArray(serviceType) ? serviceType[0] : serviceType;
  const subRef = sessionRow.cells[C['Charging Sessions']['Subscription']];
  const subId = Array.isArray(subRef) ? subRef[0] : subRef;
  const bals = balancesBySub[subId];
  const bal = bals && bals[0];
  if (!bal) return null;

  const unitType = bal.rg >= 10 && bal.rg <= 13 ? 1 : bal.rg >= 100 && bal.rg <= 102 ? 2 : 3;
  const finalUsed = unitType === 1 ? L.rand(10, 80) : unitType === 2 ? L.rand(1, 3) : 1;

  // CCR-T UT
  await L.createRecord(TABLE_IDS['Usage Transactions'], {
    [C['Usage Transactions']['Timestamp']]: nowMs,
    [C['Usage Transactions']['Message Type']]: [3], // CCR-T
    [C['Usage Transactions']['Rating Group']]: bal.rg,
    [C['Usage Transactions']['Service Identifier']]: 1,
    [C['Usage Transactions']['Requested Amount']]: 0,
    [C['Usage Transactions']['Granted Amount']]: 0,
    [C['Usage Transactions']['Used Amount']]: finalUsed,
    [C['Usage Transactions']['Validity Time']]: 0,
    [C['Usage Transactions']['Result Code']]: 2001,
    [C['Usage Transactions']['Unit Type']]: [unitType],
    [C['Usage Transactions']['FUI Action']]: [2], // Terminate
    [C['Usage Transactions']['Request Number']]: L.rand(5, 15),
    [C['Usage Transactions']['Input Octets']]: unitType === 1 ? finalUsed * 524288 : 0,
    [C['Usage Transactions']['Output Octets']]: unitType === 1 ? finalUsed * 524288 : 0,
    [C['Usage Transactions']['CC Time Seconds']]: L.rand(5, 60),
    [C['Usage Transactions']['Calling Party']]: msisdn,
    [C['Usage Transactions']['Charging Session']]: [sess.id],
    [C['Usage Transactions']['Subscription']]: [subId],
    [C['Usage Transactions']['Balance']]: [bal.balId],
  });

  // Mark session terminated
  const durSec = Math.max(1, Math.round((nowMs - (typeof startedAt === 'string' ? new Date(startedAt).getTime() : Number(startedAt))) / 1000));
  await L.updateRecord(TABLE_IDS['Charging Sessions'], sess.id, {
    [C['Charging Sessions']['Status']]: [2], // Terminated
    [C['Charging Sessions']['Ended At']]: nowMs,
    [C['Charging Sessions']['Termination Cause']]: [1],   // LOGOUT
  });

  // Write CDR
  const s = activeSubs.find(a => a.subId === subId);
  if (s) {
    await L.createRecord(TABLE_IDS['Call Detail Records'], {
      [C['Call Detail Records']['CDR Code']]: `CDR-${msisdn.slice(-4)}-${nowMs.toString(36).slice(-6).toUpperCase()}`,
      [C['Call Detail Records']['Subscription']]: [subId],
      [C['Call Detail Records']['Customer']]: [s.customerId],
      [C['Call Detail Records']['Tariff Plan']]: [s.planId],
      [C['Call Detail Records']['Charging Session']]: [sess.id],
      [C['Call Detail Records']['Service Type']]: [st],
      [C['Call Detail Records']['Started At']]: startedAt,
      [C['Call Detail Records']['Ended At']]: nowMs,
      [C['Call Detail Records']['Duration Seconds']]: durSec,
      [C['Call Detail Records']['Total MB']]: unitType === 1 ? finalUsed : 0,
      [C['Call Detail Records']['Total Minutes']]: unitType === 2 ? finalUsed : 0,
      [C['Call Detail Records']['Total Units']]: finalUsed,
      [C['Call Detail Records']['Rating Group']]: bal.rg,
      [C['Call Detail Records']['Total Charged from Allowance']]: finalUsed,
      [C['Call Detail Records']['Total Charged from Wallet']]: 0,
      [C['Call Detail Records']['Total Octets']]: unitType === 1 ? finalUsed * 1024 * 1024 : 0,
      [C['Call Detail Records']['Record Sequence Number']]: L.rand(1, 999),
      [C['Call Detail Records']['Final Termination Cause']]: 'normal',
    });
  }

  return { type: 'CCR-T', msisdn, rg: bal.rg, used: finalUsed, sessId: sess.id, durSec };
}

// ──────────────────────────────────────────────────────────────
function ts() { return new Date().toISOString().slice(11, 19); }
function banner() {
  console.log('');
  console.log('🛰  ─────────────────────────────────────────────────────────────');
  console.log('    DIAMETER CRON  —  live OCS event simulator');
  console.log(`    tick = ${TICK_MS}ms    burst = ${BURST}    PID ${process.pid}`);
  console.log('    ─────────────────────────────────────────────────────────────');
  console.log('');
}

async function tick() {
  const events = [];
  for (let i = 0; i < BURST; i++) {
    const kind = pickWeighted(WEIGHTS);
    let r;
    try {
      if (kind === 'ccrInitial')       r = await ccrInitial();
      else if (kind === 'ccrUpdate')   r = await ccrUpdate() || await ccrInitial();   // fallback if no open sessions
      else if (kind === 'ccrTerminate')r = await ccrTerminate() || await ccrUpdate() || await ccrInitial();
    } catch (e) {
      console.log(`[${ts()}]  ✗ error on ${kind}: ${e.message.slice(0, 100)}`);
    }
    if (!r) continue;
    events.push(r);
  }
  for (const e of events) {
    const emoji = e.type === 'CCR-I' ? '🟢' : e.type === 'CCR-U' ? '🟡' : '🔴';
    const unit = e.rg >= 10 && e.rg <= 13 ? 'MB' : e.rg >= 100 && e.rg <= 102 ? 'min' : 'SMS';
    const line = e.type === 'CCR-T'
      ? `${emoji} ${e.type.padEnd(6)} ${e.msisdn}  rg=${e.rg}  used=${e.used}${unit}  dur=${e.durSec}s  sess=${e.sessId.slice(0,8)}`
      : `${emoji} ${e.type.padEnd(6)} ${e.msisdn}  rg=${e.rg}  ${e.type === 'CCR-I' ? 'reserved' : 'used'}=${e.reserved || e.used}${unit}  sess=${e.sessId.slice(0,8)}`;
    console.log(`[${ts()}]  ${line}`);
  }
}

async function main() {
  banner();
  process.on('SIGINT',  () => { console.log('\n⏸  shutting down — '+new Date().toISOString()); process.exit(0); });
  process.on('SIGTERM', () => { console.log('\n⏸  shutting down — '+new Date().toISOString()); process.exit(0); });

  await loadColumnMaps();
  await refreshContext();
  console.log(`[${ts()}]  context loaded: ${activeSubs.length} active subs, ${openSessionIds.length} open sessions`);

  let refreshEvery = 0;
  while (true) {
    await tick();
    refreshEvery++;
    // every 20 ticks, refresh context so newly-opened sessions enter the pool
    if (refreshEvery >= 20) {
      await refreshContext();
      console.log(`[${ts()}]  🔄  context refreshed — ${openSessionIds.length} open sessions`);
      refreshEvery = 0;
    }
    await L.sleep(TICK_MS);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
