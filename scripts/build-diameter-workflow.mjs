// Build the native ERPAI auto-builder workflow "Diameter Simulator".
// Cron trigger every 1 min → one code.executor node that does the whole thing.
// Same logic as scripts/diameter-cron.mjs, but runs natively on ERPAI's scheduler.

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const TOKEN = 'erp_pat_live_REDACTED';
const BASE = 'https://api.erpai.studio';
const APP_ID = 'afe8c4540708da6ca9e6fe79';

// ─── Inline simulator code (runs in code.executor child process) ──────────
// Token + IDs hard-coded. Fetches active subs + open sessions, picks random
// action (50% UPDATE / 30% INITIAL / 20% TERMINATE), emits Diameter events.
const SIM_CODE = String.raw`
// Diameter Simulator — one tick per invocation
var TOKEN = 'erp_pat_live_REDACTED';
var BASE = 'https://api.erpai.studio';

var T = {
  subs: '495e7f2e36663583722c8ec8',
  balances: '9daeb0991b806538ceab887f',
  sessions: 'a12c328f7b9c5df56d12ec6c',
  uts: '5d81244b8bef791c68fdbb49',
  cdrs: '6208bfec7d2a7ff07f870188',
};
var SC = {  // Subscriptions columns
  status: 'BFCp', msisdn: 'sDya', customer: 'c6QN', currentPlan: 'vudt',
};
var BC = {  // Balances columns
  code: 'ucLa', initial: 'aGu1', rg: 'dOSd', subscription: 'yw1p',
};
var CSC = {  // Charging Sessions columns
  sessionId: 'DCM8', subscription: '1hHe', status: 'KQuF',
  startedAt: 'y3qX', endedAt: 'PHIm', serviceType: '4WcR', serviceContext: 'cnsm',
  callingParty: 'tmDp', calledParty: 'wypP', apn: 'kM4Z', rat: 'UPL8',
  termCause: '6eUa', locationInfo: 'y5bW', requestCount: 'XMVJ',
  totalUsed: 'mQLP', totalCharged: 'ySwc',
};
var UC = {  // Usage Transactions columns
  msgType: 'AjeI', rg: 'xuuQ', svcId: 'cer4',
  requested: '0RM2', granted: 'i7OF', used: 'umgX',
  validity: 'hmd1', resultCode: 'RC5Q', unitType: 'HtGT',
  fuiAction: 'HwNc', reqNum: 'Rdyh',
  callingParty: 'dbQH', calledParty: 'R6Dj', apn: 'e7tD',
  inputOctets: 'Fpuq', outputOctets: 'ZUn1', ccTime: 'idrW',
  chargingSession: 'Beg1', subscription: 'ZaUH', balance: '2DAb',
  timestamp: 'I5xQ',
};
var DC = {  // CDR columns
  code: 'gSCS', subscription: 'Uhc1', customer: 'FlgA', tariffPlan: 'KST2',
  chargingSession: 'Pder', serviceType: 'z64l',
  startedAt: 'YAU2', endedAt: '5kwS', durSec: '6jrg',
  totalMB: 'KaGi', totalMin: '11jM', totalUnits: '0rOj', rg: 'PlVW',
  chargedAllowance: 'mohY', chargedWallet: 'KbQs', octets: 'kfle',
  termCause: 'OJ31',
};

var rand = function(a,b){ return a + Math.floor(Math.random() * (b - a + 1)); };
var pick = function(arr){ return arr[Math.floor(Math.random() * arr.length)]; };

async function api(method, path, body) {
  var opts = {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  var r = await fetch(BASE + path, opts);
  var txt = await r.text();
  try { return JSON.parse(txt); } catch (e) { return { raw: txt, status: r.status }; }
}

async function pickActiveSub() {
  var r = await api('POST', '/v1/app-builder/table/' + T.subs + '/paged-record?pageNo=1&pageSize=100', {});
  var rows = (r.data || []).filter(function(s){
    var st = s.cells[SC.status];
    var id = Array.isArray(st) ? st[0] : st;
    return id === 1 && s.cells[SC.msisdn];
  });
  if (!rows.length) return null;
  var sub = pick(rows);
  var customerRef = sub.cells[SC.customer];
  var planRef = sub.cells[SC.currentPlan];
  return {
    subId: sub._id,
    msisdn: sub.cells[SC.msisdn],
    customerId: Array.isArray(customerRef) ? customerRef[0] : customerRef,
    planId: Array.isArray(planRef) ? planRef[0] : planRef,
  };
}

async function getBalances(subId) {
  var r = await api('POST', '/v1/app-builder/table/' + T.balances + '/paged-record?pageNo=1&pageSize=100', {});
  var all = r.data || [];
  return all.filter(function(b){
    var sr = b.cells[BC.subscription];
    var sid = Array.isArray(sr) ? sr[0] : sr;
    return sid === subId;
  }).map(function(b){
    return { balId: b._id, rg: b.cells[BC.rg] || 10, initial: b.cells[BC.initial] || 0 };
  });
}

async function pickOpenSession() {
  var r = await api('POST', '/v1/app-builder/table/' + T.sessions + '/paged-record?pageNo=1&pageSize=100', {});
  var open = (r.data || []).filter(function(s){
    var st = s.cells[CSC.status];
    var id = Array.isArray(st) ? st[0] : st;
    return id === 1;
  });
  if (!open.length) return null;
  return pick(open);
}

async function ccrInitial() {
  var sub = await pickActiveSub();
  if (!sub) return { action: 'NOOP', reason: 'no active sub' };
  var bals = await getBalances(sub.subId);
  if (!bals.length) return { action: 'NOOP', reason: 'no balances for sub' };
  // Prefer data balance
  var bal = bals.filter(function(b){ return b.rg >= 10 && b.rg <= 13; })[0] || bals[0];
  var isData = bal.rg >= 10 && bal.rg <= 13;
  var isVoice = bal.rg >= 100 && bal.rg <= 102;
  var serviceType = isData ? 1 : isVoice ? 2 : 5;
  var serviceCtx = isData ? 1 : isVoice ? 1 : 3;
  var unitType = isData ? 1 : isVoice ? 2 : 3;
  var reserve = isData ? rand(50, 300) : isVoice ? rand(1, 5) : 1;
  var called = isData ? pick(['netflix.com','youtube.com','whatsapp.net','facebook.com','google.com','tiktok.com','instagram.com']) :
               isVoice ? '267' + pick(['71','72','75','77']) + String(rand(100000, 999999)) :
               '267' + pick(['71','72','75','77']) + String(rand(100000, 999999));
  var now = Date.now();

  var s = await api('POST', '/v1/app-builder/table/' + T.sessions + '/record', {
    cells: (function(){ var c = {};
      c[CSC.sessionId] = 'SESS-' + sub.msisdn.slice(-4) + '-' + now.toString(36).slice(-6).toUpperCase();
      c[CSC.subscription] = [sub.subId];
      c[CSC.status] = [1];
      c[CSC.serviceType] = [serviceType];
      c[CSC.serviceContext] = [serviceCtx];
      c[CSC.startedAt] = now;
      c[CSC.callingParty] = sub.msisdn;
      c[CSC.calledParty] = called;
      if (isData) c[CSC.apn] = 'internet.btc.bw';
      c[CSC.rat] = [Math.random() < 0.15 ? 5 : 1];
      c[CSC.locationInfo] = 'LAC' + rand(1000, 9999) + '-CI' + rand(1000, 9999);
      c[CSC.requestCount] = 1;
      c[CSC.totalUsed] = 0;
      c[CSC.totalCharged] = 0;
      return c;
    })(),
  });
  var sessId = s.id || (s.data && s.data[0] && s.data[0]._id);

  var u = await api('POST', '/v1/app-builder/table/' + T.uts + '/record', {
    cells: (function(){ var c = {};
      c[UC.timestamp] = now;
      c[UC.msgType] = [1];
      c[UC.rg] = bal.rg;
      c[UC.svcId] = 1;
      c[UC.requested] = reserve;
      c[UC.granted] = reserve;
      c[UC.used] = 0;
      c[UC.validity] = 600;
      c[UC.resultCode] = 2001;
      c[UC.unitType] = [unitType];
      c[UC.fuiAction] = [1];
      c[UC.reqNum] = 1;
      c[UC.callingParty] = sub.msisdn;
      c[UC.calledParty] = '*';
      if (isData) c[UC.apn] = 'internet.btc.bw';
      c[UC.chargingSession] = [sessId];
      c[UC.subscription] = [sub.subId];
      c[UC.balance] = [bal.balId];
      return c;
    })(),
  });

  return { action: 'CCR-I', msisdn: sub.msisdn, rg: bal.rg, reserved: reserve, sessId: sessId };
}

async function ccrUpdate() {
  var sess = await pickOpenSession();
  if (!sess) return null;
  var subRef = sess.cells[CSC.subscription];
  var subId = Array.isArray(subRef) ? subRef[0] : subRef;
  var bals = await getBalances(subId);
  if (!bals.length) return null;
  var bal = bals[0];
  var isData = bal.rg >= 10 && bal.rg <= 13;
  var isVoice = bal.rg >= 100 && bal.rg <= 102;
  var unitType = isData ? 1 : isVoice ? 2 : 3;
  var used = isData ? rand(20, 200) : isVoice ? rand(1, 8) : 1;
  var now = Date.now();
  var msisdn = sess.cells[CSC.callingParty] || '';

  await api('POST', '/v1/app-builder/table/' + T.uts + '/record', {
    cells: (function(){ var c = {};
      c[UC.timestamp] = now;
      c[UC.msgType] = [2];
      c[UC.rg] = bal.rg;
      c[UC.svcId] = 1;
      c[UC.requested] = used;
      c[UC.granted] = used;
      c[UC.used] = used;
      c[UC.validity] = 600;
      c[UC.resultCode] = 2001;
      c[UC.unitType] = [unitType];
      c[UC.fuiAction] = [1];
      c[UC.reqNum] = rand(2, 8);
      c[UC.callingParty] = msisdn;
      if (isData) {
        c[UC.inputOctets] = used * 524288;
        c[UC.outputOctets] = used * 524288;
      }
      c[UC.ccTime] = rand(30, 300);
      c[UC.chargingSession] = [sess._id];
      c[UC.subscription] = [subId];
      c[UC.balance] = [bal.balId];
      return c;
    })(),
  });

  return { action: 'CCR-U', msisdn: msisdn, rg: bal.rg, used: used, sessId: sess._id };
}

async function ccrTerminate() {
  var sess = await pickOpenSession();
  if (!sess) return null;
  var subRef = sess.cells[CSC.subscription];
  var subId = Array.isArray(subRef) ? subRef[0] : subRef;
  var bals = await getBalances(subId);
  if (!bals.length) return null;
  var bal = bals[0];
  var isData = bal.rg >= 10 && bal.rg <= 13;
  var isVoice = bal.rg >= 100 && bal.rg <= 102;
  var unitType = isData ? 1 : isVoice ? 2 : 3;
  var finalUsed = isData ? rand(10, 80) : isVoice ? rand(1, 3) : 1;
  var now = Date.now();
  var startedAt = sess.cells[CSC.startedAt];
  var startMs = typeof startedAt === 'string' ? new Date(startedAt).getTime() : Number(startedAt);
  var durSec = Math.max(1, Math.round((now - startMs) / 1000));
  var msisdn = sess.cells[CSC.callingParty] || '';
  var serviceType = sess.cells[CSC.serviceType];
  var stype = Array.isArray(serviceType) ? serviceType[0] : serviceType;

  // CCR-T UT
  await api('POST', '/v1/app-builder/table/' + T.uts + '/record', {
    cells: (function(){ var c = {};
      c[UC.timestamp] = now;
      c[UC.msgType] = [3];
      c[UC.rg] = bal.rg;
      c[UC.svcId] = 1;
      c[UC.requested] = 0;
      c[UC.granted] = 0;
      c[UC.used] = finalUsed;
      c[UC.validity] = 0;
      c[UC.resultCode] = 2001;
      c[UC.unitType] = [unitType];
      c[UC.fuiAction] = [2];
      c[UC.reqNum] = rand(5, 15);
      c[UC.callingParty] = msisdn;
      if (isData) {
        c[UC.inputOctets] = finalUsed * 524288;
        c[UC.outputOctets] = finalUsed * 524288;
      }
      c[UC.ccTime] = rand(5, 60);
      c[UC.chargingSession] = [sess._id];
      c[UC.subscription] = [subId];
      c[UC.balance] = [bal.balId];
      return c;
    })(),
  });

  // Close session
  await api('PUT', '/v1/app-builder/table/' + T.sessions + '/record/' + sess._id, {
    cells: (function(){ var c = {};
      c[CSC.status] = [2];
      c[CSC.endedAt] = now;
      c[CSC.termCause] = [1];
      return c;
    })(),
  });

  // Write CDR — needs the customer + planId, fetch sub
  var subResp = await api('GET', '/v1/app-builder/table/' + T.subs + '/record/' + subId);
  var subRow = (subResp.data && subResp.data[0]) || subResp.data || subResp;
  var cells = subRow.cells || {};
  var customerRef = cells[SC.customer];
  var planRef = cells[SC.currentPlan];
  var customerId = Array.isArray(customerRef) ? customerRef[0] : customerRef;
  var planId = Array.isArray(planRef) ? planRef[0] : planRef;

  await api('POST', '/v1/app-builder/table/' + T.cdrs + '/record', {
    cells: (function(){ var c = {};
      c[DC.code] = 'CDR-' + msisdn.slice(-4) + '-' + now.toString(36).slice(-6).toUpperCase();
      c[DC.subscription] = [subId];
      if (customerId) c[DC.customer] = [customerId];
      if (planId) c[DC.tariffPlan] = [planId];
      c[DC.chargingSession] = [sess._id];
      c[DC.serviceType] = [stype || 1];
      c[DC.startedAt] = startMs;
      c[DC.endedAt] = now;
      c[DC.durSec] = durSec;
      c[DC.totalMB] = isData ? finalUsed : 0;
      c[DC.totalMin] = isVoice ? finalUsed : 0;
      c[DC.totalUnits] = finalUsed;
      c[DC.rg] = bal.rg;
      c[DC.chargedAllowance] = finalUsed;
      c[DC.chargedWallet] = 0;
      c[DC.octets] = isData ? finalUsed * 1024 * 1024 : 0;
      c[DC.termCause] = 'normal';
      return c;
    })(),
  });

  return { action: 'CCR-T', msisdn: msisdn, rg: bal.rg, used: finalUsed, durSec: durSec, sessId: sess._id };
}

// Main tick: weighted pick
async function run() {
  var weights = { U: 50, I: 30, T: 20 };
  var total = weights.U + weights.I + weights.T;
  var r = Math.random() * total;
  var result = null;
  if (r < weights.U) {
    result = await ccrUpdate() || await ccrInitial();
  } else if (r < weights.U + weights.I) {
    result = await ccrInitial();
  } else {
    result = await ccrTerminate() || await ccrUpdate() || await ccrInitial();
  }
  console.log(JSON.stringify({
    ok: true,
    tick: new Date().toISOString(),
    event: result || { action: 'NOOP' },
  }));
}

run().catch(function(e) {
  console.log(JSON.stringify({ ok: false, error: e.message || String(e) }));
});
`;

// ─── Workflow definition ──────────────────────────────────────────────
const workflow = {
  name: 'Diameter Simulator',
  description: 'Scheduled (every 1 min) Diameter Gy event emitter — fires CCR-I / CCR-U / CCR-T into Charging Sessions, Usage Transactions, and CDR tables. Native replacement for scripts/diameter-cron.mjs.',
  erpaiAppId: APP_ID,
  nodes: [
    {
      id: 'cron_trigger',
      name: 'Every 1 Minute',
      type: 'cron',
      typeVersion: 2,
      position: [0, 0],
      parameters: {
        scheduleMode: 'interval',
        unit: 'minutes',
        interval: 1,
      },
    },
    {
      id: 'diameter_tick',
      name: 'Emit Diameter Event',
      type: 'code.executor',
      typeVersion: 1,
      position: [400, 0],
      parameters: {
        language: 'javascript',
        executionMode: 'inline',
        executionType: 'standard',
        timeout: 60,
        code: SIM_CODE,
      },
    },
  ],
  connections: {
    cron_trigger: {
      main: [[{ node: 'diameter_tick', type: 'main', index: 0 }]],
    },
  },
  settings: { executionOrder: 'v1' },
};

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  try { return { status: r.status, ok: r.ok, data: JSON.parse(txt) }; }
  catch { return { status: r.status, ok: r.ok, data: { raw: txt } }; }
}

async function main() {
  console.log('Creating workflow...');
  const res = await api('POST', `/v1/auto-builder/workflows?appId=${APP_ID}`, workflow);
  console.log('  status:', res.status);
  console.log('  body:', JSON.stringify(res.data).slice(0, 500));
  const wfId = res.data?.body?._id || res.data?.data?._id || res.data?._id;
  if (!wfId) {
    console.log('No workflow id returned');
    return;
  }
  console.log('Workflow id:', wfId);

  console.log('\nActivating...');
  const act = await api('POST', `/v1/auto-builder/workflows/${wfId}/activate`, {});
  console.log('  status:', act.status, JSON.stringify(act.data).slice(0, 400));

  console.log('\nOne manual test execution...');
  const exe = await api('POST', `/v1/auto-builder/workflows/${wfId}/execute`, {});
  console.log('  status:', exe.status, JSON.stringify(exe.data).slice(0, 800));

  console.log('\n─── Workflow URL in app: /auto-builder/workflows/' + wfId + ' ───');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
