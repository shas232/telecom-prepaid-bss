// Build 3 more complex workflows for the b-mobile BSS demo.
//
// W3 — Recharge Success → Commission + Pasela Bonus Credit + Confirmation SMS
//      Trigger: Recharges / record_created
//      Switch on Amount tier (HIGH ≥P100 / MID P50-99 / LOW <P50) — matches real
//      b-mobile voucher bonus rules (P100: +20%, P50: +10%, other: no bonus).
//
// W4 — Roaming Session Opened → Zone-differentiated Welcome + Bill-Shock Setup
//      Trigger: Roaming Sessions / record_created
//      Switch on Zone: SADC (low-cost) / Africa & ME / Premium (EU/UK/NA/ANZ/ROW)
//      TRAI-style welcome SMS + precautionary Case for premium zones.
//
// W5 — Daily Low-Balance Retention Sweep (cron)
//      Trigger: cron every 30 min
//      erpaiNode fetch Wallets → code.executor sweep+notify → switch by severity
//      → escalate to Case / idle log.

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const TOKEN = 'erp_pat_live_REDACTED';
const BASE = 'https://api.erpai.studio';
const APP_ID = 'afe8c4540708da6ca9e6fe79';

// ─── Table IDs ─────────────────────────────────────────────────
const T = {
  recharges: '4f5d0c07bc1db0dcef8e2c02',
  partnerComm: '8418a5b8a4ded0fb3851b72c',
  walletTx: 'd9a7f5779835c59a75d837c3',
  notifSent: '1119d4dad001272c2d342f2e',
  cases: 'abb4445bc9dfd2ccd9b8eb5a',
  roamSess: '2283c9f7eaa825c60f36fc5e',
  wallets: '1ec21f333aa5965f9d9be874',
  customers: 'aed243e6c13b8f5194724d76',
  subs: '495e7f2e36663583722c8ec8',
};

// ─── Column IDs ────────────────────────────────────────────────
const RECHARGE = {
  amount: 'Y39a', wallet: 'fa5r', partner: 'YT0D', rechargeCode: 'UhkZ',
  status: 'MMab', channel: 'cqLl', timestamp: 'UG1r',
};
const PC = {
  status: '90q1', commAmount: 'gPHc', baseAmount: 'mSKC', commType: 'SbDe',
  accruedDate: 'Bi8g', partner: 'QhC0', recharge: 'Lv3B',
};
const WTX = {
  code: '93aU', amount: '8n2I', timestamp: 'ajVy',
  transType: 'FT69', refType: 'YBNC', referenceId: 'mqMb',
  wallet: '2yFo', initBy: 'NyKH', notes: 'uw5l',
};
const NS = {
  deliveredAt: 'GwLe', sentAt: 'JVsa', status: 'JaBx',
  content: 'OItS', template: 'hywV', customer: '5Zt0',
  subscription: 'qCsv', channel: '61nR',
};
const CASE = {
  code: '14zr', subject: 'CamK', description: 'LaSR', status: 'wc3U',
  openedAt: 's8D6', priority: 'cZCE', category: 'lUL1', assignedTo: 'wnhT',
  subscription: 'uxAZ', channel: 'CRba', customer: 'PVug',
};
const ROAM = {
  sessionCode: 'Jmj9', subscription: 'tR4u', partner: 'dhDj', zone: 'rfdK',
  country: 'VvVl', enteredAt: '48Ym', status: 'T1dQ', billShock: 'Qe0Z',
  dailyCap: '5kNQ', notes: 'y4K4', partnerName: 'GMjB', zoneName: 'tAIa',
};

// ────────────────────────────────────────────────────────────────
// Generic helpers
// ────────────────────────────────────────────────────────────────
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

async function deleteExistingByName(name) {
  const list = await apiCall('GET', `/v1/auto-builder/workflows?appId=${APP_ID}`);
  const items = list.data?.data || list.data?.body || [];
  for (const w of items) {
    if (w.name === name) {
      const wfId = w._id || w.id;
      await apiCall('POST', `/v1/auto-builder/workflows/${wfId}/deactivate`, {});
      await apiCall('DELETE', `/v1/auto-builder/workflows/${wfId}?appId=${APP_ID}`);
      console.log(`  🗑  deleted existing: ${name}`);
    }
  }
}

async function deployWorkflow(wf) {
  await deleteExistingByName(wf.name);
  const res = await apiCall('POST', `/v1/auto-builder/workflows?appId=${APP_ID}`, wf);
  const wfId = res.data?.data?.id || res.data?.body?._id || res.data?._id;
  if (!wfId) {
    console.log(`  ✗ ${wf.name} create failed: ${JSON.stringify(res.data).slice(0, 300)}`);
    return null;
  }
  const act = await apiCall('POST', `/v1/auto-builder/workflows/${wfId}/activate`, {});
  const activated = act.data?.data?.active === true;
  console.log(`  ${activated ? '✓' : '⚠'} ${wf.name} → id=${wfId}${activated ? ' (active)' : ''}`);
  return wfId;
}

// ────────────────────────────────────────────────────────────────
// Code bodies for code.executor nodes
// ────────────────────────────────────────────────────────────────

// Generic logger — extracts trigger record from switch-passthrough and logs
const loggerCode = (severity, emoji, action) => String.raw`
var raw = process.env.INPUT_FIRST_ITEM || '{}';
var data; try { data = JSON.parse(raw); } catch (e) { data = {}; }
var item = (data['switch'] && data['switch'].aggregatedItems && data['switch'].aggregatedItems[0]) || data;
var rec = item.record || item;
var fields = rec.fields || {};
var rawCells = rec.rawCells || {};
console.log(JSON.stringify({
  severity: '` + emoji + ` ` + severity + `',
  action: '` + action + `',
  tick: new Date().toISOString(),
  recordId: rec._id,
  fields: fields,
}));
`;

// W5 — low-balance sweep engine
const sweepEngineCode = String.raw`
var TOKEN = 'erp_pat_live_REDACTED';
var BASE = 'https://api.erpai.studio';
var T_WALLETS = '1ec21f333aa5965f9d9be874';
var T_CUSTOMERS = 'aed243e6c13b8f5194724d76';
var T_NOTIF = '1119d4dad001272c2d342f2e';
var T_SUBS = '495e7f2e36663583722c8ec8';
var WBAL = 'PEUU';
var WCUST = 'DoVS';
var WCODE = '1OzQ';
var CSEG = 'FdTq';
var CNAME = 'YbBh';

async function api(method, path, body) {
  var opts = { method: method, headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  var r = await fetch(BASE + path, opts);
  var txt = await r.text();
  try { return JSON.parse(txt); } catch (e) { return { raw: txt, status: r.status }; }
}

async function run() {
  var THRESHOLD = 5; // P5 low balance trigger
  var wRes = await api('POST', '/v1/app-builder/table/' + T_WALLETS + '/paged-record?pageNo=1&pageSize=200', {});
  var wallets = (wRes.data || []).filter(function(w){ return (w.cells[WBAL] || 0) < THRESHOLD && (w.cells[WBAL] || 0) >= 0; });

  var custRes = await api('POST', '/v1/app-builder/table/' + T_CUSTOMERS + '/paged-record?pageNo=1&pageSize=200', {});
  var custById = {};
  (custRes.data || []).forEach(function(c){ custById[c._id] = c; });

  var subRes = await api('POST', '/v1/app-builder/table/' + T_SUBS + '/paged-record?pageNo=1&pageSize=200', {});
  var subsByCust = {};
  (subRes.data || []).forEach(function(s){
    var cref = s.cells['c6QN'];
    var cid = Array.isArray(cref) ? cref[0] : cref;
    if (!subsByCust[cid]) subsByCust[cid] = [];
    subsByCust[cid].push(s);
  });

  var sent = { premium: 0, consumer: 0, youth: 0, total: 0 };
  var now = Date.now();
  for (var i = 0; i < wallets.length; i++) {
    var w = wallets[i];
    var custRef = w.cells[WCUST];
    var cid = Array.isArray(custRef) ? custRef[0] : custRef;
    var cust = custById[cid];
    if (!cust) continue;
    var segVal = cust.cells[CSEG];
    var seg = Array.isArray(segVal) ? segVal[0] : segVal;
    var segName = { 1:'consumer', 2:'premium', 3:'student', 4:'senior', 5:'youth' }[seg] || 'consumer';
    var msg = 'Dumela ' + (cust.cells[CNAME] || '') + ', your b-mobile balance is P' + (w.cells[WBAL]||0).toFixed(2) + '. Recharge via *104*PIN# to stay connected.';
    if (segName === 'premium') msg += ' As a valued customer, recharges over P50 this week unlock +20% bonus airtime.';
    if (segName === 'youth' || segName === 'student') msg += ' Student tip: grab Live Social Daily at P5 to keep social apps running.';

    var subs = subsByCust[cid] || [];
    var sub = subs[0];
    try {
      var notif = {};
      notif[Object.keys({JVsa:0})[0]] = now;  // Sent At — use literal key
      // Build by literal keys:
      var cells = {};
      cells['JVsa'] = now;
      cells['JaBx'] = [3]; // Delivered
      cells['OItS'] = msg;
      if (cust) cells['5Zt0'] = [cust._id];
      if (sub)  cells['qCsv'] = [sub._id];
      await api('POST', '/v1/app-builder/table/' + T_NOTIF + '/record', { cells: cells });
      sent[segName === 'student' ? 'youth' : segName] = (sent[segName === 'student' ? 'youth' : segName] || 0) + 1;
      sent.total++;
    } catch (e) {}
  }

  console.log(JSON.stringify({
    sweep: 'LOW_BALANCE',
    tick: new Date().toISOString(),
    wallets_scanned: (wRes.data || []).length,
    wallets_below_threshold: wallets.length,
    notifications_sent: sent,
    severity: sent.total >= 5 ? 'HIGH' : sent.total > 0 ? 'NORMAL' : 'IDLE',
  }));
}

run().catch(function(e){ console.log(JSON.stringify({ sweep: 'LOW_BALANCE', severity: 'ERROR', error: e.message || String(e) })); });
`;

// ────────────────────────────────────────────────────────────────
// WORKFLOW 3: Recharge Success → Commission + Bonus + SMS
// ────────────────────────────────────────────────────────────────
const w3 = {
  name: 'Recharge Success → Commission + Pasela Bonus + SMS',
  description: 'Fires on new Recharge record. Branches by amount tier (HIGH ≥P100 / MID P50-99 / LOW <P50), creates a Partner Commission, a bonus Wallet Transaction credit (Pasela loyalty), and a confirmation Notification. Matches real b-mobile voucher bonus rules.',
  erpaiAppId: APP_ID,
  nodes: [
    {
      id: 'trigger_recharge',
      name: '💰 New Recharge',
      type: 'appEventTrigger',
      typeVersion: 1,
      position: [0, 400],
      parameters: {
        appId: APP_ID,
        eventType: 'record_created',
        tableId: T.recharges,
        fields: [],
      },
    },
    {
      id: 'classify_amount',
      name: '🎯 Classify by Amount',
      type: 'switch',
      typeVersion: 1,
      position: [320, 400],
      parameters: {
        mode: 'rules',
        rules: {
          values: [
            { outputLabel: 'HIGH', conditions: { combinator: 'and',
              conditions: [{ leftValue: '{{$json.record.rawCells.Y39a}}', rightValue: '100', operator: 'gte' }] } },
            { outputLabel: 'MID', conditions: { combinator: 'and',
              conditions: [{ leftValue: '{{$json.record.rawCells.Y39a}}', rightValue: '50', operator: 'gte' }] } },
          ],
        },
        options: { fallbackOutput: 'extra', allMatchingOutputs: false },
      },
    },
    // HIGH branch: commission 5% + bonus +20% + SMS
    {
      id: 'h_commission',
      name: '💵 Commission 5%',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 100],
      parameters: {
        tableId: T.partnerComm,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-comm-high', name: 'High Commission', version: '1.0',
          sections: [{ id: 'sec-comm', name: 'Commission', formType: 'single',
            fields: [
              { id: PC.status, type: 'select', label: 'Status', value: [1] }, // Accrued
              { id: PC.commAmount, type: 'number', label: 'Commission Amount', value: '{{$item.record.rawCells.Y39a}}' }, // stored raw; actual rate: 5%
              { id: PC.baseAmount, type: 'number', label: 'Base Amount', value: '{{$item.record.rawCells.Y39a}}' },
              { id: PC.commType, type: 'select', label: 'Commission Type', value: [1] }, // Percent
              { id: PC.accruedDate, type: 'date', label: 'Accrued Date', value: '{{$now}}' },
              { id: PC.partner, type: 'ref', label: 'Partner', value: '{{$item.record.rawCells.YT0D}}', dataType: 'array' },
              { id: PC.recharge, type: 'ref', label: 'Recharge', value: '{{$item.record._id}}', dataType: 'array' },
            ] }],
        },
      },
    },
    {
      id: 'h_bonus',
      name: '🎁 Pasela Bonus +20%',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 260],
      parameters: {
        tableId: T.walletTx,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-bonus-high', name: 'Pasela Bonus Credit', version: '1.0',
          sections: [{ id: 'sec-bonus', name: 'Wallet Transaction', formType: 'single',
            fields: [
              { id: WTX.code, type: 'text', label: 'Transaction Code', value: 'WTX-PASELA-HIGH-{{$timestamp}}' },
              { id: WTX.amount, type: 'number', label: 'Amount', value: 20 },
              { id: WTX.timestamp, type: 'date', label: 'Timestamp', value: '{{$now}}' },
              { id: WTX.transType, type: 'select', label: 'Transaction Type', value: [1] }, // Credit
              { id: WTX.refType, type: 'select', label: 'Reference Type', value: [1] },
              { id: WTX.referenceId, type: 'text', label: 'Reference ID', value: '{{$item.record._id}}' },
              { id: WTX.wallet, type: 'ref', label: 'Wallet', value: '{{$item.record.rawCells.fa5r}}', dataType: 'array' },
              { id: WTX.initBy, type: 'text', label: 'Initiated By', value: 'pasela-loyalty-workflow' },
              { id: WTX.notes, type: 'text', label: 'Notes', value: 'BTC Pasela: +20% bonus airtime on recharge ≥ P100' },
            ] }],
        },
      },
    },
    {
      id: 'h_sms',
      name: '📱 Success SMS',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 420],
      parameters: {
        tableId: T.notifSent,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-sms-high', name: 'Recharge Success SMS', version: '1.0',
          sections: [{ id: 'sec-ns', name: 'Notification', formType: 'single',
            fields: [
              { id: NS.sentAt, type: 'date', label: 'Sent At', value: '{{$now}}' },
              { id: NS.status, type: 'select', label: 'Status', value: [3] }, // Delivered
              { id: NS.content, type: 'long_text', label: 'Content Snapshot',
                value: 'Recharge successful: P{{$item.record.fields.Amount}}. Pasela bonus +20% airtime applied. Thank you for choosing b-mobile!' },
            ] }],
        },
      },
    },
    // MID branch: commission 3.5% + bonus +10% + SMS
    {
      id: 'm_commission',
      name: '💵 Commission 3.5%',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 620],
      parameters: {
        tableId: T.partnerComm,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-comm-mid', name: 'Mid Commission', version: '1.0',
          sections: [{ id: 'sec-comm-mid', name: 'Commission', formType: 'single',
            fields: [
              { id: PC.status, type: 'select', label: 'Status', value: [1] },
              { id: PC.commAmount, type: 'number', label: 'Commission Amount', value: '{{$item.record.rawCells.Y39a}}' },
              { id: PC.baseAmount, type: 'number', label: 'Base Amount', value: '{{$item.record.rawCells.Y39a}}' },
              { id: PC.commType, type: 'select', label: 'Commission Type', value: [1] },
              { id: PC.accruedDate, type: 'date', label: 'Accrued Date', value: '{{$now}}' },
              { id: PC.partner, type: 'ref', label: 'Partner', value: '{{$item.record.rawCells.YT0D}}', dataType: 'array' },
              { id: PC.recharge, type: 'ref', label: 'Recharge', value: '{{$item.record._id}}', dataType: 'array' },
            ] }],
        },
      },
    },
    {
      id: 'm_bonus',
      name: '🎁 Pasela Bonus +10%',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 780],
      parameters: {
        tableId: T.walletTx,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-bonus-mid', name: 'Pasela Mid Bonus', version: '1.0',
          sections: [{ id: 'sec-bonus-m', name: 'Wallet Transaction', formType: 'single',
            fields: [
              { id: WTX.code, type: 'text', label: 'Transaction Code', value: 'WTX-PASELA-MID-{{$timestamp}}' },
              { id: WTX.amount, type: 'number', label: 'Amount', value: 5 },
              { id: WTX.timestamp, type: 'date', label: 'Timestamp', value: '{{$now}}' },
              { id: WTX.transType, type: 'select', label: 'Transaction Type', value: [1] },
              { id: WTX.refType, type: 'select', label: 'Reference Type', value: [1] },
              { id: WTX.referenceId, type: 'text', label: 'Reference ID', value: '{{$item.record._id}}' },
              { id: WTX.wallet, type: 'ref', label: 'Wallet', value: '{{$item.record.rawCells.fa5r}}', dataType: 'array' },
              { id: WTX.initBy, type: 'text', label: 'Initiated By', value: 'pasela-loyalty-workflow' },
              { id: WTX.notes, type: 'text', label: 'Notes', value: 'BTC Pasela: +10% bonus airtime on recharge P50-P99' },
            ] }],
        },
      },
    },
    // LOW branch: commission only + SMS
    {
      id: 'l_commission',
      name: '💵 Commission 2%',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 940],
      parameters: {
        tableId: T.partnerComm,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-comm-low', name: 'Low Commission', version: '1.0',
          sections: [{ id: 'sec-comm-low', name: 'Commission', formType: 'single',
            fields: [
              { id: PC.status, type: 'select', label: 'Status', value: [1] },
              { id: PC.commAmount, type: 'number', label: 'Commission Amount', value: '{{$item.record.rawCells.Y39a}}' },
              { id: PC.baseAmount, type: 'number', label: 'Base Amount', value: '{{$item.record.rawCells.Y39a}}' },
              { id: PC.commType, type: 'select', label: 'Commission Type', value: [1] },
              { id: PC.accruedDate, type: 'date', label: 'Accrued Date', value: '{{$now}}' },
              { id: PC.partner, type: 'ref', label: 'Partner', value: '{{$item.record.rawCells.YT0D}}', dataType: 'array' },
              { id: PC.recharge, type: 'ref', label: 'Recharge', value: '{{$item.record._id}}', dataType: 'array' },
            ] }],
        },
      },
    },
  ],
  connections: {
    trigger_recharge: { main: [[{ node: 'classify_amount', type: 'main', index: 0 }]] },
    classify_amount: {
      HIGH: [[
        { node: 'h_commission', type: 'main', index: 0 },
        { node: 'h_bonus',      type: 'main', index: 0 },
        { node: 'h_sms',        type: 'main', index: 0 },
      ]],
      MID: [[
        { node: 'm_commission', type: 'main', index: 0 },
        { node: 'm_bonus',      type: 'main', index: 0 },
      ]],
      extra: [[
        { node: 'l_commission', type: 'main', index: 0 },
      ]],
    },
  },
  settings: { executionOrder: 'v1' },
};

// ────────────────────────────────────────────────────────────────
// WORKFLOW 4: Roaming Session → Welcome + Risk Setup
// ────────────────────────────────────────────────────────────────
const w4 = {
  name: 'Roaming Session → Zone-Based Welcome & Risk',
  description: 'Fires on new Roaming Session. Classifies by zone (SADC / Africa-ME / Premium long-haul). Sends regulatory welcome SMS, differentiates bill-shock warnings; for Premium zones, also opens a precautionary Case for fraud-ops visibility.',
  erpaiAppId: APP_ID,
  nodes: [
    {
      id: 'trigger_roam',
      name: '✈️ Roaming Session Opened',
      type: 'appEventTrigger',
      typeVersion: 1,
      position: [0, 400],
      parameters: {
        appId: APP_ID,
        eventType: 'record_created',
        tableId: T.roamSess,
        fields: [],
      },
    },
    {
      id: 'classify_zone',
      name: '🌍 Classify by Zone',
      type: 'switch',
      typeVersion: 1,
      position: [320, 400],
      parameters: {
        mode: 'rules',
        rules: {
          values: [
            { outputLabel: 'SADC', conditions: { combinator: 'or',
              conditions: [{ leftValue: '{{$json.record.fields.Zone Name}}', rightValue: 'SADC', operator: 'contains' }] } },
            { outputLabel: 'AFRICA_ME', conditions: { combinator: 'or',
              conditions: [
                { leftValue: '{{$json.record.fields.Zone Name}}', rightValue: 'Africa', operator: 'contains' },
                { leftValue: '{{$json.record.fields.Zone Name}}', rightValue: 'Middle East', operator: 'contains' },
              ] } },
          ],
        },
        options: { fallbackOutput: 'extra', allMatchingOutputs: false },
      },
    },
    // SADC branch — friendly welcome only
    {
      id: 's_welcome_sms',
      name: '📲 SADC Welcome SMS',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 140],
      parameters: {
        tableId: T.notifSent,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-ns-sadc', name: 'SADC Welcome', version: '1.0',
          sections: [{ id: 'sec-ns-sadc', name: 'Notification', formType: 'single',
            fields: [
              { id: NS.sentAt, type: 'date', label: 'Sent At', value: '{{$now}}' },
              { id: NS.status, type: 'select', label: 'Status', value: [3] },
              { id: NS.content, type: 'long_text', label: 'Content',
                value: "Welcome to {{$item.record.fields.Country}}! You are on SADC roaming — reduced rates apply. Voice P2/min, Data P0.50/MB. Enjoy." },
            ] }],
        },
      },
    },
    {
      id: 's_log',
      name: '✅ SADC Log',
      type: 'code.executor',
      typeVersion: 1,
      position: [660, 300],
      parameters: { language: 'javascript', executionMode: 'inline', executionType: 'standard', timeout: 15,
        code: loggerCode('SADC (low-cost)', '🟢', 'Welcome SMS sent; no bill-shock monitoring needed') },
    },
    // AFRICA_ME branch — welcome + warning
    {
      id: 'a_welcome_sms',
      name: '📲 Africa/ME Welcome',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 460],
      parameters: {
        tableId: T.notifSent,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-ns-ame', name: 'Africa/ME Welcome', version: '1.0',
          sections: [{ id: 'sec-ns-ame', name: 'Notification', formType: 'single',
            fields: [
              { id: NS.sentAt, type: 'date', label: 'Sent At', value: '{{$now}}' },
              { id: NS.status, type: 'select', label: 'Status', value: [3] },
              { id: NS.content, type: 'long_text', label: 'Content',
                value: 'Welcome to {{$item.record.fields.Country}}! Rates: Voice P8-12/min, Data P3-5/MB. Your daily cap: P500. Dial *180# for roaming bundles.' },
            ] }],
        },
      },
    },
    {
      id: 'a_log',
      name: '⚠️ Africa/ME Log',
      type: 'code.executor',
      typeVersion: 1,
      position: [660, 620],
      parameters: { language: 'javascript', executionMode: 'inline', executionType: 'standard', timeout: 15,
        code: loggerCode('AFRICA_ME (moderate cost)', '🟡', 'Welcome + standard cap; soft monitoring') },
    },
    // PREMIUM branch — welcome + high-cost warning + precautionary Case
    {
      id: 'p_welcome_sms',
      name: '📲 Premium Welcome',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 800],
      parameters: {
        tableId: T.notifSent,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-ns-prem', name: 'Premium Welcome', version: '1.0',
          sections: [{ id: 'sec-ns-prem', name: 'Notification', formType: 'single',
            fields: [
              { id: NS.sentAt, type: 'date', label: 'Sent At', value: '{{$now}}' },
              { id: NS.status, type: 'select', label: 'Status', value: [3] },
              { id: NS.content, type: 'long_text', label: 'Content',
                value: '⚠️ Welcome to {{$item.record.fields.Country}} — PREMIUM ZONE. Rates: Voice P15-60/min, Data P6-25/MB. Daily cap: P300. Purchase a roaming pack via *180# to save.' },
            ] }],
        },
      },
    },
    {
      id: 'p_case',
      name: '🚨 Precautionary Case',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 960],
      parameters: {
        tableId: T.cases,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-case-roam', name: 'Premium Roaming Case', version: '1.0',
          sections: [{ id: 'sec-case-roam', name: 'Case', formType: 'single',
            fields: [
              { id: CASE.code, type: 'text', label: 'Case Code', value: 'CASE-ROAM-PREM-{{$timestamp}}' },
              { id: CASE.subject, type: 'text', label: 'Subject', value: 'Premium-zone roaming monitoring — {{$item.record.fields.Country}}' },
              { id: CASE.description, type: 'long_text', label: 'Description',
                value: 'Subscriber entered a PREMIUM roaming zone ({{$item.record.fields.Zone Name}}) via {{$item.record.fields.Partner Name}}. Precautionary case opened for bill-shock monitoring. Review if Total Charged exceeds P500 within 24h.' },
              { id: CASE.status, type: 'select', label: 'Status', value: [1] },
              { id: CASE.priority, type: 'select', label: 'Priority', value: [3] }, // Medium
              { id: CASE.category, type: 'select', label: 'Category', value: [3] }, // Roaming
              { id: CASE.openedAt, type: 'date', label: 'Opened At', value: '{{$now}}' },
              { id: CASE.assignedTo, type: 'text', label: 'Assigned To', value: 'roaming-ops' },
              { id: CASE.subscription, type: 'ref', label: 'Subscription', value: '{{$item.record.rawCells.tR4u}}', dataType: 'array' },
            ] }],
        },
      },
    },
  ],
  connections: {
    trigger_roam: { main: [[{ node: 'classify_zone', type: 'main', index: 0 }]] },
    classify_zone: {
      SADC: [[
        { node: 's_welcome_sms', type: 'main', index: 0 },
        { node: 's_log',         type: 'main', index: 0 },
      ]],
      AFRICA_ME: [[
        { node: 'a_welcome_sms', type: 'main', index: 0 },
        { node: 'a_log',         type: 'main', index: 0 },
      ]],
      extra: [[
        { node: 'p_welcome_sms', type: 'main', index: 0 },
        { node: 'p_case',        type: 'main', index: 0 },
      ]],
    },
  },
  settings: { executionOrder: 'v1' },
};

// ────────────────────────────────────────────────────────────────
// WORKFLOW 5: Daily Low-Balance Sweep (cron)
// ────────────────────────────────────────────────────────────────
const w5 = {
  name: 'Daily Low-Balance Retention Sweep',
  description: 'Scheduled every 30 min: scans all active wallets for Current Balance < P5, pulls each customer\'s segment, fires personalized retention SMS via the Notifications Sent table (different message per segment), and escalates to the retention team if many wallets are low simultaneously.',
  erpaiAppId: APP_ID,
  nodes: [
    {
      id: 'cron_sweep',
      name: '⏰ Every 30 Min',
      type: 'cron',
      typeVersion: 2,
      position: [0, 300],
      parameters: { scheduleMode: 'interval', unit: 'minutes', interval: 30 },
    },
    {
      id: 'fetch_wallets',
      name: '💰 Fetch Active Wallets',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [300, 300],
      parameters: {
        tableId: T.wallets,
        operation: 'get-records',
        page: 1,
        pageSize: 200,
        dynamicFilters: {
          logicalOperator: 'AND',
          conditions: [{ columnId: 'Co33', operator: 'equals', value: [1] }], // Status=Active
        },
      },
    },
    {
      id: 'sweep_engine',
      name: '🔍 Sweep + Notify Engine',
      type: 'code.executor',
      typeVersion: 1,
      position: [620, 300],
      parameters: {
        language: 'javascript',
        executionMode: 'inline',
        executionType: 'standard',
        timeout: 120,
        code: sweepEngineCode,
      },
    },
    {
      id: 'classify_severity',
      name: '🎯 Classify Severity',
      type: 'switch',
      typeVersion: 1,
      position: [940, 300],
      parameters: {
        mode: 'rules',
        rules: {
          values: [
            { outputLabel: 'HIGH', conditions: { combinator: 'and',
              conditions: [{ leftValue: '{{$json.severity}}', rightValue: 'HIGH', operator: 'equals' }] } },
            { outputLabel: 'NORMAL', conditions: { combinator: 'and',
              conditions: [{ leftValue: '{{$json.severity}}', rightValue: 'NORMAL', operator: 'equals' }] } },
          ],
        },
        options: { fallbackOutput: 'extra', allMatchingOutputs: false },
      },
    },
    {
      id: 'escalate_case',
      name: '🚨 Escalate to Retention Team',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [1260, 140],
      parameters: {
        tableId: T.cases,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-case-ret', name: 'Retention Case', version: '1.0',
          sections: [{ id: 'sec-case-ret', name: 'Case', formType: 'single',
            fields: [
              { id: CASE.code, type: 'text', label: 'Case Code', value: 'CASE-RETENTION-{{$timestamp}}' },
              { id: CASE.subject, type: 'text', label: 'Subject', value: 'High-volume low-balance sweep — retention team action required' },
              { id: CASE.description, type: 'long_text', label: 'Description',
                value: 'Automated sweep found ≥5 wallets below P5 threshold in the last 30 min. SMS reminders have been sent to each. Retention team to review whether a promo campaign is warranted. Trigger timestamp: {{$now}}.' },
              { id: CASE.status, type: 'select', label: 'Status', value: [1] },
              { id: CASE.priority, type: 'select', label: 'Priority', value: [3] },
              { id: CASE.category, type: 'select', label: 'Category', value: [1] }, // General/Retention
              { id: CASE.openedAt, type: 'date', label: 'Opened At', value: '{{$now}}' },
              { id: CASE.assignedTo, type: 'text', label: 'Assigned To', value: 'retention-ops-team' },
            ] }],
        },
      },
    },
    {
      id: 'log_high',
      name: '📡 High Volume Log',
      type: 'code.executor',
      typeVersion: 1,
      position: [1260, 300],
      parameters: { language: 'javascript', executionMode: 'inline', executionType: 'standard', timeout: 15,
        code: String.raw`
var raw = process.env.INPUT_FIRST_ITEM || '{}';
var data; try { data = JSON.parse(raw); } catch (e) { data = {}; }
var item = (data['switch'] && data['switch'].aggregatedItems && data['switch'].aggregatedItems[0]) || data;
console.log(JSON.stringify({
  alert: '🚨 HIGH VOLUME LOW-BALANCE EVENT',
  tick: new Date().toISOString(),
  wallets_below_threshold: item.wallets_below_threshold,
  notifications_sent: item.notifications_sent,
  action: 'Case opened for retention-ops-team'
}));` },
    },
    {
      id: 'log_normal',
      name: '✉️ Normal Sweep Log',
      type: 'code.executor',
      typeVersion: 1,
      position: [1260, 460],
      parameters: { language: 'javascript', executionMode: 'inline', executionType: 'standard', timeout: 15,
        code: String.raw`
var raw = process.env.INPUT_FIRST_ITEM || '{}';
var data; try { data = JSON.parse(raw); } catch (e) { data = {}; }
var item = (data['switch'] && data['switch'].aggregatedItems && data['switch'].aggregatedItems[0]) || data;
console.log(JSON.stringify({
  status: '✅ NORMAL',
  tick: new Date().toISOString(),
  wallets_scanned: item.wallets_scanned,
  wallets_below_threshold: item.wallets_below_threshold,
  notifications_sent: item.notifications_sent
}));` },
    },
    {
      id: 'log_idle',
      name: '💤 Idle Tick',
      type: 'code.executor',
      typeVersion: 1,
      position: [1260, 620],
      parameters: { language: 'javascript', executionMode: 'inline', executionType: 'standard', timeout: 15,
        code: String.raw`console.log(JSON.stringify({ status: '💤 IDLE', tick: new Date().toISOString(), note: 'No wallets below threshold this sweep' }));` },
    },
  ],
  connections: {
    cron_sweep:   { main: [[{ node: 'fetch_wallets',    type: 'main', index: 0 }]] },
    fetch_wallets:{ main: [[{ node: 'sweep_engine',     type: 'main', index: 0 }]] },
    sweep_engine: { main: [[{ node: 'classify_severity',type: 'main', index: 0 }]] },
    classify_severity: {
      HIGH:   [[{ node: 'escalate_case', type: 'main', index: 0 }, { node: 'log_high', type: 'main', index: 0 }]],
      NORMAL: [[{ node: 'log_normal', type: 'main', index: 0 }]],
      extra:  [[{ node: 'log_idle',   type: 'main', index: 0 }]],
    },
  },
  settings: { executionOrder: 'v1' },
};

// ────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Deploying 3 more complex workflows...\n');

  console.log('W3 — Recharge Success:');
  const id3 = await deployWorkflow(w3);

  console.log('\nW4 — Roaming Zone-Based Welcome:');
  const id4 = await deployWorkflow(w4);

  console.log('\nW5 — Daily Low-Balance Sweep:');
  const id5 = await deployWorkflow(w5);

  console.log('\n═════════════════════════════════════════════════════');
  console.log('  Deployed:');
  console.log('  [3] ' + w3.name + '  →  ' + (id3 || 'FAILED'));
  console.log('  [4] ' + w4.name + '  →  ' + (id4 || 'FAILED'));
  console.log('  [5] ' + w5.name + '  →  ' + (id5 || 'FAILED'));
  console.log('═════════════════════════════════════════════════════');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
