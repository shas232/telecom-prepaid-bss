// Build 7 new tables: Payments, Quotes, Quote Items, Number Prefix Tariffs,
// CPE Inventory, Erasure Requests, Report Subscriptions.
// Schema-only — no seed data.

import * as L from './lib-common.mjs';

const CUSTOMERS_ID = 'aed243e6c13b8f5194724d76';
const WALLETS_ID   = '1ec21f333aa5965f9d9be874';
const RECHARGES_ID = '4f5d0c07bc1db0dcef8e2c02';
const SUBS_ID      = '495e7f2e36663583722c8ec8';
const TARIFF_ID    = 'f2e797515f347f862e71a641';

const CURRENCIES = ['USD','EUR','GBP','INR','BWP','ZAR','KES','NGN'];

const BULK_SLEEP = 1100;

// Helper: currency number column
const cur = (name, opts = {}) => ({ name, type: 'number', currency: true, ...opts });

async function listTables() {
  const r = await L.api('GET', `/v1/app-builder/table?appId=${L.APP_ID}&pageSize=200`);
  return r.data?.data || [];
}

async function getOrCreate(existingByName, def) {
  if (existingByName[def.name]) {
    console.log(`  [skip] ${def.name} already exists → ${existingByName[def.name]}`);
    return { id: existingByName[def.name], existed: true };
  }
  const r = await L.api('POST', `/v1/app-builder/table`, {
    name: def.name, appId: L.APP_ID,
    description: def.description,
    icon: def.icon, category: def.category,
    idColumn: def.idColumn,
  });
  const id = r.data?.data?._id || r.data?._id || r.data?.id;
  if (!id) throw new Error(`createTable(${def.name}) failed: ${JSON.stringify(r.data).slice(0,400)}`);
  console.log(`  [new] ${def.name} → ${id}`);
  return { id, existed: false };
}

async function addColumnsIfNew(tableId, specs, label) {
  // Fetch existing column names to avoid duplicating on a rerun
  const schema = await L.getTableSchema(tableId);
  const existingNames = new Set(schema.map(c => c.name));
  const toCreate = specs.filter(s => !existingNames.has(s.name));
  if (!toCreate.length) {
    console.log(`  [${label}] all ${specs.length} cols already present; 0 created`);
    const map = {};
    for (const c of schema) map[c.name] = c.id;
    return { map, added: 0 };
  }
  const r = await L.api('POST', `/v1/app-builder/table/${tableId}/column/bulk`, { columns: toCreate });
  if (!r.data?.success) {
    console.error(`  [${label}] FAIL:`, JSON.stringify(r.data).slice(0, 800));
    throw new Error(`createColumns(${label}) failed`);
  }
  const freshSchema = await L.getTableSchema(tableId);
  const map = {};
  for (const c of freshSchema) map[c.name] = c.id;
  console.log(`  [${label}] created ${toCreate.length} new cols (total ${freshSchema.length})`);
  return { map, added: toCreate.length };
}

async function main() {
  console.log('=== Build 7 new tables ===\n');
  console.log('1. Fetching existing tables...');
  const tables = await listTables();
  const byName = {};
  for (const t of tables) byName[t.name] = t._id;
  console.log(`   ${tables.length} tables in app\n`);

  const results = {};
  const errors = [];

  // ------------------------------------------------------------------
  // Create all 7 tables first (except Quote Items, which needs Quote id)
  // ------------------------------------------------------------------
  console.log('2. Creating tables (or reusing existing)...');

  const specs = [
    { key: 'Payments', name: 'Payments', category: 'Wallet & Recharge', icon: 'CreditCard',
      description: 'Payment transactions with gateway/provider lifecycle, idempotency, webhook events (INT-005)',
      idColumn: { name: 'Payment', columnCode: 'PAY' } },
    { key: 'Quotes', name: 'Quotes', category: 'Channels & Orders', icon: 'FileSignature',
      description: 'CPQ quote with offer compatibility + validity (ORD-002)',
      idColumn: { name: 'Quote', columnCode: 'QTE' } },
    { key: 'Quote Items', name: 'Quote Items', category: 'Channels & Orders', icon: 'List',
      description: 'Line items of a quote',
      idColumn: { name: 'Item', columnCode: 'QIT' } },
    { key: 'Number Prefix Tariffs', name: 'Number Prefix Tariffs', category: 'Tariff & Rating', icon: 'Hash',
      description: 'Per-prefix tariff for premium, toll-free, international, short-code numbers (OCR-014)',
      idColumn: { name: 'Prefix Tariff', columnCode: 'NPT' } },
    { key: 'CPE Inventory', name: 'CPE Inventory', category: 'Subscribers', icon: 'Router',
      description: 'Customer Premises Equipment — routers, modems, ONTs, STBs, IoT gateways (INV-004)',
      idColumn: { name: 'CPE', columnCode: 'CPE' } },
    { key: 'Erasure Requests', name: 'Erasure Requests', category: 'Customers', icon: 'UserX',
      description: 'GDPR Article 17 right-to-erasure workflow (KYC-008)',
      idColumn: { name: 'Erasure', columnCode: 'ERA' } },
    { key: 'Report Subscriptions', name: 'Report Subscriptions', category: 'Platform', icon: 'CalendarClock',
      description: 'Scheduled report exports to email/storage (ABI-005)',
      idColumn: { name: 'Subscription', columnCode: 'RSB' } },
  ];

  for (const s of specs) {
    const { id, existed } = await getOrCreate(byName, s);
    results[s.key] = { id, category: s.category, existed, colCount: 0 };
  }

  // ------------------------------------------------------------------
  // Define column sets
  // ------------------------------------------------------------------

  // 1. Payments
  const paymentsCols = [
    { name: 'Payment Code', type: 'text', unique: true, required: true },
    L.selectSpec('Provider', ['Stripe','Razorpay','UPI','Paytm','Flutterwave','PayPal','Square','Bank Transfer']),
    L.selectSpec('Payment Method', ['Card','UPI','Wallet','Net Banking','Cash','Voucher','Bank Transfer','Mobile Money']),
    cur('Amount', { required: true }),
    L.selectSpec('Currency', CURRENCIES),
    L.selectSpec('Status', ['Initiated','Authorized','Captured','Failed','Refunded','Disputed','Cancelled']),
    { name: 'Failure Reason', type: 'text' },
    { name: 'Idempotency Key', type: 'text', unique: true },
    { name: 'Gateway Transaction ID', type: 'text' },
    { name: 'Webhook Event ID', type: 'text' },
    { name: 'HMAC Signature', type: 'text' },
    { name: 'Metadata JSON', type: 'long_text' },
    L.refSpec('Customer', CUSTOMERS_ID, undefined, true),
    L.refSpec('Wallet', WALLETS_ID),
    L.refSpec('Recharge', RECHARGES_ID),
    { name: 'Initiated At', type: 'date', required: true },
    { name: 'Completed At', type: 'date' },
    cur('Refund Amount'),
    { name: 'Notes', type: 'long_text' },
  ];

  // 2. Quotes
  const quotesCols = [
    { name: 'Quote Code', type: 'text', unique: true, required: true },
    L.refSpec('Customer', CUSTOMERS_ID),
    L.refSpec('Subscription', SUBS_ID),
    L.selectSpec('Status', ['Draft','Sent','Viewed','Accepted','Expired','Rejected','Converted']),
    cur('Subtotal'),
    cur('Discount Amount'),
    cur('Tax Amount'),
    cur('Total'),
    { name: 'Valid Until', type: 'date' },
    { name: 'Expires At', type: 'date' },
    { name: 'Sent At', type: 'date' },
    { name: 'Accepted At', type: 'date' },
    { name: 'Prepared By', type: 'text' },
    { name: 'Notes', type: 'long_text' },
    { name: 'Related Order', type: 'text' },
  ];

  // 4. Number Prefix Tariffs
  const nptCols = [
    { name: 'Prefix Code', type: 'text', unique: true, required: true },
    { name: 'Prefix', type: 'text', required: true },
    { name: 'Description', type: 'long_text' },
    L.selectSpec('Destination Type', ['Premium Rate','Toll-Free','International','Short Code','Special Service','Emergency']),
    cur('Per Minute Rate'),
    cur('Per SMS Rate'),
    cur('Per Event Rate'),
    { name: 'Region', type: 'text' },
    L.selectSpec('Currency', CURRENCIES),
    { name: 'Effective From', type: 'date' },
    { name: 'Effective To', type: 'date' },
    L.selectSpec('Status', ['Active','Scheduled','Deprecated','Expired']),
    { name: 'Priority', type: 'number' },
    { name: 'Notes', type: 'long_text' },
  ];

  // 5. CPE Inventory
  const cpeCols = [
    { name: 'CPE Code', type: 'text', unique: true, required: true },
    L.selectSpec('CPE Type', ['Router','Modem','ONT','STB','IoT Gateway','5G CPE','LTE Dongle','VoIP ATA']),
    { name: 'Serial Number', type: 'text', unique: true, required: true },
    { name: 'MAC Address', type: 'text' },
    { name: 'Vendor', type: 'text' },
    { name: 'Model', type: 'text' },
    { name: 'Firmware Version', type: 'text' },
    L.selectSpec('Status', ['In Stock','Deployed','Faulty','Retrieved','RMA','Retired']),
    { name: 'Warehouse Location', type: 'text' },
    L.refSpec('Assigned Subscription', SUBS_ID),
    L.refSpec('Owner', CUSTOMERS_ID),
    { name: 'Lease Start', type: 'date' },
    { name: 'Lease End', type: 'date' },
    { name: 'Deployed Date', type: 'date' },
    { name: 'Warranty Until', type: 'date' },
    cur('Instalment Amount'),
    { name: 'Instalment Count Remaining', type: 'number' },
    { name: 'Financing Partner', type: 'text' },
    { name: 'Notes', type: 'long_text' },
  ];

  // 6. Erasure Requests
  const eraCols = [
    { name: 'Request Code', type: 'text', unique: true, required: true },
    L.refSpec('Customer', CUSTOMERS_ID, undefined, true),
    { name: 'Requested At', type: 'date', required: true },
    L.selectSpec('Reason', ['Customer Request','Account Closure','Legal Obligation','Regulator Order','Inactive Subject']),
    { name: 'Reason Details', type: 'long_text' },
    L.selectSpec('Status', ['Pending Review','Approved','In Progress','Completed','Rejected','Cancelled']),
    { name: 'Approved By', type: 'text' },
    { name: 'Approved At', type: 'date' },
    { name: 'Completed At', type: 'date' },
    { name: 'Rejection Reason', type: 'text' },
    { name: 'Retention Override', type: 'boolean' },
    { name: 'Retention Reason', type: 'text' },
    { name: 'Pseudonymization Log', type: 'long_text' },
    { name: 'Legal Basis', type: 'text' },
    { name: 'Notes', type: 'long_text' },
  ];

  // 7. Report Subscriptions
  const rsbCols = [
    { name: 'Report Code', type: 'text', unique: true, required: true },
    { name: 'Report Name', type: 'text', required: true },
    { name: 'Description', type: 'long_text' },
    L.selectSpec('Report Type', ['Revenue','Usage','CDR','Fraud','Commission','Inventory','Customer','MNP','Roaming']),
    { name: 'SQL Query', type: 'long_text' },
    L.selectSpec('Schedule', ['Daily','Weekly','Monthly','Quarterly','Ad-Hoc']),
    { name: 'Schedule Time', type: 'text' },
    { name: 'Recipients', type: 'long_text' },
    L.selectSpec('Format', ['CSV','XLSX','PDF','JSON']),
    { name: 'Last Run At', type: 'date' },
    { name: 'Next Run At', type: 'date' },
    L.selectSpec('Last Run Status', ['Success','Failed','Skipped','Running']),
    { name: 'Last Run Row Count', type: 'number' },
    { name: 'Filter JSON', type: 'long_text' },
    L.selectSpec('Status', ['Active','Paused','Disabled']),
    { name: 'Owner', type: 'text' },
  ];

  // ------------------------------------------------------------------
  // Push columns — 1.1s between bulk calls
  // ------------------------------------------------------------------
  console.log('\n3. Adding columns (1.1s between bulk calls)...');

  const runs = [
    ['Payments', paymentsCols],
    ['Quotes', quotesCols],
    ['Number Prefix Tariffs', nptCols],
    ['CPE Inventory', cpeCols],
    ['Erasure Requests', eraCols],
    ['Report Subscriptions', rsbCols],
  ];

  for (let i = 0; i < runs.length; i++) {
    const [key, cols] = runs[i];
    try {
      const { map, added } = await addColumnsIfNew(results[key].id, cols, key);
      results[key].colMap = map;
      results[key].colCount = Object.keys(map).length;
    } catch (e) {
      errors.push({ table: key, err: String(e).slice(0, 600) });
    }
    await L.sleep(BULK_SLEEP);
  }

  // ------------------------------------------------------------------
  // Quote Items — needs Quote ref resolved from newly created Quotes
  // ------------------------------------------------------------------
  console.log('\n4. Quote Items (cross-ref → Quotes)...');
  const quotesId = results['Quotes'].id;
  console.log(`   resolving Quotes ref → ${quotesId}`);
  const qiCols = [
    { name: 'Item Code', type: 'text' },
    L.refSpec('Quote', quotesId, undefined, true),
    L.refSpec('Tariff Plan', TARIFF_ID),
    { name: 'Quantity', type: 'number' },
    cur('Unit Price'),
    cur('Line Discount'),
    cur('Line Total'),
    { name: 'Notes', type: 'text' },
    { name: 'Sequence', type: 'number' },
  ];
  try {
    const { map } = await addColumnsIfNew(results['Quote Items'].id, qiCols, 'Quote Items');
    results['Quote Items'].colMap = map;
    results['Quote Items'].colCount = Object.keys(map).length;
  } catch (e) {
    errors.push({ table: 'Quote Items', err: String(e).slice(0, 600) });
  }

  // ------------------------------------------------------------------
  // Persist table ids
  // ------------------------------------------------------------------
  try {
    const current = L.loadTableIds();
    for (const key of Object.keys(results)) current[key] = results[key].id;
    L.saveTableIds(current);
  } catch (e) {
    console.warn('   (could not save table-ids.json:', e.message, ')');
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log('\n=== SUMMARY ===');
  for (const key of Object.keys(results)) {
    const r = results[key];
    console.log(`- ${key.padEnd(25)} ${r.id}  cat="${r.category}"  cols=${r.colCount}  ${r.existed ? '(pre-existing)' : '(new)'}`);
  }
  // cross-ref marker
  const qiQuoteColId = results['Quote Items'].colMap?.['Quote'];
  console.log(`\nCross-ref: Quote Items.Quote → Quotes(${quotesId}) colId=${qiQuoteColId || 'MISSING'}`);

  if (errors.length) {
    console.log('\n=== ERRORS ===');
    for (const e of errors) {
      console.log(`\n[${e.table}]`);
      console.log(e.err.split('\n').slice(0, 10).join('\n'));
    }
  } else {
    console.log('\nNo errors.');
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
