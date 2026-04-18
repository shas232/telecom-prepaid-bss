// Diameter Simulator v2 — complex multi-node workflow.
//   cron → httpRequest → erpaiNode(get-records) → code.executor(engine) → switch → 4 branch loggers
//
// Shows off: external API call, native ERPAI data fetch, JS logic, 4-way
// conditional branching, per-branch follow-up actions.

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const TOKEN = 'erp_pat_live_REDACTED';
const BASE = 'https://api.erpai.studio';
const APP_ID = 'afe8c4540708da6ca9e6fe79';
const SUBS_TABLE = '495e7f2e36663583722c8ec8';
const SUBS_STATUS_COL = 'BFCp';

// ──────────────────────────────────────────────────────────────
// Diameter engine — reads input from previous nodes + does the API work
// ──────────────────────────────────────────────────────────────
const ENGINE_CODE = String.raw`
var TOKEN = 'erp_pat_live_REDACTED';
var BASE = 'https://api.erpai.studio';

var T = {
  subs: '495e7f2e36663583722c8ec8',
  balances: '9daeb0991b806538ceab887f',
  sessions: 'a12c328f7b9c5df56d12ec6c',
  uts: '5d81244b8bef791c68fdbb49',
  cdrs: '6208bfec7d2a7ff07f870188',
};
var SC = { status: 'BFCp', msisdn: 'sDya', customer: 'c6QN', currentPlan: 'vudt' };
var BC = { code: 'ucLa', initial: 'aGu1', rg: 'dOSd', subscription: 'yw1p' };
var CSC = {
  sessionId: 'DCM8', subscription: '1hHe', status: 'KQuF',
  startedAt: 'y3qX', endedAt: 'PHIm', serviceType: '4WcR', serviceContext: 'cnsm',
  callingParty: 'tmDp', calledParty: 'wypP', apn: 'kM4Z', rat: 'UPL8',
  termCause: '6eUa', locationInfo: 'y5bW', requestCount: 'XMVJ',
  totalUsed: 'mQLP', totalCharged: 'ySwc',
};
var UC = {
  msgType: 'AjeI', rg: 'xuuQ', svcId: 'cer4',
  requested: '0RM2', granted: 'i7OF', used: 'umgX',
  validity: 'hmd1', resultCode: 'RC5Q', unitType: 'HtGT',
  fuiAction: 'HwNc', reqNum: 'Rdyh',
  callingParty: 'dbQH', calledParty: 'R6Dj', apn: 'e7tD',
  inputOctets: 'Fpuq', outputOctets: 'ZUn1', ccTime: 'idrW',
  chargingSession: 'Beg1', subscription: 'ZaUH', balance: '2DAb',
  timestamp: 'I5xQ',
};
var DC = {
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
  var opts = { method: method, headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  var r = await fetch(BASE + path, opts);
  var txt = await r.text();
  try { return JSON.parse(txt); } catch (e) { return { raw: txt, status: r.status }; }
}

// Read upstream context: httpRequest (time) + erpaiNode (subs)
function readInput() {
  var raw = process.env.INPUT_FIRST_ITEM || '{}';
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

async function pickActiveSub(upstream) {
  // Try to use upstream erpaiNode get-records output
  var subs = null;
  if (upstream && upstream.data && Array.isArray(upstream.data)) subs = upstream.data;
  else if (upstream && upstream.records && Array.isArray(upstream.records)) subs = upstream.records;

  // Fallback — fetch directly
  if (!subs || !subs.length) {
    var r = await api('POST', '/v1/app-builder/table/' + T.subs + '/paged-record?pageNo=1&pageSize=100', {});
    subs = r.data || [];
  }

  var active = subs.filter(function(s){
    var st = (s.cells || {})[SC.status];
    var id = Array.isArray(st) ? st[0] : st;
    return id === 1 && s.cells && s.cells[SC.msisdn];
  });
  if (!active.length) return null;
  var sub = pick(active);
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
  var r = await api('POST', '/v1/app-builder/table/' + T.balances + '/paged-record?pageNo=1&pageSize=200', {});
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
  var r = await api('POST', '/v1/app-builder/table/' + T.sessions + '/paged-record?pageNo=1&pageSize=200', {});
  var open = (r.data || []).filter(function(s){
    var st = s.cells[CSC.status];
    var id = Array.isArray(st) ? st[0] : st;
    return id === 1;
  });
  if (!open.length) return null;
  return pick(open);
}

async function ccrInitial() {
  var upstream = readInput();
  var sub = await pickActiveSub(upstream);
  if (!sub) return { action: 'NOOP', reason: 'no active sub' };
  var bals = await getBalances(sub.subId);
  if (!bals.length) return { action: 'NOOP', reason: 'no balances' };
  var bal = bals.filter(function(b){ return b.rg >= 10 && b.rg <= 13; })[0] || bals[0];
  var isData = bal.rg >= 10 && bal.rg <= 13;
  var isVoice = bal.rg >= 100 && bal.rg <= 102;
  var serviceType = isData ? 1 : isVoice ? 2 : 5;
  var serviceCtx = isData ? 1 : isVoice ? 1 : 3;
  var unitType = isData ? 1 : isVoice ? 2 : 3;
  var reserve = isData ? rand(50, 300) : isVoice ? rand(1, 5) : 1;
  var called = isData ? pick(['netflix.com','youtube.com','whatsapp.net','facebook.com','google.com','tiktok.com','instagram.com','spotify.com']) :
               '267' + pick(['71','72','75','77']) + String(rand(100000, 999999));
  var now = Date.now();

  var s = await api('POST', '/v1/app-builder/table/' + T.sessions + '/record', { cells: (function(){ var c = {};
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
    return c; })() });
  var sessId = s.id || (s.data && s.data[0] && s.data[0]._id);

  await api('POST', '/v1/app-builder/table/' + T.uts + '/record', { cells: (function(){ var c = {};
    c[UC.timestamp] = now;
    c[UC.msgType] = [1]; c[UC.rg] = bal.rg; c[UC.svcId] = 1;
    c[UC.requested] = reserve; c[UC.granted] = reserve; c[UC.used] = 0;
    c[UC.validity] = 600; c[UC.resultCode] = 2001;
    c[UC.unitType] = [unitType]; c[UC.fuiAction] = [1]; c[UC.reqNum] = 1;
    c[UC.callingParty] = sub.msisdn; c[UC.calledParty] = '*';
    if (isData) c[UC.apn] = 'internet.btc.bw';
    c[UC.chargingSession] = [sessId]; c[UC.subscription] = [sub.subId]; c[UC.balance] = [bal.balId];
    return c; })() });

  return { action: 'CCR-I', msisdn: sub.msisdn, rg: bal.rg, reserved: reserve, sessId: sessId, called: called, serviceType: isData ? 'data' : isVoice ? 'voice' : 'sms' };
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

  await api('POST', '/v1/app-builder/table/' + T.uts + '/record', { cells: (function(){ var c = {};
    c[UC.timestamp] = now; c[UC.msgType] = [2]; c[UC.rg] = bal.rg; c[UC.svcId] = 1;
    c[UC.requested] = used; c[UC.granted] = used; c[UC.used] = used;
    c[UC.validity] = 600; c[UC.resultCode] = 2001;
    c[UC.unitType] = [unitType]; c[UC.fuiAction] = [1]; c[UC.reqNum] = rand(2, 8);
    c[UC.callingParty] = msisdn;
    if (isData) { c[UC.inputOctets] = used * 524288; c[UC.outputOctets] = used * 524288; }
    c[UC.ccTime] = rand(30, 300);
    c[UC.chargingSession] = [sess._id]; c[UC.subscription] = [subId]; c[UC.balance] = [bal.balId];
    return c; })() });

  return { action: 'CCR-U', msisdn: msisdn, rg: bal.rg, used: used, sessId: sess._id, serviceType: isData ? 'data' : isVoice ? 'voice' : 'sms' };
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
  var stRaw = sess.cells[CSC.serviceType];
  var stype = Array.isArray(stRaw) ? stRaw[0] : stRaw;

  await api('POST', '/v1/app-builder/table/' + T.uts + '/record', { cells: (function(){ var c = {};
    c[UC.timestamp] = now; c[UC.msgType] = [3]; c[UC.rg] = bal.rg; c[UC.svcId] = 1;
    c[UC.requested] = 0; c[UC.granted] = 0; c[UC.used] = finalUsed;
    c[UC.validity] = 0; c[UC.resultCode] = 2001;
    c[UC.unitType] = [unitType]; c[UC.fuiAction] = [2]; c[UC.reqNum] = rand(5, 15);
    c[UC.callingParty] = msisdn;
    if (isData) { c[UC.inputOctets] = finalUsed * 524288; c[UC.outputOctets] = finalUsed * 524288; }
    c[UC.ccTime] = rand(5, 60);
    c[UC.chargingSession] = [sess._id]; c[UC.subscription] = [subId]; c[UC.balance] = [bal.balId];
    return c; })() });

  await api('PUT', '/v1/app-builder/table/' + T.sessions + '/record/' + sess._id, { cells: (function(){ var c = {};
    c[CSC.status] = [2]; c[CSC.endedAt] = now; c[CSC.termCause] = [1];
    return c; })() });

  var subResp = await api('GET', '/v1/app-builder/table/' + T.subs + '/record/' + subId);
  var subRow = (subResp.data && subResp.data[0]) || subResp.data || subResp;
  var cells = (subRow && subRow.cells) || {};
  var customerRef = cells[SC.customer];
  var planRef = cells[SC.currentPlan];
  var customerId = Array.isArray(customerRef) ? customerRef[0] : customerRef;
  var planId = Array.isArray(planRef) ? planRef[0] : planRef;

  await api('POST', '/v1/app-builder/table/' + T.cdrs + '/record', { cells: (function(){ var c = {};
    c[DC.code] = 'CDR-' + msisdn.slice(-4) + '-' + now.toString(36).slice(-6).toUpperCase();
    c[DC.subscription] = [subId];
    if (customerId) c[DC.customer] = [customerId];
    if (planId) c[DC.tariffPlan] = [planId];
    c[DC.chargingSession] = [sess._id];
    c[DC.serviceType] = [stype || 1];
    c[DC.startedAt] = startMs; c[DC.endedAt] = now; c[DC.durSec] = durSec;
    c[DC.totalMB] = isData ? finalUsed : 0;
    c[DC.totalMin] = isVoice ? finalUsed : 0;
    c[DC.totalUnits] = finalUsed; c[DC.rg] = bal.rg;
    c[DC.chargedAllowance] = finalUsed; c[DC.chargedWallet] = 0;
    c[DC.octets] = isData ? finalUsed * 1024 * 1024 : 0;
    c[DC.termCause] = 'normal';
    return c; })() });

  return { action: 'CCR-T', msisdn: msisdn, rg: bal.rg, used: finalUsed, durSec: durSec, sessId: sess._id, serviceType: isData ? 'data' : isVoice ? 'voice' : 'sms' };
}

async function run() {
  var weights = { U: 50, I: 30, T: 20 };
  var total = weights.U + weights.I + weights.T;
  var r = Math.random() * total;
  var result = null;
  if (r < weights.U)                 result = await ccrUpdate()    || await ccrInitial();
  else if (r < weights.U + weights.I) result = await ccrInitial();
  else                                 result = await ccrTerminate() || await ccrUpdate() || await ccrInitial();

  console.log(JSON.stringify({
    ok: true,
    tick: new Date().toISOString(),
    action: (result && result.action) || 'NOOP',
    msisdn: result && result.msisdn,
    rg: result && result.rg,
    serviceType: result && result.serviceType,
    detail: result || { action: 'NOOP' },
  }));
}

run().catch(function(e) {
  console.log(JSON.stringify({ ok: false, action: 'NOOP', error: e.message || String(e) }));
});
`;

// ──────────────────────────────────────────────────────────────
// Simple branch loggers
// ──────────────────────────────────────────────────────────────
const branchLog = (action, emoji) => String.raw`
var raw = process.env.INPUT_FIRST_ITEM || '{}';
var data; try { data = JSON.parse(raw); } catch (e) { data = {}; }
// switch output: data.switch.aggregatedItems[0] is the item that matched
var item = (data['switch'] && data['switch'].aggregatedItems && data['switch'].aggregatedItems[0]) || data;
console.log(JSON.stringify({
  branch: '` + emoji + ` ` + action + `',
  msisdn: item.msisdn,
  rg: item.rg,
  service: item.serviceType,
  detail: item.detail || item,
  tick: item.tick,
}));
`;

// ──────────────────────────────────────────────────────────────
// Workflow JSON
// ──────────────────────────────────────────────────────────────
const workflow = {
  name: 'Diameter Simulator v2',
  description: 'Multi-node Diameter Gy event simulator: cron → external time API → fetch active subs → engine (CCR-I/U/T logic + API writes) → switch → 4 per-action branches with per-branch loggers. Native replacement for scripts/diameter-cron.mjs, same tables.',
  erpaiAppId: APP_ID,
  nodes: [
    {
      id: 'cron_trigger',
      name: '⏰ Every 1 Min',
      type: 'cron',
      typeVersion: 2,
      position: [0, 300],
      parameters: { scheduleMode: 'interval', unit: 'minutes', interval: 1 },
    },
    {
      id: 'fetch_tariff_plans',
      name: '📦 Fetch Active Plans',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [280, 300],
      parameters: {
        tableId: 'f2e797515f347f862e71a641', // Tariff Plans
        operation: 'get-records',
        page: 1,
        pageSize: 50,
      },
    },
    {
      id: 'fetch_subs',
      name: '👥 Fetch Active Subs',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [560, 300],
      parameters: {
        tableId: SUBS_TABLE,
        operation: 'get-records',
        page: 1,
        pageSize: 100,
        dynamicFilters: {
          logicalOperator: 'AND',
          conditions: [{ columnId: SUBS_STATUS_COL, operator: 'equals', value: [1] }],
        },
      },
    },
    {
      id: 'diameter_engine',
      name: '🛰 Diameter Engine',
      type: 'code.executor',
      typeVersion: 1,
      position: [840, 300],
      parameters: {
        language: 'javascript',
        executionMode: 'inline',
        executionType: 'standard',
        timeout: 90,
        code: ENGINE_CODE,
      },
    },
    {
      id: 'route_action',
      name: '🔀 Route by Action',
      type: 'switch',
      typeVersion: 1,
      position: [1160, 300],
      parameters: {
        mode: 'rules',
        rules: {
          values: [
            { conditions: { conditions: [{ leftValue: '{{$json.action}}', rightValue: 'CCR-I', operator: 'equals' }], combinator: 'and' }, outputLabel: 'CCR-I' },
            { conditions: { conditions: [{ leftValue: '{{$json.action}}', rightValue: 'CCR-U', operator: 'equals' }], combinator: 'and' }, outputLabel: 'CCR-U' },
            { conditions: { conditions: [{ leftValue: '{{$json.action}}', rightValue: 'CCR-T', operator: 'equals' }], combinator: 'and' }, outputLabel: 'CCR-T' },
          ],
        },
        options: { fallbackOutput: 'extra', allMatchingOutputs: false },
      },
    },
    {
      id: 'log_initial',
      name: '🟢 Log CCR-I',
      type: 'code.executor',
      typeVersion: 1,
      position: [1480, 100],
      parameters: { language: 'javascript', executionMode: 'inline', executionType: 'standard', timeout: 15, code: branchLog('SESSION OPENED', '🟢') },
    },
    {
      id: 'log_update',
      name: '🟡 Log CCR-U',
      type: 'code.executor',
      typeVersion: 1,
      position: [1480, 260],
      parameters: { language: 'javascript', executionMode: 'inline', executionType: 'standard', timeout: 15, code: branchLog('USAGE UPDATE', '🟡') },
    },
    {
      id: 'log_terminate',
      name: '🔴 Log CCR-T + CDR',
      type: 'code.executor',
      typeVersion: 1,
      position: [1480, 420],
      parameters: { language: 'javascript', executionMode: 'inline', executionType: 'standard', timeout: 15, code: branchLog('SESSION CLOSED + CDR WRITTEN', '🔴') },
    },
    {
      id: 'log_noop',
      name: '⚪ Log NOOP',
      type: 'code.executor',
      typeVersion: 1,
      position: [1480, 580],
      parameters: { language: 'javascript', executionMode: 'inline', executionType: 'standard', timeout: 15, code: branchLog('NO-OP (no eligible data)', '⚪') },
    },
  ],
  connections: {
    cron_trigger:       { main: [[{ node: 'fetch_tariff_plans', type: 'main', index: 0 }]] },
    fetch_tariff_plans: { main: [[{ node: 'fetch_subs',          type: 'main', index: 0 }]] },
    fetch_subs:      { main: [[{ node: 'diameter_engine',  type: 'main', index: 0 }]] },
    diameter_engine: { main: [[{ node: 'route_action',     type: 'main', index: 0 }]] },
    route_action: {
      'CCR-I': [[{ node: 'log_initial',   type: 'main', index: 0 }]],
      'CCR-U': [[{ node: 'log_update',    type: 'main', index: 0 }]],
      'CCR-T': [[{ node: 'log_terminate', type: 'main', index: 0 }]],
      'extra': [[{ node: 'log_noop',      type: 'main', index: 0 }]],
    },
  },
  settings: { executionOrder: 'v1' },
};

// ──────────────────────────────────────────────────────────────
async function apiCall(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  try { return { status: r.status, ok: r.ok, data: JSON.parse(txt) }; }
  catch { return { status: r.status, ok: r.ok, data: { raw: txt } }; }
}

async function main() {
  // First deactivate + delete the v1 workflow so only v2 runs
  console.log('Listing existing workflows...');
  const list = await apiCall('GET', `/v1/auto-builder/workflows?appId=${APP_ID}`);
  const existingV1 = ((list.data?.data || list.data?.body || list.data || []).filter ? (list.data?.data || list.data?.body || list.data || []) : []).filter(w => w.name === 'Diameter Simulator' || w.name === 'Diameter Simulator v2');
  for (const w of existingV1) {
    const wfId = w._id || w.id;
    console.log(`  Found: ${w.name} (${wfId}) — deactivating + deleting`);
    await apiCall('POST', `/v1/auto-builder/workflows/${wfId}/deactivate`, {});
    await apiCall('DELETE', `/v1/auto-builder/workflows/${wfId}?appId=${APP_ID}`);
  }

  console.log('\nCreating Diameter Simulator v2...');
  const res = await apiCall('POST', `/v1/auto-builder/workflows?appId=${APP_ID}`, workflow);
  console.log('  status:', res.status);
  const wfId = res.data?.data?.id || res.data?.body?._id || res.data?._id;
  console.log('  id:', wfId);
  if (!wfId) {
    console.log('  error body:', JSON.stringify(res.data).slice(0, 800));
    return;
  }

  console.log('\nActivating...');
  const act = await apiCall('POST', `/v1/auto-builder/workflows/${wfId}/activate`, {});
  console.log('  ', act.status, JSON.stringify(act.data).slice(0, 200));

  console.log('\nTest run...');
  const exe = await apiCall('POST', `/v1/auto-builder/workflows/${wfId}/execute`, {});
  console.log('  ', exe.status, JSON.stringify(exe.data).slice(0, 500));

  console.log('\n════════════════════════════════════════════════');
  console.log('  Workflow: Diameter Simulator v2');
  console.log('  ID: ' + wfId);
  console.log('  Nodes: 9 (cron + httpRequest + erpaiNode + code + switch + 4 branch loggers)');
  console.log('════════════════════════════════════════════════');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
