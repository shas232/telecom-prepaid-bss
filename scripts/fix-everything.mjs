// One-shot cleanup + backfill for every defect the audit surfaced
// (minus the 2 backend engine bugs). Re-audit after running.

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
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function api(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  for (let i = 0; i < 4; i++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt, status: res.status }; }
    if (res.status === 429) { await sleep(2000); continue; }
    return { ok: res.ok, status: res.status, data };
  }
}

async function fetchAll(tname) {
  const all = [];
  let page = 1;
  while (true) {
    const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/paged-record?pageNo=${page}&pageSize=300`, {});
    const b = r.data?.data || [];
    all.push(...b);
    if (b.length < 300) break;
    page++;
  }
  return all;
}

async function patch(tname, id, cells) {
  return api('PUT', `/v1/app-builder/table/${TABLE_IDS[tname]}/record/${id}`, { cells });
}
async function del(tname, id) {
  return api('DELETE', `/v1/app-builder/table/${TABLE_IDS[tname]}/record/${id}`);
}
async function createRecord(tname, cells) {
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/record`, { cells });
  return r.data?.id || r.data?.data?.[0]?._id;
}

const stats = { orphansCleared: 0, recsDeleted: 0, negWalletsFixed: 0, cellsFilled: 0, deadColsRemoved: 0 };

const TABLES = [
  'Customers','Subscriptions','Tariff Plans','Balances','Wallets',
  'Charging Sessions','Usage Transactions','Recharges','Wallet Transactions',
  'Orders','Order Items','MSISDN Pool','SIM Inventory','Cases',
  'Customer Identifications','Customer Interactions','Customer Lifecycle Events',
  'Notifications Sent','Notification Templates','Partner Commissions',
  'Partner Contracts','Distribution Partners','Call Detail Records','Network Elements',
  'Channels','Account Hierarchy','Bundle Components','Users',
];

console.log('Loading records + schemas...');
const records = {}, schema = {};
for (const tn of TABLES) {
  records[tn] = await fetchAll(tn);
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tn]}`);
  schema[tn] = r.data.columnsMetaData || [];
}
const idToName = Object.fromEntries(Object.entries(TABLE_IDS).map(([n, i]) => [i, n]));
const existsIn = {};
for (const tn of TABLES) existsIn[tn] = new Set(records[tn].map(r => r._id));
function col(tn, name) { return schema[tn].find(c => c.name === name); }
function colId(tn, name) { return col(tn, name)?.id; }

// ===========================================================================
// FIX 1: Delete orphan refs
// ===========================================================================
console.log('\n=== Fix 1: Clearing orphan refs ===');
async function clearOrphans(tn, refName) {
  const refCol = col(tn, refName);
  if (!refCol || refCol.type !== 'ref') return;
  const targetTable = idToName[refCol.refTable?._id];
  if (!targetTable || !existsIn[targetTable]) return;
  for (const r of records[tn]) {
    const v = r.cells[refCol.id];
    if (v == null) continue;
    const arr = Array.isArray(v) ? v : [v];
    if (arr.some(id => id && !existsIn[targetTable].has(id))) {
      await patch(tn, r._id, { [refCol.id]: [] });
      stats.orphansCleared++;
      await sleep(120);
    }
  }
}
for (const [tn, col] of [
  ['Balances', 'Subscription'], ['Recharges', 'Wallet'], ['Wallets', 'Customer'],
  ['Subscriptions', 'Customer'], ['Usage Transactions', 'Charging Session'],
  ['Usage Transactions', 'Subscription'], ['Usage Transactions', 'Balance'],
  ['Charging Sessions', 'Subscription'], ['Wallet Transactions', 'Wallet'],
]) await clearOrphans(tn, col);
console.log(`  cleared ${stats.orphansCleared} orphan refs`);

// ===========================================================================
// FIX 2: Delete leftover E2E sub + impossible balance
// ===========================================================================
console.log('\n=== Fix 2: Delete corrupted records ===');
records['Subscriptions'] = await fetchAll('Subscriptions');
const leftover = records['Subscriptions'].find(s => s.cells['sDya'] === '919900000001');
if (leftover) {
  const subId = leftover._id;
  records['Balances'] = await fetchAll('Balances');
  records['Usage Transactions'] = await fetchAll('Usage Transactions');
  records['Charging Sessions'] = await fetchAll('Charging Sessions');
  const bSub = colId('Balances', 'Subscription');
  const uSub = colId('Usage Transactions', 'Subscription');
  const csSub = colId('Charging Sessions', 'Subscription');
  for (const b of records['Balances']) {
    const v = b.cells[bSub]; if (v && (Array.isArray(v)?v[0]:v) === subId) { await del('Balances', b._id); stats.recsDeleted++; }
  }
  for (const u of records['Usage Transactions']) {
    const v = u.cells[uSub]; if (v && (Array.isArray(v)?v[0]:v) === subId) { await del('Usage Transactions', u._id); stats.recsDeleted++; }
  }
  for (const cs of records['Charging Sessions']) {
    const v = cs.cells[csSub]; if (v && (Array.isArray(v)?v[0]:v) === subId) { await del('Charging Sessions', cs._id); stats.recsDeleted++; }
  }
  await del('Subscriptions', subId); stats.recsDeleted++;
  console.log('  deleted leftover MSISDN=919900000001 and its children');
}

// Impossible balance (used > initial)
records['Balances'] = await fetchAll('Balances');
records['Usage Transactions'] = await fetchAll('Usage Transactions');
const bInitId = colId('Balances', 'Initial Amount');
const bUsedId = colId('Balances', 'Used Amount');
const utBalCol = colId('Usage Transactions', 'Balance');
for (const b of records['Balances']) {
  const i = b.cells[bInitId] || 0;
  const u = b.cells[bUsedId] || 0;
  if (u > i && i > 0) {
    console.log(`  deleting impossible balance ${b.cells['ucLa']} (${u}/${i})`);
    for (const ut of records['Usage Transactions']) {
      const v = ut.cells[utBalCol];
      if (v && (Array.isArray(v)?v[0]:v) === b._id) { await del('Usage Transactions', ut._id); stats.recsDeleted++; }
    }
    await del('Balances', b._id); stats.recsDeleted++;
  }
}

// ===========================================================================
// FIX 3: Delete ghost Charging Sessions (no UTs)
// ===========================================================================
console.log('\n=== Fix 3: Delete ghost charging sessions ===');
records['Charging Sessions'] = await fetchAll('Charging Sessions');
records['Usage Transactions'] = await fetchAll('Usage Transactions');
const utSessCol = colId('Usage Transactions', 'Charging Session');
const sessWithUt = new Set();
for (const u of records['Usage Transactions']) {
  const v = u.cells[utSessCol]; if (v) (Array.isArray(v)?v:[v]).forEach(id => sessWithUt.add(id));
}
let ghostCount = 0;
for (const s of records['Charging Sessions']) {
  if (!sessWithUt.has(s._id)) { await del('Charging Sessions', s._id); stats.recsDeleted++; ghostCount++; await sleep(90); }
}
console.log(`  deleted ${ghostCount} ghost sessions`);

// ===========================================================================
// FIX 4: Top up negative wallets
// ===========================================================================
console.log('\n=== Fix 4: Top up negative wallets ===');
records['Wallets'] = await fetchAll('Wallets');
const walletBalId = colId('Wallets', 'Current Balance');
const wltRech = colId('Wallets', 'Lifetime Recharge');
const wtxAmtId = colId('Wallet Transactions', 'Amount');
const wtxWalletId = colId('Wallet Transactions', 'Wallet');
for (const w of records['Wallets']) {
  const bal = w.cells[walletBalId] || 0;
  if (bal >= 0) continue;
  const topUp = Math.ceil(Math.abs(bal) / 50) * 50 + 50;
  const newBal = bal + topUp;
  await createRecord('Wallet Transactions', {
    '93aU': `WTX-ADJ-${w.cells['MjRH']}-${Date.now()}`,
    [wtxAmtId]: topUp,
    ajVy: Date.now(),
    FT69: [1],
    YBNC: [3],
    mqMb: 'balance-correction',
    jNFT: bal, '1Hc4': newBal,
    NyKH: 'system',
    uw5l: `Balance correction: ${bal} → ${newBal}`,
    [wtxWalletId]: [w._id],
  });
  await patch('Wallets', w._id, {
    [walletBalId]: newBal,
    [wltRech]: (w.cells[wltRech] || 0) + topUp,
    aj2c: Date.now(),
  });
  stats.negWalletsFixed++;
  console.log(`  ${w.cells['MjRH']}: ${bal} → ${newBal}`);
  await sleep(120);
}

// ===========================================================================
// FIX 5: Backfill empty-but-should-be-filled columns
// ===========================================================================
console.log('\n=== Fix 5: Backfill sparse data columns ===');

// Helper to only update cells that are currently empty
async function fillEmpty(tname, records, colId, valueForRow) {
  for (const r of records) {
    const v = r.cells[colId];
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) {
      const newVal = valueForRow(r);
      if (newVal != null) {
        await patch(tname, r._id, { [colId]: newVal });
        stats.cellsFilled++;
        await sleep(80);
      }
    }
  }
}

// Users.Last Name
records['Users'] = await fetchAll('Users');
await fillEmpty('Users', records['Users'], colId('Users', 'Last Name'), r => {
  const first = r.cells[colId('Users','First Name')] || 'User';
  const fallback = { Admin: 'Kumar', System: 'Ops', Operator: 'Singh' }[first] || 'Sharma';
  return fallback;
});

// Subscriptions.Notes — add operational notes for a subset
records['Subscriptions'] = await fetchAll('Subscriptions');
const subNoteId = colId('Subscriptions', 'Notes');
for (const r of records['Subscriptions']) {
  if (r.cells[subNoteId]) continue;
  const status = (r.cells[colId('Subscriptions','Status')] || [1])[0];
  const note = status === 1
    ? pick(['Activated via retail channel.','Port-in from competitor; KYC reverified.','Added to family plan.','High-priority business line.','Repeat recharger; loyalty tier 2.'])
    : pick(['Suspended due to dunning.','Awaiting KYC re-verification.','Voluntary hold.','Flagged by fraud engine — manual review.']);
  await patch('Subscriptions', r._id, { [subNoteId]: note });
  stats.cellsFilled++;
  await sleep(70);
}

// Subscriptions.Termination Date — only for terminated/port-out statuses
const subStatusId = colId('Subscriptions','Status');
const subTermId = colId('Subscriptions','Termination Date');
for (const r of records['Subscriptions']) {
  if (r.cells[subTermId]) continue;
  const status = (r.cells[subStatusId] || [1])[0];
  if (status === 3 || status === 4) {   // Terminated / Port Out
    await patch('Subscriptions', r._id, { [subTermId]: Date.now() - rand(1, 90) * 86400_000 });
    stats.cellsFilled++;
    await sleep(70);
  }
}

// MSISDN Pool.Reservation Expiry — only where Status = Reserved (id=2)
records['MSISDN Pool'] = await fetchAll('MSISDN Pool');
const mpStatusId = colId('MSISDN Pool','Status');
const mpExpId = colId('MSISDN Pool','Reservation Expiry');
for (const r of records['MSISDN Pool']) {
  if (r.cells[mpExpId]) continue;
  const status = (r.cells[mpStatusId] || [1])[0];
  if (status === 2) {
    await patch('MSISDN Pool', r._id, { [mpExpId]: Date.now() + rand(1, 30) * 86400_000 });
    stats.cellsFilled++;
    await sleep(70);
  }
}

// SIM Inventory.Received Date
records['SIM Inventory'] = await fetchAll('SIM Inventory');
await fillEmpty('SIM Inventory', records['SIM Inventory'], colId('SIM Inventory','Received Date'),
  () => Date.now() - rand(30, 365) * 86400_000);

// Customer Identifications.Scan URL — generate plausible cloud URL
records['Customer Identifications'] = await fetchAll('Customer Identifications');
await fillEmpty('Customer Identifications', records['Customer Identifications'], colId('Customer Identifications','Scan URL'),
  r => `https://kyc-docs.example.com/scans/${r._id}/front.jpg`);

// Customer Lifecycle Events.Notes
records['Customer Lifecycle Events'] = await fetchAll('Customer Lifecycle Events');
await fillEmpty('Customer Lifecycle Events', records['Customer Lifecycle Events'], colId('Customer Lifecycle Events','Notes'),
  r => {
    const type = (r.cells[colId('Customer Lifecycle Events','Event Type')] || [1])[0];
    return {
      1: 'Activated via self-care portal.',
      2: 'Suspended — validity expired with insufficient balance to renew.',
      3: 'Reactivated after top-up; balance restored.',
      4: 'Churned — zero usage for 90 days.',
      5: 'Reinstated per regulatory appeal.',
      6: 'Merged into primary account.',
      7: 'KYC document resubmitted and verified.',
    }[type] || 'Lifecycle event recorded.';
  });

// Customer Interactions.Transcript
records['Customer Interactions'] = await fetchAll('Customer Interactions');
await fillEmpty('Customer Interactions', records['Customer Interactions'], colId('Customer Interactions','Transcript'),
  r => {
    const t = (r.cells[colId('Customer Interactions','Interaction Type')] || [1])[0];
    return {
      1: 'Customer queried current balance via USSD *121#. Response: 14.5GB data, 999 min voice, 287 SMS remaining.',
      2: 'Customer recharged ₹30 via mobile app. Success. Confirmation SMS sent.',
      3: 'Customer purchased Unlimited Monthly Pack ₹30. Allowances seeded; welcome notification queued.',
      4: 'Customer complaint: slow data in morning hours. Routed to network ops.',
      5: 'Customer queried plan validity expiry; CSR confirmed 7 days remaining.',
      6: 'Status update delivered: recharge success and new balance.',
      7: 'Customer used self-care to enable roaming for upcoming travel.',
    }[t] || 'Customer interaction recorded.';
  });

// Call Detail Records — fill Total Octets, Partner Involved
records['Call Detail Records'] = await fetchAll('Call Detail Records');
const cdrMbId = colId('Call Detail Records','Total MB');
const cdrOctId = colId('Call Detail Records','Total Octets');
const cdrPartnerId = colId('Call Detail Records','Partner Involved');
for (const r of records['Call Detail Records']) {
  const updates = {};
  if (!r.cells[cdrOctId]) {
    const mb = r.cells[cdrMbId] || 0;
    updates[cdrOctId] = Math.round(mb * 1024 * 1024);
  }
  if (!r.cells[cdrPartnerId]) {
    updates[cdrPartnerId] = pick(['','','','Vodafone IN','Airtel','Reliance Jio','BSNL','Idea','Tata','International Gateway']);
  }
  if (Object.keys(updates).length) {
    await patch('Call Detail Records', r._id, updates);
    stats.cellsFilled++;
    await sleep(70);
  }
}

// Notifications Sent.Read At — backfill for half of push/in-app notifications (realistic read receipts)
records['Notifications Sent'] = await fetchAll('Notifications Sent');
const nsReadId = colId('Notifications Sent', 'Read At');
if (nsReadId) {
  for (const r of records['Notifications Sent']) {
    if (r.cells[nsReadId]) continue;
    if (Math.random() > 0.55) continue;   // only 45% read
    const sent = r.cells[colId('Notifications Sent','Sent At')] || r.cells['CTDT'];
    const sentMs = typeof sent === 'string' ? new Date(sent).getTime() : sent;
    if (!sentMs) continue;
    const readMs = sentMs + rand(60_000, 3600_000 * 6);   // 1 min–6h later
    await patch('Notifications Sent', r._id, { [nsReadId]: readMs });
    stats.cellsFilled++;
    await sleep(70);
  }
}

// Notification Templates: fill Subject + Variables per Trigger Event
records['Notification Templates'] = await fetchAll('Notification Templates');
const ntSubId = colId('Notification Templates','Subject');
const ntVarId = colId('Notification Templates','Variables');
const ntTrigId = colId('Notification Templates','Trigger Event');
for (const r of records['Notification Templates']) {
  const trig = (r.cells[ntTrigId] || [1])[0];
  const meta = {
    1: { subject: 'Low Balance Alert', vars: '{msisdn},{remaining},{plan}' },
    2: { subject: 'Your Plan is Expiring Soon', vars: '{msisdn},{plan},{days_left}' },
    3: { subject: 'Recharge Successful', vars: '{msisdn},{amount},{new_balance}' },
    4: { subject: 'Plan Activated', vars: '{msisdn},{plan},{data},{voice},{sms}' },
    5: { subject: 'Exclusive Offer For You', vars: '{msisdn},{promo_code},{discount}' },
    6: { subject: 'Plan Depleted — Top Up Now', vars: '{msisdn},{service}' },
    7: { subject: 'KYC Documents Required', vars: '{msisdn},{deadline}' },
    8: { subject: 'Welcome to the Network!', vars: '{msisdn},{plan}' },
  }[trig] || { subject: 'Notification', vars: '{msisdn}' };
  const updates = {};
  if (!r.cells[ntSubId]) updates[ntSubId] = meta.subject;
  if (!r.cells[ntVarId]) updates[ntVarId] = meta.vars;
  if (Object.keys(updates).length) {
    await patch('Notification Templates', r._id, updates);
    stats.cellsFilled++;
    await sleep(70);
  }
}

// Partner Commissions.Settled Date — for Settled status (id=3)
records['Partner Commissions'] = await fetchAll('Partner Commissions');
const pcStatusId = colId('Partner Commissions','Status');
const pcSettledId = colId('Partner Commissions','Settled Date');
const pcAccruedId = colId('Partner Commissions','Accrued Date');
for (const r of records['Partner Commissions']) {
  if (r.cells[pcSettledId]) continue;
  const status = (r.cells[pcStatusId] || [1])[0];
  if (status === 3) {
    const accrued = r.cells[pcAccruedId] || Date.now() - 30 * 86400_000;
    await patch('Partner Commissions', r._id, { [pcSettledId]: accrued + rand(7, 30) * 86400_000 });
    stats.cellsFilled++;
    await sleep(70);
  }
}

// Distribution Partners.Commission Scheme
records['Distribution Partners'] = await fetchAll('Distribution Partners');
const dpComId = colId('Distribution Partners', 'Commission Scheme');
await fillEmpty('Distribution Partners', records['Distribution Partners'], dpComId,
  r => {
    const tier = (r.cells[colId('Distribution Partners','Tier')] || [3])[0];
    return { 1: '5% on all recharges + ₹25 per activation', 2: '3.5% on all recharges + ₹15 per activation', 3: '2% on all recharges + ₹10 per activation' }[tier] || '2% flat';
  });

// Network Elements.Last Heartbeat
records['Network Elements'] = await fetchAll('Network Elements');
await fillEmpty('Network Elements', records['Network Elements'], colId('Network Elements','Last Heartbeat'),
  () => Date.now() - rand(10_000, 600_000));

// Channels.Operating Hours + Config JSON
records['Channels'] = await fetchAll('Channels');
await fillEmpty('Channels', records['Channels'], colId('Channels','Operating Hours'),
  r => {
    const t = (r.cells[colId('Channels','Channel Type')] || [1])[0];
    return [1,2,3,4,5].includes(t) ? '24/7' : 'Mon-Sat 09:00-21:00';
  });
await fillEmpty('Channels', records['Channels'], colId('Channels','Config JSON'),
  r => {
    const t = (r.cells[colId('Channels','Channel Type')] || [1])[0];
    return {
      1: JSON.stringify({ shortcode:'*121#', timeout_s:30, max_depth:4 }),
      2: JSON.stringify({ shortcode:'121', aggregator:'Kaleyra' }),
      3: JSON.stringify({ ivr:'+91-22-0000-0000', languages:['en','hi'] }),
      4: JSON.stringify({ min_app_version:'3.2.0', push_provider:'FCM' }),
      5: JSON.stringify({ base_url:'https://selfcare.example.com', sso:true }),
      6: JSON.stringify({ pos_vendor:'Ingenico', reconciliation:'daily' }),
      7: JSON.stringify({ provider:'WhatsApp Business', whatsapp_id:'15551234567' }),
      8: JSON.stringify({ handle:'@operator', platform:'Twitter,Facebook' }),
    }[t] || '{}';
  });

// Partner Contracts.Signed Document URL
records['Partner Contracts'] = await fetchAll('Partner Contracts');
await fillEmpty('Partner Contracts', records['Partner Contracts'], colId('Partner Contracts','Signed Document URL'),
  r => `https://contracts.example.com/${r.cells[colId('Partner Contracts','Contract Number')] || r._id}.pdf`);

// Account Hierarchy.Effective To + Notes
records['Account Hierarchy'] = await fetchAll('Account Hierarchy');
await fillEmpty('Account Hierarchy', records['Account Hierarchy'], colId('Account Hierarchy','Effective To'),
  () => Date.now() + rand(90, 720) * 86400_000);
await fillEmpty('Account Hierarchy', records['Account Hierarchy'], colId('Account Hierarchy','Notes'),
  r => {
    const t = (r.cells[colId('Account Hierarchy','Relationship Type')] || [1])[0];
    return { 1:'Primary account holder; manages family sub-lines.', 2:'Secondary family line on parent plan.',
             3:'Corporate master account; consolidates invoicing.', 4:'Corporate employee line under master account.' }[t];
  });

// Bundle Components.Notes
records['Bundle Components'] = await fetchAll('Bundle Components');
await fillEmpty('Bundle Components', records['Bundle Components'], colId('Bundle Components','Notes'),
  r => `Component qty ${r.cells[colId('Bundle Components','Quantity')] || 1} — seq ${r.cells[colId('Bundle Components','Sequence')] || 1}`);

// Usage Transactions.FUI Redirect URL — only for FUI Action = redirect (id=2)
records['Usage Transactions'] = await fetchAll('Usage Transactions');
const utFuiAct = colId('Usage Transactions','FUI Action');
const utFuiUrl = colId('Usage Transactions','FUI Redirect URL');
// We'll only fill where an FUI Action has been set to "redirect" type — sparse by design
let fuiFilled = 0;
for (const r of records['Usage Transactions']) {
  if (r.cells[utFuiUrl]) continue;
  const act = (r.cells[utFuiAct] || [0])[0];
  if (act === 2 || (Math.random() < 0.02 && act === 1)) {   // rare: only a small subset genuinely needed
    await patch('Usage Transactions', r._id, { [utFuiUrl]: 'https://topup.example.com/?msisdn=' + (r.cells['dbQH'] || '') });
    fuiFilled++; stats.cellsFilled++;
    await sleep(50);
  }
}
console.log(`  filled FUI URL on ${fuiFilled} UTs (where applicable)`);

console.log('\n=== ALL FIXES COMPLETE ===');
console.log(JSON.stringify(stats, null, 2));
