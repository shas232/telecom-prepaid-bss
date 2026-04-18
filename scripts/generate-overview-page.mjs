// Generate a static HTML overview page for the Telecom BSS app
// (ERD + schema + relationships + roles + views + reports + business flow),
// styled like the EnterpriseOne ERP reference.
//
// Output: custom-pages/telecom-overview.html

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

async function api(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE_URL + url, opts);
  return r.json();
}

// --- Table descriptions, categories, and grouping (curated) ---
const TABLE_META = {
  // Customer domain
  'Customers':                 { cat: 'master',      desc: 'Prepaid subscribers and corporate accounts — identity, contact, KYC, risk score.' },
  'Customer Identifications':  { cat: 'master',      desc: 'KYC documents and verification records linked to each customer.' },
  'Account Hierarchy':         { cat: 'master',      desc: 'Parent/child account structure for corporate and billing hierarchies.' },
  'Customer Lifecycle Events': { cat: 'transaction', desc: 'Log of activation, suspension, resumption, and churn events per subscription.' },
  'Customer Interactions':     { cat: 'transaction', desc: 'Inbound and outbound customer touchpoints across channels (IVR, app, store).' },
  'Cases':                     { cat: 'transaction', desc: 'Customer support tickets — classification, status, SLA, resolution.' },

  // Subscription + SIM + MSISDN
  'Subscriptions':             { cat: 'master',      desc: 'Active MSISDN → customer → plan bindings with status and dates.' },
  'Subscription Status History':{cat: 'transaction', desc: 'Historical log of every status transition on a subscription.' },
  'SIM Inventory':             { cat: 'master',      desc: 'ICCID inventory with SIM state, ordering partner, and allocation.' },
  'MSISDN Pool':               { cat: 'master',      desc: 'Number pool — reserved, assigned, quarantined, and released MSISDNs.' },

  // Catalog
  'Tariff Plans':              { cat: 'master',      desc: 'Prepaid plans: price, validity, allowances (data/voice/SMS), priority-on-charge.' },
  'Bundles':                   { cat: 'master',      desc: 'Add-on bundle definitions (booster packs, roaming, topups).' },
  'Bundle Components':         { cat: 'master',      desc: 'Line items that compose a bundle — unit, amount, validity.' },
  'Promotions':                { cat: 'master',      desc: 'Marketing campaigns: discounts, bonuses, eligibility rules, windows.' },
  'Business Rules':            { cat: 'master',      desc: 'Configurable priority/charging policy rules applied during rating.' },
  'Services':                  { cat: 'master',      desc: 'Catalog of service definitions (voice, SMS, data, roaming).' },

  // Balances / Wallet / Money
  'Balances':                  { cat: 'transaction', desc: 'Per-subscription service balances (data MB, voice min, SMS, bonus) with priority.' },
  'Wallets':                   { cat: 'master',      desc: 'Customer wallet holding monetary balance (separate from service balances).' },
  'Wallet Transactions':       { cat: 'transaction', desc: 'Debits/credits on wallets — recharge, rating deduction, refund, expiry.' },
  'Balance Transfers':         { cat: 'transaction', desc: 'Peer-to-peer balance gifting between subscribers.' },
  'Bonus Grants':              { cat: 'transaction', desc: 'Bonus balance awards from promotions, referrals, or manual adjustments.' },

  // Charging / CDR
  'Charging Sessions':         { cat: 'transaction', desc: 'Gy session — one per call/data session, tracks CCR-I → CCR-T lifecycle.' },
  'Usage Transactions':        { cat: 'transaction', desc: 'Per-event charging records (CCR-I, CCR-U, CCR-T, CCR-E) with rating group.' },
  'Call Detail Records':       { cat: 'transaction', desc: 'Settled CDRs with subscriber, termination cause, and amount charged.' },

  // Sales / Orders
  'Orders':                    { cat: 'transaction', desc: 'Customer orders — plans, bundles, SIMs, recharges, accessories.' },
  'Order Items':               { cat: 'master',      desc: 'Line items of each order (product, qty, price, discount).' },
  'Recharges':                 { cat: 'transaction', desc: 'Prepaid top-ups to the customer wallet — channel, amount, method.' },
  'Recharge Vouchers':         { cat: 'master',      desc: 'Scratch-card / voucher inventory — face value, serial, status.' },

  // Partner / Channel
  'Distribution Partners':     { cat: 'master',      desc: 'Reseller and distribution partner master (name, territory, commission rate).' },
  'Partner Contracts':         { cat: 'master',      desc: 'Contracts with partners — commission scheme, validity, revenue share.' },
  'Partner Commissions':       { cat: 'transaction', desc: 'Commission earned per recharge or activation by partner.' },
  'Channels':                  { cat: 'master',      desc: 'Sales/service channels — retail, USSD, self-care, B2B, IVR.' },

  // F&F / CUG / Promotions
  'Friends and Family Groups': { cat: 'master',      desc: 'F&F discount group definitions.' },
  'FF Members':                { cat: 'master',      desc: 'Members within a Friends & Family group.' },
  'Closed User Groups':        { cat: 'master',      desc: 'CUG (on-net intra-enterprise rated) group definitions.' },
  'CUG Members':               { cat: 'master',      desc: 'CUG membership — which subscriber belongs to which CUG.' },
  'Promotion Redemptions':     { cat: 'transaction', desc: 'Log of promotion claims by subscribers.' },

  // Notifications / Network
  'Notification Templates':    { cat: 'master',      desc: 'SMS / push / email template library — variables, language, channel.' },
  'Notifications Sent':        { cat: 'transaction', desc: 'Outbound notification log — template, recipient, status, timestamp.' },
  'Network Elements':          { cat: 'master',      desc: 'Telco network nodes (OCS, PCRF, PGW, SMSC, IN) registered with the app.' },
  'Users':                     { cat: 'master',      desc: 'Internal BSS users (operators, CSR, admin) with role assignments.' },
};

function typeLabel(c) {
  if (c.type === 'ref') return 'reference';
  if (c.type === 'formula') return 'formula';
  if (c.type === 'rollup') return 'rollup';
  if (c.type === 'number' && c.currency) return 'currency';
  if (c.type === 'boolean') return 'toggle';
  if (c.type === 'multi-select') return 'multi-select';
  if (c.type === 'auto_seq') return 'auto-seq';
  if (c.type === 'seq_format_id') return 'seq-fmt';
  return c.type;
}

// Columns that are auto or internal — hide from the doc
const SKIP_COL_NAMES = new Set(['Created At','Updated At','Created By','Updated By','Draft','Sequence Format ID']);
const SKIP_COL_TYPES = new Set(['seq_format_id','related_ref']);

// --- Fetch everything ---
async function fetchAll() {
  const out = [];
  const tNames = Object.keys(TABLE_IDS);
  // Reverse index tableId -> tableName
  const idToName = {};
  for (const [n, id] of Object.entries(TABLE_IDS)) idToName[id] = n;
  for (const tn of tNames) {
    const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tn]}`);
    const cols = r.columnsMetaData || [];
    out.push({ name: tn, id: TABLE_IDS[tn], cols });
    await sleep(120);
  }
  return { tables: out, idToName };
}

// --- ERD mermaid ---
// emit erDiagram with relationships ||--o{
function mermaidId(n) {
  return n.replace(/[^A-Za-z0-9]/g, '_');
}
function buildERD(tables, idToName) {
  const lines = ['erDiagram'];
  for (const t of tables) {
    for (const c of t.cols) {
      if (c.type !== 'ref') continue;
      const targetTableId = c.refTable?._id;
      const targetName = idToName[targetTableId];
      if (!targetName) continue;
      lines.push(`    ${mermaidId(targetName)} ||--o{ ${mermaidId(t.name)} : "${c.name}"`);
    }
  }
  return lines.join('\n');
}

// --- HTML builders ---
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderTable(t, idToName) {
  const meta = TABLE_META[t.name] || { cat: 'transaction', desc: '' };
  const visibleCols = t.cols.filter(c =>
    !SKIP_COL_NAMES.has(c.name) &&
    !SKIP_COL_TYPES.has(c.type)
  );
  const rows = visibleCols.map(c => {
    const req = c.required ? '<span class="req">*</span>' : '';
    const type = typeLabel(c);
    let details = '';
    if (c.type === 'ref') {
      const tgt = idToName[c.refTable?._id] || '—';
      details = `→ ${esc(tgt)}`;
    } else if (c.type === 'formula' || c.type === 'rollup') {
      const expr = c.formula?.expression || '';
      details = expr ? `<code>fx: ${esc(expr)}</code>` : '';
    } else if (c.type === 'select' || c.type === 'multi-select') {
      const opts = (c.options || []).map(o => o.value || o).slice(0, 6).join(', ');
      if (opts) details = `<span class="muted">${esc(opts)}${(c.options||[]).length > 6 ? '…' : ''}</span>`;
    }
    return `<tr><td>${esc(c.name)}${req}</td><td><code>${esc(type)}</code></td><td>${details}</td></tr>`;
  }).join('');
  return `
    <div class="table-block">
      <div class="table-header">
        <strong>${esc(t.name)}</strong>
        <span class="badge">${esc(meta.cat)}</span>
        <span class="col-count">${visibleCols.length} columns</span>
      </div>
      <div class="table-desc">${esc(meta.desc)}</div>
      <table>
        <thead><tr><th>Column</th><th>Type</th><th>Details</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildRelationshipsList(tables, idToName) {
  const rels = [];
  for (const t of tables) {
    for (const c of t.cols) {
      if (c.type !== 'ref') continue;
      const tn = idToName[c.refTable?._id];
      if (!tn) continue;
      rels.push({ from: t.name, to: tn, field: c.name });
    }
  }
  return rels.map(r =>
    `<li><strong>${esc(r.from)}</strong> ──→ <strong>${esc(r.to)}</strong> — ${esc(r.from)}.${esc(r.field)} references ${esc(r.to)}</li>`
  ).join('');
}

// --- Roles, views, reports (curated) ---
const ROLES = [
  { name: 'Admin', desc: 'Full access — all BSS modules, config, and ops.',
    perms: ['Full CRUD on all tables', 'Access to all dashboards and reports', 'Manage users, roles, and workflows'] },
  { name: 'CSR (Customer Service Rep)', desc: 'Front-line customer operations.',
    perms: ['Read all customer data', 'Create/close Cases & Interactions', 'Trigger manual recharges & balance adjustments', 'Lookup MSISDN / ICCID / wallet balance'] },
  { name: 'Billing Analyst', desc: 'Owns charging correctness, rating, and CDR integrity.',
    perms: ['Read all charging/rating/CDR tables', 'Manage Tariff Plans, Bundles, Business Rules', 'Trigger re-rating and reconciliation workflows'] },
  { name: 'Partner Manager', desc: 'Distributor, retailer, and channel operations.',
    perms: ['Manage Distribution Partners, Contracts, Commissions', 'View recharge volume per partner', 'Approve/adjust commission payouts'] },
  { name: 'Network Ops', desc: 'Monitors Gy/Ro integration and session health.',
    perms: ['Read Charging Sessions, Usage Transactions, Network Elements', 'Read Notifications Sent', 'Replay / retry stuck sessions'] },
  { name: 'Marketing', desc: 'Owns promotions, bundles, bonus campaigns.',
    perms: ['Manage Promotions, Bundles, Bundle Components', 'Manage Notification Templates', 'View redemption and conversion reports'] },
  { name: 'Retail Partner', desc: 'External retailer operating through the partner portal.',
    perms: ['Sell SIMs, recharges, plan activations', 'View own commission ledger', 'No access to other partners\u2019 data'] },
  { name: 'Self-Care Subscriber', desc: 'End subscriber logged in through the self-care portal.',
    perms: ['View own subscription, balances, plan, recharge history', 'Submit own Cases', 'Initiate own recharges / balance transfers'] },
];

const VIEWS = [
  { name: 'All Active Subscribers', table: 'Subscriptions', filter: 'Status = active', roles: 'CSR, Billing, Admin',
    cols: ['MSISDN','Customer Name','Current Plan','Plan Price','Activation Date','Status'] },
  { name: 'Low Balance Subscribers', table: 'Balances', filter: 'Remaining Amount < 10% × Initial Amount',
    roles: 'CSR, Marketing', cols: ['MSISDN','Plan Name','Initial Amount','Used Amount','Remaining Amount'] },
  { name: 'Expiring Plans (7 days)', table: 'Subscriptions', filter: 'Validity End ≤ today + 7d',
    roles: 'CSR, Marketing', cols: ['MSISDN','Current Plan','Validity End','Plan Price'] },
  { name: 'Open Cases', table: 'Cases', filter: 'Status in (new, in_progress)',
    roles: 'CSR, Admin', cols: ['Case ID','Customer Name','Category','Priority','Opened At','Status'] },
  { name: 'Today\'s Recharges', table: 'Recharges', filter: 'Recharge Date = today',
    roles: 'Partner Manager, Billing', cols: ['Recharge Code','Wallet Code','Amount','Channel','Partner','Status'] },
  { name: 'High-Value Customers', table: 'Customers', filter: 'Lifetime Recharge > 5,000',
    roles: 'Marketing, Partner Manager', cols: ['Name','Phone','Subscription Count','Lifetime Recharge','Recharge Count'] },
  { name: 'Stuck Charging Sessions', table: 'Charging Sessions', filter: 'Status = in_progress AND Start Time < now − 24h',
    roles: 'Network Ops', cols: ['Session ID','MSISDN','Service','Start Time','UT Count'] },
  { name: 'Partner Commission Ledger', table: 'Partner Commissions', filter: 'grouped by Partner',
    roles: 'Partner Manager, Admin', cols: ['Partner','Recharge','Recharge Amount','Commission Amount','Status'] },
  { name: 'Voucher Inventory', table: 'Recharge Vouchers', filter: 'Status = available',
    roles: 'Partner Manager, Admin', cols: ['Voucher Code','Face Value','Batch','Status','Expiry'] },
  { name: 'CDR Review', table: 'Call Detail Records', filter: 'CDR Date = yesterday',
    roles: 'Billing', cols: ['CDR ID','MSISDN','Plan Name','Service','Amount','Termination Cause'] },
];

const REPORTS = [
  { name: 'Prepaid Balance Dashboard', type: 'hierarchical', desc: 'Live totals: active subs, wallet balance, service balances by plan, rating-group usage, top-up velocity.' },
  { name: 'CDR Settlement Report', type: 'flat', desc: 'Daily CDRs with service breakdown, hourly volume, termination cause mix, CSV export for reconciliation.' },
  { name: 'Usage Patterns Heatmap', type: 'hierarchical', desc: '7×24 day-of-week × hour heatmap — events, data MB, voice minutes, SMS count.' },
  { name: 'Customer 360', type: 'hierarchical', desc: 'Full subscriber view — KYC, subscriptions, balances, wallet, cases, interactions, lifecycle.' },
  { name: 'Partner Commission Summary', type: 'flat', desc: 'Commission earned per partner, period, channel — paid vs pending, recharge-volume driven.' },
  { name: 'Promotion Effectiveness', type: 'flat', desc: 'Redemption count × revenue lift × incremental ARPU per promotion.' },
  { name: 'Churn Risk Report', type: 'hierarchical', desc: 'Subscribers with falling usage, low balance, expiring plans — churn probability bucket.' },
];

// --- Main ---
async function main() {
  console.log('Fetching schema from ERPAI...');
  const { tables, idToName } = await fetchAll();
  console.log(`  ${tables.length} tables loaded`);

  // Group tables by domain for readability
  const GROUPS = {
    'Customer': ['Customers','Customer Identifications','Account Hierarchy','Customer Lifecycle Events','Customer Interactions','Cases'],
    'Subscription & SIM': ['Subscriptions','Subscription Status History','SIM Inventory','MSISDN Pool'],
    'Catalog': ['Tariff Plans','Bundles','Bundle Components','Promotions','Business Rules','Services'],
    'Balances & Wallet': ['Balances','Wallets','Wallet Transactions','Balance Transfers','Bonus Grants'],
    'Charging & CDR': ['Charging Sessions','Usage Transactions','Call Detail Records'],
    'Sales & Orders': ['Orders','Order Items','Recharges','Recharge Vouchers'],
    'Partner & Channel': ['Distribution Partners','Partner Contracts','Partner Commissions','Channels'],
    'F&F / CUG / Promotions': ['Friends and Family Groups','FF Members','Closed User Groups','CUG Members','Promotion Redemptions'],
    'Notifications & Network': ['Notification Templates','Notifications Sent','Network Elements','Users'],
  };

  // order tables within each group as listed; any unclassified go at the end
  const byName = Object.fromEntries(tables.map(t => [t.name, t]));
  const ordered = [];
  const seen = new Set();
  const groupBlocks = [];
  for (const [gname, tnames] of Object.entries(GROUPS)) {
    const members = tnames.map(n => byName[n]).filter(Boolean);
    for (const m of members) { seen.add(m.name); ordered.push(m); }
    groupBlocks.push({ gname, members });
  }
  const unclassified = tables.filter(t => !seen.has(t.name));
  if (unclassified.length) groupBlocks.push({ gname: 'Other', members: unclassified });

  // Build the tables HTML, grouped
  const tableSections = groupBlocks.map(({gname, members}) => {
    if (!members.length) return '';
    const blocks = members.map(t => renderTable(t, idToName)).join('\n');
    return `<h3 class="group-header">${esc(gname)} <span class="count">${members.length}</span></h3>\n${blocks}`;
  }).join('\n');

  const erd = buildERD(tables, idToName);
  const relList = buildRelationshipsList(tables, idToName);
  const totalCols = tables.reduce((s, t) => s + t.cols.filter(c => !SKIP_COL_NAMES.has(c.name) && !SKIP_COL_TYPES.has(c.type)).length, 0);
  const totalRels = tables.reduce((s, t) => s + t.cols.filter(c => c.type === 'ref').length, 0);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Telecom BSS — Prepaid Billing System</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>document.addEventListener('DOMContentLoaded',()=>mermaid.init(undefined,'.mermaid'))</script>
<style>
  :root{--bg:#fff;--fg:#111;--muted:#666;--border:#e5e5e5;--accent:#2563eb;--badge-bg:#f3f4f6;--card-bg:#fafafa}
  @media(prefers-color-scheme:dark){:root{--bg:#0a0a0a;--fg:#e5e5e5;--muted:#999;--border:#333;--accent:#60a5fa;--badge-bg:#1e1e1e;--card-bg:#141414}}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--fg);line-height:1.6;max-width:none;margin:0;padding:32px 48px}
  @media(min-width:1600px){body{padding:32px 80px}}
  @media(max-width:700px){body{padding:24px 16px}}
  h1{font-size:28px;font-weight:700;margin-bottom:4px}
  .subtitle{color:var(--muted);font-size:14px;margin-bottom:32px}
  h2{font-size:18px;font-weight:700;margin:36px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
  h3.group-header{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:20px 0 10px}
  h3{font-size:14px;font-weight:600;margin-bottom:4px}
  .count{font-size:11px;font-weight:500;background:var(--badge-bg);color:var(--muted);padding:2px 8px;border-radius:99px}
  .badge{display:inline-block;font-size:10px;font-weight:500;background:var(--badge-bg);color:var(--muted);padding:2px 8px;border-radius:4px;margin-right:4px}
  .badge.ro{background:#fef3c7;color:#92400e}
  .req{color:#ef4444;margin-left:2px}
  .muted{color:var(--muted);font-size:11px}
  .table-block{border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:12px}
  .table-header{padding:8px 12px;background:var(--card-bg);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:13px}
  .table-desc{padding:6px 12px;font-size:11px;color:var(--muted);border-bottom:1px solid var(--border)}
  .col-count{margin-left:auto;font-size:10px;color:var(--muted)}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;padding:6px 12px;font-weight:500;color:var(--muted);border-bottom:1px solid var(--border);background:var(--card-bg)}
  td{padding:5px 12px;border-bottom:1px solid var(--border);vertical-align:top}
  tr:last-child td{border-bottom:none}
  code{font-size:11px;background:var(--badge-bg);padding:1px 5px;border-radius:3px;font-family:'SF Mono',Consolas,monospace}
  .card{border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px}
  .card p{font-size:12px;color:var(--muted);margin:4px 0}
  .perms{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
  ul{padding-left:20px;font-size:13px}
  li{margin-bottom:6px}
  .prose{font-size:13px;color:var(--fg)}
  .prose p{margin-bottom:8px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
  .kpi{border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--card-bg)}
  .kpi .k{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  .kpi .v{font-size:22px;font-weight:700;margin-top:4px}
  .footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);text-align:center}
  .mermaid{background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:16px;overflow-x:auto;font-size:11px}
  @media print{body{max-width:100%;padding:20px}h2{break-after:avoid}.table-block{break-inside:avoid}.card{break-inside:avoid}@page{margin:1.5cm}}
</style>
</head>
<body>
  <h1>Telecom BSS — Prepaid Billing System</h1>
  <div class="subtitle">Real-time charging, rating, wallet, catalog, partner &amp; customer operations</div>

  <div class="kpis">
    <div class="kpi"><div class="k">Tables</div><div class="v">${tables.length}</div></div>
    <div class="kpi"><div class="k">Columns</div><div class="v">${totalCols}</div></div>
    <div class="kpi"><div class="k">Relationships</div><div class="v">${totalRels}</div></div>
    <div class="kpi"><div class="k">Roles</div><div class="v">${ROLES.length}</div></div>
  </div>

  <section>
    <h2>Business Overview</h2>
    <div class="prose">
      <p>A prepaid telecom <strong>Business Support System (BSS)</strong> delivering end-to-end operations for a mobile operator: customer &amp; subscription lifecycle, SIM and MSISDN management, tariff-plan catalog with bundles and booster stacking, a monetary wallet alongside multi-balance service buckets (data / voice / SMS / bonus), real-time Diameter Gy/Ro online charging with priority-based balance depletion, CDR generation, partner &amp; channel distribution with commissioning, and a full customer-service surface (cases, interactions, notifications).</p>
      <p>The model captures every artefact touched during the prepaid charging flow — CCR-I initiations, incremental CCR-U reauthorizations, CCR-T terminations, and exception CCR-E events — flowing through <code>Charging Sessions</code> &rarr; <code>Usage Transactions</code> &rarr; <code>Call Detail Records</code>, with rollup totals on subscriptions and balance buckets.</p>
    </div>
  </section>

  <section>
    <h2>Entity Relationship Diagram</h2>
    <div class="mermaid">${erd}</div>
  </section>

  <section>
    <h2>Tables <span class="count">${tables.length}</span></h2>
    ${tableSections}
  </section>

  <section>
    <h2>Relationships <span class="count">${totalRels}</span></h2>
    <ul>${relList}</ul>
  </section>

  <section>
    <h2>Roles &amp; Permissions <span class="count">${ROLES.length}</span></h2>
    ${ROLES.map(r => `
    <div class="card">
      <h3>${esc(r.name)}</h3>
      <p>${esc(r.desc)}</p>
      <div class="perms">${r.perms.map(p => `<span class="badge">${esc(p)}</span>`).join('')}</div>
    </div>`).join('')}
  </section>

  <section>
    <h2>Views <span class="count">${VIEWS.length}</span></h2>
    ${VIEWS.map(v => `
    <div class="card">
      <h3>${esc(v.name)} <span class="badge">${esc(v.table)}</span></h3>
      <p><strong>Filter:</strong> ${esc(v.filter)}</p>
      <p><strong>Roles:</strong> ${esc(v.roles)}</p>
      <div class="perms">${v.cols.map(c => `<span class="badge">${esc(c)}</span>`).join('')}</div>
    </div>`).join('')}
  </section>

  <section>
    <h2>Reports &amp; Analytics <span class="count">${REPORTS.length}</span></h2>
    <ul>${REPORTS.map(r => `<li><strong>${esc(r.name)}</strong> <span class="badge">${esc(r.type)}</span> — ${esc(r.desc)}</li>`).join('')}</ul>
  </section>

  <section>
    <h2>Business Process Flow</h2>
    <div class="prose">
      <ol>
        <li><strong>Customer Onboarding</strong>
          <ul>
            <li>Agent or self-care captures identity; record created in <code>Customers</code> with <code>Customer Identifications</code> for KYC.</li>
            <li>MSISDN pulled from <code>MSISDN Pool</code>; SIM allocated from <code>SIM Inventory</code>; <code>Subscriptions</code> row created and activated.</li>
            <li><code>Customer Lifecycle Events</code> log records the activation; welcome SMS sent via <code>Notifications Sent</code>.</li>
          </ul>
        </li>
        <li><strong>Plan Selection &amp; Provisioning</strong>
          <ul>
            <li>Customer picks a <code>Tariff Plan</code>; an <code>Order</code> with <code>Order Items</code> is created.</li>
            <li>Wallet is debited via <code>Wallet Transactions</code>; service buckets are seeded in <code>Balances</code> (data / voice / SMS / bonus) with priority-on-charge.</li>
            <li>Optional <code>Bundles</code> / boosters stack additional buckets on top of the base plan.</li>
          </ul>
        </li>
        <li><strong>Recharge Flow</strong>
          <ul>
            <li>Voucher from <code>Recharge Vouchers</code>, or partner POS via <code>Distribution Partners</code>, creates a <code>Recharges</code> row.</li>
            <li>Wallet credited (<code>Wallet Transactions</code>); commission row inserted in <code>Partner Commissions</code> according to <code>Partner Contracts</code>.</li>
          </ul>
        </li>
        <li><strong>Real-time Charging (Gy)</strong>
          <ul>
            <li>Network element (PGW / MSC / SMSC) opens a <code>Charging Sessions</code> row with CCR-I.</li>
            <li>Per event, a <code>Usage Transactions</code> row records Requested / Granted / Used Service-Unit, with the rating-group determined by <code>Services</code>.</li>
            <li>Rating engine applies <code>Business Rules</code> and depletes <code>Balances</code> in priority order; bonus buckets deplete before paid ones.</li>
            <li>Session ends on CCR-T; <code>Call Detail Records</code> settlement row is written.</li>
          </ul>
        </li>
        <li><strong>Promotions &amp; Loyalty</strong>
          <ul>
            <li>Eligibility engine checks <code>Promotions</code>; on hit a <code>Promotion Redemptions</code> row and a <code>Bonus Grants</code> balance entry are created.</li>
            <li><code>Friends and Family Groups</code> / <code>Closed User Groups</code> redirect rating to discounted tariffs for on-net on-group calls.</li>
          </ul>
        </li>
        <li><strong>Customer Care</strong>
          <ul>
            <li>All inbound touchpoints land in <code>Customer Interactions</code>; escalations create <code>Cases</code> with SLA + status.</li>
            <li>CSR can adjust <code>Balances</code>, issue <code>Bonus Grants</code>, or trigger <code>Balance Transfers</code> between subscribers.</li>
          </ul>
        </li>
        <li><strong>Expiry &amp; Churn</strong>
          <ul>
            <li>Daily sweep suspends <code>Subscriptions</code> whose validity has expired; status transition logged in <code>Subscription Status History</code>.</li>
            <li>Low-balance / expiring-plan notifications trigger retention promos.</li>
          </ul>
        </li>
        <li><strong>Partner &amp; Channel Ops</strong>
          <ul>
            <li><code>Channels</code> (retail, USSD, self-care, B2B) route orders and recharges to the right partner.</li>
            <li><code>Partner Commissions</code> ledger is settled on cadence defined in <code>Partner Contracts</code>.</li>
          </ul>
        </li>
        <li><strong>Automation</strong>
          <ul>
            <li>Workflows: welcome notification on activation, low-balance alert, plan-expiry reminder, plan-purchase confirmation, daily CDR summary.</li>
            <li>Rollups refresh in near-realtime: Used / Remaining Amount per balance, Lifetime Recharge per customer, Active Subscribers per plan.</li>
          </ul>
        </li>
      </ol>
    </div>
  </section>

  <div class="footer">Generated on ${new Date().toISOString().slice(0, 10)} · ${tables.length} tables · ${totalCols} columns · ${totalRels} relationships</div>
</body>
</html>
`;

  const outPath = path.join(ROOT, 'custom-pages', 'telecom-overview.html');
  fs.writeFileSync(outPath, html);
  console.log(`Wrote ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
