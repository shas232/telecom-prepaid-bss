// Finish Phase 4: continue from where bw-04-activity.mjs failed (Subscription Status History onwards).
// Uses correct schema column names.

import * as L from './lib-common.mjs';
import fs from 'node:fs';
import path from 'node:path';

const TABLE_IDS = L.loadTableIds();
const CUSTOMERS = JSON.parse(fs.readFileSync(path.join(L.ROOT, '.bw-customers-ids.json'), 'utf8'));
const CAT = JSON.parse(fs.readFileSync(path.join(L.ROOT, '.bw-catalog-ids.json'), 'utf8'));

async function cm(tn) {
  const cols = await L.getTableSchema(TABLE_IDS[tn]);
  return Object.fromEntries(cols.map(c => [c.name, c.id]));
}

async function main() {
  const nowMs = Date.now();

  const [SSH, CS, NS, O, OI, FF, FFM, CUG, CUGM, BG, BT, PR, MNP, NA, NCE, AH, IME, EIR, DEV] = await Promise.all([
    cm('Subscription Status History'), cm('Cases'), cm('Notifications Sent'),
    cm('Orders'), cm('Order Items'), cm('Friends and Family Groups'), cm('FF Members'),
    cm('Closed User Groups'), cm('CUG Members'), cm('Bonus Grants'),
    cm('Balance Transfers'), cm('Promotion Redemptions'), cm('MNP Requests'),
    cm('Number Auctions'), cm('Number Change Events'), cm('Account Hierarchy'),
    cm('IMEI Change Events'), cm('Equipment Identity Register'), cm('Devices'),
  ]);

  // ────────────── Subscription Status History
  console.log('=== Subscription Status History ===');
  for (const c of CUSTOMERS) {
    await L.createRecord(TABLE_IDS['Subscription Status History'], {
      [SSH['Subscription']]: [c.subId],
      [SSH['From Status']]: 'New',
      [SSH['To Status']]: 'Active',
      [SSH['Changed At']]: nowMs - c.activatedDaysAgo * 86400000,
      [SSH['Changed By']]: 'activation_workflow',
      [SSH['Reason']]: 'Initial activation',
    });
    await L.sleep(25);
  }
  console.log(`  ${CUSTOMERS.length} entries`);

  // ────────────── Cases
  console.log('\n=== Cases ===');
  const caseSeeds = [
    { custIdx: 1, subj: 'Data slowdown in evenings', desc: 'Customer reports throughput drops after 19h — possible cell congestion in Gaborone West.', cat: 4, pri: 2, status: 3, channel: 'USSD-180' },
    { custIdx: 3, subj: 'Roaming bill higher than expected in UK', desc: 'Customer claims bill shock on return from London trip. Claims she switched off data.', cat: 2, pri: 1, status: 4, channel: 'CARE-111' },
    { custIdx: 4, subj: 'SIM not activating', desc: 'New SIM issued from Maun BTC shop not registering. ICCID validated.', cat: 5, pri: 1, status: 3, channel: 'RETAIL-BTC' },
    { custIdx: 6, subj: 'Balance deducted without usage', desc: 'Customer says P15 disappeared overnight with no UT records. Balance forensic needed.', cat: 2, pri: 2, status: 4, channel: 'CARE-111' },
    { custIdx: 10, subj: 'USSD *180# not responding', desc: 'SDP timeout errors from Palapye area customers.', cat: 4, pri: 3, status: 5, channel: 'USSD-180' },
    { custIdx: 14, subj: 'Request for invoice copy', desc: 'Corporate customer needs VAT invoices for 3 months.', cat: 6, pri: 3, status: 5, channel: 'WEB-SELFCARE' },
  ];
  for (let i = 0; i < caseSeeds.length; i++) {
    const cs = caseSeeds[i];
    const c = CUSTOMERS[cs.custIdx];
    const openedAt = nowMs - L.rand(3, 90) * 86400000;
    const resolvedAt = cs.status >= 4 ? openedAt + L.rand(1, 14) * 86400000 : null;
    await L.createRecord(TABLE_IDS['Cases'], {
      [CS['Case Code']]: `CASE-2026-${String(i+1).padStart(4, '0')}`,
      [CS['Subject']]: cs.subj,
      [CS['Description']]: cs.desc,
      [CS['Customer']]: [c.customerId],
      [CS['Subscription']]: [c.subId],
      [CS['Channel']]: [CAT.channels[cs.channel]],
      [CS['Category']]: [cs.cat],
      [CS['Priority']]: [cs.pri],
      [CS['Status']]: [cs.status],
      [CS['Assigned To']]: 'csr-team-' + L.rand(1, 5),
      [CS['Opened At']]: openedAt,
      ...(resolvedAt ? { [CS['Resolved At']]: resolvedAt, [CS['Resolution Notes']]: 'Resolved per CSR handbook; customer satisfied.', [CS['CSAT']]: L.rand(3, 5) } : {}),
    });
  }
  console.log(`  ${caseSeeds.length} cases`);

  // ────────────── Notifications Sent
  console.log('\n=== Notifications Sent ===');
  const templates = await L.fetchAll(TABLE_IDS['Notification Templates']);
  const NT = await cm('Notification Templates');
  const tplByCode = {};
  for (const t of templates) tplByCode[t.cells[NT['Template Code']]] = t._id;
  const smsChannel = CAT.channels['SMS-SHORTCODE'];

  let notifCount = 0;
  for (const c of CUSTOMERS) {
    // Welcome
    await L.createRecord(TABLE_IDS['Notifications Sent'], {
      [NS['Template']]: [tplByCode['TPL-WELCOME']],
      [NS['Customer']]: [c.customerId],
      [NS['Subscription']]: [c.subId],
      [NS['Channel']]: [smsChannel],
      [NS['Sent At']]: nowMs - c.activatedDaysAgo * 86400000 + 60000,
      [NS['Delivered At']]: nowMs - c.activatedDaysAgo * 86400000 + 120000,
      [NS['Status']]: [3],
      [NS['Content Snapshot']]: `Dumela ${c.first}! Welcome to b-mobile. Your MSISDN ${c.msisdn} is active on ${c.plan}. Dial *180# for bundles.`,
    });
    notifCount++;
    // Recharge confirmations
    for (let r = 0; r < 2; r++) {
      const sentAt = nowMs - L.rand(1, 30) * 86400000;
      await L.createRecord(TABLE_IDS['Notifications Sent'], {
        [NS['Template']]: [tplByCode['TPL-RECH-OK']],
        [NS['Customer']]: [c.customerId],
        [NS['Subscription']]: [c.subId],
        [NS['Channel']]: [smsChannel],
        [NS['Sent At']]: sentAt,
        [NS['Delivered At']]: sentAt + 45000,
        [NS['Status']]: [3],
        [NS['Content Snapshot']]: `Recharge successful. New balance: P${L.rand(10, 150)}.`,
        ...(Math.random() < 0.4 ? { [NS['Read At']]: sentAt + L.rand(60, 3600) * 1000 } : {}),
      });
      notifCount++;
    }
    // Low balance
    if (c.walletBalance < 20) {
      await L.createRecord(TABLE_IDS['Notifications Sent'], {
        [NS['Template']]: [tplByCode['TPL-LOW-BAL']],
        [NS['Customer']]: [c.customerId],
        [NS['Subscription']]: [c.subId],
        [NS['Channel']]: [smsChannel],
        [NS['Sent At']]: nowMs - L.rand(1, 3) * 86400000,
        [NS['Status']]: [3],
        [NS['Content Snapshot']]: `Hi ${c.first}, your b-mobile balance is P${c.walletBalance}. Recharge via *104*PIN#.`,
      });
      notifCount++;
    }
    await L.sleep(15);
  }
  console.log(`  ${notifCount} notifications`);

  // ────────────── Orders + Order Items
  console.log('\n=== Orders + Order Items ===');
  const retailCh = CAT.channels['RETAIL-BTC'];
  for (let i = 0; i < 6; i++) {
    const c = CUSTOMERS[i];
    const submittedAt = nowMs - L.rand(30, 200) * 86400000;
    const orderId = await L.createRecord(TABLE_IDS['Orders'], {
      [O['Order Code']]: `ORD-${c.msisdn.slice(-4)}-${i+1}`,
      [O['Customer']]: [c.customerId],
      [O['Subscription']]: [c.subId],
      [O['Order Type']]: [L.pick([1, 2, 3])],
      [O['Status']]: [4],
      [O['Channel']]: [retailCh],
      [O['Submitted At']]: submittedAt,
      [O['Fulfilled At']]: submittedAt + 600000,
      [O['Total Amount']]: 30,
      [O['Notes']]: 'Plan activation via retail channel.',
    });
    await L.createRecord(TABLE_IDS['Order Items'], {
      [OI['Order']]: [orderId],
      [OI['Tariff Plan']]: [c.planId],
      [OI['Quantity']]: 1,
      [OI['Unit Price']]: 30,
      [OI['Total']]: 30,
      [OI['Notes']]: 'Plan SKU',
    });
  }
  console.log('  6 orders + 6 items');

  // ────────────── F&F Group (1) + Members
  console.log('\n=== F&F + CUG ===');
  // F&F: owner is a SUBSCRIPTION not a customer
  const ffId = await L.createRecord(TABLE_IDS['Friends and Family Groups'], {
    [FF['Group Code']]: 'FF-KHAMA-FAM',
    [FF['Group Name']]: 'Khama Family F&F',
    [FF['Owner Subscription']]: [CUSTOMERS[6].subId],  // Kefilwe
    [FF['Max Members']]: 5,
    [FF['Special Rate Card']]: 'On-net 50% discount between F&F members',
    [FF['Status']]: [1],
  });
  for (let i = 0; i < 3; i++) {
    await L.createRecord(TABLE_IDS['FF Members'], {
      [FFM['FF Group']]: [ffId],
      [FFM['Member MSISDN']]: CUSTOMERS[5+i].msisdn,
      [FFM['Added Date']]: nowMs - L.rand(30, 150) * 86400000,
      [FFM['On Net']]: true,
      [FFM['Status']]: [1],
    });
  }

  const cugId = await L.createRecord(TABLE_IDS['Closed User Groups'], {
    [CUG['CUG Code']]: 'CUG-DEBSWANA',
    [CUG['CUG Name']]: 'Debswana Corporate CUG',
    [CUG['CUG Type']]: [1],
    [CUG['Owner Customer']]: [CUSTOMERS[3].customerId], // Boitumelo
    [CUG['Internal Rate Card']]: 'Intra-CUG 80% voice discount; on-net free until 60 min/day.',
    [CUG['Status']]: [1],
  });
  for (let i = 0; i < 4; i++) {
    await L.createRecord(TABLE_IDS['CUG Members'], {
      [CUGM['CUG']]: [cugId],
      [CUGM['Subscription']]: [CUSTOMERS[3+i].subId],
      [CUGM['Added Date']]: nowMs - L.rand(60, 300) * 86400000,
      [CUGM['Role']]: [i === 0 ? 1 : 2], // admin or member
      [CUGM['Status']]: [1],
    });
  }
  console.log('  1 F&F (3 members) + 1 CUG (4 members)');

  // ────────────── Bonus Grants
  console.log('\n=== Bonus Grants ===');
  for (let i = 0; i < 8; i++) {
    const c = CUSTOMERS[i];
    await L.createRecord(TABLE_IDS['Bonus Grants'], {
      [BG['Bonus Code']]: `BG-WELCOME-${c.msisdn.slice(-4)}`,
      [BG['Subscription']]: [c.subId],
      [BG['Amount']]: 5,
      [BG['Unit Type']]: [4], // currency
      [BG['Rating Group']]: 300, // bonus pool
      [BG['Granted Reason']]: [1], // welcome
      [BG['Granted By']]: 'activation_workflow',
      [BG['Granted Date']]: nowMs - c.activatedDaysAgo * 86400000,
      [BG['Expiry Date']]: nowMs - (c.activatedDaysAgo - 14) * 86400000,
      [BG['Validity Days']]: 14,
      [BG['Consumed Amount']]: L.rand(0, 5),
    });
  }
  console.log('  8 bonus grants');

  // ────────────── Promotion Redemptions
  console.log('\n=== Promotion Redemptions ===');
  const paselaId = CAT.promos['PASELA'];
  const welcomeId = CAT.promos['WELCOME-SIM'];
  for (let i = 0; i < 7; i++) {
    const c = CUSTOMERS[i];
    await L.createRecord(TABLE_IDS['Promotion Redemptions'], {
      [PR['Promotion']]: [i % 2 === 0 ? paselaId : welcomeId],
      [PR['Customer']]: [c.customerId],
      [PR['Subscription']]: [c.subId],
      [PR['Redeemed At']]: nowMs - L.rand(5, 90) * 86400000,
      [PR['Value Granted']]: L.rand(5, 50),
      [PR['Reference Transaction']]: 'TXN-' + c.msisdn.slice(-4) + '-' + i,
      [PR['Notes']]: i % 2 === 0 ? 'BTC Pasela points redemption' : 'Welcome SIM bonus',
    });
  }
  console.log('  7 redemptions');

  // ────────────── Balance Transfers
  console.log('\n=== Balance Transfers ===');
  for (let i = 0; i < 3; i++) {
    await L.createRecord(TABLE_IDS['Balance Transfers'], {
      [BT['Transfer Code']]: `BT-${CUSTOMERS[i].msisdn.slice(-4)}-${CUSTOMERS[i+10].msisdn.slice(-4)}`,
      [BT['From Subscription']]: [CUSTOMERS[i].subId],
      [BT['To Subscription']]: [CUSTOMERS[i+10].subId],
      [BT['Transfer Type']]: [1], // airtime
      [BT['Amount']]: L.pick([5, 10, 20]),
      [BT['Fee']]: 1,
      [BT['Status']]: [2],
      [BT['Timestamp']]: nowMs - L.rand(5, 45) * 86400000,
      [BT['Reason']]: 'P2P airtime gift.',
    });
  }
  console.log('  3 transfers');

  // ────────────── Devices: IMEI change + EIR (fraud scenario)
  console.log('\n=== IMEI + EIR ===');
  const thabo = CUSTOMERS[0];
  const boitu = CUSTOMERS[3];
  const tacs = await L.fetchAll(TABLE_IDS['Device TAC Database']);
  const tCols = await L.getTableSchema(TABLE_IDS['Device TAC Database']);
  const T_TAC = tCols.find(c => c.name === 'TAC').id;
  const galaxyA54 = tacs.find(t => t.cells[T_TAC] === '35689009');

  const fraudImei = '35689009' + String(L.rand(1000000, 9999999));
  const fraudDevId = await L.createRecord(TABLE_IDS['Devices'], {
    [DEV['Device Code']]: `DEV-FRAUD-${thabo.msisdn.slice(-4)}`,
    [DEV['IMEI']]: fraudImei,
    [DEV['TAC']]: '35689009',
    [DEV['Device TAC']]: [galaxyA54._id],
    [DEV['First Seen']]: nowMs - 3 * 3600000,
    [DEV['Last Seen']]: nowMs - 30 * 60000,
    [DEV['Status']]: [1],
    [DEV['Is Fraud Flagged']]: true,
    [DEV['Make']]: 'Samsung',
    [DEV['Model Name']]: 'Galaxy A54 5G',
    [DEV['Supports VoLTE']]: true,
    [DEV['Supports 5G']]: true,
    [DEV['Release Year']]: 2023,
    [DEV['Notes']]: 'Unknown device; SIM swap detected during active roaming in South Africa — URGENT review.',
  });
  await L.createRecord(TABLE_IDS['IMEI Change Events'], {
    [IME['Event Code']]: `IME-FRAUD-${thabo.msisdn.slice(-4)}`,
    [IME['Subscription']]: [thabo.subId],
    [IME['Old IMEI']]: thabo.imei,
    [IME['New IMEI']]: fraudImei,
    [IME['New Device']]: [fraudDevId],
    [IME['Changed At']]: nowMs - 45 * 60000,
    [IME['Hours Since Previous']]: 0.75,
    [IME['Suspicious']]: true,
    [IME['Review Status']]: [1],
    [IME['Resolution Notes']]: 'SIM moved to unknown Samsung A54 during active roaming in South Africa. Possible SIM swap. URGENT.',
  });
  await L.createRecord(TABLE_IDS['IMEI Change Events'], {
    [IME['Event Code']]: `IME-UPGRADE-${boitu.msisdn.slice(-4)}`,
    [IME['Subscription']]: [boitu.subId],
    [IME['Old IMEI']]: '35644511' + String(L.rand(1000000, 9999999)),
    [IME['New IMEI']]: boitu.imei,
    [IME['Changed At']]: nowMs - 200 * 86400000,
    [IME['Hours Since Previous']]: 24 * 365,
    [IME['Suspicious']]: false,
    [IME['Review Status']]: [2],
    [IME['Reviewed By']]: 'fraud.ops@btc.bw',
    [IME['Reviewed At']]: nowMs - 199 * 86400000,
    [IME['Resolution Notes']]: 'Annual corporate device upgrade (Note 20 → S24 Ultra).',
  });
  await L.createRecord(TABLE_IDS['Equipment Identity Register'], {
    [EIR['EIR Code']]: `EIR-FRAUD-${thabo.msisdn.slice(-4)}`,
    [EIR['IMEI']]: fraudImei,
    [EIR['Device']]: [fraudDevId],
    [EIR['List Type']]: [2],
    [EIR['Reason']]: [3],
    [EIR['Reported By']]: 'fraud-detector-bot',
    [EIR['Reported At']]: nowMs - 30 * 60000,
    [EIR['Country of Report']]: 'South Africa',
    [EIR['Status']]: [1],
    [EIR['Notes']]: 'Auto-flagged by IMEI change anomaly engine during active SADC roaming.',
  });
  const stolenImei = '35737120' + String(L.rand(1000000, 9999999));
  await L.createRecord(TABLE_IDS['Equipment Identity Register'], {
    [EIR['EIR Code']]: `EIR-STOLEN-1`,
    [EIR['IMEI']]: stolenImei,
    [EIR['List Type']]: [1],
    [EIR['Reason']]: [1],
    [EIR['Reported By']]: 'customer via BTC Shop Gaborone',
    [EIR['Reported At']]: nowMs - 30 * 86400000,
    [EIR['Country of Report']]: 'Botswana',
    [EIR['Police Case Number']]: 'CR-GAB-2026/' + L.rand(100, 999),
    [EIR['Status']]: [1],
    [EIR['Notes']]: 'Stolen in break-in at Extension 12, Gaborone. Police case filed.',
  });
  console.log('  2 IMEI events + 2 EIR entries');

  // ────────────── MNP (regulatory scope note)
  console.log('\n=== MNP (regulatory scope — BOCRA shelved 2021) ===');
  await L.createRecord(TABLE_IDS['MNP Requests'], {
    [MNP['MNP Code']]: `MNP-SCOPE-01`,
    [MNP['Type']]: [1],
    [MNP['MSISDN']]: '26771234123',
    [MNP['Donor Operator']]: 'Mascom',
    [MNP['UPC Code']]: 'PLANNED',
    [MNP['Requested At']]: nowMs - 30 * 86400000,
    [MNP['Status']]: [8],
    [MNP['Rejection Reason']]: [6],
    [MNP['SLA Days Remaining']]: 0,
    [MNP['Notes']]: '⚠ REGULATORY SCOPE — BOCRA shelved MNP in April 2021. Schema retained for future regulator re-enablement.',
  });
  await L.createRecord(TABLE_IDS['MNP Requests'], {
    [MNP['MNP Code']]: `MNP-SCOPE-02`,
    [MNP['Type']]: [2],
    [MNP['MSISDN']]: CUSTOMERS[5].msisdn,
    [MNP['Subscription']]: [CUSTOMERS[5].subId],
    [MNP['Customer']]: [CUSTOMERS[5].customerId],
    [MNP['Recipient Operator']]: 'Orange Botswana',
    [MNP['UPC Code']]: 'PLANNED',
    [MNP['Requested At']]: nowMs - 45 * 86400000,
    [MNP['Status']]: [8],
    [MNP['Rejection Reason']]: [6],
    [MNP['SLA Days Remaining']]: 0,
    [MNP['Notes']]: '⚠ REGULATORY SCOPE — BOCRA shelved MNP. Reserved for future re-activation.',
  });
  console.log('  2 MNP scope placeholders');

  // ────────────── Number Auctions
  console.log('\n=== Number Auctions ===');
  const mp = await L.fetchAll(TABLE_IDS['MSISDN Pool']);
  const MPCol = await cm('MSISDN Pool');
  const auctionSeeds = [
    { msisdn: '26777777777', tier: 3, reserve: 55000, bid: 82000, count: 6, status: 2, endDays: 3,  note: 'Triple-7 platinum — hot lot.' },
    { msisdn: '26772222222', tier: 3, reserve: 40000, bid: 58000, count: 4, status: 2, endDays: 7,  note: 'Repeated 2s.' },
    { msisdn: '26775555555', tier: 3, reserve: 40000, bid: 0,     count: 0, status: 2, endDays: 14, note: 'Repeated 5s — reserve not yet met.' },
    { msisdn: '26771000000', tier: 2, reserve: 15000, bid: 21000, count: 3, status: 4, endDays: -7, note: 'Round-number gold — sold.' },
    { msisdn: '26771234567', tier: 4, reserve: 80000, bid: 125000,count: 9, status: 4, endDays: -14,note: 'Ladder ascending — sold to corporate.' },
  ];
  for (let i = 0; i < auctionSeeds.length; i++) {
    const a = auctionSeeds[i];
    const isSold = a.status === 4;
    const mpRow = mp.find(r => r.cells[MPCol['MSISDN']] === a.msisdn);
    const winner = isSold ? CUSTOMERS[i % CUSTOMERS.length].customerId : null;
    const bidder = a.bid > 0 && !isSold ? CUSTOMERS[(i+1) % CUSTOMERS.length].customerId : null;
    await L.createRecord(TABLE_IDS['Number Auctions'], {
      [NA['Auction Code']]: `AUC-${a.msisdn.slice(-5)}-${i+1}`,
      [NA['MSISDN']]: a.msisdn,
      ...(mpRow ? { [NA['MSISDN Record']]: [mpRow._id] } : {}),
      [NA['Tier']]: [a.tier - 1],
      [NA['Reserve Price']]: a.reserve,
      [NA['Current Bid']]: a.bid || null,
      ...(bidder ? { [NA['Highest Bidder']]: [bidder] } : {}),
      [NA['Bid Count']]: a.count,
      [NA['Start Date']]: nowMs - 30 * 86400000,
      [NA['End Date']]: nowMs + a.endDays * 86400000,
      [NA['Status']]: [a.status],
      ...(winner ? { [NA['Winner']]: [winner] } : {}),
      ...(isSold ? { [NA['Sold Price']]: a.bid } : {}),
      [NA['Notes']]: a.note,
    });
  }
  console.log('  5 auctions');

  // ────────────── Number Change Events (audit)
  console.log('\n=== Number Change Events ===');
  for (const c of CUSTOMERS) {
    await L.createRecord(TABLE_IDS['Number Change Events'], {
      [NCE['Event Code']]: `NCE-ASSIGN-${c.msisdn.slice(-6)}`,
      [NCE['MSISDN']]: c.msisdn,
      [NCE['New Subscription']]: [c.subId],
      [NCE['Change Type']]: [1],
      [NCE['Changed At']]: nowMs - c.activatedDaysAgo * 86400000,
      [NCE['Changed By']]: L.pick(['retail.ops@btc.bw','app.provisioning','csr.ops@btc.bw']),
      [NCE['Reason']]: 'Initial MSISDN assignment from pool upon activation.',
    });
    await L.sleep(20);
  }
  console.log(`  ${CUSTOMERS.length} events`);

  // ────────────── Account Hierarchy
  console.log('\n=== Account Hierarchy ===');
  await L.createRecord(TABLE_IDS['Account Hierarchy'], {
    [AH['Parent Customer']]: [CUSTOMERS[3].customerId],
    [AH['Child Customer']]: [CUSTOMERS[7].customerId],
    [AH['Relationship Type']]: [4],
    [AH['Billing Responsibility']]: [1],
    [AH['Effective From']]: nowMs - 300 * 86400000,
    [AH['Effective To']]: nowMs + 365 * 86400000,
    [AH['Notes']]: 'Corporate employee line — Debswana account.',
  });
  await L.createRecord(TABLE_IDS['Account Hierarchy'], {
    [AH['Parent Customer']]: [CUSTOMERS[6].customerId],
    [AH['Child Customer']]: [CUSTOMERS[5].customerId],
    [AH['Relationship Type']]: [2],
    [AH['Billing Responsibility']]: [1],
    [AH['Effective From']]: nowMs - 200 * 86400000,
    [AH['Notes']]: 'Family line — mother pays for daughter.',
  });
  console.log('  2 hierarchies');

  // ────────────── Trigger final eval
  console.log('\n=== Triggering evaluation ===');
  await L.sleep(5000);
  for (const tn of ['Balances','Subscriptions','Customers','Tariff Plans','Wallets','Charging Sessions','Roaming Partners','Roaming Zones','Device TAC Database','Devices','MNP Requests','Number Auctions']) {
    const rows = await L.fetchAll(TABLE_IDS[tn]);
    await L.evalAllComputed(TABLE_IDS[tn], rows.map(r => r._id));
  }

  console.log('\n=== PHASE 4 FINISH COMPLETE ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
