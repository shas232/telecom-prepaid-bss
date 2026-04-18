// BW Phase 4: transactional + behavioral activity.
// Generates a realistic demo-grade dataset of recharges, usage, roaming, cases,
// promotions, MNP (flagged as out-of-scope in BW), auctions, IMEI events.

import * as L from './lib-common.mjs';
import fs from 'node:fs';
import path from 'node:path';

const TABLE_IDS = L.loadTableIds();
const CUSTOMERS = JSON.parse(fs.readFileSync(path.join(L.ROOT, '.bw-customers-ids.json'), 'utf8'));

async function cm(tn) {
  const cols = await L.getTableSchema(TABLE_IDS[tn]);
  return Object.fromEntries(cols.map(c => [c.name, c.id]));
}

async function main() {
  console.log('=== BW PHASE 4: ACTIVITY ===\n');

  // Pre-load all column maps
  const [R, WT, CH_SESS, UT, CDR, PC, NS, CLE, CI, CS, SSH, BG, BT, PR, O, OI, PCom, RS, RZ, RP, TAPr, IME, EIR, MNP, NA, NCE, AH, FF, FFM, CUG, CUGM] = await Promise.all([
    cm('Recharges'), cm('Wallet Transactions'), cm('Charging Sessions'), cm('Usage Transactions'),
    cm('Call Detail Records'), cm('Partner Commissions'), cm('Notifications Sent'), cm('Customer Lifecycle Events'),
    cm('Customer Interactions'), cm('Cases'), cm('Subscription Status History'), cm('Bonus Grants'),
    cm('Balance Transfers'), cm('Promotion Redemptions'), cm('Orders'), cm('Order Items'),
    cm('Partner Commissions'), cm('Roaming Sessions'), cm('Roaming Zones'), cm('Roaming Partners'),
    cm('TAP Records'), cm('IMEI Change Events'), cm('Equipment Identity Register'),
    cm('MNP Requests'), cm('Number Auctions'), cm('Number Change Events'),
    cm('Account Hierarchy'), cm('Friends and Family Groups'), cm('FF Members'),
    cm('Closed User Groups'), cm('CUG Members'),
  ]);

  // Need: Channels, Distribution Partners, Tariff Plans, Promotions, Templates
  const CAT = JSON.parse(fs.readFileSync(path.join(L.ROOT, '.bw-catalog-ids.json'), 'utf8'));
  const distValues = Object.values(CAT.dist);
  const channelValues = Object.values(CAT.channels);

  const partners = await L.fetchAll(TABLE_IDS['Roaming Partners']);
  const partnerByCode = {};
  for (const p of partners) {
    const code = p.cells[Object.keys(RP).find(k => RP[k] === RP['Partner Code'])] || p.cells[RP['Partner Code']];
    partnerByCode[code] = p._id;
  }

  const zones = await L.fetchAll(TABLE_IDS['Roaming Zones']);
  const zoneByCode = {};
  for (const z of zones) zoneByCode[z.cells[RZ['Zone Code']]] = z._id;

  let totalRecharges = 0, totalUTs = 0, totalSessions = 0, totalCDRs = 0;
  const nowMs = Date.now();

  // ────────────────────────────────────────────────────────────
  // Per-customer activity: recharges, UTs, sessions, CDRs
  // ────────────────────────────────────────────────────────────
  for (let i = 0; i < CUSTOMERS.length; i++) {
    const c = CUSTOMERS[i];
    const activeDays = c.activatedDaysAgo;

    // 1. Recharges — 2-5 per customer over active period
    const numRech = L.rand(2, 5);
    for (let r = 0; r < numRech; r++) {
      const daysAgo = Math.floor((activeDays / numRech) * (numRech - r)) + L.rand(-3, 3);
      const ts = nowMs - Math.max(1, daysAgo) * 86400000;
      const amount = L.pick([10, 20, 30, 50, 50, 100]);
      const tax = Math.round(amount * 0.14 * 100) / 100;
      const net = amount - tax;
      const partner = L.pick(distValues);
      const rechargeId = await L.createRecord(TABLE_IDS['Recharges'], {
        [R['Recharge Code']]: `RCH-${c.msisdn.slice(-4)}-${r+1}`,
        [R['Amount']]: amount,
        [R['Tax Amount']]: tax,
        [R['Net Amount']]: net,
        [R['Currency']]: [1],
        [R['Channel']]: [L.pick([1, 2, 3, 4, 5])],
        [R['Status']]: [1],
        [R['Timestamp']]: ts,
        [R['Wallet']]: [c.walletId],
        [R['Distribution Partner']]: [partner],
        [R['Gateway Reference']]: `GW-${c.msisdn.slice(-6)}-${ts.toString(36).slice(-6).toUpperCase()}`,
        [R['Wallet Code']]: `WLT-${c.first.toUpperCase()}-${c.msisdn.slice(-4)}`,
      });
      totalRecharges++;

      // Matching Wallet Transaction (credit)
      await L.createRecord(TABLE_IDS['Wallet Transactions'], {
        [WT['Transaction Code']]: `WTX-RCH-${c.msisdn.slice(-4)}-${r+1}`,
        [WT['Amount']]: amount,
        [WT['Timestamp']]: ts,
        [WT['Transaction Type']]: [1], // credit
        [WT['Reference Type']]: [1],
        [WT['Reference ID']]: rechargeId,
        [WT['Balance Before']]: Math.max(0, c.walletBalance - amount),
        [WT['Balance After']]: Math.max(0, c.walletBalance),
        [WT['Initiated By']]: 'recharge_gateway',
        [WT['Notes']]: `Recharge P${amount} via ${['retail','app','USSD','bank','card'][L.rand(0,4)]}`,
        [WT['Wallet']]: [c.walletId],
        [WT['Wallet Code']]: `WLT-${c.first.toUpperCase()}-${c.msisdn.slice(-4)}`,
      });

      // Partner commission (for retail/agent channels)
      if (Math.random() < 0.6) {
        await L.createRecord(TABLE_IDS['Partner Commissions'], {
          [PCom['Commission Amount']]: Math.round(amount * 0.03 * 100) / 100,
          [PCom['Base Amount']]: amount,
          [PCom['Status']]: [L.pick([1, 2, 3])],
          [PCom['Commission Type']]: [1],
          [PCom['Accrued Date']]: ts,
          [PCom['Settlement Reference']]: `STL-${new Date(ts).toISOString().slice(0,7)}`,
          [PCom['Partner']]: [partner],
          [PCom['Recharge']]: [rechargeId],
        });
      }
      await L.sleep(30);
    }

    // 2. Plan purchase Wallet Transaction (debit)
    const planPrice = c.planId ? (await (async () => {
      const plans = await L.fetchAll(TABLE_IDS['Tariff Plans']);
      const TP_COLS = await cm('Tariff Plans');
      return plans.find(p => p._id === c.planId)?.cells[TP_COLS['Price']] || 30;
    })()) : 30;
    await L.createRecord(TABLE_IDS['Wallet Transactions'], {
      [WT['Transaction Code']]: `WTX-PLAN-${c.msisdn.slice(-6)}`,
      [WT['Amount']]: -planPrice,
      [WT['Timestamp']]: nowMs - c.activatedDaysAgo * 86400000,
      [WT['Transaction Type']]: [2],
      [WT['Reference Type']]: [2],
      [WT['Reference ID']]: c.subId,
      [WT['Balance Before']]: c.walletBalance + planPrice,
      [WT['Balance After']]: c.walletBalance,
      [WT['Initiated By']]: 'system',
      [WT['Notes']]: `Plan activation — ${c.plan}`,
      [WT['Wallet']]: [c.walletId],
      [WT['Wallet Code']]: `WLT-${c.first.toUpperCase()}-${c.msisdn.slice(-4)}`,
    });

    // 3. Usage: charging sessions + UTs + CDRs
    // Data sessions
    const dataBal = c.balances.find(b => b.type === 'data');
    if (dataBal && dataBal.used > 0) {
      const sessionsCount = Math.min(12, Math.max(2, Math.round(dataBal.used / 400)));
      const perSession = Math.floor(dataBal.used / sessionsCount);
      for (let s = 0; s < sessionsCount; s++) {
        const sessStart = Math.round(nowMs - (activeDays * (sessionsCount - s) / sessionsCount) * 86400000 + L.rand(0, 86400000));
        const dur = L.rand(180, 1800);
        const sessEnd = sessStart + dur * 1000;
        const usedThisSession = perSession + L.rand(-50, 50);
        if (usedThisSession <= 0) continue;
        const sessId = await L.createRecord(TABLE_IDS['Charging Sessions'], {
          [CH_SESS['Session ID']]: `SESS-D-${c.msisdn.slice(-4)}-${s+1}`,
          [CH_SESS['Subscription']]: [c.subId],
          [CH_SESS['Started At']]: sessStart,
          [CH_SESS['Ended At']]: sessEnd,
          [CH_SESS['Status']]: [2], // completed
          [CH_SESS['Service Type']]: [1], // data
          [CH_SESS['Service Context']]: [1],
          [CH_SESS['Calling Party']]: c.msisdn,
          [CH_SESS['Called Party']]: L.pick(['*','netflix.com','youtube.com','facebook.com','instagram.com','tiktok.com','google.com','whatsapp.net']),
          [CH_SESS['APN']]: 'internet.btc.bw',
          [CH_SESS['RAT Type']]: [L.pick([1,1,1,2])],
          [CH_SESS['Termination Cause']]: [1],
          [CH_SESS['Request Count']]: Math.max(1, Math.round(usedThisSession / 300)),
          [CH_SESS['Total Used Amount']]: usedThisSession,
          [CH_SESS['Total Charged']]: 0, // within bundle
          [CH_SESS['Location Info']]: 'LAC' + L.rand(1000, 9999) + '-CI' + L.rand(1000, 9999),
        });
        totalSessions++;

        // 2-4 UTs per session (CCR-I, CCR-U, CCR-T)
        const nChunks = Math.min(4, Math.max(2, Math.round(usedThisSession / 200)));
        const chunks = [];
        let rem = usedThisSession;
        for (let k = 0; k < nChunks; k++) {
          const ch = k === nChunks - 1 ? rem : Math.round(usedThisSession / nChunks);
          chunks.push(ch);
          rem -= ch;
        }
        for (let k = 0; k < chunks.length; k++) {
          const kind = k === 0 ? 1 : k === chunks.length - 1 ? 3 : 2;
          await L.createRecord(TABLE_IDS['Usage Transactions'], {
            [UT['Timestamp']]: Math.round(sessStart + (k / chunks.length) * dur * 1000),
            [UT['Message Type']]: [kind],
            [UT['Rating Group']]: 10, [UT['Service Identifier']]: 1,
            [UT['Requested Amount']]: chunks[k], [UT['Granted Amount']]: chunks[k], [UT['Used Amount']]: chunks[k],
            [UT['Validity Time']]: 600, [UT['Result Code']]: 2001,
            [UT['Unit Type']]: [1],
            [UT['Input Octets']]: chunks[k] * 524288, [UT['Output Octets']]: chunks[k] * 524288,
            [UT['CC Time Seconds']]: Math.round(dur / chunks.length),
            [UT['Request Number']]: k + 1,
            [UT['Calling Party']]: c.msisdn,
            [UT['Called Party']]: '*',
            [UT['APN']]: 'internet.btc.bw',
            [UT['FUI Action']]: [1],
            [UT['Charging Session']]: [sessId],
            [UT['Subscription']]: [c.subId],
            [UT['Balance']]: [dataBal.id],
          });
          totalUTs++;
        }

        // CDR for this session
        await L.createRecord(TABLE_IDS['Call Detail Records'], {
          [CDR['CDR Code']]: `CDR-D-${c.msisdn.slice(-4)}-${s+1}`,
          [CDR['Subscription']]: [c.subId],
          [CDR['Customer']]: [c.customerId],
          [CDR['Tariff Plan']]: [c.planId],
          [CDR['Charging Session']]: [sessId],
          [CDR['Service Type']]: [1],
          [CDR['Started At']]: sessStart, [CDR['Ended At']]: sessEnd,
          [CDR['Duration Seconds']]: dur,
          [CDR['Total MB']]: usedThisSession,
          [CDR['Total Minutes']]: 0,
          [CDR['Total Units']]: usedThisSession,
          [CDR['Rating Group']]: 10,
          [CDR['Total Charged from Allowance']]: usedThisSession,
          [CDR['Total Charged from Wallet']]: 0,
          [CDR['Total Octets']]: usedThisSession * 1024 * 1024,
          [CDR['Record Sequence Number']]: s + 1,
          [CDR['Final Termination Cause']]: 'normal',
        });
        totalCDRs++;
        await L.sleep(15);
      }
    }
    console.log(`[${i+1}] ${c.first} ${c.last}: ${numRech} recharges, data usage seeded`);
  }

  console.log(`\nTotals so far: recharges=${totalRecharges} sessions=${totalSessions} UTs=${totalUTs} CDRs=${totalCDRs}`);

  // ────────────────────────────────────────────────────────────
  // Cross-customer activity: roaming, MNP, lifecycle events, cases, etc.
  // ────────────────────────────────────────────────────────────

  // Featured roaming — Thabo in SA, Boitumelo in UK, one random in UAE
  console.log('\n=== Roaming Sessions ===');
  const thabo = CUSTOMERS[0]; // Thabo Khumalo — hero
  const boitu = CUSTOMERS[3]; // Boitumelo — corporate
  await L.createRecord(TABLE_IDS['Roaming Sessions'], {
    [RS['Session Code']]: `ROAM-${thabo.msisdn.slice(-4)}-ZA-1`,
    [RS['Subscription']]: [thabo.subId],
    [RS['Partner']]: [partnerByCode['ZAF-VOD-01']],
    [RS['Zone']]: [zoneByCode['SADC']],
    [RS['Country']]: 'South Africa',
    [RS['VLR Address']]: '+27830000042',
    [RS['Entered At']]: nowMs - 2 * 86400000,
    [RS['Status']]: [1], // Active
    [RS['Bill Shock Level']]: [2], // 50%
    [RS['Data Usage (MB)']]: 1250,
    [RS['Voice Usage (min)']]: 68,
    [RS['SMS Count']]: 14,
    [RS['Total Charged']]: 340,
    [RS['Daily Cap']]: 800,
    [RS['Partner Name']]: 'Vodacom',
    [RS['Zone Name']]: 'SADC (Southern Africa)',
  });
  await L.createRecord(TABLE_IDS['Roaming Sessions'], {
    [RS['Session Code']]: `ROAM-${thabo.msisdn.slice(-4)}-ZW-1`,
    [RS['Subscription']]: [thabo.subId],
    [RS['Partner']]: [partnerByCode['ZWE-ECN-01']],
    [RS['Zone']]: [zoneByCode['SADC']],
    [RS['Country']]: 'Zimbabwe',
    [RS['VLR Address']]: '+263778000042',
    [RS['Entered At']]: nowMs - 40 * 86400000,
    [RS['Left At']]: nowMs - 33 * 86400000,
    [RS['Status']]: [2], // Completed
    [RS['Bill Shock Level']]: [1],
    [RS['Data Usage (MB)']]: 620,
    [RS['Voice Usage (min)']]: 85,
    [RS['SMS Count']]: 9,
    [RS['Total Charged']]: 210,
    [RS['Partner Name']]: 'Econet Wireless',
    [RS['Zone Name']]: 'SADC (Southern Africa)',
  });
  await L.createRecord(TABLE_IDS['Roaming Sessions'], {
    [RS['Session Code']]: `ROAM-${boitu.msisdn.slice(-4)}-GB-1`,
    [RS['Subscription']]: [boitu.subId],
    [RS['Partner']]: [partnerByCode['GBR-VOD-01']],
    [RS['Zone']]: [zoneByCode['UK']],
    [RS['Country']]: 'United Kingdom',
    [RS['VLR Address']]: '+447700000042',
    [RS['Entered At']]: nowMs - 12 * 86400000,
    [RS['Left At']]: nowMs - 5 * 86400000,
    [RS['Status']]: [2],
    [RS['Bill Shock Level']]: [3], // 80%
    [RS['Data Usage (MB)']]: 3400,
    [RS['Voice Usage (min)']]: 180,
    [RS['SMS Count']]: 22,
    [RS['Total Charged']]: 1580,
    [RS['Partner Name']]: 'Vodafone UK',
    [RS['Zone Name']]: 'United Kingdom',
  });
  console.log('  3 roaming sessions seeded');

  // Update Thabo's sub to reflect active roaming
  const subCols = await cm('Subscriptions');
  await L.updateRecord(TABLE_IDS['Subscriptions'], thabo.subId, {
    [subCols['Current Roaming Zone']]: [zoneByCode['SADC']],
  });

  // TAP Records — settlement from top partners
  console.log('\n=== TAP Records ===');
  const topPartnerCodes = ['ZAF-VOD-01','ZAF-MTN-01','NAM-MTC-01','ZWE-ECN-01','GBR-VOD-01','ARE-ETI-01','USA-TMO-01'];
  for (const pc of topPartnerCodes) {
    const pid = partnerByCode[pc];
    if (!pid) continue;
    for (let m = 0; m < 2; m++) {
      const periodStart = nowMs - (60 - m * 30) * 86400000;
      const periodEnd = periodStart + 30 * 86400000;
      const events = L.rand(20, 150);
      const amt = Math.round(events * L.rand(3, 20) * 100) / 100;
      await L.createRecord(TABLE_IDS['TAP Records'], {
        [TAPr['TAP Code']]: `TAP-${pc}-${m+1}`,
        [TAPr['Partner']]: [pid],
        [TAPr['File Name']]: `TAP3_${pc}_${new Date(periodStart).toISOString().slice(0,7)}.xml`,
        [TAPr['Period Start']]: periodStart,
        [TAPr['Period End']]: periodEnd,
        [TAPr['Total Events']]: events,
        [TAPr['Total Amount']]: amt,
        [TAPr['Currency']]: [1],
        [TAPr['Status']]: [m === 0 ? 6 : 3], // recent=Settled, older=Reconciled
        [TAPr['Received Date']]: periodEnd + 86400000,
        ...(m === 0 ? { [TAPr['Settled Date']]: periodEnd + 14 * 86400000 } : {}),
      });
    }
  }
  console.log('  14 TAP records seeded');

  // ────────────────────────────────────────────────────────────
  // Lifecycle events — activation per subscription
  // ────────────────────────────────────────────────────────────
  console.log('\n=== Lifecycle Events ===');
  for (const c of CUSTOMERS) {
    await L.createRecord(TABLE_IDS['Customer Lifecycle Events'], {
      [CLE['Event Type']]: [1], // Activated
      [CLE['Event Date']]: nowMs - c.activatedDaysAgo * 86400000,
      [CLE['Reason']]: 'New SIM activation via ' + L.pick(['BTC Shop Gaborone','BTC Shop Francistown','Retail Agent','BTC Mobile App']),
      [CLE['Triggered By']]: [2],
      [CLE['Previous Status']]: 'New',
      [CLE['New Status']]: 'Active',
      [CLE['Customer']]: [c.customerId],
      [CLE['Notes']]: 'Customer onboarded; KYC verified; plan ' + c.plan + ' activated; welcome SMS sent.',
    });
    await L.sleep(30);
  }
  console.log(`  ${CUSTOMERS.length} activation events`);

  // Subscription Status History
  console.log('\n=== Subscription Status History ===');
  for (const c of CUSTOMERS) {
    await L.createRecord(TABLE_IDS['Subscription Status History'], {
      [SSH['Subscription']]: [c.subId],
      [SSH['Previous Status']]: [null],
      [SSH['New Status']]: [1],
      [SSH['Changed At']]: nowMs - c.activatedDaysAgo * 86400000,
      [SSH['Changed By']]: 'activation_workflow',
      [SSH['Reason']]: 'Initial activation',
    });
    await L.sleep(30);
  }
  console.log(`  ${CUSTOMERS.length} status history entries`);

  // ────────────────────────────────────────────────────────────
  // Customer Interactions + Cases
  // ────────────────────────────────────────────────────────────
  console.log('\n=== Interactions + Cases ===');
  let interactionCount = 0;
  for (const c of CUSTOMERS) {
    const n = L.rand(1, 4);
    for (let i = 0; i < n; i++) {
      const type = L.pick([1, 2, 3, 5, 6, 7]);
      const ts = nowMs - L.rand(1, c.activatedDaysAgo) * 86400000;
      await L.createRecord(TABLE_IDS['Customer Interactions'], {
        [CI['Interaction Code']]: `INT-${c.msisdn.slice(-4)}-${i+1}`,
        [CI['Interaction Type']]: [type],
        [CI['Timestamp']]: ts,
        [CI['Duration Seconds']]: L.rand(30, 300),
        [CI['Outcome']]: [1],
        [CI['Agent ID']]: type === 4 ? 'csr-' + L.rand(1, 20) : 'system',
        [CI['Transcript']]: type === 1 ? 'Customer dialed *134# to check balance.' :
                           type === 2 ? 'Customer recharged via USSD.' :
                           type === 3 ? 'Customer bought ' + c.plan + ' bundle.' :
                           type === 7 ? 'Self-care portal login + plan inquiry.' :
                           'General query resolved.',
        [CI['CSAT Score']]: L.rand(3, 5),
        [CI['Customer']]: [c.customerId],
        [CI['Subscription']]: [c.subId],
      });
      interactionCount++;
      await L.sleep(20);
    }
  }
  console.log(`  ${interactionCount} interactions`);

  // Cases — 6 support tickets
  const caseSeeds = [
    { custIdx: 1, subj: 'Data slowdown in evenings',  cat: 4, pri: 2, status: 3, channel: 'USSD-180' },
    { custIdx: 3, subj: 'Roaming bill higher than expected in UK', cat: 2, pri: 1, status: 4, channel: 'CARE-111' },
    { custIdx: 4, subj: 'SIM not activating',         cat: 5, pri: 1, status: 3, channel: 'RETAIL-BTC' },
    { custIdx: 6, subj: 'Balance deducted without usage', cat: 2, pri: 2, status: 4, channel: 'CARE-111' },
    { custIdx: 10, subj: 'USSD not responding',       cat: 4, pri: 3, status: 5, channel: 'USSD-180' },
    { custIdx: 14, subj: 'Request for bill copy',     cat: 6, pri: 3, status: 5, channel: 'WEB-SELFCARE' },
  ];
  for (let i = 0; i < caseSeeds.length; i++) {
    const cs = caseSeeds[i];
    const c = CUSTOMERS[cs.custIdx];
    const openedAt = nowMs - L.rand(3, 90) * 86400000;
    const resolvedAt = cs.status >= 4 ? openedAt + L.rand(1, 14) * 86400000 : null;
    await L.createRecord(TABLE_IDS['Cases'], {
      [CS['Case Code']]: `CASE-2026-${String(i+1).padStart(4, '0')}`,
      [CS['Subject']]: cs.subj,
      [CS['Customer']]: [c.customerId],
      [CS['Subscription']]: [c.subId],
      [CS['Channel']]: [CAT.channels[cs.channel]],
      [CS['Category']]: [cs.cat],
      [CS['Priority']]: [cs.pri],
      [CS['Status']]: [cs.status],
      [CS['Assigned To']]: 'csr-team-' + L.rand(1, 5),
      [CS['Opened At']]: openedAt,
      ...(resolvedAt ? { [CS['Resolved At']]: resolvedAt } : {}),
      ...(resolvedAt ? { [CS['CSAT']]: L.rand(3, 5) } : {}),
    });
  }
  console.log(`  ${caseSeeds.length} cases`);

  // ────────────────────────────────────────────────────────────
  // Notifications Sent (welcome + recharge success + low balance)
  // ────────────────────────────────────────────────────────────
  console.log('\n=== Notifications Sent ===');
  const templates = await L.fetchAll(TABLE_IDS['Notification Templates']);
  const tplByCode = {};
  const TPL = await cm('Notification Templates');
  for (const t of templates) tplByCode[t.cells[TPL['Template Code']]] = t._id;

  let notifCount = 0;
  for (const c of CUSTOMERS) {
    // Welcome on activation
    await L.createRecord(TABLE_IDS['Notifications Sent'], {
      [NS['Template']]: [tplByCode['TPL-WELCOME']],
      [NS['Customer']]: [c.customerId],
      [NS['Subscription']]: [c.subId],
      [NS['Recipient']]: c.msisdn,
      [NS['Channel']]: [1], // SMS
      [NS['Sent At']]: nowMs - c.activatedDaysAgo * 86400000 + 60000,
      [NS['Status']]: [3], // delivered
      [NS['Body Rendered']]: `Dumela ${c.first}! Welcome to b-mobile. Your MSISDN ${c.msisdn} is active on ${c.plan}.`,
    });
    notifCount++;
    // Recharge confirmations (match some recharges)
    for (let r = 0; r < 2; r++) {
      await L.createRecord(TABLE_IDS['Notifications Sent'], {
        [NS['Template']]: [tplByCode['TPL-RECH-OK']],
        [NS['Customer']]: [c.customerId],
        [NS['Subscription']]: [c.subId],
        [NS['Recipient']]: c.msisdn,
        [NS['Channel']]: [1],
        [NS['Sent At']]: nowMs - L.rand(1, 30) * 86400000,
        [NS['Status']]: [3],
        [NS['Body Rendered']]: `Recharge successful. New balance: P${L.rand(10, 150)}.`,
      });
      notifCount++;
    }
    // Low balance for some
    if (c.walletBalance < 20) {
      await L.createRecord(TABLE_IDS['Notifications Sent'], {
        [NS['Template']]: [tplByCode['TPL-LOW-BAL']],
        [NS['Customer']]: [c.customerId],
        [NS['Subscription']]: [c.subId],
        [NS['Recipient']]: c.msisdn,
        [NS['Channel']]: [1],
        [NS['Sent At']]: nowMs - L.rand(1, 3) * 86400000,
        [NS['Status']]: [3],
        [NS['Body Rendered']]: `Hi ${c.first}, your b-mobile balance is P${c.walletBalance}. Recharge via *104*PIN#.`,
      });
      notifCount++;
    }
    await L.sleep(20);
  }
  console.log(`  ${notifCount} notifications`);

  // ────────────────────────────────────────────────────────────
  // Devices: IMEI change event + EIR (fraud scenario)
  // ────────────────────────────────────────────────────────────
  console.log('\n=== IMEI Change Events + EIR ===');
  // Seed one suspicious IMEI change for Thabo (while roaming)
  const tacs = await L.fetchAll(TABLE_IDS['Device TAC Database']);
  const tCols = await L.getTableSchema(TABLE_IDS['Device TAC Database']);
  const galaxyA54 = tacs.find(t => t.cells[tCols.find(c => c.name === 'TAC').id] === '35689009');

  const DEV = await cm('Devices');
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
    [DEV['Notes']]: 'Unknown device; SIM swap detected during active roaming session — URGENT review.',
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
    [IME['Resolution Notes']]: 'SIM moved to unknown Samsung device during active roaming in South Africa. Possible SIM swap fraud. URGENT review.',
  });
  await L.createRecord(TABLE_IDS['Equipment Identity Register'], {
    [EIR['EIR Code']]: `EIR-FRAUD-${thabo.msisdn.slice(-4)}`,
    [EIR['IMEI']]: fraudImei,
    [EIR['Device']]: [fraudDevId],
    [EIR['List Type']]: [2], // Graylist
    [EIR['Reason']]: [3], // Fraud
    [EIR['Reported By']]: 'fraud-detector-bot',
    [EIR['Reported At']]: nowMs - 30 * 60000,
    [EIR['Country of Report']]: 'South Africa',
    [EIR['Status']]: [1],
    [EIR['Notes']]: 'Auto-flagged by IMEI change anomaly engine during active SADC roaming.',
  });

  // Plus one clean IMEI change (Boitumelo upgraded his phone last year)
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
    [IME['Resolution Notes']]: 'Annual device upgrade — previous Note 20 replaced with S24 Ultra via corporate program.',
  });

  // Plus an EIR stolen entry for a retired sub (demo stolen-phone scenario)
  const stolenImei = '35737120' + String(L.rand(1000000, 9999999));
  await L.createRecord(TABLE_IDS['Equipment Identity Register'], {
    [EIR['EIR Code']]: `EIR-STOLEN-1`,
    [EIR['IMEI']]: stolenImei,
    [EIR['List Type']]: [1], // Blacklist
    [EIR['Reason']]: [1], // Stolen
    [EIR['Reported By']]: 'customer via BTC Shop Gaborone',
    [EIR['Reported At']]: nowMs - 30 * 86400000,
    [EIR['Country of Report']]: 'Botswana',
    [EIR['Police Case Number']]: 'CR-GAB-2026/' + L.rand(100, 999),
    [EIR['Status']]: [1],
    [EIR['Notes']]: 'Stolen in break-in at Extension 12, Gaborone. Police case filed. Customer reissued SIM.',
  });
  console.log('  2 IMEI change events + 2 EIR entries (1 fraud, 1 stolen)');

  // ────────────────────────────────────────────────────────────
  // MNP — flagged as out-of-scope in BW (BOCRA shelved 2021)
  // but seed 2 records with explanatory note
  // ────────────────────────────────────────────────────────────
  console.log('\n=== MNP (flagged as BOCRA-shelved regulatory scope) ===');
  await L.createRecord(TABLE_IDS['MNP Requests'], {
    [MNP['MNP Code']]: `MNP-SCOPE-PLANNING-01`,
    [MNP['Type']]: [1], // Port In
    [MNP['MSISDN']]: '26771234123',
    [MNP['Donor Operator']]: 'Mascom',
    [MNP['UPC Code']]: 'PLANNED',
    [MNP['Requested At']]: nowMs - 30 * 86400000,
    [MNP['Status']]: [8], // Cancelled
    [MNP['Rejection Reason']]: [6], // Regulator Denial
    [MNP['SLA Days Remaining']]: 0,
    [MNP['Notes']]: 'REGULATORY SCOPE — BOCRA shelved MNP in April 2021. Schema retained for future regulatory re-enablement. This record is a reference scenario.',
  });
  await L.createRecord(TABLE_IDS['MNP Requests'], {
    [MNP['MNP Code']]: `MNP-SCOPE-PLANNING-02`,
    [MNP['Type']]: [2], // Port Out
    [MNP['MSISDN']]: CUSTOMERS[5].msisdn,
    [MNP['Subscription']]: [CUSTOMERS[5].subId],
    [MNP['Customer']]: [CUSTOMERS[5].customerId],
    [MNP['Recipient Operator']]: 'Orange Botswana',
    [MNP['UPC Code']]: 'PLANNED',
    [MNP['Requested At']]: nowMs - 45 * 86400000,
    [MNP['Status']]: [8],
    [MNP['Rejection Reason']]: [6],
    [MNP['SLA Days Remaining']]: 0,
    [MNP['Notes']]: 'REGULATORY SCOPE — BOCRA shelved MNP in April 2021. Schema retained for future regulatory re-enablement.',
  });
  console.log('  2 MNP scope placeholders');

  // ────────────────────────────────────────────────────────────
  // Number Auctions — vanity numbers
  // ────────────────────────────────────────────────────────────
  console.log('\n=== Number Auctions ===');
  const mp = await L.fetchAll(TABLE_IDS['MSISDN Pool']);
  const MPCol = await cm('MSISDN Pool');
  const vanityNumbers = mp.filter(r => {
    const tier = (r.cells[MPCol['Tier']] || [0])[0];
    return tier >= 2;
  });
  const auctionSeeds = [
    { msisdn: '26777777777', tier: 3, reserve: 55000, bid: 82000, count: 6, status: 2, endDays: 3,  note: 'Triple-7 platinum — highly sought.' },
    { msisdn: '26772222222', tier: 3, reserve: 40000, bid: 58000, count: 4, status: 2, endDays: 7,  note: 'Repeated 2s.' },
    { msisdn: '26775555555', tier: 3, reserve: 40000, bid: 0,     count: 0, status: 2, endDays: 14, note: 'Repeated 5s — reserve not met yet.' },
    { msisdn: '26771000000', tier: 2, reserve: 15000, bid: 21000, count: 3, status: 4, endDays: -7, note: 'Round-number gold — sold.' },
    { msisdn: '26771234567', tier: 4, reserve: 80000, bid: 125000,count: 9, status: 4, endDays: -14,note: 'Ladder ascending — sold to corporate.' },
  ];
  for (let i = 0; i < auctionSeeds.length; i++) {
    const a = auctionSeeds[i];
    const isSold = a.status === 4;
    const mpRow = vanityNumbers.find(r => r.cells[MPCol['MSISDN']] === a.msisdn);
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
  console.log('  5 auctions (2 open, 2 sold, 1 open-no-bid)');

  // ────────────────────────────────────────────────────────────
  // Number Change Events — audit log for activations + sold auctions
  // ────────────────────────────────────────────────────────────
  console.log('\n=== Number Change Events ===');
  for (const c of CUSTOMERS) {
    await L.createRecord(TABLE_IDS['Number Change Events'], {
      [NCE['Event Code']]: `NCE-ASSIGN-${c.msisdn.slice(-6)}`,
      [NCE['MSISDN']]: c.msisdn,
      [NCE['New Subscription']]: [c.subId],
      [NCE['Change Type']]: [1], // Assign
      [NCE['Changed At']]: nowMs - c.activatedDaysAgo * 86400000,
      [NCE['Changed By']]: L.pick(['retail.ops@btc.bw','app.provisioning','csr.ops@btc.bw']),
      [NCE['Reason']]: 'Initial MSISDN assignment from pool upon new subscription.',
    });
    await L.sleep(20);
  }
  console.log(`  ${CUSTOMERS.length} assign events`);

  // ────────────────────────────────────────────────────────────
  // Account Hierarchy (Debswana corporate, one family)
  // ────────────────────────────────────────────────────────────
  console.log('\n=== Account Hierarchy ===');
  // Boitumelo (corporate) as parent of 2 employee lines
  await L.createRecord(TABLE_IDS['Account Hierarchy'], {
    [AH['Parent Customer']]: [boitu.customerId],
    [AH['Child Customer']]: [CUSTOMERS[7].customerId],
    [AH['Relationship Type']]: [4], // Corporate Employee
    [AH['Billing Responsibility']]: [1], // Parent Pays
    [AH['Effective From']]: nowMs - 300 * 86400000,
    [AH['Effective To']]: nowMs + 365 * 86400000,
    [AH['Notes']]: 'Corporate employee line — Debswana account.',
  });
  await L.createRecord(TABLE_IDS['Account Hierarchy'], {
    [AH['Parent Customer']]: [CUSTOMERS[6].customerId], // Kefilwe (senior)
    [AH['Child Customer']]: [CUSTOMERS[5].customerId], // Naledi (daughter)
    [AH['Relationship Type']]: [2], // Family Member
    [AH['Billing Responsibility']]: [1],
    [AH['Effective From']]: nowMs - 200 * 86400000,
    [AH['Notes']]: 'Family line — mother pays for daughter.',
  });
  console.log('  2 account hierarchies');

  // ────────────────────────────────────────────────────────────
  // F&F Groups + CUGs
  // ────────────────────────────────────────────────────────────
  console.log('\n=== F&F + CUG ===');
  const ffId = await L.createRecord(TABLE_IDS['Friends and Family Groups'], {
    [FF['Group Code']]: 'FF-KHAMA-FAM',
    [FF['Group Name']]: 'Khama Family F&F',
    [FF['Owner']]: [CUSTOMERS[6].customerId],
    [FF['Discount %']]: 50,
    [FF['Status']]: [1],
    [FF['Max Members']]: 5,
    [FF['Created Date']]: nowMs - 150 * 86400000,
  });
  for (let i = 0; i < 3; i++) {
    await L.createRecord(TABLE_IDS['FF Members'], {
      [FFM['Group']]: [ffId],
      [FFM['Subscription']]: [CUSTOMERS[5+i].subId],
      [FFM['Added Date']]: nowMs - L.rand(30, 150) * 86400000,
      [FFM['Status']]: [1],
    });
  }
  const cugId = await L.createRecord(TABLE_IDS['Closed User Groups'], {
    [CUG['CUG Code']]: 'CUG-DEBSWANA',
    [CUG['CUG Name']]: 'Debswana Corporate CUG',
    [CUG['Enterprise Account']]: [boitu.customerId],
    [CUG['Discount %']]: 80,
    [CUG['Status']]: [1],
    [CUG['Max Members']]: 500,
  });
  for (let i = 0; i < 4; i++) {
    await L.createRecord(TABLE_IDS['CUG Members'], {
      [CUGM['CUG']]: [cugId],
      [CUGM['Subscription']]: [CUSTOMERS[3+i].subId],
      [CUGM['Added Date']]: nowMs - L.rand(60, 300) * 86400000,
      [CUGM['Status']]: [1],
    });
  }
  console.log('  1 F&F (3 members) + 1 CUG (4 members)');

  // ────────────────────────────────────────────────────────────
  // Bonus Grants, Promotion Redemptions, Balance Transfers, Orders
  // ────────────────────────────────────────────────────────────
  console.log('\n=== Bonus Grants + Promotions + Orders ===');
  for (let i = 0; i < 5; i++) {
    const c = CUSTOMERS[i];
    await L.createRecord(TABLE_IDS['Bonus Grants'], {
      [BG['Grant Code']]: `BG-WELCOME-${c.msisdn.slice(-4)}`,
      [BG['Subscription']]: [c.subId],
      [BG['Amount']]: 5,
      [BG['Unit']]: [1],
      [BG['Reason']]: [1], // Welcome
      [BG['Status']]: [2], // Active
      [BG['Granted At']]: nowMs - c.activatedDaysAgo * 86400000,
      [BG['Expires At']]: nowMs - (c.activatedDaysAgo - 14) * 86400000,
      [BG['Notes']]: 'Welcome bonus: P5 credit + 100 MB on new SIM activation.',
    });
  }

  // Promotion Redemptions (BTC Pasela + Welcome)
  const paselaId = CAT.promos['PASELA'];
  const welcomeId = CAT.promos['WELCOME-SIM'];
  for (let i = 0; i < 6; i++) {
    const c = CUSTOMERS[i];
    await L.createRecord(TABLE_IDS['Promotion Redemptions'], {
      [PR['Redemption Code']]: `PRM-${c.msisdn.slice(-4)}-${i+1}`,
      [PR['Promotion']]: [i % 2 === 0 ? paselaId : welcomeId],
      [PR['Customer']]: [c.customerId],
      [PR['Subscription']]: [c.subId],
      [PR['Redeemed At']]: nowMs - L.rand(5, 90) * 86400000,
      [PR['Value Redeemed']]: L.rand(5, 50),
      [PR['Status']]: [2],
    });
  }

  // Balance Transfers
  for (let i = 0; i < 2; i++) {
    const from = CUSTOMERS[i];
    const to = CUSTOMERS[i + 10];
    await L.createRecord(TABLE_IDS['Balance Transfers'], {
      [BT['Transfer Code']]: `BT-${from.msisdn.slice(-4)}-${to.msisdn.slice(-4)}`,
      [BT['From Subscription']]: [from.subId],
      [BT['To Subscription']]: [to.subId],
      [BT['Amount']]: L.pick([5, 10, 20]),
      [BT['Unit']]: [1],
      [BT['Transfer Fee']]: 1,
      [BT['Status']]: [2],
      [BT['Timestamp']]: nowMs - L.rand(5, 45) * 86400000,
      [BT['Notes']]: 'P2P airtime gift.',
    });
  }

  // Orders + Order Items
  for (let i = 0; i < 4; i++) {
    const c = CUSTOMERS[i];
    const orderId = await L.createRecord(TABLE_IDS['Orders'], {
      [O['Order Code']]: `ORD-${c.msisdn.slice(-4)}-${i+1}`,
      [O['Customer']]: [c.customerId],
      [O['Order Type']]: [L.pick([1, 2])],
      [O['Status']]: [4], // Completed
      [O['Channel']]: [CAT.channels['RETAIL-BTC']],
      [O['Order Date']]: nowMs - L.rand(30, 200) * 86400000,
      [O['Total Amount']]: 30,
      [O['Notes']]: 'Plan activation via retail.',
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
  console.log('  5 bonus grants + 6 promo redemptions + 2 balance transfers + 4 orders');

  // Trigger rollup eval on major tables
  console.log('\n=== Triggering evaluation ===');
  await L.sleep(5000);
  for (const tn of ['Balances','Subscriptions','Customers','Tariff Plans','Wallets','Charging Sessions','Roaming Partners','Roaming Zones','Device TAC Database','Devices']) {
    const rows = await L.fetchAll(TABLE_IDS[tn]);
    await L.evalAllComputed(TABLE_IDS[tn], rows.map(r => r._id));
  }

  console.log('\n=== PHASE 4 COMPLETE ===');
  console.log(`Final totals: ${totalRecharges} recharges · ${totalSessions} sessions · ${totalUTs} UTs · ${totalCDRs} CDRs`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
