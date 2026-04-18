// END-TO-END INTEGRATION TEST for the Telecom BSS
//
// Exercises every link in the billing chain with a fresh test identity:
//   Customer → Subscription → Tariff Plan → Balances × 3 (data/voice/SMS)
//   Wallet → Recharge → Wallet Transaction
//   Charging Session → Usage Transactions
//
// Then verifies every computed column end-to-end:
//   - Lookups (Tariff→Balance, Subscription→Balance, Wallet→Recharge)
//   - Rollups (UT→Balance.Used, UT→Session.Total UT Used,
//              Balance→Subscription.Total Initial/Used, Balance→TariffPlan.Total Seeded,
//              Subscription→Customer.Subscription Count,
//              Subscription→TariffPlan.Active Subscribers,
//              Recharge→Wallet.Total Recharges / Recharge Count)
//   - Math formulas (Balance.Remaining, Usage %, Plan Utilization %, etc.)

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

const TEST_TAG = 'E2E-TEST-' + Date.now();

async function api(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  for (let i = 0; i < 5; i++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt, status: res.status }; }
    if (res.status === 429) { await sleep(2000); continue; }
    return { ok: res.ok, status: res.status, data };
  }
}

async function createRecord(tname, cells) {
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/record`, { cells });
  const id = r.data?.id || r.data?.data?.[0]?._id;
  if (!r.data?.success || !id) {
    throw new Error(`Failed to create ${tname}: ${JSON.stringify(r.data).slice(0, 400)}`);
  }
  return id;
}

async function getRecord(tname, id) {
  const r = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tname]}/record/${id}`);
  return r.data;
}

async function evalAllComputed(tname, ids) {
  const t = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tname]}`);
  const cols = (t.data.columnsMetaData || []).filter(c => c.type === 'formula' || c.type === 'rollup');
  for (const c of cols) {
    await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/evaluate/${c.id}?appId=${APP_ID}`, {
      sessionId: `e2e-${c.id}-${Date.now()}`, filter: { ids },
    });
    await sleep(400);
  }
}

async function main() {
  console.log(`=== E2E INTEGRATION TEST — tag: ${TEST_TAG} ===\n`);
  const results = { tag: TEST_TAG, created: {}, checks: [] };

  // ----------------------------------------------------------------
  // Step 1: Pick an existing Tariff Plan (Unlimited Monthly Pack)
  // ----------------------------------------------------------------
  console.log('1. Locating Tariff Plan "Unlimited Monthly Pack"');
  const tp = await api('POST', `/v1/app-builder/table/${TABLE_IDS['Tariff Plans']}/paged-record?pageNo=1&pageSize=50`, {});
  const plan = (tp.data.data || []).find(p => p.cells['kSbg'] === 'Unlimited Monthly Pack');
  if (!plan) throw new Error('Tariff plan not found');
  console.log(`   planId=${plan._id} price=${plan.cells['WZ99']} validity=${plan.cells['vqEa']}`);
  console.log(`   allowances: data=${plan.cells['43Sg']}MB voice=${plan.cells['CAnm']}min sms=${plan.cells['ALxp']}`);
  results.planId = plan._id;
  results.planPrice = plan.cells['WZ99'];
  results.planValidity = plan.cells['vqEa'];

  // ----------------------------------------------------------------
  // Step 2: Create Customer
  // ----------------------------------------------------------------
  console.log('\n2. Creating test Customer');
  const customerId = await createRecord('Customers', {
    YbBh: `E2E Test ${TEST_TAG}`,      // Name (unique by tag)
    FdTq: [1],                          // Segment: retail/consumer
    JU45: [1],                          // Language
    VdLL: [1],                          // Customer Type
    yqnJ: [3],                          // KYC verified
    EtsP: Date.now() - 1000*60*60*24*30, // Onboarded 30 days ago
    jhdQ: [1],                          // Status active
    sRZy: `${TEST_TAG.toLowerCase()}@example.test`,
    VEX7: '919900000001',
  });
  console.log(`   customerId=${customerId}`);
  results.created.customerId = customerId;

  // ----------------------------------------------------------------
  // Step 3: Create Wallet for customer
  // ----------------------------------------------------------------
  console.log('\n3. Creating Wallet');
  const walletId = await createRecord('Wallets', {
    MjRH: `WLT-${TEST_TAG}`,           // Wallet Code
    DoVS: [customerId],                 // Customer ref
    PEUU: 100,                          // Current Balance 100
    VHn9: [1],                          // Currency
    Co33: [1],                          // Status active
    aj2c: Date.now() - 1000*60*60,     // last recharge 1h ago
    zOPP: 100,                          // Lifetime Recharge
    QGjX: 0,                            // Lifetime Spend
  });
  console.log(`   walletId=${walletId}`);
  results.created.walletId = walletId;

  // ----------------------------------------------------------------
  // Step 4: Create Subscription (tied to customer + plan)
  // ----------------------------------------------------------------
  console.log('\n4. Creating Subscription');
  const subId = await createRecord('Subscriptions', {
    sDya: '919900000001',               // MSISDN unique to test
    s8jx: '899101299900000001',         // ICCID
    3: null, // placeholder (ignored)
    '3O7g': '404689900000001',          // IMSI
    hq2e: 'internet',                   // APN
    UupI: [3],                          // Subscription Type
    8: null,
    '8sK7': false,                      // Roaming
    gLpn: 'OP',                         // Home Network
    Ov5X: Date.now() - 1000*60*60*24*7, // Activated 7 days ago
    BFCp: [1],                          // Status active
    c6QN: [customerId],                 // Customer ref
    vudt: [plan._id],                   // Current Plan ref
    '1Gy9': plan.cells['43Sg'],        // Data Remaining seeded from plan
    sIqm: plan.cells['CAnm'],          // Voice Remaining
    HIXG: plan.cells['ALxp'],          // SMS Remaining
  });
  console.log(`   subscriptionId=${subId} MSISDN=919900000001`);
  results.created.subscriptionId = subId;

  // ----------------------------------------------------------------
  // Step 5: Create Recharge (credits wallet) + Wallet Transaction
  // ----------------------------------------------------------------
  console.log('\n5. Creating Recharge');
  const rechargeId = await createRecord('Recharges', {
    UhkZ: `RCH-${TEST_TAG}`,           // Recharge Code
    Y39a: 50,                           // Amount 50
    WzsW: [1],                          // Currency
    cqLl: [1],                          // Channel (retail)
    MMab: [1],                          // Status completed
    UG1r: Date.now(),                   // Timestamp now
    fa5r: [walletId],                   // Wallet ref
    xw3H: 5,                            // Tax
    Qxij: 45,                           // Net Amount
    tKyH: `GW-${TEST_TAG}`,            // Gateway Reference
  });
  console.log(`   rechargeId=${rechargeId} amount=50`);
  results.created.rechargeId = rechargeId;

  // ----------------------------------------------------------------
  // Step 6: Create 3 Balances (data/voice/SMS) seeded from tariff plan
  // ----------------------------------------------------------------
  console.log('\n6. Creating 3 Balances (data/voice/SMS) seeded from plan');
  const now = Date.now();
  const cycleStart = now - 1000*60*60*24*2;   // 2 days ago
  const cycleEnd = now + 1000*60*60*24*28;    // 28 days from now

  const balDataId = await createRecord('Balances', {
    ucLa: `BAL-DATA-${TEST_TAG}`,
    o4qw: cycleStart,
    VrcT: [1],                          // Status active
    DXPX: cycleEnd,
    Esuj: [1],                          // Service Context data
    aGu1: plan.cells['43Sg'],          // Initial Amount 51200 MB
    dOSd: 10,                           // Rating Group 10 (data)
    g3QJ: 'data',                       // Allowance Label
    yutm: [1],                          // Unit Type
    yw1p: [subId],                      // Subscription ref
    '1hH7': [plan._id],                // Tariff Plan ref
    zlob: cycleStart,
    GVKg: cycleEnd,
    '42E9': plan.cells['WZ99'],        // Price Paid
    uhlG: [1],                          // Activation Source
  });
  console.log(`   data balanceId=${balDataId} initial=${plan.cells['43Sg']}MB`);

  const balVoiceId = await createRecord('Balances', {
    ucLa: `BAL-VOICE-${TEST_TAG}`,
    o4qw: cycleStart,
    VrcT: [1],
    DXPX: cycleEnd,
    Esuj: [2],                          // Service Context voice
    aGu1: plan.cells['CAnm'],          // 999999 min
    dOSd: 20,                           // Rating Group 20 (voice)
    g3QJ: 'voice',
    yutm: [2],
    yw1p: [subId],
    '1hH7': [plan._id],
    zlob: cycleStart,
    GVKg: cycleEnd,
    '42E9': 0,
    uhlG: [1],
  });
  console.log(`   voice balanceId=${balVoiceId} initial=${plan.cells['CAnm']}min`);

  const balSmsId = await createRecord('Balances', {
    ucLa: `BAL-SMS-${TEST_TAG}`,
    o4qw: cycleStart,
    VrcT: [1],
    DXPX: cycleEnd,
    Esuj: [3],
    aGu1: plan.cells['ALxp'],          // 300 sms
    dOSd: 30,                           // Rating Group 30 (SMS)
    g3QJ: 'sms',
    yutm: [3],
    yw1p: [subId],
    '1hH7': [plan._id],
    zlob: cycleStart,
    GVKg: cycleEnd,
    '42E9': 0,
    uhlG: [1],
  });
  console.log(`   sms balanceId=${balSmsId} initial=${plan.cells['ALxp']}`);
  results.created.balDataId = balDataId;
  results.created.balVoiceId = balVoiceId;
  results.created.balSmsId = balSmsId;

  // ----------------------------------------------------------------
  // Step 7: Create Charging Session
  // ----------------------------------------------------------------
  console.log('\n7. Creating Charging Session');
  const sessionId = await createRecord('Charging Sessions', {
    DCM8: `SESS-${TEST_TAG}`,
    y3qX: now - 1000*60*10,            // Started 10 min ago
    PHIm: now - 1000*60,               // Ended 1 min ago
    KQuF: [2],                          // Status ended
    4: null,
    '4WcR': [1],                        // Service Type data
    tmDp: '919900000001',
    wypP: 'google.com',
    cnsm: [1],
    '1hHe': [subId],                   // Subscription ref
    kM4Z: 'internet',
    UPL8: [1],
    XMVJ: 3,
    '6eUa': [1],
    mQLP: 0,
    ySwc: 0,
  });
  console.log(`   chargingSessionId=${sessionId}`);
  results.created.chargingSessionId = sessionId;

  // ----------------------------------------------------------------
  // Step 8: Create 3 Usage Transactions depleting the data balance
  //         UT references: Charging Session + Subscription + Balance
  // ----------------------------------------------------------------
  console.log('\n8. Creating 3 Usage Transactions against data balance');
  const utIds = [];
  const amounts = [500, 750, 1250];  // total 2500 MB used
  for (let i = 0; i < amounts.length; i++) {
    const utId = await createRecord('Usage Transactions', {
      I5xQ: now - 1000*60*(10-i*3),     // staggered timestamps
      AjeI: [i === 0 ? 1 : i === 2 ? 3 : 2],  // CCR-I, CCR-U, CCR-T
      xuuQ: 10,                         // Rating Group 10 (data)
      cer4: 1,
      '0RM2': amounts[i],
      i7OF: amounts[i],
      umgX: amounts[i],                 // Used Amount
      hmd1: 600,
      RC5Q: 2001,
      HtGT: [1],                        // Unit Type MB
      Fpuq: amounts[i]*524288,          // Input Octets (approx)
      ZUn1: amounts[i]*524288,          // Output Octets
      idrW: 180,
      Rdyh: i+1,
      dbQH: '919900000001',
      R6Dj: 'google.com',
      e7tD: 'internet',
      HwNc: [1],
      FLwy: null,
      Beg1: [sessionId],                // Charging Session ref
      ZaUH: [subId],                    // Subscription ref
      '2DAb': [balDataId],              // Balance ref (data bucket)
    });
    utIds.push(utId);
    console.log(`   ut${i+1}=${utId} used=${amounts[i]}MB`);
    await sleep(200);
  }
  results.created.utIds = utIds;
  results.totalUsedMB = amounts.reduce((a,b) => a+b, 0);

  // ----------------------------------------------------------------
  // Step 9: Create Wallet Transaction (debit for plan purchase)
  // ----------------------------------------------------------------
  console.log('\n9. Creating Wallet Transaction (plan purchase debit)');
  const wtxId = await createRecord('Wallet Transactions', {
    '93aU': `WTX-${TEST_TAG}`,
    '8n2I': -30,                        // Amount (plan price debit)
    ajVy: now - 1000*60*60*24,          // Yesterday
    FT69: [2],                          // debit
    YBNC: [1],                          // Reference Type
    mqMb: TEST_TAG,
    jNFT: 100,                          // Before
    '1Hc4': 70,                         // After
    NyKH: 'system',
    uw5l: 'E2E plan purchase',
    '2yFo': [walletId],                 // Wallet ref
  });
  console.log(`   wtxId=${wtxId}`);
  results.created.wtxId = wtxId;

  // ----------------------------------------------------------------
  // Step 10: Trigger evaluation on affected tables
  // ----------------------------------------------------------------
  console.log('\n10. Triggering evaluation on all affected tables');
  await sleep(3000);
  await evalAllComputed('Balances', [balDataId, balVoiceId, balSmsId]);
  await evalAllComputed('Subscriptions', [subId]);
  await evalAllComputed('Customers', [customerId]);
  await evalAllComputed('Tariff Plans', [plan._id]);
  await evalAllComputed('Wallets', [walletId]);
  await evalAllComputed('Charging Sessions', [sessionId]);
  await evalAllComputed('Usage Transactions', utIds);
  await evalAllComputed('Recharges', [rechargeId]);
  await evalAllComputed('Wallet Transactions', [wtxId]);
  console.log('   evaluation triggered on 9 tables');

  console.log('\n11. Waiting 45s for async settle...');
  await sleep(45000);

  // Save results so the verifier agent knows what to look up
  fs.writeFileSync(path.join(ROOT, '.e2e-test-result.json'), JSON.stringify(results, null, 2));
  console.log(`\nTest setup complete. Results saved to .e2e-test-result.json`);
  console.log(`TAG: ${TEST_TAG}`);
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
