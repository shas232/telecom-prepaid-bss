#!/usr/bin/env node
// low-stock-alert.mjs — INV-008
// SIM Inventory groupBy (warehouse_location, batch_id) — count status='In Stock' per group.
// If count < reorder_threshold AND (reorder_alert_sent_at null OR > 24h ago):
//   - insert Notifications Sent row (template LOW_STOCK_ALERT / fallback first Email template)
//   - PUT each SIM Inventory row in the group: reorder_alert_sent_at = now()
//
// Usage:
//   node scripts/low-stock-alert.mjs              # live
//   node scripts/low-stock-alert.mjs --dry-run    # preview

import { api, APP_ID, sleep } from './lib-common.mjs';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');

const TID = {
  SimInventory:    'd505634fbf573e21591ed72f',
  NotifSent:       '1119d4dad001272c2d342f2e',
  NotifTemplates:  '7f559e405ea6595e0c06fe24',
};

// SIM Inventory column IDs
const SIM = {
  WarehouseLocation: 'ftpK',
  BatchId:           'N4ab',
  Status:            'UPMn',  // 1=In Stock
  ReorderThreshold:  'FcdD',
  ReorderAlertSentAt:'HfUN',
};

// Notifications Sent column IDs
const NS = {
  SentAt:           'JVsa',
  Status:           'JaBx',    // 1=Queued
  ContentSnapshot:  'OItS',
  Template:         'hywV',
  Channel:          '61nR',
  TicketReference:  'nKSl',
};

const COOLDOWN_MS = 24 * 3600 * 1000;

async function sql(q) {
  const r = await api('POST', '/v1/agent/app/sql/execute', { appId: APP_ID, sqlQuery: q, limit: 100000 });
  if (!r.ok) throw new Error('SQL: ' + JSON.stringify(r.data).slice(0, 400));
  return r.data?.data?.rows || [];
}

function parseSelectId(v) {
  if (v == null || v === '' || v === '[]') return null;
  try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) && a.length ? Number(a[0]) : null; }
  catch { return null; }
}

async function updateSim(id, cells) {
  return api('PUT', `/v1/app-builder/table/${TID.SimInventory}/record/${id}?appId=${APP_ID}`, { cells });
}

async function bulkInsert(tableId, rows) {
  if (!rows.length) return { inserted: 0, errors: [] };
  let inserted = 0; const errors = [];
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    const r = await api('POST', `/v1/app-builder/table/${tableId}/record-bulk?appId=${APP_ID}`,
      { arr: batch.map(cells => ({ cells })) });
    if (!r.ok) errors.push({ start: i, status: r.status, body: JSON.stringify(r.data).slice(0, 400) });
    else inserted += batch.length;
    await sleep(150);
  }
  return { inserted, errors };
}

async function main() {
  console.log('== low-stock-alert ==', DRY ? '[DRY RUN]' : '');

  // Find template: LOW_STOCK_ALERT preferred, fallback first Email template
  const tpls = await sql(`SELECT _id, template_code, channel_type FROM a1776271424351_notification_templates WHERE _deleted=0`);
  let template = tpls.find(t => t.template_code === 'LOW_STOCK_ALERT');
  if (!template) template = tpls.find(t => parseSelectId(t.channel_type) === 3); // 3=Email
  if (!template) template = tpls[0];
  if (!template) { console.log('no templates available; aborting'); return; }
  console.log(`using template: ${template.template_code} (${template._id})`);

  // Load inventory
  const sims = await sql(
    `SELECT _id, warehouse_location, batch_id, status, reorder_threshold, reorder_alert_sent_at
     FROM a1776271424351_sim_inventory WHERE _deleted=0`
  );
  console.log(`sim rows: ${sims.length}`);

  // Group by warehouse_location|batch_id
  const groups = new Map();
  for (const s of sims) {
    const key = `${s.warehouse_location || ''}||${s.batch_id || ''}`;
    if (!groups.has(key)) groups.set(key, {
      key,
      warehouse: s.warehouse_location,
      batch: s.batch_id,
      threshold: Number(s.reorder_threshold) || 0,
      inStock: 0,
      rowsInStock: [],
      lastAlertMs: 0,
    });
    const g = groups.get(key);
    if (Number(s.reorder_threshold) > g.threshold) g.threshold = Number(s.reorder_threshold);
    if (parseSelectId(s.status) === 1) {
      g.inStock++;
      g.rowsInStock.push(s._id);
    }
    if (s.reorder_alert_sent_at) {
      const ms = new Date(String(s.reorder_alert_sent_at).replace(' ', 'T') + 'Z').getTime();
      if (ms > g.lastAlertMs) g.lastAlertMs = ms;
    }
  }

  const now = Date.now();
  const toAlert = [];
  let skippedCooldown = 0, skippedAboveThreshold = 0, skippedNoThreshold = 0;
  for (const g of groups.values()) {
    if (!g.threshold) { skippedNoThreshold++; continue; }
    if (g.inStock >= g.threshold) { skippedAboveThreshold++; continue; }
    if (g.lastAlertMs && now - g.lastAlertMs < COOLDOWN_MS) { skippedCooldown++; continue; }
    toAlert.push(g);
  }
  console.log(`groups=${groups.size} toAlert=${toAlert.length} cooldown=${skippedCooldown} ok=${skippedAboveThreshold} no-threshold=${skippedNoThreshold}`);

  if (!toAlert.length) { console.log('nothing to alert'); return; }

  // Build notification rows
  const notifRows = toAlert.map(g => ({
    [NS.SentAt]: new Date().toISOString(),
    [NS.Status]: [1],
    [NS.ContentSnapshot]: `Location ${g.warehouse} (batch ${g.batch}) has ${g.inStock} units in stock, below threshold ${g.threshold}`,
    [NS.Template]: [template._id],
    [NS.TicketReference]: `LOW_STOCK-${g.warehouse}-${g.batch}`,
  }));

  if (DRY) {
    console.log('DRY: would insert', notifRows.length, 'notifications');
    for (const g of toAlert.slice(0, 5)) console.log(`  ${g.warehouse}/${g.batch} inStock=${g.inStock} thr=${g.threshold}`);
    return;
  }

  const { inserted, errors } = await bulkInsert(TID.NotifSent, notifRows);
  console.log(`notifications inserted: ${inserted}/${notifRows.length}`);
  if (errors.length) {
    console.log('INSERT ERRORS:');
    for (const e of errors.slice(0, 5)) console.log(JSON.stringify(e).slice(0, 400));
  }

  // Stamp each row in the group with reorder_alert_sent_at = now
  const nowIso = new Date().toISOString();
  let stamped = 0; const updErrors = [];
  for (const g of toAlert) {
    for (const rowId of g.rowsInStock) {
      const r = await updateSim(rowId, { [SIM.ReorderAlertSentAt]: nowIso });
      if (!r.ok) updErrors.push({ rowId, status: r.status, body: JSON.stringify(r.data).slice(0, 300) });
      else stamped++;
      await sleep(120);
    }
  }
  console.log(`sim rows stamped: ${stamped}`);
  if (updErrors.length) { console.log('UPDATE ERRORS (first 5):'); for (const e of updErrors.slice(0, 5)) console.log(JSON.stringify(e).slice(0, 300)); }

  console.log('\n== DONE ==');
  console.log(`alerts=${inserted} stamped=${stamped} errors=${errors.length + updErrors.length}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
