// Make every record consistent with the data flow:
//   Customer → Wallet → Recharge → Wallet Transaction → Partner Commission
//   Customer → Subscription → Current Plan (Tariff Plan)
//   Subscription + Plan → Balance rows (Initial from Tariff Plan columns)
//   Balance + Usage Transactions → Used Amount (sum) → Remaining (initial - used)
//   Charging Session → Call Detail Record (with Tariff Plan linked)
//   Distribution Partner → allocated Vouchers, SIM Inventory, Recharges
//
// Everything should flow. No hardcoded nonsense.

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

async function colMap(t) {
  if (colMapCache.has(t)) return colMapCache.get(t);
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[t]}`);
  const cols = r.columnsMetaData || [];
  const m = {}; for (const c of cols) m[c.name] = c.id;
  colMapCache.set(t, m); return m;
}

async function fetchAll(t) {
  const all = []; let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[t]}/paged-record?pageNo=${page}&pageSize=200`, {});
    const batch = r?.data || [];
    all.push(...batch);
    if (batch.length < 200) break;
    page++; await sleep(300);
  }
  return all;
}

async function update(t, id, cellsByName) {
  const m = await colMap(t);
  const cellsById = {};
  for (const [k, v] of Object.entries(cellsByName)) if (m[k]) cellsById[m[k]] = v;
  return api('PUT', `/v1/app-builder/table/${TABLE_IDS[t]}/record/${id}`, { cells: cellsById });
}

const log = (s) => console.log(`[${new Date().toISOString().slice(11,19)}] ${s}`);

// ============================================================================

async function main() {
  log('Loading all data...');
  const [
    customers, subs, wallets, tariffs, balances, utxs, sessions, cdrs,
    recharges, walletTxns, partners, vouchers, sims, msisdnPool, commissions,
  ] = await Promise.all([
    fetchAll('Customers'),
    fetchAll('Subscriptions'),
    fetchAll('Wallets'),
    fetchAll('Tariff Plans'),
    fetchAll('Balances'),
    fetchAll('Usage Transactions'),
    fetchAll('Charging Sessions'),
    fetchAll('Call Detail Records'),
    fetchAll('Recharges'),
    fetchAll('Wallet Transactions'),
    fetchAll('Distribution Partners'),
    fetchAll('Recharge Vouchers'),
    fetchAll('SIM Inventory'),
    fetchAll('MSISDN Pool'),
    fetchAll('Partner Commissions'),
  ]);

  const mCust = await colMap('Customers');
  const mSub = await colMap('Subscriptions');
  const mWlt = await colMap('Wallets');
  const mTariff = await colMap('Tariff Plans');
  const mBal = await colMap('Balances');
  const mUtx = await colMap('Usage Transactions');
  const mSess = await colMap('Charging Sessions');
  const mCdr = await colMap('Call Detail Records');
  const mRech = await colMap('Recharges');
  const mWtx = await colMap('Wallet Transactions');
  const mPtr = await colMap('Distribution Partners');
  const mVch = await colMap('Recharge Vouchers');
  const mSim = await colMap('SIM Inventory');
  const mMp = await colMap('MSISDN Pool');
  const mComm = await colMap('Partner Commissions');

  log(`  customers=${customers.length}, subs=${subs.length}, wallets=${wallets.length}, tariffs=${tariffs.length}`);
  log(`  balances=${balances.length}, utxs=${utxs.length}, sessions=${sessions.length}, cdrs=${cdrs.length}`);
  log(`  recharges=${recharges.length}, walletTxns=${walletTxns.length}, partners=${partners.length}, vouchers=${vouchers.length}`);

  // ========================================================================
  // FIX 1: Balance.Used Amount = SUM of Usage Transactions.Used Amount
  //        Balance.Remaining = Initial - Used
  //        Balance.Status = Depleted if Remaining <= 0
  // ========================================================================
  log('FIX 1: Balance Used + Remaining from Usage Transactions');
  const usedByBalance = new Map();
  for (const u of utxs) {
    const balId = u.cells[mUtx['Balance']]?.[0];
    if (!balId) continue;
    const used = Number(u.cells[mUtx['Used Amount']]) || 0;
    usedByBalance.set(balId, (usedByBalance.get(balId) || 0) + used);
  }
  for (const b of balances) {
    const init = Number(b.cells[mBal['Initial Amount']]) || 0;
    const used = usedByBalance.get(b._id) || 0;
    const remaining = Math.max(0, init - used);
    const status = remaining <= 0 ? [2] : [1];
    await update('Balances', b._id, {
      'Used Amount': Math.round(used * 100) / 100,
      'Remaining Amount': Math.round(remaining * 100) / 100,
      'Status': status,
    });
    await sleep(700);
  }
  log(`  ✓ updated ${balances.length} balances`);

  // ========================================================================
  // FIX 2: Subscription.Current Plan — pull from Balance.Tariff Plan (highest priority = base)
  // ========================================================================
  log('FIX 2: Subscription.Current Plan from active base Balance');
  const tariffById = new Map(tariffs.map(t => [t._id, t]));
  const balancesBySub = new Map();
  for (const b of balances) {
    const subId = b.cells[mBal['Subscription']]?.[0];
    if (!subId) continue;
    if (!balancesBySub.has(subId)) balancesBySub.set(subId, []);
    balancesBySub.get(subId).push(b);
  }
  let currentPlanSet = 0;
  for (const s of subs) {
    const sBals = balancesBySub.get(s._id) || [];
    if (!sBals.length) continue;
    // Pick the base plan (highest Priority On Charge) among this sub's active balances
    let baseTariff = null, basePrio = -1;
    for (const b of sBals) {
      const tariffId = b.cells[mBal['Tariff Plan']]?.[0];
      if (!tariffId) continue;
      const effTo = b.cells[mBal['Effective To']];
      if (effTo) continue; // ended
      const tariff = tariffById.get(tariffId);
      if (!tariff) continue;
      const prio = Number(tariff.cells[mTariff['Priority On Charge']]) || 10;
      if (prio > basePrio) { basePrio = prio; baseTariff = tariffId; }
    }
    if (baseTariff) {
      await update('Subscriptions', s._id, { 'Current Plan': [baseTariff] });
      currentPlanSet++;
    }
    await sleep(600);
  }
  log(`  ✓ set Current Plan on ${currentPlanSet} subs`);

  // ========================================================================
  // FIX 3: Refresh Subscription Data/Voice/SMS Remaining from Balances
  // ========================================================================
  log('FIX 3: Subscription Data/Voice/SMS Remaining summary');
  for (const s of subs) {
    const sBals = balancesBySub.get(s._id) || [];
    let dataRem = 0, voiceRem = 0, smsRem = 0;
    for (const b of sBals) {
      const init = Number(b.cells[mBal['Initial Amount']]) || 0;
      const used = usedByBalance.get(b._id) || 0;
      const rem = Math.max(0, init - used);
      const rg = Number(b.cells[mBal['Rating Group']]) || 0;
      if (rg >= 10 && rg < 100) dataRem += rem;
      else if (rg >= 100 && rg < 200) voiceRem += rem;
      else if (rg >= 200 && rg < 300) smsRem += rem;
    }
    await update('Subscriptions', s._id, {
      'Data Remaining (MB)': Math.round(dataRem),
      'Voice Remaining (min)': Math.round(voiceRem * 100) / 100,
      'SMS Remaining': Math.round(smsRem),
    });
    await sleep(600);
  }
  log(`  ✓ refreshed ${subs.length} sub summaries`);

  // ========================================================================
  // FIX 4: Call Detail Records.Tariff Plan — inherit from session's subscription current plan
  // ========================================================================
  log('FIX 4: CDR.Tariff Plan from session subscription');
  const subById = new Map(subs.map(s => [s._id, s]));
  let cdrFixed = 0;
  for (const cdr of cdrs) {
    const subId = cdr.cells[mCdr['Subscription']]?.[0];
    const sub = subById.get(subId);
    if (!sub) continue;
    const currentPlan = sub.cells[mSub['Current Plan']]?.[0];
    if (!currentPlan) continue;
    await update('Call Detail Records', cdr._id, { 'Tariff Plan': [currentPlan] });
    cdrFixed++;
    await sleep(700);
  }
  log(`  ✓ set Tariff Plan on ${cdrFixed} CDRs`);

  // ========================================================================
  // FIX 5: Recharge Vouchers.Allocated Partner — distribute remaining vouchers across partners
  // ========================================================================
  log('FIX 5: Voucher allocation + recharge linkage');
  // Partition vouchers evenly across 3 partners
  let allocated = 0;
  for (let i=0; i<vouchers.length; i++) {
    const v = vouchers[i];
    if (v.cells[mVch['Allocated Partner']]?.[0]) continue;
    const partner = partners[i % partners.length];
    await update('Recharge Vouchers', v._id, { 'Allocated Partner': [partner._id] });
    allocated++;
    await sleep(600);
  }
  log(`  ✓ allocated ${allocated} vouchers to partners`);

  // Link Redeemed vouchers to the Recharge that used them
  let linked = 0;
  for (const r of recharges) {
    const serial = r.cells[mRech['Voucher Serial']];
    if (!serial) continue;
    const voucher = vouchers.find(v => v.cells[mVch['Voucher Serial']] === serial);
    if (!voucher) continue;
    await update('Recharge Vouchers', voucher._id, {
      'Redeemed By Recharge': [r._id],
      'Status': [4], // Redeemed
      'Redeemed Date': r.cells[mRech['Timestamp']] || new Date().toISOString(),
    });
    linked++;
    await sleep(600);
  }
  log(`  ✓ linked ${linked} redeemed vouchers to recharges`);

  // ========================================================================
  // FIX 6: SIM Inventory.Allocated To Partner — in-stock SIMs allocated to partners
  // ========================================================================
  log('FIX 6: SIM allocation to partners');
  let simAllocated = 0;
  for (let i=0; i<sims.length; i++) {
    const sim = sims[i];
    const status = String(sim.cells[mSim['Status']] || '[3]');
    // Only allocate "In Stock" SIMs (status=1) to partners; Activated ones stay linked to subscriptions
    if (!status.includes('1')) continue;
    if (sim.cells[mSim['Allocated To Partner']]?.[0]) continue;
    const partner = partners[i % partners.length];
    await update('SIM Inventory', sim._id, { 'Allocated To Partner': [partner._id] });
    simAllocated++;
    await sleep(600);
  }
  log(`  ✓ allocated ${simAllocated} in-stock SIMs to partners`);

  // ========================================================================
  // FIX 7: Wallet balance consistency — recompute from recharges + wallet transactions
  //        Current Balance = SUM(recharges) + SUM(other credits) - SUM(debits)
  // ========================================================================
  log('FIX 7: Wallet balance consistency with transactions');
  const walletsByCust = new Map();
  for (const w of wallets) {
    const cid = w.cells[mWlt['Customer']]?.[0];
    if (cid) walletsByCust.set(cid, w);
  }
  const rechargesByWallet = new Map();
  for (const r of recharges) {
    const wid = r.cells[mRech['Wallet']]?.[0];
    if (!wid) continue;
    if (!rechargesByWallet.has(wid)) rechargesByWallet.set(wid, []);
    rechargesByWallet.get(wid).push(r);
  }
  const txnsByWallet = new Map();
  for (const tx of walletTxns) {
    const wid = tx.cells[mWtx['Wallet']]?.[0];
    if (!wid) continue;
    if (!txnsByWallet.has(wid)) txnsByWallet.set(wid, []);
    txnsByWallet.get(wid).push(tx);
  }

  for (const w of wallets) {
    const wRecharges = rechargesByWallet.get(w._id) || [];
    const wTxns = txnsByWallet.get(w._id) || [];
    const totalRecharge = wRecharges
      .filter(r => String(r.cells[mRech['Status']] || '').includes('2'))
      .reduce((sum, r) => sum + (Number(r.cells[mRech['Amount']]) || 0), 0);
    const totalDebit = wTxns
      .reduce((sum, tx) => {
        const amt = Number(tx.cells[mWtx['Amount']]) || 0;
        return sum + (amt < 0 ? -amt : 0);
      }, 0);
    const currentBalance = Math.round((totalRecharge - totalDebit) * 100) / 100;
    await update('Wallets', w._id, {
      'Current Balance': currentBalance,
      'Lifetime Recharge': Math.round(totalRecharge * 100) / 100,
      'Lifetime Spend': Math.round(totalDebit * 100) / 100,
    });
    await sleep(600);
  }
  log(`  ✓ recomputed ${wallets.length} wallet balances from history`);

  log('');
  log('== DATA CONSISTENCY FIXES COMPLETE ==');
}

main().catch(e => { console.error(e); process.exit(1); });
