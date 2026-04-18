// Seeds all supporting tables (Promotions, KYC, Recharges, Wallet Transactions,
// CDRs, Orders, Cases, Notifications Sent, Business Rules, F&F groups, CUGs,
// MSISDN Pool, SIM Inventory, Bundles, Customer Interactions, Partner Contracts,
// Account Hierarchy, Customer Lifecycle Events, Balance Transfers, Bonus Grants,
// Subscription Status History, Partner Commissions).
//
// Usage: node seed-supporting.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const APP_ID = 'afe8c4540708da6ca9e6fe79';

const TABLE_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.table-ids.json'), 'utf8'));
const SEED_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.seed-ids.json'), 'utf8'));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const colMapCache = new Map();
const recordCache = new Map();
const rnd = (min, max) => min + Math.random()*(max-min);
const rndInt = (min, max) => Math.floor(rnd(min, max+1));
const pick = (arr) => arr[rndInt(0, arr.length-1)];
const iso = (date) => new Date(date).toISOString();

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

async function getColMap(tableName) {
  if (colMapCache.has(tableName)) return colMapCache.get(tableName);
  const tid = TABLE_IDS[tableName];
  const resp = await api('GET', `/v1/app-builder/table/${tid}`);
  const cols = resp.columnsMetaData || resp.data?.columnsMetaData || [];
  const map = {};
  for (const c of cols) map[c.name] = c.id;
  colMapCache.set(tableName, map);
  return map;
}

async function insert(tableName, cellsByName) {
  const tid = TABLE_IDS[tableName];
  const map = await getColMap(tableName);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) {
    if (map[k]) cellsById[map[k]] = v;
    else console.warn(`  ! ${tableName}: unknown column "${k}"`);
  }
  const resp = await api('POST', `/v1/app-builder/table/${tid}/record`, { cells: cellsById });
  const rid = resp?.data?.[0]?._id || resp?.data?._id || resp?._id;
  if (!rid) console.error(`  ✗ ${tableName}:`, JSON.stringify(resp).slice(0,200));
  await sleep(1100);
  return rid;
}

async function fetchAll(tableName) {
  if (recordCache.has(tableName)) return recordCache.get(tableName);
  const tid = TABLE_IDS[tableName];
  const all = [];
  let page = 1;
  while (true) {
    const resp = await api('POST', `/v1/app-builder/table/${tid}/paged-record?pageNo=${page}&pageSize=200`, {});
    const batch = resp?.data || [];
    all.push(...batch);
    if (batch.length < 200) break;
    page++;
    await sleep(800);
  }
  recordCache.set(tableName, all);
  return all;
}

const log = (msg) => process.stdout.write(msg + '\n');

// =============================================================================

async function main() {
  log('Loading existing records...');
  const [customers, subs, wallets, spas, tariffs, vouchers, partners, channels, templates, balances, sessions] = await Promise.all([
    fetchAll('Customers'),
    fetchAll('Subscriptions'),
    fetchAll('Wallets'),
    fetchAll('Subscription Plan Assignments'),
    fetchAll('Tariff Plans'),
    fetchAll('Recharge Vouchers'),
    fetchAll('Distribution Partners'),
    fetchAll('Channels'),
    fetchAll('Notification Templates'),
    fetchAll('Balances'),
    fetchAll('Charging Sessions'),
  ]);
  log(`  ${customers.length} customers, ${subs.length} subs, ${wallets.length} wallets, ${spas.length} SPAs, ${sessions.length} sessions`);

  // Helper: column ID maps
  const mCust = await getColMap('Customers');
  const mSub = await getColMap('Subscriptions');
  const mWallet = await getColMap('Wallets');
  const mSpa = await getColMap('Subscription Plan Assignments');
  const mBalance = await getColMap('Balances');
  const mTariff = await getColMap('Tariff Plans');
  const mVoucher = await getColMap('Recharge Vouchers');
  const mPartner = await getColMap('Distribution Partners');
  const mChannel = await getColMap('Channels');
  const mSession = await getColMap('Charging Sessions');

  // Index helpers
  const walletsByCust = new Map();
  wallets.forEach(w => {
    const cid = w.cells[mWallet['Customer']]?.[0];
    if (cid) walletsByCust.set(cid, w);
  });
  const subsByCust = new Map();
  subs.forEach(s => {
    const cid = s.cells[mSub['Customer']]?.[0];
    if (!subsByCust.has(cid)) subsByCust.set(cid, []);
    subsByCust.get(cid).push(s);
  });
  const balancesBySub = new Map();
  balances.forEach(b => {
    const sid = b.cells[mBalance['Subscription']]?.[0];
    if (!balancesBySub.has(sid)) balancesBySub.set(sid, []);
    balancesBySub.get(sid).push(b);
  });

  // ===========================================================================
  // CUSTOMER IDENTIFICATIONS (KYC — 1 per customer)
  // ===========================================================================
  log('=== Customer Identifications (20) ===');
  const ID_TYPES = [1, 2, 5]; // Passport, National ID, Aadhaar
  const AUTHORITIES = ['Govt. of India — UIDAI', 'Dept. of State — Passport Office', 'Ministry of External Affairs'];
  for (let i=0; i<customers.length; i++) {
    const cid = customers[i]._id;
    const idType = pick(ID_TYPES);
    const idNum = idType === 5 ? `XXXX-XXXX-${String(rndInt(1000,9999))}` : `P${String(rndInt(1000000,9999999))}`;
    await insert('Customer Identifications', {
      'Customer': [cid],
      'ID Type': [idType],
      'ID Number': idNum,
      'Issuing Authority': pick(AUTHORITIES),
      'Issue Date': '2021-03-15',
      'Expiry Date': '2031-03-14',
      'Verified': true,
      'Verification Date': '2024-04-20',
      'Notes': 'KYC verified via e-KYC portal',
    });
  }

  // ===========================================================================
  // CUSTOMER LIFECYCLE EVENTS (1 activation per customer)
  // ===========================================================================
  log('=== Customer Lifecycle Events (20) ===');
  for (const c of customers) {
    await insert('Customer Lifecycle Events', {
      'Customer': [c._id],
      'Event Type': [1], // Activated
      'Event Date': c.cells[mCust['Onboarded Date']] ? new Date(c.cells[mCust['Onboarded Date']]).toISOString() : '2024-01-15T00:00:00.000Z',
      'Reason': 'Initial account activation',
      'Triggered By': [1], // System
      'Previous Status': 'New',
      'New Status': 'Active',
    });
  }

  // ===========================================================================
  // ACCOUNT HIERARCHY (3 family relationships)
  // ===========================================================================
  log('=== Account Hierarchy (3 family links) ===');
  for (let i=0; i<3 && i*2+1 < customers.length; i++) {
    await insert('Account Hierarchy', {
      'Parent Customer': [customers[i*2]._id],
      'Child Customer': [customers[i*2+1]._id],
      'Relationship Type': [1], // Family Head
      'Billing Responsibility': [1], // Parent Pays
      'Effective From': '2024-02-01',
    });
  }

  // ===========================================================================
  // SUBSCRIPTION STATUS HISTORY (activation entry per sub)
  // ===========================================================================
  log('=== Subscription Status History (27) ===');
  for (const s of subs) {
    await insert('Subscription Status History', {
      'Subscription': [s._id],
      'From Status': 'Inactive',
      'To Status': 'Active',
      'Changed At': s.cells[mSub['Activation Date']] ? new Date(s.cells[mSub['Activation Date']]).toISOString() : '2024-06-01T00:00:00.000Z',
      'Reason': 'SIM activated by customer',
      'Changed By': 'system',
    });
  }

  // ===========================================================================
  // MSISDN POOL (20 available numbers in reserve)
  // ===========================================================================
  log('=== MSISDN Pool (20) ===');
  for (let i=1; i<=20; i++) {
    const msisdn = '9198700' + String(i).padStart(5, '0');
    const tier = i <= 3 ? 4 : (i <= 8 ? 2 : 1); // Vanity / Gold / Standard
    await insert('MSISDN Pool', {
      'MSISDN': msisdn,
      'Status': [1], // Available
      'Tier': [tier],
    });
  }

  // ===========================================================================
  // SIM INVENTORY (30 total: 27 activated + 3 in stock)
  // ===========================================================================
  log('=== SIM Inventory (10) ===');
  for (let i=1; i<=10; i++) {
    const iccid = '8991011' + String(i).padStart(11, '0');
    const imsi = '40467' + String(i).padStart(10, '0');
    await insert('SIM Inventory', {
      'ICCID': iccid,
      'IMSI': imsi,
      'Batch ID': 'BATCH-SIM-001',
      'Vendor': 'Gemalto',
      'Status': [1], // In Stock
      'Warehouse Location': 'Mumbai Central DC',
    });
  }

  // ===========================================================================
  // BUNDLES (2 combo offerings)
  // ===========================================================================
  log('=== Bundles (2) ===');
  const bnd1 = await insert('Bundles', {
    'Bundle Code': 'BND-WELCOME',
    'Bundle Name': 'Welcome Pack',
    'Bundle Price': 10,
    'Discount vs Components': 5,
    'Validity Days': 30,
    'Status': [2],
  });
  const bnd2 = await insert('Bundles', {
    'Bundle Code': 'BND-SUMMER',
    'Bundle Name': 'Summer Bonus',
    'Bundle Price': 25,
    'Discount vs Components': 8,
    'Validity Days': 30,
    'Status': [2],
  });
  // Bundle Components
  log('=== Bundle Components (4) ===');
  const offerings = await fetchAll('Product Offerings');
  if (bnd1 && offerings[0]) {
    await insert('Bundle Components', { 'Bundle':[bnd1], 'Offering':[offerings[0]._id], 'Quantity':1, 'Sequence':1 });
    if (offerings[1]) await insert('Bundle Components', { 'Bundle':[bnd1], 'Offering':[offerings[1]._id], 'Quantity':1, 'Sequence':2 });
  }
  if (bnd2 && offerings[1]) {
    await insert('Bundle Components', { 'Bundle':[bnd2], 'Offering':[offerings[1]._id], 'Quantity':1, 'Sequence':1 });
    if (offerings[2]) await insert('Bundle Components', { 'Bundle':[bnd2], 'Offering':[offerings[2]._id], 'Quantity':1, 'Sequence':2 });
  }

  // ===========================================================================
  // PROMOTIONS (3 offers)
  // ===========================================================================
  log('=== Promotions (3) ===');
  const promo1 = await insert('Promotions', {
    'Promotion Code': 'PROMO-DATAX2',
    'Promotion Name': 'Double Data Weekend',
    'Type': [3], // Bonus Allowance
    'Eligibility Rules': 'All Ultimate 10GB Pack customers',
    'Start Date': '2026-04-10',
    'End Date': '2026-04-17',
    'Max Redemptions Per Customer': 1,
    'Total Budget': 2000,
    'Budget Consumed': 450,
    'Status': [2], // Active
  });
  const promo2 = await insert('Promotions', {
    'Promotion Code': 'PROMO-REFER50',
    'Promotion Name': 'Refer & Earn $5',
    'Type': [5], // Cashback
    'Eligibility Rules': 'Refer a new customer who recharges 10+',
    'Start Date': '2026-01-01',
    'End Date': '2026-12-31',
    'Max Redemptions Per Customer': 5,
    'Total Budget': 5000,
    'Budget Consumed': 125,
    'Status': [2],
  });
  const promo3 = await insert('Promotions', {
    'Promotion Code': 'PROMO-WELCOME',
    'Promotion Name': 'New User Welcome 2GB',
    'Type': [3],
    'Eligibility Rules': 'First-time activations in first 7 days',
    'Start Date': '2026-01-01',
    'End Date': '2026-12-31',
    'Max Redemptions Per Customer': 1,
    'Total Budget': 10000,
    'Budget Consumed': 820,
    'Status': [2],
  });

  // ===========================================================================
  // PROMOTION REDEMPTIONS (6 redemptions across customers)
  // ===========================================================================
  log('=== Promotion Redemptions (6) ===');
  const promos = [promo1, promo2, promo3].filter(Boolean);
  for (let i=0; i<6; i++) {
    const c = customers[i % customers.length];
    const promo = pick(promos);
    const sub = subsByCust.get(c._id)?.[0];
    await insert('Promotion Redemptions', {
      'Promotion': [promo],
      'Customer': [c._id],
      'Subscription': sub ? [sub._id] : undefined,
      'Redeemed At': new Date(Date.now() - rndInt(0, 10*86400000)).toISOString(),
      'Value Granted': pick([100, 500, 1024, 5]),
      'Reference Transaction': `REF-${rndInt(10000,99999)}`,
      'Expiry Date': '2026-05-30',
      'Notes': 'Auto-applied promo',
    });
  }

  // ===========================================================================
  // BONUS GRANTS (5 ad-hoc bonuses)
  // ===========================================================================
  log('=== Bonus Grants (5) ===');
  const reasons = [[1,'Loyalty'],[2,'Compensation'],[3,'Promo'],[4,'Referral'],[5,'Win Back']];
  for (let i=0; i<5; i++) {
    const sub = subs[i];
    const r = pick(reasons);
    await insert('Bonus Grants', {
      'Subscription': [sub._id],
      'Bonus Code': `BNS-${String(i+1).padStart(4,'0')}`,
      'Rating Group': 10,
      'Unit Type': [1],
      'Amount': pick([500, 1024, 2048]),
      'Validity Days': 30,
      'Granted Reason': [r[0]],
      'Granted By': 'csr.agent@op.com',
      'Granted Date': new Date(Date.now() - rndInt(0, 30*86400000)).toISOString(),
      'Expiry Date': new Date(Date.now() + 30*86400000).toISOString(),
      'Consumed Amount': 0,
    });
  }

  // ===========================================================================
  // PARTNER CONTRACTS (1 per partner)
  // ===========================================================================
  log('=== Partner Contracts (3) ===');
  for (let i=0; i<partners.length; i++) {
    await insert('Partner Contracts', {
      'Partner': [partners[i]._id],
      'Contract Number': `CTR-${String(i+1).padStart(4,'0')}`,
      'Effective From': '2024-01-15',
      'Effective To': '2027-01-14',
      'Commission Structure': '3% of recharge value, tiered: 4% above $10k/month',
      'SLA Targets': '99.5% uptime; <2s recharge processing; support response <4h',
      'Termination Clauses': '90-day notice; fraud = immediate termination',
      'Status': [2], // Active
    });
  }

  // ===========================================================================
  // RECHARGES (12 — one for each of 12 customers, with wallet txns)
  // ===========================================================================
  log('=== Recharges + Wallet Transactions (12) ===');
  const CHANNELS_IDX = [[1,'Voucher'],[2,'USSD'],[3,'App'],[4,'Retail POS'],[6,'Online']];
  for (let i=0; i<12; i++) {
    const c = customers[i];
    const w = walletsByCust.get(c._id);
    if (!w) continue;
    const amt = pick([5, 10, 20]);
    const ch = pick(CHANNELS_IDX);
    const partner = pick(partners);
    const vcher = vouchers.filter(v => Number(v.cells[mVoucher['Denomination']]) === amt && String(v.cells[mVoucher['Status']])==='2')[0];
    const ts = new Date(Date.now() - rndInt(0, 20*86400000)).toISOString();
    const rech = await insert('Recharges', {
      'Wallet': [w._id],
      'Distribution Partner': [partner._id],
      'Recharge Code': `RCG-${String(i+1).padStart(6,'0')}`,
      'Amount': amt,
      'Currency': [1],
      'Channel': [ch[0]],
      'Voucher Serial': vcher ? vcher.cells[mVoucher['Voucher Serial']] : '',
      'Gateway Reference': `GW-${rndInt(1000000,9999999)}`,
      'Status': [2], // Successful
      'Timestamp': ts,
      'Tax Amount': +(amt * 0.18).toFixed(2),
      'Net Amount': +(amt * 0.82).toFixed(2),
    });

    // Matching wallet transaction
    await insert('Wallet Transactions', {
      'Wallet': [w._id],
      'Transaction Code': `WTX-R-${String(i+1).padStart(6,'0')}`,
      'Transaction Type': [1], // Recharge
      'Amount': amt,
      'Balance Before': rndInt(5, 30),
      'Balance After': rndInt(30, 100),
      'Reference ID': rech || '',
      'Reference Type': [1],
      'Timestamp': ts,
      'Initiated By': 'customer',
      'Notes': `Recharge via ${ch[1]}`,
    });
  }

  // ===========================================================================
  // WALLET TRANSACTIONS (plan purchase debits — 1 per customer)
  // ===========================================================================
  log('=== Wallet Transactions (plan purchase, 20) ===');
  for (let i=0; i<customers.length; i++) {
    const c = customers[i];
    const w = walletsByCust.get(c._id);
    if (!w) continue;
    const price = pick([5, 15, 30]);
    await insert('Wallet Transactions', {
      'Wallet': [w._id],
      'Transaction Code': `WTX-P-${String(i+1).padStart(6,'0')}`,
      'Transaction Type': [2], // Plan Purchase
      'Amount': -price,
      'Balance Before': rndInt(30, 100),
      'Balance After': rndInt(15, 70),
      'Reference Type': [2],
      'Timestamp': '2026-04-01T00:00:00.000Z',
      'Initiated By': 'customer',
      'Notes': 'Plan activation — debit',
    });
  }

  // ===========================================================================
  // PARTNER COMMISSIONS (one per recharge — 12)
  // ===========================================================================
  log('=== Partner Commissions (12) ===');
  const recharges = await fetchAll('Recharges');
  const mRech = await getColMap('Recharges');
  for (let i=0; i<recharges.length; i++) {
    const r = recharges[i];
    const partnerId = r.cells[mRech['Distribution Partner']]?.[0];
    if (!partnerId) continue;
    const base = Number(r.cells[mRech['Amount']]) || 0;
    const commission = +(base * 0.03).toFixed(2);
    await insert('Partner Commissions', {
      'Partner': [partnerId],
      'Recharge': [r._id],
      'Commission Type': [1],
      'Base Amount': base,
      'Commission Amount': commission,
      'Accrued Date': r.cells[mRech['Timestamp']] ? new Date(r.cells[mRech['Timestamp']]).toISOString() : iso(Date.now()),
      'Status': i < 6 ? [3] : [1], // Settled vs Accrued
      'Settlement Reference': i < 6 ? `SETTL-${i+1}` : '',
    });
  }

  // ===========================================================================
  // BALANCE TRANSFERS (3 P2P)
  // ===========================================================================
  log('=== Balance Transfers (3) ===');
  for (let i=0; i<3; i++) {
    const a = subs[i*2], b = subs[i*2+1];
    if (!a || !b) continue;
    await insert('Balance Transfers', {
      'From Subscription': [a._id],
      'To Subscription': [b._id],
      'Transfer Code': `XFR-${String(i+1).padStart(4,'0')}`,
      'Transfer Type': [pick([1,2,3])],
      'Amount': pick([5, 100, 500]),
      'Fee': 0.5,
      'Status': [2], // Completed
      'Timestamp': new Date(Date.now() - rndInt(0, 10*86400000)).toISOString(),
      'Reason': 'P2P gift',
    });
  }

  // ===========================================================================
  // ORDERS + ORDER ITEMS (8 orders)
  // ===========================================================================
  log('=== Orders + Items (8 orders) ===');
  const ORDER_TYPES = [[1,'New Activation'],[2,'Plan Purchase'],[3,'SIM Replacement'],[7,'Reactivation']];
  for (let i=0; i<8; i++) {
    const c = customers[i];
    const sub = subsByCust.get(c._id)?.[0];
    const ch = channels[i % channels.length];
    const ot = pick(ORDER_TYPES);
    const total = pick([5, 15, 30]);
    const ord = await insert('Orders', {
      'Customer': [c._id],
      'Subscription': sub ? [sub._id] : undefined,
      'Channel': [ch._id],
      'Order Code': `ORD-${String(i+1).padStart(6,'0')}`,
      'Order Type': [ot[0]],
      'Total Amount': total,
      'Status': [4], // Fulfilled
      'Submitted At': new Date(Date.now() - rndInt(0, 30*86400000)).toISOString(),
      'Fulfilled At': new Date(Date.now() - rndInt(0, 29*86400000)).toISOString(),
      'Notes': `${ot[1]} order`,
    });
    if (ord) {
      await insert('Order Items', {
        'Order': [ord],
        'Tariff Plan': [pick(tariffs)._id],
        'Quantity': 1,
        'Unit Price': total,
        'Total': total,
        'Notes': ot[1],
      });
    }
  }

  // ===========================================================================
  // CASES (8 support tickets)
  // ===========================================================================
  log('=== Cases (8) ===');
  const CAT = [[1,'Billing'],[2,'Technical'],[3,'Service Request'],[4,'Complaint']];
  const PRI = [[1,'Low'],[2,'Medium'],[3,'High']];
  const STAT = [[1,'Open'],[2,'In Progress'],[3,'Resolved'],[4,'Closed']];
  const SUBJECTS = [
    'Data speed is very slow in evening',
    'Double charge on recharge',
    'Plan not activating after payment',
    'SMS not delivered to friend',
    'International calls blocked',
    'Balance showing wrong amount',
    'Unable to send USSD *123#',
    'Roaming not working abroad',
  ];
  for (let i=0; i<8; i++) {
    const c = customers[i];
    const sub = subsByCust.get(c._id)?.[0];
    const st = pick(STAT);
    await insert('Cases', {
      'Customer': [c._id],
      'Subscription': sub ? [sub._id] : undefined,
      'Channel': [channels[i % channels.length]._id],
      'Case Code': `CAS-${String(i+1).padStart(6,'0')}`,
      'Category': [pick(CAT)[0]],
      'Priority': [pick(PRI)[0]],
      'Status': [st[0]],
      'Subject': SUBJECTS[i],
      'Description': `Customer reports: ${SUBJECTS[i]}. Agent to investigate.`,
      'Assigned To': `agent${rndInt(1,5)}@op.com`,
      'Opened At': new Date(Date.now() - rndInt(0, 14*86400000)).toISOString(),
      'Resolved At': st[0] >= 3 ? new Date(Date.now() - rndInt(0, 7*86400000)).toISOString() : undefined,
      'Resolution Notes': st[0] >= 3 ? 'Resolved after diagnostic check' : '',
      'CSAT': st[0] === 3 ? rndInt(3,5) : undefined,
    });
  }

  // ===========================================================================
  // CUSTOMER INTERACTIONS (15 USSD balance checks + self-care)
  // ===========================================================================
  log('=== Customer Interactions (15) ===');
  const INT_TYPES = [[1,'Balance Check'],[2,'Recharge'],[3,'Plan Purchase'],[5,'Query'],[7,'Self Care Action']];
  for (let i=0; i<15; i++) {
    const c = customers[i % customers.length];
    const sub = subsByCust.get(c._id)?.[0];
    const ch = pick(channels);
    const it = pick(INT_TYPES);
    await insert('Customer Interactions', {
      'Customer': [c._id],
      'Subscription': sub ? [sub._id] : undefined,
      'Channel': [ch._id],
      'Interaction Code': `INT-${String(i+1).padStart(6,'0')}`,
      'Interaction Type': [it[0]],
      'Timestamp': new Date(Date.now() - rndInt(0, 3*86400000)).toISOString(),
      'Duration Seconds': rndInt(10, 180),
      'Outcome': [1], // Resolved
      'Agent ID': pick([null, null, 'agent1', 'agent2']) || '',
      'CSAT Score': rndInt(3, 5),
    });
  }

  // ===========================================================================
  // NOTIFICATIONS SENT (sample notifications)
  // ===========================================================================
  log('=== Notifications Sent (12) ===');
  for (let i=0; i<12; i++) {
    const c = customers[i % customers.length];
    const sub = subsByCust.get(c._id)?.[0];
    const tmpl = templates[i % templates.length];
    const ch = channels.find(x => x.cells[mChannel['Channel Code']] === 'SMS') || channels[0];
    await insert('Notifications Sent', {
      'Template': [tmpl._id],
      'Customer': [c._id],
      'Subscription': sub ? [sub._id] : undefined,
      'Channel': [ch._id],
      'Sent At': new Date(Date.now() - rndInt(0, 7*86400000)).toISOString(),
      'Delivered At': new Date(Date.now() - rndInt(0, 6*86400000)).toISOString(),
      'Status': [3], // Delivered
      'Content Snapshot': 'Your plan "Ultimate 10GB Pack" is 80% used. Remaining: 2.1 GB. Top-up via *123# to continue.',
    });
  }

  // ===========================================================================
  // BUSINESS RULES (sample policy rules)
  // ===========================================================================
  log('=== Business Rules (6) ===');
  const RULES = [
    ['RULE-LOW20','Notify at 20% remaining','Notification','remaining_pct <= 20','send_notification(LOW_BAL_20)'],
    ['RULE-PLAN-EXP','Warn 3 days before plan expiry','Notification','days_until_expiry <= 3','send_notification(PLAN_EXPIRING)'],
    ['RULE-FUI-BLOCK','Block when balance hits 0','Rating','balance = 0 AND overage_action = block','deny_request(FUI_TERMINATE)'],
    ['RULE-FUI-REDIR','Redirect when balance low','Rating','balance = 0 AND has_overage_wallet','debit_wallet_payg()'],
    ['RULE-FRAUD-VEL','Flag rapid recharges','Fraud','recharges_per_hour > 5','flag_for_review()'],
    ['RULE-WELCOME','Grant welcome bonus','Promotion','subscription.age_days <= 1 AND recharge_done','grant_bonus(PROMO_WELCOME)'],
  ];
  for (let i=0; i<RULES.length; i++) {
    const [code, name, rtype, cond, act] = RULES[i];
    await insert('Business Rules', {
      'Rule Code': code,
      'Rule Name': name,
      'Rule Type': [rtype === 'Rating' ? 1 : rtype === 'Notification' ? 2 : rtype === 'Fraud' ? 4 : 3],
      'Trigger Condition': cond,
      'Action': act,
      'Priority': i + 1,
      'Enabled': true,
    });
  }

  // ===========================================================================
  // FRIENDS AND FAMILY GROUPS + MEMBERS
  // ===========================================================================
  log('=== F&F Groups + Members (2 groups) ===');
  for (let i=0; i<2 && i < subs.length; i++) {
    const owner = subs[i];
    const grp = await insert('Friends and Family Groups', {
      'Owner Subscription': [owner._id],
      'Group Code': `FFG-${String(i+1).padStart(3,'0')}`,
      'Group Name': `${i===0 ? 'Family Circle' : 'Work Buddies'}`,
      'Max Members': 5,
      'Special Rate Card': 'RC-FF-FREE',
      'Status': [1],
    });
    if (grp) {
      for (let j=0; j<3; j++) {
        await insert('FF Members', {
          'FF Group': [grp],
          'Member MSISDN': '91985' + String(rndInt(100000000, 999999999)).slice(0,8),
          'Added Date': '2026-02-15',
          'On Net': true,
          'Status': [1],
        });
      }
    }
  }

  // ===========================================================================
  // CLOSED USER GROUPS + MEMBERS (1 corporate CUG)
  // ===========================================================================
  log('=== CUG + Members (1 group) ===');
  const cug = await insert('Closed User Groups', {
    'Owner Customer': [customers[0]._id],
    'CUG Code': 'CUG-0001',
    'CUG Name': 'Acme Corp Employees',
    'CUG Type': [1], // Corporate
    'Internal Rate Card': 'RC-CUG-ACME',
    'Status': [1],
  });
  if (cug) {
    for (let i=0; i<5 && i < subs.length; i++) {
      await insert('CUG Members', {
        'CUG': [cug],
        'Subscription': [subs[i]._id],
        'Role': [i === 0 ? 1 : 2],
        'Added Date': '2026-03-01',
        'Status': [1],
      });
    }
  }

  // ===========================================================================
  // CALL DETAIL RECORDS (flatten from sessions)
  // ===========================================================================
  log(`=== Call Detail Records (from ${sessions.length} sessions) ===`);
  const SVC_LABEL = { 1:'Data', 2:'Voice On-net', 3:'Voice Off-net', 4:'Voice Intl', 5:'SMS Dom', 6:'SMS Intl' };
  for (let i=0; i<sessions.length; i++) {
    const s = sessions[i];
    const svcType = Number(String(s.cells[mSession['Service Type']] || '[1]').replace(/[\[\]]/g, ''));
    const cause = String(s.cells[mSession['Termination Cause']] || '[1]');
    const sub = subs.find(x => x._id === s.cells[mSession['Subscription']]?.[0]);
    const custId = sub ? sub.cells[mSub['Customer']]?.[0] : undefined;
    const totalUsed = Number(s.cells[mSession['Total Used Amount']]) || 0;
    const started = s.cells[mSession['Started At']] ? new Date(s.cells[mSession['Started At']]).toISOString() : iso(Date.now());
    const ended = s.cells[mSession['Ended At']] ? new Date(s.cells[mSession['Ended At']]).toISOString() : iso(Date.now());
    const durSec = Math.max(0, Math.floor((new Date(ended) - new Date(started)) / 1000));
    await insert('Call Detail Records', {
      'Charging Session': [s._id],
      'Subscription': sub ? [sub._id] : undefined,
      'Customer': custId ? [custId] : undefined,
      'CDR Code': `CDR-${String(i+1).padStart(6,'0')}`,
      'Service Type': [svcType],
      'Started At': started,
      'Ended At': ended,
      'Duration Seconds': durSec,
      'Total MB': svcType === 1 ? totalUsed : 0,
      'Total Minutes': svcType >= 2 && svcType <= 4 ? totalUsed : 0,
      'Total Units': svcType >= 5 ? totalUsed : 0,
      'Rating Group': svcType === 1 ? 10 : (svcType >= 5 ? 200 : 100),
      'Total Charged from Allowance': totalUsed,
      'Total Charged from Wallet': 0,
      'Final Termination Cause': cause === '[1]' ? 'LOGOUT' : 'TIMEOUT',
      'Record Sequence Number': i + 1,
    });
  }

  log('');
  log('=== SUPPORTING SEED COMPLETE ===');
}

main().catch(e => { console.error(e); process.exit(1); });
