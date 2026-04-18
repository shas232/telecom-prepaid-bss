// Configures entry forms so that parent tables embed their child tables as
// line items (type: "table"). The schema-level ref already exists; this adds
// the UI form config so line items show in the record dialog.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const APP_ID = 'afe8c4540708da6ca9e6fe79';

const TABLE_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.table-ids.json'), 'utf8'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

// Parent → Child mappings for line items
// [parent table name, child table name, title shown in form]
const LINE_ITEMS = [
  ['Orders',                     'Order Items',                     'Order Items'],
  ['Tariff Plans',               'Plan Allowances',                 'Plan Allowances'],
  ['Bundles',                    'Bundle Components',               'Components'],
  ['Charging Sessions',          'Usage Transactions',              'CCR Events'],
  ['Closed User Groups',         'CUG Members',                     'Members'],
  ['Friends and Family Groups',  'FF Members',                      'Members'],
  ['Promotions',                 'Promotion Redemptions',           'Redemptions'],
  ['Subscriptions',              'Subscription Plan Assignments',   'Active & Historical Plans'],
  ['Subscriptions',              'Balances',                        'Balances'],
  ['Subscriptions',              'Charging Sessions',               'Charging Sessions'],
  ['Subscriptions',              'Bonus Grants',                    'Bonus Grants'],
  ['Subscriptions',              'Subscription Status History',     'Status History'],
  ['Wallets',                    'Wallet Transactions',             'Wallet Transactions'],
  ['Wallets',                    'Recharges',                       'Recharges'],
  ['Distribution Partners',      'Partner Contracts',               'Contracts'],
  ['Distribution Partners',      'Partner Commissions',             'Commissions'],
  ['Customers',                  'Customer Identifications',        'KYC Documents'],
  ['Customers',                  'Customer Lifecycle Events',       'Lifecycle Events'],
  ['Customers',                  'Cases',                           'Support Cases'],
  ['Customers',                  'Customer Interactions',           'Interactions'],
  ['Customers',                  'Subscriptions',                   'Subscriptions'],
  ['Customers',                  'Wallets',                         'Wallet'],
  ['Customers',                  'Orders',                          'Orders'],
];

async function getFullTableMeta(tableName) {
  const tid = TABLE_IDS[tableName];
  if (!tid) return null;
  const resp = await api('GET', `/v1/app-builder/table/${tid}`);
  return {
    tid,
    cols: resp.columnsMetaData || resp.data?.columnsMetaData || [],
  };
}

async function getEntryForm(tableName) {
  const tid = TABLE_IDS[tableName];
  const resp = await api('GET', `/v1/app-builder/table/${tid}/entry-form?appId=${APP_ID}`);
  return resp?.body || resp?.data || resp;
}

// Group children by parent so we can batch into a single PUT per parent
const byParent = new Map();
for (const [parent, child, title] of LINE_ITEMS) {
  if (!byParent.has(parent)) byParent.set(parent, []);
  byParent.get(parent).push({ child, title });
}

async function wireParent(parentName, children) {
  const meta = await getFullTableMeta(parentName);
  if (!meta) { console.log(`  SKIP ${parentName} — no table id`); return; }

  // Regular (non-system, non-related_ref) columns become column_view fields
  const SYSTEM_IDS = new Set(['ID','CTDT','UTDT','CTBY','UTBY','DFT','SFID']);
  const columnFields = meta.cols
    .filter(c => !SYSTEM_IDS.has(c.id) && c.type !== 'related_ref')
    .map((c, idx) => ({
      _id: c.id,
      title: c.name,
      type: 'column_view',
      required: !!c.required,
      index: idx,
      uiVisible: true,
      readOnly: false,
      placeHolder: '',
      defaultValue: null,
      style: { width: c.type === 'long_text' ? 'full' : 'half' },
    }));

  // Line item TABLE fields appended after columns
  const tableFields = children
    .map(({ child, title }, i) => {
      const childTid = TABLE_IDS[child];
      if (!childTid) return null;
      return {
        _id: childTid,
        title,
        type: 'table',
        required: false,
        index: columnFields.length + i,
        uiVisible: true,
        readOnly: false,
        placeHolder: '',
        defaultValue: null,
        style: { width: 'full' },
        settings: { appearance: { viewType: 'table', deleteOnParentRemove: false } },
      };
    })
    .filter(Boolean);

  const body = {
    title: `${parentName} Form`,
    fields: [...columnFields, ...tableFields],
  };

  const resp = await api('PUT', `/v1/app-builder/table/${meta.tid}/entry-form?appId=${APP_ID}`, body);
  const ok = resp?.success;
  if (ok) {
    console.log(`  ✓ ${parentName} — ${columnFields.length} columns + ${tableFields.length} line items`);
  } else {
    console.log(`  ✗ ${parentName}: ${JSON.stringify(resp).slice(0,250)}`);
  }
  await sleep(1200);
}

async function main() {
  console.log('Wiring line items (entry form "table" fields)...');
  for (const [parent, children] of byParent) {
    await wireParent(parent, children);
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
