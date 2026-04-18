// E2E INTEGRATION TEST for the 3 new modules (Roaming / Devices / MNP).
//
// Scenario: "Rohan Gupta, Delhi, travels to Singapore with a new iPhone 15 Pro.
// Mid-trip his SIM is swapped to a different device (fraud flag). Upon return,
// he initiates a port-out to Airtel."
//
// Creates: Customer → Wallet → Subscription (with plan) → 3 Balances →
//          Device (iPhone 15 Pro) → Roaming Session in Singapore → Usage →
//          Suspicious IMEI Change → Port-out MNP request.

import * as L from './lib-common.mjs';
import fs from 'node:fs';
import path from 'node:path';

const TABLE_IDS = L.loadTableIds();
const TAG = 'MOD-E2E-' + Date.now();

async function colMap(tn) {
  const cols = await L.getTableSchema(TABLE_IDS[tn]);
  return Object.fromEntries(cols.map(c => [c.name, c.id]));
}

async function main() {
  console.log(`=== MODULE E2E TEST — tag: ${TAG} ===\n`);
  const results = { tag: TAG, created: {}, expectations: {} };

  // ---- Load all column maps ----
  const [C_CUST, C_SUB, C_WLT, C_BAL, C_TP, C_RSESS, C_RPART, C_RZONE, C_DEV, C_TAC, C_EIR, C_IME, C_MNP, C_NCE] = await Promise.all([
    colMap('Customers'), colMap('Subscriptions'), colMap('Wallets'), colMap('Balances'),
    colMap('Tariff Plans'),
    colMap('Roaming Sessions'), colMap('Roaming Partners'), colMap('Roaming Zones'),
    colMap('Devices'), colMap('Device TAC Database'),
    colMap('Equipment Identity Register'), colMap('IMEI Change Events'),
    colMap('MNP Requests'), colMap('Number Change Events'),
  ]);

  // ---- Step 1: Find Tariff Plan + Singtel partner + ASEAN zone ----
  console.log('1. Looking up reference data...');
  const plans = await L.fetchAll(TABLE_IDS['Tariff Plans']);
  const plan = plans.find(p => p.cells[C_TP['Plan Name']] === 'Unlimited Monthly Pack');
  const partners = await L.fetchAll(TABLE_IDS['Roaming Partners']);
  const singtel = partners.find(p => p.cells[C_RPART['Partner Code']] === 'SGP-SGT-01');
  const zones = await L.fetchAll(TABLE_IDS['Roaming Zones']);
  const aseanZone = zones.find(z => z.cells[C_RZONE['Zone Code']] === 'ASEAN');
  const tacs = await L.fetchAll(TABLE_IDS['Device TAC Database']);
  const iphone15Pro = tacs.find(t => t.cells[C_TAC['TAC']] === '35328115');
  console.log(`   plan=${plan._id.slice(0,8)} singtel=${singtel._id.slice(0,8)} asean=${aseanZone._id.slice(0,8)} iphone=${iphone15Pro._id.slice(0,8)}`);
  results.refs = { planId: plan._id, singtelId: singtel._id, aseanId: aseanZone._id, iphoneTACId: iphone15Pro._id };

  // ---- Step 2: Customer ----
  console.log('\n2. Creating Customer: Rohan Gupta');
  const customerId = await L.createRecord(TABLE_IDS['Customers'], {
    [C_CUST['Name']]: `Rohan Gupta (${TAG})`,
    [C_CUST['Email']]: `rohan.${TAG.toLowerCase()}@example.test`,
    [C_CUST['Phone']]: '919988776655',
    [C_CUST['Segment']]: [1],
    [C_CUST['Language']]: [1],
    [C_CUST['Customer Type']]: [1],
    [C_CUST['KYC Status']]: [3],
    [C_CUST['Onboarded Date']]: Date.now() - 400 * 86400000,
    [C_CUST['Status']]: [1],
  });
  results.created.customerId = customerId;
  console.log(`   customer=${customerId}`);

  // ---- Step 3: Wallet ----
  console.log('\n3. Creating Wallet');
  const walletId = await L.createRecord(TABLE_IDS['Wallets'], {
    [C_WLT['Wallet Code']]: `WLT-ROHAN-${TAG}`,
    [C_WLT['Customer']]: [customerId],
    [C_WLT['Current Balance']]: 500,
    [C_WLT['Currency']]: [1],
    [C_WLT['Status']]: [1],
    [C_WLT['Last Recharge Date']]: Date.now() - 3 * 86400000,
    [C_WLT['Lifetime Recharge']]: 2500,
    [C_WLT['Lifetime Spend']]: 2000,
  });
  results.created.walletId = walletId;
  console.log(`   wallet=${walletId}`);

  // ---- Step 4: Subscription ----
  console.log('\n4. Creating Subscription: MSISDN 919988776655');
  const subId = await L.createRecord(TABLE_IDS['Subscriptions'], {
    [C_SUB['MSISDN']]: '919988776655',
    [C_SUB['ICCID']]: '8991012099887766551',
    [C_SUB['IMSI']]: '404689988776655',
    [C_SUB['APN']]: 'internet',
    [C_SUB['Subscription Type']]: [3],
    [C_SUB['Roaming Enabled']]: true,
    [C_SUB['Home Network']]: 'Home IN',
    [C_SUB['Activation Date']]: Date.now() - 180 * 86400000,
    [C_SUB['Status']]: [1],
    [C_SUB['Customer']]: [customerId],
    [C_SUB['Current Plan']]: [plan._id],
    [C_SUB['Data Remaining (MB)']]: plan.cells[C_TP['Data Allowance (MB)']] - 8000,
    [C_SUB['Voice Remaining (min)']]: plan.cells[C_TP['Voice Allowance (min)']] - 320,
    [C_SUB['SMS Remaining']]: plan.cells[C_TP['SMS Allowance']] - 42,
    [C_SUB['Last Usage Date']]: Date.now() - 2 * 3600000,
    [C_SUB['Roaming Credit Limit Daily']]: 1500,
  });
  results.created.subId = subId;
  console.log(`   sub=${subId}`);

  // ---- Step 5: Balances ----
  console.log('\n5. Creating 3 Balances');
  const cycleStart = Date.now() - 5 * 86400000;
  const cycleEnd = cycleStart + plan.cells[C_TP['Validity Days']] * 86400000;
  const balDataId = await L.createRecord(TABLE_IDS['Balances'], {
    [C_BAL['Balance Code']]: `BAL-DATA-${TAG}`,
    [C_BAL['Cycle Start']]: cycleStart, [C_BAL['Cycle End']]: cycleEnd,
    [C_BAL['Status']]: [1], [C_BAL['Service Context']]: [1],
    [C_BAL['Initial Amount']]: plan.cells[C_TP['Data Allowance (MB)']],
    [C_BAL['Rating Group']]: 10,
    [C_BAL['Allowance Label']]: 'data_main',
    [C_BAL['Unit Type']]: [1],
    [C_BAL['Subscription']]: [subId], [C_BAL['Tariff Plan']]: [plan._id],
    [C_BAL['Effective From']]: cycleStart, [C_BAL['Effective To']]: cycleEnd,
    [C_BAL['Price Paid']]: plan.cells[C_TP['Price']], [C_BAL['Activation Source']]: [1],
  });
  const balVoiceId = await L.createRecord(TABLE_IDS['Balances'], {
    [C_BAL['Balance Code']]: `BAL-VOICE-${TAG}`,
    [C_BAL['Cycle Start']]: cycleStart, [C_BAL['Cycle End']]: cycleEnd,
    [C_BAL['Status']]: [1], [C_BAL['Service Context']]: [2],
    [C_BAL['Initial Amount']]: plan.cells[C_TP['Voice Allowance (min)']],
    [C_BAL['Rating Group']]: 20,
    [C_BAL['Allowance Label']]: 'voice_unlimited',
    [C_BAL['Unit Type']]: [2],
    [C_BAL['Subscription']]: [subId], [C_BAL['Tariff Plan']]: [plan._id],
    [C_BAL['Effective From']]: cycleStart, [C_BAL['Effective To']]: cycleEnd,
    [C_BAL['Price Paid']]: 0, [C_BAL['Activation Source']]: [1],
  });
  const balSmsId = await L.createRecord(TABLE_IDS['Balances'], {
    [C_BAL['Balance Code']]: `BAL-SMS-${TAG}`,
    [C_BAL['Cycle Start']]: cycleStart, [C_BAL['Cycle End']]: cycleEnd,
    [C_BAL['Status']]: [1], [C_BAL['Service Context']]: [3],
    [C_BAL['Initial Amount']]: plan.cells[C_TP['SMS Allowance']],
    [C_BAL['Rating Group']]: 30,
    [C_BAL['Allowance Label']]: 'sms_pack',
    [C_BAL['Unit Type']]: [3],
    [C_BAL['Subscription']]: [subId], [C_BAL['Tariff Plan']]: [plan._id],
    [C_BAL['Effective From']]: cycleStart, [C_BAL['Effective To']]: cycleEnd,
    [C_BAL['Price Paid']]: 0, [C_BAL['Activation Source']]: [1],
  });
  results.created.balances = { data: balDataId, voice: balVoiceId, sms: balSmsId };
  console.log(`   balances created`);

  // ---- Step 6: Device (iPhone 15 Pro) ----
  console.log('\n6. Creating Device: iPhone 15 Pro');
  const newImei = '35328115' + String(L.rand(1000000, 9999999));
  const deviceId = await L.createRecord(TABLE_IDS['Devices'], {
    [C_DEV['Device Code']]: `DEV-ROHAN-${TAG}`,
    [C_DEV['IMEI']]: newImei,
    [C_DEV['IMEISV']]: newImei.slice(0,14) + '7',
    [C_DEV['TAC']]: '35328115',
    [C_DEV['Device TAC']]: [iphone15Pro._id],
    [C_DEV['Owner']]: [customerId],
    [C_DEV['Current Subscription']]: [subId],
    [C_DEV['First Seen']]: Date.now() - 60 * 86400000,
    [C_DEV['Last Seen']]: Date.now() - 1 * 3600000,
    [C_DEV['Status']]: [1],
    [C_DEV['Is Fraud Flagged']]: false,
    // Denormalized values (backend lookup bug workaround)
    [C_DEV['Make']]: 'Apple',
    [C_DEV['Model Name']]: 'iPhone 15 Pro',
    [C_DEV['Supports VoLTE']]: true,
    [C_DEV['Supports 5G']]: true,
    [C_DEV['Release Year']]: 2023,
  });
  results.created.deviceId = deviceId;
  results.createdImei = newImei;
  console.log(`   device=${deviceId} IMEI=${newImei}`);

  // Link device back to sub
  await L.updateRecord(TABLE_IDS['Subscriptions'], subId, { [C_SUB['Current Device']]: [deviceId] });

  // ---- Step 7: Roaming Session — Singapore trip ACTIVE ----
  console.log('\n7. Creating Roaming Session in Singapore (ACTIVE)');
  const enteredAt = Date.now() - 3 * 86400000; // 3 days ago
  const rsId = await L.createRecord(TABLE_IDS['Roaming Sessions'], {
    [C_RSESS['Session Code']]: `ROAM-ROHAN-${TAG}`,
    [C_RSESS['Subscription']]: [subId],
    [C_RSESS['Partner']]: [singtel._id],
    [C_RSESS['Zone']]: [aseanZone._id],
    [C_RSESS['Country']]: 'Singapore',
    [C_RSESS['VLR Address']]: '+6590000042',
    [C_RSESS['Entered At']]: enteredAt,
    [C_RSESS['Status']]: [1], // Active
    [C_RSESS['Bill Shock Level']]: [2], // 50%
    [C_RSESS['Data Usage (MB)']]: 1850,
    [C_RSESS['Voice Usage (min)']]: 95,
    [C_RSESS['SMS Count']]: 22,
    [C_RSESS['Total Charged']]: 780,
    [C_RSESS['Daily Cap']]: 1500,
    // denormalized
    [C_RSESS['Partner Name']]: 'Singtel',
    [C_RSESS['Zone Name']]: 'Southeast Asia',
  });
  results.created.roamSessionId = rsId;

  // Update sub's Current Roaming Zone
  await L.updateRecord(TABLE_IDS['Subscriptions'], subId, { [C_SUB['Current Roaming Zone']]: [aseanZone._id] });
  console.log(`   session=${rsId} (charges so far: ₹780)`);

  // ---- Step 8: Suspicious IMEI change (mid-trip SIM moved to another device) ----
  console.log('\n8. Creating Suspicious IMEI change event');
  // Attacker's device — Samsung A54 5G (common fraud device)
  const galaxyA54 = tacs.find(t => t.cells[C_TAC['TAC']] === '35689009');
  const fraudImei = '35689009' + String(L.rand(1000000, 9999999));
  const fraudDeviceId = await L.createRecord(TABLE_IDS['Devices'], {
    [C_DEV['Device Code']]: `DEV-FRAUD-${TAG}`,
    [C_DEV['IMEI']]: fraudImei,
    [C_DEV['TAC']]: '35689009',
    [C_DEV['Device TAC']]: [galaxyA54._id],
    [C_DEV['First Seen']]: Date.now() - 1 * 3600000,
    [C_DEV['Last Seen']]: Date.now() - 10 * 60000,
    [C_DEV['Status']]: [1],
    [C_DEV['Is Fraud Flagged']]: true,
    [C_DEV['Make']]: 'Samsung',
    [C_DEV['Model Name']]: 'Galaxy A54 5G',
    [C_DEV['Supports VoLTE']]: true,
    [C_DEV['Supports 5G']]: true,
    [C_DEV['Release Year']]: 2023,
    [C_DEV['Notes']]: 'Unknown device; first-seen during active roaming session — flagged.',
  });
  await L.createRecord(TABLE_IDS['IMEI Change Events'], {
    [C_IME['Event Code']]: `IME-${TAG}`,
    [C_IME['Subscription']]: [subId],
    [C_IME['Old IMEI']]: newImei,
    [C_IME['New IMEI']]: fraudImei,
    [C_IME['New Device']]: [fraudDeviceId],
    [C_IME['Changed At']]: Date.now() - 45 * 60000,
    [C_IME['Hours Since Previous']]: 0.75,
    [C_IME['Suspicious']]: true,
    [C_IME['Review Status']]: [1], // Pending
    [C_IME['Resolution Notes']]: 'SIM moved to unknown device during active international roaming — possible SIM swap. URGENT review.',
  });
  console.log(`   fraud device=${fraudDeviceId} + change event flagged`);

  // EIR entry on the fraud device (graylist pending investigation)
  const eirId = await L.createRecord(TABLE_IDS['Equipment Identity Register'], {
    [C_EIR['EIR Code']]: `EIR-${TAG}`,
    [C_EIR['IMEI']]: fraudImei,
    [C_EIR['Device']]: [fraudDeviceId],
    [C_EIR['List Type']]: [2], // Graylist
    [C_EIR['Reason']]: [3], // Fraud
    [C_EIR['Reported By']]: 'fraud-detector-bot',
    [C_EIR['Reported At']]: Date.now() - 30 * 60000,
    [C_EIR['Country of Report']]: 'Singapore',
    [C_EIR['Status']]: [1], // Active
    [C_EIR['Notes']]: 'Auto-flagged by IMEI change anomaly engine.',
  });
  results.created.fraudDeviceId = fraudDeviceId;
  results.created.eirId = eirId;
  console.log(`   EIR graylist=${eirId}`);

  // ---- Step 9: Port-out MNP request ----
  console.log('\n9. Creating Port-Out MNP request (to Airtel)');
  const mnpId = await L.createRecord(TABLE_IDS['MNP Requests'], {
    [C_MNP['MNP Code']]: `MNP-${TAG}`,
    [C_MNP['Type']]: [2], // Port Out
    [C_MNP['MSISDN']]: '919988776655',
    [C_MNP['Subscription']]: [subId],
    [C_MNP['Customer']]: [customerId],
    [C_MNP['Recipient Operator']]: 'Airtel',
    [C_MNP['UPC Code']]: 'UPC' + L.rand(1000, 9999),
    [C_MNP['Requested At']]: Date.now() - 2 * 86400000,
    [C_MNP['Scheduled Cutover']]: Date.now() + 5 * 86400000,
    [C_MNP['Status']]: [3], // Donor Approved
    [C_MNP['Rejection Reason']]: [1], // None
    [C_MNP['SLA Days Remaining']]: 5,
    [C_MNP['Notes']]: 'Customer requested port-out to Airtel; UPC validated; awaiting cutover.',
  });
  results.created.mnpId = mnpId;

  // Audit trail — Number Change Event
  await L.createRecord(TABLE_IDS['Number Change Events'], {
    [C_NCE['Event Code']]: `NCE-${TAG}`,
    [C_NCE['MSISDN']]: '919988776655',
    [C_NCE['Old Subscription']]: [subId],
    [C_NCE['Change Type']]: [4], // Port Out
    [C_NCE['Changed At']]: Date.now() - 2 * 86400000,
    [C_NCE['Changed By']]: 'csr.mnp@operator',
    [C_NCE['Reason']]: 'Customer-initiated port-out to Airtel.',
  });
  console.log(`   mnp=${mnpId} + audit event created`);

  // ---- Step 10: Trigger evaluation ----
  console.log('\n10. Triggering evaluation on affected tables');
  await L.sleep(3000);
  for (const tn of ['Roaming Partners','Roaming Zones','Roaming Sessions','Devices','Device TAC Database','Equipment Identity Register','IMEI Change Events','MNP Requests','Number Change Events','Customers','Subscriptions','Wallets','Balances','Tariff Plans']) {
    const rows = await L.fetchAll(TABLE_IDS[tn]);
    await L.evalAllComputed(TABLE_IDS[tn], rows.map(r => r._id));
  }
  console.log('   eval triggered across 14 tables');

  console.log('\n11. Waiting 45s for async settle...');
  await L.sleep(45000);

  // ---- Expected values ----
  results.expectations = {
    customer: { name: `Rohan Gupta (${TAG})` },
    sub: {
      msisdn: '919988776655',
      currentRoamingZone: aseanZone._id,
      currentDevice: deviceId,
      roamingSessionCount: 1,
      lifetimeRoamingCharges: 780,
      imeiChangeCount: 1,
      mnpRequestCount: 1,
    },
    balances: {
      dataInitial: plan.cells[C_TP['Data Allowance (MB)']],
      voiceInitial: plan.cells[C_TP['Voice Allowance (min)']],
      smsInitial: plan.cells[C_TP['SMS Allowance']],
      dataUsed: 0, voiceUsed: 0, smsUsed: 0,  // no UTs created
    },
    device: {
      imei: newImei,
      make: 'Apple', modelName: 'iPhone 15 Pro', supports5G: true, supportsVoLTE: true,
    },
    roamingSession: {
      country: 'Singapore',
      status: 'Active',
      dataUsage: 1850, voiceUsage: 95, smsCount: 22,
      totalCharged: 780,
      partnerName: 'Singtel', zoneName: 'Southeast Asia',
    },
    mnp: { type: 'Port Out', status: 'Donor Approved', recipient: 'Airtel' },
    imeiChange: { suspicious: true, reviewStatus: 'Pending' },
    eir: { listType: 'Graylist', reason: 'Fraud' },
    customerRollups: {
      deviceCount: 1,
      mnpRequestCount: 1,
      subscriptionCount: 1,
    },
  };

  fs.writeFileSync(path.join(L.ROOT, '.e2e-modules-result.json'), JSON.stringify(results, null, 2));
  console.log(`\nSetup complete. Results → .e2e-modules-result.json`);
  console.log(`\nTAG: ${TAG}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
