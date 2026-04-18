// Clean seed script for the telecom prepaid billing system.
// Usage: node seed.mjs

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

// Cache column maps so we don't re-fetch
const colMapCache = new Map();

async function api(method, url, body) {
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  let res, data;
  for (let attempt = 0; attempt < 6; attempt++) {
    res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
    if (res.status === 429) {
      await sleep(2500);
      continue;
    }
    return data;
  }
  return data;
}

async function getColMap(tableName) {
  if (colMapCache.has(tableName)) return colMapCache.get(tableName);
  const tid = TABLE_IDS[tableName];
  if (!tid) throw new Error(`Unknown table: ${tableName}`);
  const resp = await api('GET', `/v1/app-builder/table/${tid}`);
  const cols = resp.columnsMetaData || resp.data?.columnsMetaData || [];
  const map = {};
  for (const c of cols) map[c.name] = c.id;
  colMapCache.set(tableName, map);
  return map;
}

// Insert one record. cells keys are column NAMES. Returns record _id.
async function insert(tableName, cellsByName) {
  const tid = TABLE_IDS[tableName];
  const map = await getColMap(tableName);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) {
    if (!map[k]) {
      console.warn(`  ! ${tableName}: unknown column "${k}"`);
      continue;
    }
    cellsById[map[k]] = v;
  }
  const resp = await api('POST', `/v1/app-builder/table/${tid}/record`, { cells: cellsById });
  const rid = resp?.data?.[0]?._id || resp?.data?._id || resp?._id;
  if (!rid) {
    console.error(`  ✗ ${tableName}: ${JSON.stringify(resp).slice(0, 300)}`);
    return null;
  }
  await sleep(1100);
  return rid;
}

// Quick logger
const log = (msg) => process.stdout.write(msg + '\n');

// ============================================================================
// SEED
// ============================================================================

// Resolve any previous seed IDs
const SEED_IDS_FILE = path.join(ROOT, '.seed-ids.json');
const seedIds = fs.existsSync(SEED_IDS_FILE) ? JSON.parse(fs.readFileSync(SEED_IDS_FILE, 'utf8')) : {};
const saveSeed = () => fs.writeFileSync(SEED_IDS_FILE, JSON.stringify(seedIds, null, 2));

async function main() {
  // ---------- Services ----------
  log('=== Services (5) ===');
  seedIds.svc_data    = await insert('Services', { 'Service Code':'DATA_GPRS',   'Service Name':'Mobile Data',       'Service Family':[1],'Default Rating Group':10, 'Default Service Context':[1],'Unit Type':[1],'Description':'4G/5G mobile data' });
  seedIds.svc_vonnet  = await insert('Services', { 'Service Code':'VOICE_ONNET', 'Service Name':'Voice On-net',      'Service Family':[2],'Default Rating Group':100,'Default Service Context':[2],'Unit Type':[2],'Description':'Calls within network' });
  seedIds.svc_voffnet = await insert('Services', { 'Service Code':'VOICE_OFFNET','Service Name':'Voice Off-net',     'Service Family':[2],'Default Rating Group':101,'Default Service Context':[2],'Unit Type':[2],'Description':'Calls to other operators' });
  seedIds.svc_smsdom  = await insert('Services', { 'Service Code':'SMS_DOM',     'Service Name':'SMS Domestic',      'Service Family':[3],'Default Rating Group':200,'Default Service Context':[3],'Unit Type':[3],'Description':'Domestic SMS' });
  seedIds.svc_smsint  = await insert('Services', { 'Service Code':'SMS_INTL',    'Service Name':'SMS International', 'Service Family':[3],'Default Rating Group':201,'Default Service Context':[3],'Unit Type':[3],'Description':'International SMS' });
  saveSeed();

  // ---------- Channels ----------
  log('=== Channels (5) ===');
  seedIds.ch_ussd   = await insert('Channels', { 'Channel Code':'USSD',  'Channel Name':'USSD Self-Care','Channel Type':[1],'Enabled':true });
  seedIds.ch_app    = await insert('Channels', { 'Channel Code':'APP',   'Channel Name':'Mobile App',   'Channel Type':[4],'Enabled':true });
  seedIds.ch_sms    = await insert('Channels', { 'Channel Code':'SMS',   'Channel Name':'SMS',          'Channel Type':[2],'Enabled':true });
  seedIds.ch_ivr    = await insert('Channels', { 'Channel Code':'IVR',   'Channel Name':'IVR',          'Channel Type':[3],'Enabled':true });
  seedIds.ch_retail = await insert('Channels', { 'Channel Code':'RETAIL','Channel Name':'Retail Shop',  'Channel Type':[6],'Enabled':true });
  saveSeed();

  // ---------- Tax Rates ----------
  log('=== Tax Rates (2) ===');
  await insert('Tax Rates', { 'Tax Code':'VAT_IN','Tax Name':'Indian GST',   'Rate Percent':18,'Applies To':[4],'Region':'IN' });
  await insert('Tax Rates', { 'Tax Code':'VAT_US','Tax Name':'US Sales Tax', 'Rate Percent':8, 'Applies To':[4],'Region':'US' });

  // ---------- Network Elements ----------
  log('=== Network Elements (6) ===');
  for (const [code, type] of [['PGW-01',1],['SMSC-01',3],['MSC-01',4],['HSS-01',6],['PCF-01',8],['SMF-01',9]]) {
    const fqdn = code.toLowerCase() + '.op.com';
    await insert('Network Elements', { 'Element Code':code,'Element Type':[type],'FQDN':fqdn,'IP Address':'10.1.1.10','Diameter Realm':'op.com','Region':'North','Status':[1] });
  }

  // ---------- Notification Templates ----------
  log('=== Notification Templates (5) ===');
  const templates = [
    ['WELCOME_SMS','Welcome SMS',8,'Welcome {name}! Your MSISDN {msisdn} is active.'],
    ['LOW_BAL_20','Low Balance 20%',1,'Your plan is 80% used. Remaining: {remaining} {unit}.'],
    ['RECHARGE_OK','Recharge Success',3,'Recharge of {amount} successful. New balance: {balance}.'],
    ['PLAN_ACTIVATED','Plan Activated',4,'Your plan {plan_name} is active. Valid till {expiry}.'],
    ['PLAN_DEPLETED','Plan Depleted',6,'Your {bucket} is fully consumed. Reload via *123#.'],
  ];
  for (const [code, name, evt, body] of templates) {
    await insert('Notification Templates', { 'Template Code':code,'Template Name':name,'Trigger Event':[evt],'Channel Type':[1],'Body':body,'Language':[1],'Enabled':true });
  }

  // ---------- Distribution Partners ----------
  log('=== Distribution Partners (3) ===');
  seedIds.p1 = await insert('Distribution Partners', { 'Partner Code':'PTR-0001','Partner Name':'City Mobile Shop','Partner Type':[1],'Tier':[1],'Region':'North','Contact Person':'Rajesh Kumar','Contact Phone':'919999111100','Contact Email':'rajesh@citymobile.com','Status':[3],'Onboarded Date':'2024-01-15','Wallet Balance':5000 });
  seedIds.p2 = await insert('Distribution Partners', { 'Partner Code':'PTR-0002','Partner Name':'QuickRecharge Super Dealer','Partner Type':[2],'Tier':[1],'Region':'South','Contact Person':'Anita Singh','Contact Phone':'919999222200','Contact Email':'anita@quickrecharge.com','Status':[3],'Onboarded Date':'2023-08-20','Wallet Balance':25000 });
  seedIds.p3 = await insert('Distribution Partners', { 'Partner Code':'PTR-0003','Partner Name':'PayApp Digital Channel','Partner Type':[3],'Tier':[2],'Region':'National','Contact Person':'Vikram Desai','Contact Phone':'919999333300','Contact Email':'vikram@payapp.com','Status':[3],'Onboarded Date':'2024-06-01','Wallet Balance':50000 });
  saveSeed();

  // ---------- Product Offerings ----------
  log('=== Product Offerings (3) ===');
  seedIds.off_starter = await insert('Product Offerings', { 'Offering Code':'OFF-STARTER','Offering Name':'Starter 2GB','Description':'2GB data + 100 min voice + 50 SMS for 28 days','Offering Type':[1],'Base Price':5,'Validity Days':28,'Grace Period Days':3,'Status':[2],'Renewal Type':[3],'Launch Date':'2024-01-01' });
  seedIds.off_ult     = await insert('Product Offerings', { 'Offering Code':'OFF-ULT10',  'Offering Name':'Ultimate 10GB','Description':'10GB data + 300 min voice + 100 SMS for 30 days','Offering Type':[1],'Base Price':15,'Validity Days':30,'Grace Period Days':3,'Status':[2],'Renewal Type':[3],'Launch Date':'2024-01-01' });
  seedIds.off_unl     = await insert('Product Offerings', { 'Offering Code':'OFF-UNL',    'Offering Name':'Unlimited Monthly','Description':'Unlimited data (50GB FUP) + unlimited on-net voice + 300 SMS','Offering Type':[1],'Base Price':30,'Validity Days':30,'Grace Period Days':3,'Status':[2],'Renewal Type':[3],'Launch Date':'2024-01-01' });
  saveSeed();

  // ---------- Tariff Plans ----------
  log('=== Tariff Plans (3) ===');
  seedIds.tp_starter = await insert('Tariff Plans', { 'Product Offering':[seedIds.off_starter],'Plan Code':'TP-STARTER','Plan Name':'Starter 2GB Pack','Price':5, 'Currency':[1],'Plan Type':[3],'Validity Days':28,'Auto Renew Default':false,'Priority On Charge':10,'Region':'Global','Status':[2] });
  seedIds.tp_ult     = await insert('Tariff Plans', { 'Product Offering':[seedIds.off_ult],    'Plan Code':'TP-ULT10',  'Plan Name':'Ultimate 10GB Pack','Price':15,'Currency':[1],'Plan Type':[3],'Validity Days':30,'Auto Renew Default':false,'Priority On Charge':10,'Region':'Global','Status':[2] });
  seedIds.tp_unl     = await insert('Tariff Plans', { 'Product Offering':[seedIds.off_unl],    'Plan Code':'TP-UNL',    'Plan Name':'Unlimited Monthly Pack','Price':30,'Currency':[1],'Plan Type':[3],'Validity Days':30,'Auto Renew Default':false,'Priority On Charge':10,'Region':'Global','Status':[2] });
  saveSeed();

  // ---------- Plan Allowances (9 — 3 per plan) ----------
  log('=== Plan Allowances (9) ===');
  const ALLOWANCES = [
    [seedIds.tp_starter, seedIds.svc_data,   10, 1, 'Starter 2GB Data',     1, 2048, 1],
    [seedIds.tp_starter, seedIds.svc_vonnet, 100,2, 'Starter 100 min Voice',2, 100,  2, 0.05],
    [seedIds.tp_starter, seedIds.svc_smsdom, 200,3, 'Starter 50 SMS',       3, 50,   2, 0.02],
    [seedIds.tp_ult,     seedIds.svc_data,   10, 1, 'Ultimate 10GB Data',   1, 10240,2, 0.001],
    [seedIds.tp_ult,     seedIds.svc_vonnet, 100,2, 'Ultimate 300 min Voice',2,300,  2, 0.03],
    [seedIds.tp_ult,     seedIds.svc_smsdom, 200,3, 'Ultimate 100 SMS',     3, 100,  2, 0.01],
    [seedIds.tp_unl,     seedIds.svc_data,   10, 1, 'Unlimited 50GB FUP',   1, 51200,3],
    [seedIds.tp_unl,     seedIds.svc_vonnet, 100,2, 'Unlimited On-net Voice',2,999999,3],
    [seedIds.tp_unl,     seedIds.svc_smsdom, 200,3, 'Unlimited 300 SMS',    3, 300,  2, 0.01],
  ];
  for (const [tp, svc, rg, ctx, label, unit, initial, oa, orate] of ALLOWANCES) {
    const cells = { 'Tariff Plan':[tp], 'Service':[svc], 'Rating Group':rg, 'Service Context':[ctx], 'Allowance Label':label, 'Unit Type':[unit], 'Initial Amount':initial, 'Overage Action':[oa] };
    if (orate !== undefined) cells['Overage Rate'] = orate;
    await insert('Plan Allowances', cells);
  }

  // ---------- Rate Cards (5) ----------
  log('=== Rate Cards (5) ===');
  const RATES = [
    ['RC-DATA-PAYG',  10, 1, 1, 0.002],
    ['RC-VOICE-ON',   100,2, 2, 0.05],
    ['RC-VOICE-OFF',  101,2, 2, 0.08],
    ['RC-SMS-DOM',    200,3, 3, 0.02],
    ['RC-SMS-INTL',   201,3, 3, 0.15],
  ];
  for (const [code, rg, ctx, unit, price] of RATES) {
    await insert('Rate Cards', { 'Rate Card Code':code,'Tariff Plan':[seedIds.tp_starter],'Rating Group':rg,'Service Context':[ctx],'Unit Type':[unit],'Price Per Unit':price,'Peak Off Peak':[1],'Effective From':'2024-01-01' });
  }

  // ---------- Vouchers (30) ----------
  log('=== Recharge Vouchers (30) ===');
  const denoms = [[5,'V5',1],[10,'V10',2],[20,'V20',3]];
  for (const [amt, prefix, batch] of denoms) {
    for (let i=1; i<=10; i++) {
      const serial = `${prefix}-${String(i).padStart(6,'0')}`;
      const pin = String(Math.floor(Math.random()*99999999)).padStart(8,'0');
      await insert('Recharge Vouchers', { 'Voucher Serial':serial,'PIN':pin,'Denomination':amt,'Currency':[1],'Batch ID':`BATCH-00${batch}`,'Status':[2],'Expiry Date':'2027-12-31' });
    }
  }

  // ---------- Customers (20) ----------
  log('=== Customers (20) ===');
  const NAMES = ['Amit Sharma','Priya Patel','Ravi Kumar','Sneha Gupta','Arjun Reddy','Neha Iyer','Karthik Menon','Anjali Singh','Rohit Verma','Deepika Rao','Vijay Nair','Kavya Pillai','Suresh Bhat','Meera Desai','Ajay Saxena','Pooja Joshi','Nikhil Agarwal','Shruti Bansal','Harsh Chopra','Riya Kapoor'];
  const custIds = [];
  for (let i=0; i<NAMES.length; i++) {
    const name = NAMES[i];
    const phone = '919812' + String(i+1).padStart(6,'0');
    const email = name.toLowerCase().replace(/\s/g,'.') + '@example.com';
    const segment = 1 + Math.floor(Math.random()*3);
    const lang = 1 + Math.floor(Math.random()*2);
    const cid = await insert('Customers', { 'Name':name,'Email':email,'Phone':phone,'Customer Type':[1],'Segment':[segment],'Status':[1],'Language':[lang],'KYC Status':[3],'Onboarded Date':`2024-${String(1+Math.floor(Math.random()*12)).padStart(2,'0')}-${String(1+Math.floor(Math.random()*28)).padStart(2,'0')}` });
    if (cid) custIds.push(cid);
  }
  seedIds.customers = custIds;
  saveSeed();

  // ---------- Subscriptions (25 — some customers have 2 SIMs) ----------
  log('=== Subscriptions (25) ===');
  const subIds = [];
  let subNum = 0;
  for (let i=0; i<custIds.length; i++) {
    const cust = custIds[i];
    subNum++;
    const msisdn = '91982' + String(subNum).padStart(7,'0');
    const imsi   = '40468' + String(subNum).padStart(10,'0');
    const iccid  = '8991012' + String(subNum).padStart(11,'0');
    const actDate = `2024-${String(1+Math.floor(Math.random()*12)).padStart(2,'0')}-${String(1+Math.floor(Math.random()*28)).padStart(2,'0')}`;
    const sid = await insert('Subscriptions', { 'Customer':[cust],'MSISDN':msisdn,'IMSI':imsi,'ICCID':iccid,'APN':'internet','Subscription Type':[3],'Status':[1],'Activation Date':actDate,'Home Network':'OP','Roaming Enabled':false });
    if (sid) subIds.push(sid);

    // 25% chance of second SIM, cap at 25 subs total
    if (Math.random() < 0.25 && subIds.length < 25) {
      subNum++;
      const msisdn2 = '91982' + String(subNum).padStart(7,'0');
      const imsi2   = '40468' + String(subNum).padStart(10,'0');
      const iccid2  = '8991012' + String(subNum).padStart(11,'0');
      const sid2 = await insert('Subscriptions', { 'Customer':[cust],'MSISDN':msisdn2,'IMSI':imsi2,'ICCID':iccid2,'APN':'internet','Subscription Type':[3],'Status':[1],'Activation Date':actDate,'Home Network':'OP','Roaming Enabled':false });
      if (sid2) subIds.push(sid2);
    }
  }
  seedIds.subscriptions = subIds;
  saveSeed();
  log(`  → ${subIds.length} subscriptions`);

  // ---------- Wallets (one per customer) ----------
  log('=== Wallets (20) ===');
  const walletIds = [];
  for (let i=0; i<custIds.length; i++) {
    const start = 10 + Math.floor(Math.random()*50);
    const wid = await insert('Wallets', { 'Customer':[custIds[i]],'Wallet Code':`WLT-${String(i+1).padStart(6,'0')}`,'Currency':[1],'Current Balance':start,'Lifetime Recharge':start,'Lifetime Spend':0,'Last Recharge Date':new Date().toISOString(),'Status':[1] });
    if (wid) walletIds.push(wid);
  }
  seedIds.wallets = walletIds;
  saveSeed();

  // ---------- Subscription Plan Assignments (one per sub) ----------
  log('=== Subscription Plan Assignments ===');
  const planMap = { 0: seedIds.tp_starter, 1: seedIds.tp_ult, 2: seedIds.tp_unl };
  const priceMap = { 0: 5, 1: 15, 2: 30 };
  const initAllowances = {
    [seedIds.tp_starter]: { data:2048,  voice:100,    sms:50 },
    [seedIds.tp_ult]:     { data:10240, voice:300,    sms:100 },
    [seedIds.tp_unl]:     { data:51200, voice:999999, sms:300 },
  };
  const spaIds = [];
  const subToTp = [];
  for (let i=0; i<subIds.length; i++) {
    const choice = i < subIds.length*0.3 ? 0 : (i < subIds.length*0.8 ? 1 : 2);
    const tp = planMap[choice];
    const price = priceMap[choice];
    subToTp.push(tp);
    const spa = await insert('Subscription Plan Assignments', { 'Subscription':[subIds[i]],'Tariff Plan':[tp],'Effective From':'2026-04-01','Activation Source':[1],'Renewal Count':0,'Status':[1],'Price Paid':price });
    if (spa) spaIds.push(spa);
  }
  seedIds.plan_assignments = spaIds;
  saveSeed();

  // ---------- Balances (3 per sub) ----------
  log('=== Balances (3 per sub) ===');
  let balCount = 0;
  for (let i=0; i<subIds.length; i++) {
    const tp = subToTp[i];
    const al = initAllowances[tp];
    const buckets = [
      { label:'Data',         rg:10, ctx:1, unit:1, initial:al.data  },
      { label:'Voice On-net', rg:100,ctx:2, unit:2, initial:al.voice },
      { label:'SMS Domestic', rg:200,ctx:3, unit:3, initial:al.sms   },
    ];
    for (const b of buckets) {
      const bid = await insert('Balances', { 'Subscription':[subIds[i]],'Subscription Plan Assignment':[spaIds[i]],'Balance Code':`BAL-${i+1}-${b.label.toUpperCase().slice(0,3)}`,'Rating Group':b.rg,'Service Context':[b.ctx],'Allowance Label':b.label,'Unit Type':[b.unit],'Initial Amount':b.initial,'Used Amount':0,'Remaining Amount':b.initial,'Cycle Start':'2026-04-01','Cycle End':'2026-05-01','Status':[1] });
      if (bid) balCount++;
    }
  }
  log(`  → ${balCount} balances`);

  log('');
  log('=== SEED COMPLETE ===');
  log(JSON.stringify({ services:5, channels:5, offerings:3, plans:3, customers:custIds.length, subs:subIds.length, spas:spaIds.length, bal:balCount }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
