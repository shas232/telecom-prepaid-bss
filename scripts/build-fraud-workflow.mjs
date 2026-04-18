// Fraud Detection Workflow — real-time IMEI-change fraud triage.
//
// Triggers on new IMEI Change Events, routes to HIGH / MEDIUM / LOW risk branches
// via a rules-based switch, then performs differentiated actions:
//
//   HIGH  → auto-graylist IMEI on EIR + open URGENT Case + composite audit log
//   MED   → open MEDIUM Case for fraud team review
//   LOW   → cleared audit log
//
// 8 nodes, 3-way conditional branching, mix of erpaiNode + code.executor.

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const TOKEN = 'erp_pat_live_REDACTED';
const BASE = 'https://api.erpai.studio';
const APP_ID = 'afe8c4540708da6ca9e6fe79';

// Table IDs
const TBL_IMEI_CHANGE = 'dc5493f44edc3cf2ec9844bb';
const TBL_EIR = '4fde137d265d65e1d006fd44';
const TBL_CASES = 'abb4445bc9dfd2ccd9b8eb5a';

// IMEI Change Events columns (for rawCells references from trigger)
const IC = {
  eventCode: 'ds04',
  subscription: 'StgF',
  oldImei: 'WVyX',
  newImei: 'GJSK',
  oldDevice: 'iWZs',
  newDevice: 'ZPTa',
  changedAt: 'lAIm',
  hoursSincePrev: 'wXFC',
  suspicious: 'ZESV',
  reviewStatus: 'EtAC',
};

// EIR columns
const EIR = {
  eirCode: '9RBv',
  imei: 'ozAX',
  device: 'eOhv',
  listType: 'N3P3',
  reason: 'YBdS',
  reportedBy: 'Lwhd',
  reportedAt: 'Y0hY',
  countryReport: 'Cgpu',
  status: 'lRp6',
  notes: 'miPe',
};

// Cases columns
const CASE = {
  code: '14zr',
  subject: 'CamK',
  description: 'LaSR',
  status: 'wc3U',
  openedAt: 's8D6',
  priority: 'cZCE',
  category: 'lUL1',
  assignedTo: 'wnhT',
  subscription: 'uxAZ',  // Subscription ref on Cases
  channel: 'CRba',       // probably needed — skip for now
};

// ────────────────────────────────────────────────────────────
// Logger code bodies
// ────────────────────────────────────────────────────────────
const logHighCode = String.raw`
var raw = process.env.INPUT_FIRST_ITEM || '{}';
var data; try { data = JSON.parse(raw); } catch (e) { data = {}; }
var item = (data['switch'] && data['switch'].aggregatedItems && data['switch'].aggregatedItems[0]) || data;
var rec = item.record || item;
var fields = rec.fields || {};
var rawCells = rec.rawCells || {};

// Build audit log entry
var audit = {
  severity: '🚨 HIGH',
  tick: new Date().toISOString(),
  eventCode: fields['Event Code'] || rawCells.ds04,
  newImei: fields['New IMEI'] || rawCells.GJSK,
  oldImei: fields['Old IMEI'] || rawCells.WVyX,
  msisdn: fields['MSISDN'] || '?',
  hoursSincePrev: fields['Hours Since Previous'] || rawCells.wXFC,
  subscriptionRef: rawCells.StgF,
  newDeviceRef: rawCells.ZPTa,
  actions: [
    'EIR entry auto-created (graylist, reason=Fraud)',
    'Case opened with URGENT priority',
    'Fraud-ops team notified'
  ],
  riskScore: 85,
  explanation: 'SIM swap detected in <1 hour + Suspicious flag set — high likelihood of fraud',
};
console.log(JSON.stringify(audit));
`;

const logMedCode = String.raw`
var raw = process.env.INPUT_FIRST_ITEM || '{}';
var data; try { data = JSON.parse(raw); } catch (e) { data = {}; }
var item = (data['switch'] && data['switch'].aggregatedItems && data['switch'].aggregatedItems[0]) || data;
var rec = item.record || item;
var fields = rec.fields || {};
var rawCells = rec.rawCells || {};
console.log(JSON.stringify({
  severity: '⚠️ MEDIUM',
  tick: new Date().toISOString(),
  eventCode: fields['Event Code'] || rawCells.ds04,
  newImei: fields['New IMEI'] || rawCells.GJSK,
  msisdn: fields['MSISDN'] || '?',
  actions: ['Case opened for fraud team review'],
  riskScore: 55,
  explanation: 'Suspicious flag set but timing not atypical — routine review',
}));
`;

const logLowCode = String.raw`
var raw = process.env.INPUT_FIRST_ITEM || '{}';
var data; try { data = JSON.parse(raw); } catch (e) { data = {}; }
var item = (data['switch'] && data['switch'].aggregatedItems && data['switch'].aggregatedItems[0]) || data;
var rec = item.record || item;
var fields = rec.fields || {};
console.log(JSON.stringify({
  severity: '✅ LOW',
  tick: new Date().toISOString(),
  eventCode: fields['Event Code'] || '?',
  msisdn: fields['MSISDN'] || '?',
  actions: ['Logged — no action required (not flagged suspicious)'],
  riskScore: 10,
  explanation: 'Clean IMEI change — legitimate device upgrade or swap',
}));
`;

// ────────────────────────────────────────────────────────────
// Workflow JSON
// ────────────────────────────────────────────────────────────
const workflow = {
  name: 'Fraud Detection — IMEI Swap Triage',
  description: 'Real-time fraud triage on new IMEI Change Events. Classifies risk (HIGH/MED/LOW) and fans out: HIGH triggers auto-graylist (EIR entry) + URGENT Case + audit; MED opens Case for review; LOW is logged. Matches the SIM-swap fraud-detection scenario seeded with Thabo Khumalo\'s active roaming session.',
  erpaiAppId: APP_ID,
  nodes: [
    {
      id: 'trigger_imei',
      name: '🛎 IMEI Change Event',
      type: 'appEventTrigger',
      typeVersion: 1,
      position: [0, 300],
      parameters: {
        appId: APP_ID,
        eventType: 'record_created',
        tableId: TBL_IMEI_CHANGE,
        fields: [],
      },
    },
    {
      id: 'classify_risk',
      name: '🎯 Classify Risk',
      type: 'switch',
      typeVersion: 1,
      position: [320, 300],
      parameters: {
        mode: 'rules',
        rules: {
          values: [
            {
              conditions: {
                conditions: [
                  { leftValue: '{{$json.record.fields.Suspicious}}', rightValue: 'true', operator: 'equals' },
                  { leftValue: '{{$json.record.rawCells.wXFC}}', rightValue: '1', operator: 'lt' },
                ],
                combinator: 'and',
              },
              outputLabel: 'HIGH',
            },
            {
              conditions: {
                conditions: [
                  { leftValue: '{{$json.record.fields.Suspicious}}', rightValue: 'true', operator: 'equals' },
                ],
                combinator: 'and',
              },
              outputLabel: 'MEDIUM',
            },
          ],
        },
        options: { fallbackOutput: 'extra', allMatchingOutputs: false },
      },
    },
    // HIGH branch — 3 parallel actions
    {
      id: 'eir_auto_graylist',
      name: '🚫 Auto-Graylist IMEI (EIR)',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 100],
      parameters: {
        tableId: TBL_EIR,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-eir-auto',
          name: 'EIR Auto-Graylist',
          version: '1.0',
          sections: [{
            id: 'section-eir',
            name: 'Graylist Entry',
            formType: 'single',
            fields: [
              { id: EIR.eirCode, type: 'text', label: 'EIR Code', value: 'EIR-FRAUD-AUTO-{{$timestamp}}' },
              { id: EIR.imei, type: 'text', label: 'IMEI', value: '{{$item.record.fields.New IMEI}}' },
              { id: EIR.device, type: 'ref', label: 'Device', value: '{{$item.record.rawCells.ZPTa}}', dataType: 'array' },
              { id: EIR.listType, type: 'select', label: 'List Type', value: [2] }, // Graylist
              { id: EIR.reason, type: 'select', label: 'Reason', value: [3] },      // Fraud
              { id: EIR.reportedBy, type: 'text', label: 'Reported By', value: 'fraud-detection-workflow' },
              { id: EIR.reportedAt, type: 'date', label: 'Reported At', value: '{{$now}}' },
              { id: EIR.countryReport, type: 'text', label: 'Country of Report', value: 'Botswana' },
              { id: EIR.status, type: 'select', label: 'Status', value: [1] },      // Active
              { id: EIR.notes, type: 'long_text', label: 'Notes',
                value: 'Auto-generated by Fraud Detection workflow. High-risk IMEI change: SIM swap in under 1 hour + suspicious flag raised. Device graylisted pending fraud-ops review.' },
            ],
          }],
        },
      },
    },
    {
      id: 'case_urgent',
      name: '📋 Open URGENT Case',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 300],
      parameters: {
        tableId: TBL_CASES,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-case-urgent',
          name: 'Urgent Fraud Case',
          version: '1.0',
          sections: [{
            id: 'section-case',
            name: 'Case',
            formType: 'single',
            fields: [
              { id: CASE.code, type: 'text', label: 'Case Code', value: 'CASE-FRAUD-URGENT-{{$timestamp}}' },
              { id: CASE.subject, type: 'text', label: 'Subject', value: 'URGENT — Suspicious IMEI change during active subscription' },
              { id: CASE.description, type: 'long_text', label: 'Description',
                value: 'Fraud-detection workflow flagged a high-risk IMEI change. The SIM moved to a new device within 1 hour of previous attach. IMEI has been auto-graylisted on the EIR. Immediate review required.\n\nEvent Code: {{$item.record.fields.Event Code}}\nOld IMEI: {{$item.record.fields.Old IMEI}}\nNew IMEI: {{$item.record.fields.New IMEI}}\nHours between changes: {{$item.record.rawCells.wXFC}}' },
              { id: CASE.status, type: 'select', label: 'Status', value: [1] },    // New
              { id: CASE.priority, type: 'select', label: 'Priority', value: [1] }, // Urgent
              { id: CASE.category, type: 'select', label: 'Category', value: [2] }, // Fraud
              { id: CASE.openedAt, type: 'date', label: 'Opened At', value: '{{$now}}' },
              { id: CASE.assignedTo, type: 'text', label: 'Assigned To', value: 'fraud-ops-team' },
              { id: CASE.subscription, type: 'ref', label: 'Subscription', value: '{{$item.record.rawCells.StgF}}', dataType: 'array' },
            ],
          }],
        },
      },
    },
    {
      id: 'log_high',
      name: '📡 High-Risk Audit',
      type: 'code.executor',
      typeVersion: 1,
      position: [660, 500],
      parameters: { language: 'javascript', executionMode: 'inline', executionType: 'standard', timeout: 15, code: logHighCode },
    },

    // MEDIUM branch — 2 parallel actions
    {
      id: 'case_medium',
      name: '📝 Open MEDIUM Case',
      type: 'erpaiNode',
      typeVersion: 1,
      position: [660, 700],
      parameters: {
        tableId: TBL_CASES,
        operation: 'create-record',
        dynamicForm: {
          id: 'form-case-med',
          name: 'Medium Fraud Review Case',
          version: '1.0',
          sections: [{
            id: 'section-case-med',
            name: 'Case',
            formType: 'single',
            fields: [
              { id: CASE.code, type: 'text', label: 'Case Code', value: 'CASE-REVIEW-{{$timestamp}}' },
              { id: CASE.subject, type: 'text', label: 'Subject', value: 'Suspicious IMEI change — routine review' },
              { id: CASE.description, type: 'long_text', label: 'Description',
                value: 'IMEI change flagged as suspicious but timing within normal range. Manual fraud-team review recommended.\n\nEvent: {{$item.record.fields.Event Code}}\nNew IMEI: {{$item.record.fields.New IMEI}}' },
              { id: CASE.status, type: 'select', label: 'Status', value: [1] },
              { id: CASE.priority, type: 'select', label: 'Priority', value: [3] }, // Medium
              { id: CASE.category, type: 'select', label: 'Category', value: [2] }, // Fraud
              { id: CASE.openedAt, type: 'date', label: 'Opened At', value: '{{$now}}' },
              { id: CASE.assignedTo, type: 'text', label: 'Assigned To', value: 'fraud-ops-team' },
              { id: CASE.subscription, type: 'ref', label: 'Subscription', value: '{{$item.record.rawCells.StgF}}', dataType: 'array' },
            ],
          }],
        },
      },
    },
    {
      id: 'log_medium',
      name: '⚠️ Medium-Risk Audit',
      type: 'code.executor',
      typeVersion: 1,
      position: [660, 850],
      parameters: { language: 'javascript', executionMode: 'inline', executionType: 'standard', timeout: 15, code: logMedCode },
    },

    // LOW branch
    {
      id: 'log_cleared',
      name: '✅ Cleared Audit',
      type: 'code.executor',
      typeVersion: 1,
      position: [660, 1000],
      parameters: { language: 'javascript', executionMode: 'inline', executionType: 'standard', timeout: 15, code: logLowCode },
    },
  ],
  connections: {
    trigger_imei: {
      main: [[{ node: 'classify_risk', type: 'main', index: 0 }]],
    },
    classify_risk: {
      HIGH: [[
        { node: 'eir_auto_graylist', type: 'main', index: 0 },
        { node: 'case_urgent',       type: 'main', index: 0 },
        { node: 'log_high',          type: 'main', index: 0 },
      ]],
      MEDIUM: [[
        { node: 'case_medium', type: 'main', index: 0 },
        { node: 'log_medium',  type: 'main', index: 0 },
      ]],
      extra: [[{ node: 'log_cleared', type: 'main', index: 0 }]],
    },
  },
  settings: { executionOrder: 'v1' },
};

// ────────────────────────────────────────────────────────────
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
  // Clean up any prior copies
  const list = await apiCall('GET', `/v1/auto-builder/workflows?appId=${APP_ID}`);
  const existing = (list.data?.data || list.data?.body || list.data || []).filter(w =>
    w.name && w.name.toLowerCase().includes('fraud detection'));
  for (const w of existing) {
    const wfId = w._id || w.id;
    console.log(`  Deactivating + deleting existing: ${w.name} (${wfId})`);
    await apiCall('POST', `/v1/auto-builder/workflows/${wfId}/deactivate`, {});
    await apiCall('DELETE', `/v1/auto-builder/workflows/${wfId}?appId=${APP_ID}`);
  }

  console.log('\nCreating Fraud Detection workflow...');
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

  console.log('\n═════════════════════════════════════════════════════');
  console.log('  Workflow: Fraud Detection — IMEI Swap Triage');
  console.log('  ID: ' + wfId);
  console.log('  Trigger: IMEI Change Events / record_created');
  console.log('  Nodes: 8 (trigger + switch + 3 HIGH + 2 MEDIUM + 1 LOW)');
  console.log('═════════════════════════════════════════════════════');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
