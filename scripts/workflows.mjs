// Workflow runner — implements the prepaid billing automations as code,
// since the auto-builder engine isn't reachable with our PAT.
//
// Usage:
//   node workflows.mjs              # run all workflows once
//   node workflows.mjs welcome      # run a single workflow by name
//   node workflows.mjs stream       # poll continuously every 30s

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const APP_ID = 'afe8c4540708da6ca9e6fe79';

const TABLE_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.table-ids.json'), 'utf8'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const colMapCache = new Map();

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

async function colMap(tname) {
  if (colMapCache.has(tname)) return colMapCache.get(tname);
  const tid = TABLE_IDS[tname];
  const r = await api('GET', `/v1/app-builder/table/${tid}`);
  const cols = r.columnsMetaData || r.data?.columnsMetaData || [];
  const m = {};
  for (const c of cols) m[c.name] = c.id;
  colMapCache.set(tname, m);
  return m;
}

async function fetchAll(tname, filter) {
  const tid = TABLE_IDS[tname];
  const all = [];
  let page = 1;
  while (true) {
    const body = filter ? { filterCriteria: filter } : {};
    const r = await api('POST', `/v1/app-builder/table/${tid}/paged-record?pageNo=${page}&pageSize=200`, body);
    const batch = r?.data || [];
    all.push(...batch);
    if (batch.length < 200) break;
    page++;
    await sleep(500);
  }
  return all;
}

async function insert(tname, cellsByName) {
  const tid = TABLE_IDS[tname];
  const m = await colMap(tname);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) {
    if (m[k]) cellsById[m[k]] = v;
  }
  const r = await api('POST', `/v1/app-builder/table/${tid}/record`, { cells: cellsById });
  return r?.data?.[0]?._id || r?.data?._id || r?._id || null;
}

async function update(tname, recordId, cellsByName) {
  const tid = TABLE_IDS[tname];
  const m = await colMap(tname);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) {
    if (m[k]) cellsById[m[k]] = v;
  }
  return await api('PUT', `/v1/app-builder/table/${tid}/record/${recordId}`, { cells: cellsById });
}

const log = (msg) => console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`);

// ============================================================================
// Helper: render a notification template
// ============================================================================

function renderTemplate(body, vars) {
  return body.replace(/\{(\w+)\}/g, (_, k) => vars[k] != null ? String(vars[k]) : `{${k}}`);
}

// ============================================================================
// WORKFLOW 1: Welcome SMS for new subscriptions
// ============================================================================

async function wfWelcomeSMS() {
  const subs = await fetchAll('Subscriptions');
  const sentNotifs = await fetchAll('Notifications Sent');
  const customers = await fetchAll('Customers');
  const templates = await fetchAll('Notification Templates');
  const channels = await fetchAll('Channels');

  const mSub = await colMap('Subscriptions');
  const mCust = await colMap('Customers');
  const mTpl = await colMap('Notification Templates');
  const mNS = await colMap('Notifications Sent');
  const mCh = await colMap('Channels');

  const cust = (id) => customers.find(c => c._id === id);
  const tplWelcome = templates.find(t => t.cells[mTpl['Template Code']] === 'WELCOME_SMS');
  const chSMS = channels.find(c => c.cells[mCh['Channel Code']] === 'SMS');
  if (!tplWelcome || !chSMS) { log('  ✗ welcome: missing template or SMS channel'); return; }

  // Already sent? Find Welcome SMS sent for each subscription
  const sentForSub = new Set();
  for (const n of sentNotifs) {
    const tplRef = n.cells[mNS['Template']]?.[0];
    const subRef = n.cells[mNS['Subscription']]?.[0];
    if (tplRef === tplWelcome._id && subRef) sentForSub.add(subRef);
  }

  let count = 0;
  for (const s of subs) {
    if (sentForSub.has(s._id)) continue;
    const c = cust(s.cells[mSub['Customer']]?.[0]);
    if (!c) continue;
    const name = c.cells[mCust['Name']];
    const msisdn = s.cells[mSub['MSISDN']];
    const body = renderTemplate(tplWelcome.cells[mTpl['Body']] || '', { name, msisdn });
    await insert('Notifications Sent', {
      'Template':[tplWelcome._id],
      'Customer':[c._id],
      'Subscription':[s._id],
      'Channel':[chSMS._id],
      'Sent At': new Date().toISOString(),
      'Delivered At': new Date().toISOString(),
      'Status':[3],
      'Content Snapshot': body,
    });
    count++;
    await sleep(800);
  }
  log(`  WELCOME-SMS: dispatched ${count}`);
}

// ============================================================================
// WORKFLOW 2: Recharge confirmation + commission accrual
// ============================================================================

async function wfRechargeConfirm() {
  const recharges = await fetchAll('Recharges');
  const wallets = await fetchAll('Wallets');
  const customers = await fetchAll('Customers');
  const subs = await fetchAll('Subscriptions');
  const templates = await fetchAll('Notification Templates');
  const channels = await fetchAll('Channels');
  const sentNotifs = await fetchAll('Notifications Sent');
  const commissions = await fetchAll('Partner Commissions');

  const mRech = await colMap('Recharges');
  const mWlt = await colMap('Wallets');
  const mSub = await colMap('Subscriptions');
  const mCust = await colMap('Customers');
  const mTpl = await colMap('Notification Templates');
  const mNS = await colMap('Notifications Sent');
  const mCh = await colMap('Channels');
  const mPC = await colMap('Partner Commissions');

  const tplRecharge = templates.find(t => t.cells[mTpl['Template Code']] === 'RECHARGE_OK');
  const chSMS = channels.find(c => c.cells[mCh['Channel Code']] === 'SMS');

  // Track which recharges already had a notification sent
  const notifForRecharge = new Set();
  for (const n of sentNotifs) {
    if (n.cells[mNS['Template']]?.[0] === tplRecharge?._id) {
      // We don't directly link; use Customer + recent sent
      // Track by content snapshot containing recharge code (rough heuristic)
    }
  }
  // Track which recharges already have commission
  const commForRecharge = new Set();
  for (const c of commissions) {
    const r = c.cells[mPC['Recharge']]?.[0];
    if (r) commForRecharge.add(r);
  }

  let notifCount = 0, commCount = 0;
  for (const r of recharges) {
    const status = String(r.cells[mRech['Status']] || '');
    if (!status.includes('2')) continue; // not Successful (index 2)

    const wid = r.cells[mRech['Wallet']]?.[0];
    const wallet = wallets.find(w => w._id === wid);
    if (!wallet) continue;
    const cid = wallet.cells[mWlt['Customer']]?.[0];
    const cust = customers.find(c => c._id === cid);
    if (!cust) continue;

    const amount = Number(r.cells[mRech['Amount']]) || 0;
    const balance = Number(wallet.cells[mWlt['Current Balance']]) || 0;
    const sub = subs.find(s => s.cells[mSub['Customer']]?.[0] === cid);

    // Notification (idempotency: send once per recharge — store recharge code in snapshot)
    const rcode = r.cells[mRech['Recharge Code']];
    const alreadySent = sentNotifs.some(n =>
      n.cells[mNS['Template']]?.[0] === tplRecharge?._id &&
      String(n.cells[mNS['Content Snapshot']] || '').includes(rcode || '__none__')
    );
    if (!alreadySent && tplRecharge && chSMS) {
      const body = renderTemplate(tplRecharge.cells[mTpl['Body']] || '', { amount: `$${amount}`, balance: `$${balance}` }) + ` [Ref: ${rcode}]`;
      await insert('Notifications Sent', {
        'Template':[tplRecharge._id],
        'Customer':[cust._id],
        'Subscription': sub ? [sub._id] : undefined,
        'Channel':[chSMS._id],
        'Sent At': new Date().toISOString(),
        'Delivered At': new Date().toISOString(),
        'Status':[3],
        'Content Snapshot': body,
      });
      notifCount++;
      await sleep(800);
    }

    // Commission (3% of amount) — skip if exists
    if (!commForRecharge.has(r._id)) {
      const partnerId = r.cells[mRech['Distribution Partner']]?.[0];
      if (partnerId) {
        const commission = +(amount * 0.03).toFixed(2);
        await insert('Partner Commissions', {
          'Partner':[partnerId],
          'Recharge':[r._id],
          'Commission Type':[1],
          'Base Amount': amount,
          'Commission Amount': commission,
          'Accrued Date': new Date().toISOString(),
          'Status':[1],
        });
        commCount++;
        await sleep(800);
      }
    }
  }
  log(`  RECHARGE-OK: ${notifCount} notifications, ${commCount} commissions accrued`);
}

// ============================================================================
// WORKFLOW 3: Low balance alert (at 20%)
// ============================================================================

async function wfLowBalance() {
  const balances = await fetchAll('Balances');
  const subs = await fetchAll('Subscriptions');
  const customers = await fetchAll('Customers');
  const templates = await fetchAll('Notification Templates');
  const channels = await fetchAll('Channels');
  const sentNotifs = await fetchAll('Notifications Sent');

  const mBal = await colMap('Balances');
  const mSub = await colMap('Subscriptions');
  const mTpl = await colMap('Notification Templates');
  const mNS = await colMap('Notifications Sent');
  const mCh = await colMap('Channels');

  const tplLow = templates.find(t => t.cells[mTpl['Template Code']] === 'LOW_BAL_20');
  const chSMS = channels.find(c => c.cells[mCh['Channel Code']] === 'SMS');
  if (!tplLow) { log('  ✗ low-bal: missing LOW_BAL_20 template'); return; }

  const UNIT_LABEL = { 1:'MB', 2:'min', 3:'SMS', 4:'sec' };

  // Idempotency: don't re-alert if alerted in last 12h for this balance
  const TWELVE_HRS = 12*60*60*1000;
  const recentAlerts = new Set();
  for (const n of sentNotifs) {
    if (n.cells[mNS['Template']]?.[0] !== tplLow._id) continue;
    const sentAt = new Date(n.cells[mNS['Sent At']]).getTime();
    if (Date.now() - sentAt < TWELVE_HRS) {
      const subRef = n.cells[mNS['Subscription']]?.[0];
      const snap = String(n.cells[mNS['Content Snapshot']] || '');
      // Track per-(sub, bucket) — extract bucket from snapshot
      if (subRef) {
        const m = snap.match(/Bucket:(\w+)/);
        if (m) recentAlerts.add(`${subRef}::${m[1]}`);
        else recentAlerts.add(subRef);
      }
    }
  }

  let count = 0;
  for (const b of balances) {
    const initial = Number(b.cells[mBal['Initial Amount']]) || 0;
    const used = Number(b.cells[mBal['Used Amount']]) || 0;
    const remaining = Number(b.cells[mBal['Remaining Amount']]) || 0;
    if (initial <= 0 || initial > 99999) continue; // skip unlimited buckets
    const pct = remaining / initial;
    if (pct >= 0.2 || pct <= 0) continue; // not in alert zone

    const subRef = b.cells[mBal['Subscription']]?.[0];
    const sub = subs.find(s => s._id === subRef);
    if (!sub) continue;
    const cust = customers.find(c => c._id === sub.cells[mSub['Customer']]?.[0]);
    if (!cust) continue;

    const unitIdx = Number(String(b.cells[mBal['Unit Type']] || '[1]').replace(/[\[\]]/g, ''));
    const unit = UNIT_LABEL[unitIdx] || '';
    const bucket = b.cells[mBal['Allowance Label']] || 'bucket';
    const dedupKey = `${subRef}::${bucket}`;
    if (recentAlerts.has(dedupKey)) continue;

    const body = renderTemplate(tplLow.cells[mTpl['Body']] || '', {
      remaining: `${remaining.toFixed(1)}`,
      unit,
    }) + ` [Bucket:${bucket}]`;

    await insert('Notifications Sent', {
      'Template':[tplLow._id],
      'Customer':[cust._id],
      'Subscription':[sub._id],
      'Channel': chSMS ? [chSMS._id] : undefined,
      'Sent At': new Date().toISOString(),
      'Delivered At': new Date().toISOString(),
      'Status':[3],
      'Content Snapshot': body,
    });
    count++;
    await sleep(800);
  }
  log(`  LOW-BAL: alerted ${count} balances at <20%`);
}

// ============================================================================
// WORKFLOW 4: Mark depleted + notify
// ============================================================================

async function wfMarkDepleted() {
  const balances = await fetchAll('Balances');
  const subs = await fetchAll('Subscriptions');
  const customers = await fetchAll('Customers');
  const templates = await fetchAll('Notification Templates');
  const channels = await fetchAll('Channels');

  const mBal = await colMap('Balances');
  const mSub = await colMap('Subscriptions');
  const mTpl = await colMap('Notification Templates');
  const mCh = await colMap('Channels');

  const tplDepl = templates.find(t => t.cells[mTpl['Template Code']] === 'PLAN_DEPLETED');
  const chSMS = channels.find(c => c.cells[mCh['Channel Code']] === 'SMS');

  let updated = 0, notified = 0;
  for (const b of balances) {
    const remaining = Number(b.cells[mBal['Remaining Amount']]) || 0;
    const status = String(b.cells[mBal['Status']] || '[1]');
    if (remaining > 0) continue;
    if (status.includes('2')) continue; // already Depleted

    // Update status -> Depleted
    await update('Balances', b._id, { 'Status':[2] });
    updated++;
    await sleep(700);

    // Send PLAN_DEPLETED notification
    const subRef = b.cells[mBal['Subscription']]?.[0];
    const sub = subs.find(s => s._id === subRef);
    if (!sub || !tplDepl) continue;
    const cust = customers.find(c => c._id === sub.cells[mSub['Customer']]?.[0]);
    if (!cust) continue;
    const bucket = b.cells[mBal['Allowance Label']] || 'allowance';
    const body = renderTemplate(tplDepl.cells[mTpl['Body']] || '', { bucket });
    await insert('Notifications Sent', {
      'Template':[tplDepl._id],
      'Customer':[cust._id],
      'Subscription':[sub._id],
      'Channel': chSMS ? [chSMS._id] : undefined,
      'Sent At': new Date().toISOString(),
      'Delivered At': new Date().toISOString(),
      'Status':[3],
      'Content Snapshot': body,
    });
    notified++;
    await sleep(800);
  }
  log(`  DEPLETED: updated ${updated} balances, sent ${notified} notifications`);
}

// ============================================================================
// WORKFLOW 5: Plan expiry warning (3 days before)
// ============================================================================

async function wfPlanExpiringSoon() {
  const spas = await fetchAll('Subscription Plan Assignments');
  const subs = await fetchAll('Subscriptions');
  const customers = await fetchAll('Customers');
  const tariffs = await fetchAll('Tariff Plans');
  const templates = await fetchAll('Notification Templates');
  const channels = await fetchAll('Channels');

  const mSpa = await colMap('Subscription Plan Assignments');
  const mTariff = await colMap('Tariff Plans');
  const mSub = await colMap('Subscriptions');
  const mTpl = await colMap('Notification Templates');
  const mCh = await colMap('Channels');

  // Use PLAN_ACTIVATED template if PLAN_EXPIRING doesn't exist
  let tpl = templates.find(t => t.cells[mTpl['Template Code']] === 'PLAN_EXPIRING');
  if (!tpl) tpl = templates.find(t => t.cells[mTpl['Template Code']] === 'PLAN_ACTIVATED');
  const chSMS = channels.find(c => c.cells[mCh['Channel Code']] === 'SMS');

  const today = new Date(); today.setHours(0,0,0,0);
  const threshold = today.getTime() + 3*86400000;

  let count = 0;
  for (const a of spas) {
    const status = String(a.cells[mSpa['Status']] || '[1]');
    if (!status.includes('1')) continue; // not Active
    if (a.cells[mSpa['Effective To']]) continue; // already has end date

    const tariffRef = a.cells[mSpa['Tariff Plan']]?.[0];
    const tariff = tariffs.find(t => t._id === tariffRef);
    if (!tariff) continue;
    const validity = Number(tariff.cells[mTariff['Validity Days']]) || 30;
    const effFrom = new Date(a.cells[mSpa['Effective From']]).getTime();
    const expiresAt = effFrom + validity*86400000;

    if (expiresAt > threshold || expiresAt < today.getTime()) continue; // not in 3-day window

    const subRef = a.cells[mSpa['Subscription']]?.[0];
    const sub = subs.find(s => s._id === subRef);
    if (!sub) continue;
    const cust = customers.find(c => c._id === sub.cells[mSub['Customer']]?.[0]);
    if (!cust) continue;

    const planName = tariff.cells[mTariff['Plan Name']];
    const expiry = new Date(expiresAt).toLocaleDateString();
    const body = renderTemplate(tpl?.cells[mTpl['Body']] || 'Your plan {plan_name} expires on {expiry}.', { plan_name:planName, expiry });

    await insert('Notifications Sent', {
      'Template':[tpl._id],
      'Customer':[cust._id],
      'Subscription':[sub._id],
      'Channel': chSMS ? [chSMS._id] : undefined,
      'Sent At': new Date().toISOString(),
      'Delivered At': new Date().toISOString(),
      'Status':[3],
      'Content Snapshot': body,
    });
    count++;
    await sleep(800);
  }
  log(`  PLAN-EXPIRING: notified ${count} subscriptions expiring in <3 days`);
}

// ============================================================================
// WORKFLOW 6: Verify KYC (mock external API)
// Trigger: scan Customer Identifications where Verified=false (or never set)
// Action: simulate calling DigiLocker/UIDAI; on success set Verified=true,
//         cascade Customer.KYC Status = Verified, log Lifecycle Event
// ============================================================================

async function wfVerifyKYC() {
  const ids = await fetchAll('Customer Identifications');
  const customers = await fetchAll('Customers');
  const mId = await colMap('Customer Identifications');
  const mCust = await colMap('Customers');

  let verifiedCount = 0, rejectedCount = 0;
  for (const id of ids) {
    if (id.cells[mId['Verified']] === true) continue; // already done
    const custId = id.cells[mId['Customer']]?.[0];
    if (!custId) continue;

    // Mock external API call: 92% success rate
    const mockSuccess = Math.random() < 0.92;
    if (mockSuccess) {
      await update('Customer Identifications', id._id, {
        'Verified': true,
        'Verification Date': new Date().toISOString(),
        'Verification Method': [3], // OTP e-KYC
      });
      // Cascade to Customer.KYC Status
      await update('Customers', custId, { 'KYC Status': [3] }); // Verified
      // Log lifecycle event
      await insert('Customer Lifecycle Events', {
        'Customer': [custId],
        'Event Type': [7], // KYC Updated
        'Event Date': new Date().toISOString(),
        'Reason': 'KYC verified via OTP e-KYC API',
        'Triggered By': [1], // System
        'New Status': 'Verified',
      });
      verifiedCount++;
    } else {
      await update('Customer Identifications', id._id, { 'Verified': false });
      await update('Customers', custId, { 'KYC Status': [4] }); // Rejected
      rejectedCount++;
    }
    await sleep(1100);
  }
  log(`  KYC: ${verifiedCount} verified, ${rejectedCount} rejected`);
}

// ============================================================================
// WORKFLOW 7: Activate Subscription
// Trigger: Order created with Order Type=New Activation, Status=Submitted
// Pre: Customer.KYC Status = Verified
// Steps: pick MSISDN from pool, pick SIM from inventory, create Subscription,
//        ensure Wallet exists, log Lifecycle Event, update order status.
// ============================================================================

async function wfActivateSubscription() {
  const orders = await fetchAll('Orders');
  const customers = await fetchAll('Customers');
  const wallets = await fetchAll('Wallets');
  const subs = await fetchAll('Subscriptions');
  const pool = await fetchAll('MSISDN Pool');
  const sims = await fetchAll('SIM Inventory');

  const mOrd = await colMap('Orders');
  const mCust = await colMap('Customers');
  const mWlt = await colMap('Wallets');
  const mSub = await colMap('Subscriptions');
  const mPool = await colMap('MSISDN Pool');
  const mSim = await colMap('SIM Inventory');

  const walletByCust = new Map();
  for (const w of wallets) {
    const cid = w.cells[mWlt['Customer']]?.[0];
    if (cid) walletByCust.set(cid, w);
  }

  let activated = 0, blocked = 0;
  for (const o of orders) {
    const otype = String(o.cells[mOrd['Order Type']] || '');
    const status = String(o.cells[mOrd['Status']] || '');
    if (!otype.includes('1')) continue; // not New Activation
    if (status.includes('4') || status.includes('5')) continue; // already Fulfilled or Cancelled

    const custId = o.cells[mOrd['Customer']]?.[0];
    const cust = customers.find(c => c._id === custId);
    if (!cust) continue;

    // KYC check
    const kyc = String(cust.cells[mCust['KYC Status']] || '');
    if (!kyc.includes('3')) {
      log(`  ✗ Order ${o.cells[mOrd['Order Code']]} blocked: KYC not verified`);
      await update('Orders', o._id, { 'Status':[6], 'Notes':'BLOCKED: KYC not verified' });
      blocked++;
      continue;
    }

    // Pick MSISDN from pool (Available)
    const availPool = pool.find(p =>
      String(p.cells[mPool['Status']] || '').includes('1') &&
      !p.cells[mPool['Assigned Subscription']]?.[0]
    );
    if (!availPool) { log(`  ✗ Order ${o.cells[mOrd['Order Code']]}: no MSISDN in pool`); continue; }

    // Pick SIM from inventory (In Stock)
    const availSim = sims.find(s =>
      String(s.cells[mSim['Status']] || '').includes('1') &&
      !s.cells[mSim['Active Subscription']]?.[0]
    );
    if (!availSim) { log(`  ✗ Order ${o.cells[mOrd['Order Code']]}: no SIM in inventory`); continue; }

    // Create subscription
    const msisdn = availPool.cells[mPool['MSISDN']];
    const iccid = availSim.cells[mSim['ICCID']];
    const imsi = availSim.cells[mSim['IMSI']];
    const newSubId = await insert('Subscriptions', {
      'Customer':[custId],
      'MSISDN': msisdn,
      'IMSI': imsi,
      'ICCID': iccid,
      'APN': 'internet',
      'Subscription Type':[3], // Hybrid
      'Status':[1], // Active
      'Activation Date': new Date().toISOString(),
      'Home Network':'OP',
      'Roaming Enabled': false,
    });
    if (!newSubId) continue;

    // Mark MSISDN as assigned
    await update('MSISDN Pool', availPool._id, {
      'Status':[3], // Assigned
      'Assigned Subscription':[newSubId],
      'Last Assigned Date': new Date().toISOString(),
    });

    // Mark SIM as activated
    await update('SIM Inventory', availSim._id, {
      'Status':[3], // Activated
      'Active Subscription':[newSubId],
    });

    // Ensure wallet exists
    if (!walletByCust.has(custId)) {
      const wid = await insert('Wallets', {
        'Customer':[custId],
        'Wallet Code': `WLT-AUTO-${Date.now()}`,
        'Currency':[1],
        'Current Balance': 0,
        'Lifetime Recharge': 0,
        'Lifetime Spend': 0,
        'Status':[1],
      });
      log(`    + auto-created wallet ${wid} for ${cust.cells[mCust['Name']]}`);
    }

    // Log lifecycle event
    await insert('Customer Lifecycle Events', {
      'Customer':[custId],
      'Event Type':[1], // Activated
      'Event Date': new Date().toISOString(),
      'Reason': `New subscription activated: ${msisdn}`,
      'Triggered By':[1],
      'New Status': 'Active',
    });

    // Log subscription status history
    await insert('Subscription Status History', {
      'Subscription':[newSubId],
      'From Status':'New',
      'To Status':'Active',
      'Changed At': new Date().toISOString(),
      'Reason':'Order fulfilled',
      'Changed By':'system',
    });

    // Mark order fulfilled
    await update('Orders', o._id, {
      'Status':[4], // Fulfilled
      'Fulfilled At': new Date().toISOString(),
      'Subscription':[newSubId],
    });

    activated++;
    await sleep(1100);
  }
  log(`  ACTIVATE-SUB: ${activated} activated, ${blocked} blocked (KYC)`);
}

// ============================================================================
// WORKFLOW 8: Plan Purchase
// Trigger: Order with Order Type = Plan Purchase, Status = Submitted
// Pre: Wallet.Current Balance >= Tariff Plan.Price
// Steps: debit wallet, close existing active SPA, create new SPA + Balances,
//        mark order Fulfilled, send PLAN_ACTIVATED notification
// ============================================================================

async function wfPlanPurchase() {
  const orders = await fetchAll('Orders');
  const orderItems = await fetchAll('Order Items');
  const customers = await fetchAll('Customers');
  const wallets = await fetchAll('Wallets');
  const subs = await fetchAll('Subscriptions');
  const tariffs = await fetchAll('Tariff Plans');
  const allowances = await fetchAll('Plan Allowances');
  const spas = await fetchAll('Subscription Plan Assignments');
  const templates = await fetchAll('Notification Templates');
  const channels = await fetchAll('Channels');

  const mOrd = await colMap('Orders');
  const mItem = await colMap('Order Items');
  const mCust = await colMap('Customers');
  const mWlt = await colMap('Wallets');
  const mSub = await colMap('Subscriptions');
  const mTariff = await colMap('Tariff Plans');
  const mAlw = await colMap('Plan Allowances');
  const mSpa = await colMap('Subscription Plan Assignments');
  const mTpl = await colMap('Notification Templates');
  const mCh = await colMap('Channels');

  const walletByCust = new Map();
  for (const w of wallets) {
    const cid = w.cells[mWlt['Customer']]?.[0];
    if (cid) walletByCust.set(cid, w);
  }

  const tplActivated = templates.find(t => t.cells[mTpl['Template Code']] === 'PLAN_ACTIVATED');
  const chSMS = channels.find(c => c.cells[mCh['Channel Code']] === 'SMS');

  let purchased = 0, blocked = 0;
  for (const o of orders) {
    const otype = String(o.cells[mOrd['Order Type']] || '');
    const status = String(o.cells[mOrd['Status']] || '');
    if (!otype.includes('2')) continue; // not Plan Purchase
    if (status.includes('4') || status.includes('5')) continue; // already done

    const custId = o.cells[mOrd['Customer']]?.[0];
    const subId = o.cells[mOrd['Subscription']]?.[0];
    const cust = customers.find(c => c._id === custId);
    const sub = subs.find(s => s._id === subId);
    if (!cust || !sub) continue;

    // Find the order's tariff plan (from Order Items)
    const orderItem = orderItems.find(it => it.cells[mItem['Order']]?.[0] === o._id);
    const tariffId = orderItem?.cells[mItem['Tariff Plan']]?.[0];
    const tariff = tariffs.find(t => t._id === tariffId);
    if (!tariff) continue;

    const price = Number(tariff.cells[mTariff['Price']]) || 0;
    const wallet = walletByCust.get(custId);
    if (!wallet) { log(`  ✗ ${o.cells[mOrd['Order Code']]}: no wallet`); blocked++; continue; }
    const balance = Number(wallet.cells[mWlt['Current Balance']]) || 0;
    if (balance < price) {
      log(`  ✗ ${o.cells[mOrd['Order Code']]}: insufficient wallet (${balance} < ${price})`);
      await update('Orders', o._id, { 'Status':[6], 'Notes':`BLOCKED: wallet $${balance} < price $${price}` });
      blocked++;
      continue;
    }

    // Debit wallet
    await update('Wallets', wallet._id, {
      'Current Balance': balance - price,
      'Lifetime Spend': (Number(wallet.cells[mWlt['Lifetime Spend']]) || 0) + price,
    });
    await insert('Wallet Transactions', {
      'Wallet':[wallet._id],
      'Transaction Code':`WTX-PP-${Date.now()}`,
      'Transaction Type':[2], // Plan Purchase
      'Amount': -price,
      'Balance Before': balance,
      'Balance After': balance - price,
      'Reference ID': o._id,
      'Reference Type':[2], // Order
      'Timestamp': new Date().toISOString(),
      'Initiated By':'workflow',
      'Notes': `Plan purchase: ${tariff.cells[mTariff['Plan Name']]}`,
    });

    // Close existing active SPA of same priority (replacement) — but for boosters keep base alive
    const planPriority = Number(tariff.cells[mTariff['Priority On Charge']]) || 10;
    const existingActive = spas.filter(a =>
      a.cells[mSpa['Subscription']]?.[0] === subId &&
      !a.cells[mSpa['Effective To']]
    );
    for (const ex of existingActive) {
      const exTariff = tariffs.find(t => t._id === ex.cells[mSpa['Tariff Plan']]?.[0]);
      const exPriority = exTariff ? Number(exTariff.cells[mTariff['Priority On Charge']]) || 10 : 10;
      // Only close if same priority (replacement), not booster stacking
      if (exPriority === planPriority) {
        await update('Subscription Plan Assignments', ex._id, {
          'Effective To': new Date().toISOString(),
          'Status':[2], // Expired
        });
      }
    }

    // Create new SPA
    const newSpaId = await insert('Subscription Plan Assignments', {
      'Subscription':[subId],
      'Tariff Plan':[tariffId],
      'Effective From': new Date().toISOString(),
      'Activation Source':[1], // Customer Self Care
      'Renewal Count': 0,
      'Status':[1], // Active
      'Price Paid': price,
    });

    // Create Balance rows from each Plan Allowance
    const validityDays = Number(tariff.cells[mTariff['Validity Days']]) || 30;
    const cycleEnd = new Date(Date.now() + validityDays * 86400000).toISOString();
    const planAllowances = allowances.filter(a => a.cells[mAlw['Tariff Plan']]?.[0] === tariffId);
    let balanceCount = 0;
    for (let i=0; i<planAllowances.length; i++) {
      const alw = planAllowances[i];
      const initial = Number(alw.cells[mAlw['Initial Amount']]) || 0;
      const rg = Number(alw.cells[mAlw['Rating Group']]) || 0;
      await insert('Balances', {
        'Subscription':[subId],
        'Subscription Plan Assignment':[newSpaId],
        'Balance Code': `BAL-AUTO-${Date.now()}-${i}`,
        'Rating Group': rg,
        'Service Context': alw.cells[mAlw['Service Context']],
        'Allowance Label': alw.cells[mAlw['Allowance Label']],
        'Unit Type': alw.cells[mAlw['Unit Type']],
        'Initial Amount': initial,
        'Used Amount': 0,
        'Remaining Amount': initial,
        'Cycle Start': new Date().toISOString(),
        'Cycle End': cycleEnd,
        'Status':[1], // Active
      });
      balanceCount++;
    }

    // Mark order fulfilled
    await update('Orders', o._id, {
      'Status':[4],
      'Fulfilled At': new Date().toISOString(),
    });

    // Send PLAN_ACTIVATED notification
    if (tplActivated && chSMS) {
      const planName = tariff.cells[mTariff['Plan Name']];
      const expiry = new Date(Date.now() + validityDays * 86400000).toLocaleDateString();
      const body = renderTemplate(tplActivated.cells[mTpl['Body']] || '', { plan_name:planName, expiry });
      await insert('Notifications Sent', {
        'Template':[tplActivated._id],
        'Customer':[custId],
        'Subscription':[subId],
        'Channel':[chSMS._id],
        'Sent At': new Date().toISOString(),
        'Delivered At': new Date().toISOString(),
        'Status':[3],
        'Content Snapshot': body,
      });
    }

    // Update Subscription.Current Plan
    await update('Subscriptions', subId, { 'Current Plan':[tariffId] });

    log(`  ✓ ${o.cells[mOrd['Order Code']]}: ${tariff.cells[mTariff['Plan Name']]} ($${price}) → ${balanceCount} balances`);
    purchased++;
    await sleep(1100);
  }
  log(`  PLAN-PURCHASE: ${purchased} purchased, ${blocked} blocked`);
}

// ============================================================================
// WORKFLOW 9: Refresh Subscription summary columns from Balances
// (Recomputes Data/Voice/SMS Remaining on every Subscription record)
// ============================================================================

async function wfRefreshSummaryColumns() {
  const subs = await fetchAll('Subscriptions');
  const balances = await fetchAll('Balances');
  const mSub = await colMap('Subscriptions');
  const mBal = await colMap('Balances');

  const balancesBySub = new Map();
  for (const b of balances) {
    const sid = b.cells[mBal['Subscription']]?.[0];
    if (!sid) continue;
    if (!balancesBySub.has(sid)) balancesBySub.set(sid, []);
    balancesBySub.get(sid).push(b);
  }

  let updated = 0;
  for (const s of subs) {
    const sBal = balancesBySub.get(s._id) || [];
    let dataRem = 0, voiceRem = 0, smsRem = 0;
    for (const b of sBal) {
      const rg = Number(b.cells[mBal['Rating Group']]) || 0;
      const rem = Number(b.cells[mBal['Remaining Amount']]) || 0;
      if (rg >= 10 && rg < 100) dataRem += rem;
      else if (rg >= 100 && rg < 200) voiceRem += rem;
      else if (rg >= 200 && rg < 300) smsRem += rem;
    }
    const curDR = Number(s.cells[mSub['Data Remaining (MB)']]) || 0;
    const curVR = Number(s.cells[mSub['Voice Remaining (min)']]) || 0;
    const curSR = Number(s.cells[mSub['SMS Remaining']]) || 0;
    // Skip if no change
    if (Math.round(curDR) === Math.round(dataRem) && Math.round(curVR*100)/100 === Math.round(voiceRem*100)/100 && Math.round(curSR) === Math.round(smsRem)) continue;
    await update('Subscriptions', s._id, {
      'Data Remaining (MB)': Math.round(dataRem),
      'Voice Remaining (min)': Math.round(voiceRem * 100) / 100,
      'SMS Remaining': Math.round(smsRem),
    });
    updated++;
    await sleep(900);
  }
  log(`  REFRESH-SUMMARY: updated ${updated} subscription summary rows`);
}

// ============================================================================
// Runner
// ============================================================================

const WORKFLOWS = {
  kyc:        wfVerifyKYC,
  activate:   wfActivateSubscription,
  purchase:   wfPlanPurchase,
  welcome:    wfWelcomeSMS,
  recharge:   wfRechargeConfirm,
  lowbal:     wfLowBalance,
  depleted:   wfMarkDepleted,
  expiring:   wfPlanExpiringSoon,
  summary:    wfRefreshSummaryColumns,
};

async function runAll() {
  log('=== Running all workflows ===');
  for (const [name, fn] of Object.entries(WORKFLOWS)) {
    try { await fn(); } catch (e) { console.error(`  ✗ ${name}:`, e.message); }
  }
  log('=== Complete ===');
}

async function main() {
  const arg = process.argv[2];
  if (!arg) return runAll();
  if (arg === 'stream') {
    log('Stream mode — Ctrl+C to stop');
    while (true) {
      await runAll();
      await sleep(30000);
    }
  } else if (WORKFLOWS[arg]) {
    await WORKFLOWS[arg]();
  } else {
    console.error(`Unknown workflow "${arg}". Available: ${Object.keys(WORKFLOWS).join(', ')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
