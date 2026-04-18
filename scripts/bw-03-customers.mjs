// BW Phase 3: customers, KYC, wallets, subscriptions, balances, devices.
// 20 realistic Batswana subscribers across segments (consumer / business / youth).

import * as L from './lib-common.mjs';
import fs from 'node:fs';
import path from 'node:path';

const TABLE_IDS = L.loadTableIds();
const CATALOG = JSON.parse(fs.readFileSync(path.join(L.ROOT, '.bw-catalog-ids.json'), 'utf8'));

async function cm(tn) {
  const cols = await L.getTableSchema(TABLE_IDS[tn]);
  return Object.fromEntries(cols.map(c => [c.name, c.id]));
}

// Tswana names dataset (from research)
const FIRSTS = ['Kagiso','Thabo','Mpho','Neo','Tebogo','Tumi','Pula','Kefilwe','Bonolo','Lesego','Atang','Oratile','Masego','Kitso','Amogelang','Wame','Boitumelo','Lerato','Naledi','Tumelo','Tshepo','Katlego','Gaone','Kabelo','Gorata','Refilwe','Dineo','Bame','Thato'];
const LASTS = ['Mogotsi','Mogale','Seretse','Kgosi','Molefhe','Morake','Ramotswa','Pilane','Khama','Masire','Motswaledi','Mothibi','Sebina','Tau','Motsumi','Bogatsu','Dingake','Kgathi','Mmusi','Ntuane','Phirinyane','Rakhudu','Tshekedi','Molefe','Kebonang'];
const CITIES = ['Gaborone','Francistown','Molepolole','Maun','Mogoditshane','Serowe','Selibe Phikwe','Kanye','Mahalapye','Palapye','Lobatse','Jwaneng'];

function pickName() {
  const f = L.pick(FIRSTS);
  const l = L.pick(LASTS);
  return { first: f, last: l, full: f + ' ' + l };
}

function msisdnBW() {
  const prefixes = ['71','72','75','77'];   // BTC/beMobile allocated prefixes
  return '267' + L.pick(prefixes) + String(L.rand(100000, 999999));
}

function iccidBW() {
  return '8926704' + String(L.rand(100000000000, 999999999999));
}
function imsiBW() {
  return '65204' + String(L.rand(1000000000, 9999999999));
}
function omangId() {
  // 9 digits
  return String(L.rand(100000000, 999999999));
}

async function main() {
  console.log('=== BW PHASE 3: CUSTOMERS + IDENTITY ===\n');

  const C = await cm('Customers');
  const W = await cm('Wallets');
  const S = await cm('Subscriptions');
  const B = await cm('Balances');
  const D = await cm('Devices');
  const CI = await cm('Customer Identifications');

  // Fetch existing Device TAC Database to pick TACs for each device
  const tacs = await L.fetchAll(TABLE_IDS['Device TAC Database']);
  const tacById = {};
  const tCols = await L.getTableSchema(TABLE_IDS['Device TAC Database']);
  const T_TAC = tCols.find(c => c.name === 'TAC').id;
  const T_MFR = tCols.find(c => c.name === 'Manufacturer').id;
  const T_NAME = tCols.find(c => c.name === 'Marketing Name').id;
  const T_VOLTE = tCols.find(c => c.name === 'VoLTE Support').id;
  const T_5G = tCols.find(c => c.name === '5G Support').id;
  const T_YEAR = tCols.find(c => c.name === 'Release Year').id;
  for (const t of tacs) {
    tacById[t._id] = {
      tac: t.cells[T_TAC], mfr: t.cells[T_MFR], name: t.cells[T_NAME],
      volte: t.cells[T_VOLTE] === true, g5: t.cells[T_5G] === true,
      year: t.cells[T_YEAR],
    };
  }
  const tacList = Object.entries(tacById);
  // Bias: premium models for business customers
  const premiumTACs = tacList.filter(([_, t]) => t.year >= 2022 && (t.mfr === 'Apple' || t.name.includes('S24') || t.name.includes('S23'))).map(([id, t]) => ({ id, ...t }));
  const midTACs = tacList.filter(([_, t]) => t.year >= 2020).map(([id, t]) => ({ id, ...t }));

  // Featured customer profiles (hand-crafted for demo realism)
  const FEATURED = [
    // Hero demo customer — roaming + device + fraud scenario
    {
      first: 'Thabo', last: 'Khumalo', segment: 1, type: 1, city: 'Gaborone',
      plan: 'BFP-MONTHLY', walletBalance: 250, walletLifetime: 4200, walletSpend: 3950,
      activatedDaysAgo: 220, onboardedDaysAgo: 400,
      deviceProfile: 'premium', deviceTac: '35328115', // iPhone 15 Pro
      usedData: 720, usedVoice: 2400, usedSms: 0,
      notes: 'Business traveler. Corporate line. Frequent SADC roamer (SA/ZW/ZM).',
    },
    // Power data user — heavy streamer
    {
      first: 'Lerato', last: 'Molefhe', segment: 1, type: 1, city: 'Gaborone',
      plan: 'TURNUP-30GB-30', walletBalance: 85, walletLifetime: 2200, walletSpend: 2115,
      activatedDaysAgo: 150, onboardedDaysAgo: 310,
      deviceProfile: 'midrange', deviceTac: '35689009', // Galaxy A54
      usedData: 22400, usedVoice: 0, usedSms: 0,
      notes: 'Heavy data user. Netflix + TikTok every evening. No voice bundle.',
    },
    // Student on Student Bundle
    {
      first: 'Kagiso', last: 'Seretse', segment: 4, type: 1, city: 'Gaborone',
      plan: 'TURNUP-4GB-30', walletBalance: 18, walletLifetime: 320, walletSpend: 302,
      activatedDaysAgo: 90, onboardedDaysAgo: 92,
      deviceProfile: 'budget', deviceTac: '86420408', // Redmi Note 12
      usedData: 2800, usedVoice: 0, usedSms: 0,
      notes: 'UB student. Student segment. Buys weekly social pack.',
    },
    // Enterprise / Corporate
    {
      first: 'Boitumelo', last: 'Ramotswa', segment: 2, type: 2, city: 'Gaborone',
      plan: 'TURNUP-100GB-30', walletBalance: 340, walletLifetime: 8100, walletSpend: 7760,
      activatedDaysAgo: 500, onboardedDaysAgo: 700,
      deviceProfile: 'premium', deviceTac: '35737120', // Galaxy S24 Ultra
      usedData: 58000, usedVoice: 0, usedSms: 0,
      notes: 'Corporate account — Debswana employee. Heavy mobile data.',
    },
    // Rural low-usage
    {
      first: 'Mpho', last: 'Molefe', segment: 1, type: 1, city: 'Maun',
      plan: 'BFP-WEEKLY', walletBalance: 6, walletLifetime: 180, walletSpend: 174,
      activatedDaysAgo: 60, onboardedDaysAgo: 180,
      deviceProfile: 'budget', deviceTac: '35832609', // Nothing Phone (1)
      usedData: 45, usedVoice: 120, usedSms: 0,
      notes: 'Rural customer. Ngamiland. Low income — buys P10 daily bundles.',
    },
    // Youth segment
    {
      first: 'Naledi', last: 'Kgosi', segment: 4, type: 1, city: 'Francistown',
      plan: 'TIKTOK-M', walletBalance: 22, walletLifetime: 450, walletSpend: 428,
      activatedDaysAgo: 120, onboardedDaysAgo: 125,
      deviceProfile: 'midrange', deviceTac: '86012015', // Realme 11 Pro+
      usedData: 1500, usedVoice: 0, usedSms: 0,
      notes: 'Youth segment. Heavy TikTok user.',
    },
    // Senior — basic voice user
    {
      first: 'Kefilwe', last: 'Khama', segment: 3, type: 1, city: 'Serowe',
      plan: 'BFP-MONTHLY', walletBalance: 62, walletLifetime: 800, walletSpend: 738,
      activatedDaysAgo: 900, onboardedDaysAgo: 1200,
      deviceProfile: 'budget', deviceTac: '35262010', // iPhone 13
      usedData: 120, usedVoice: 6500, usedSms: 0,
      notes: 'Senior segment. Long-tenure customer. Voice-heavy — calls family.',
    },
  ];

  // Generate 13 more random customers for bulk realism
  while (FEATURED.length < 20) {
    const n = pickName();
    const segment = L.pick([1,1,1,2,3,4,4]); // consumer-heavy
    FEATURED.push({
      first: n.first, last: n.last, segment, type: segment === 2 ? 2 : 1,
      city: L.pick(CITIES),
      plan: L.pick(['BFP-MONTHLY','TURNUP-4GB-30','TURNUP-8GB-30','LIVE-SOCIAL-M','BFP-WEEKLY']),
      walletBalance: L.rand(5, 180),
      walletLifetime: L.rand(200, 3500),
      walletSpend: null, // will compute below
      activatedDaysAgo: L.rand(30, 800),
      onboardedDaysAgo: L.rand(30, 1200),
      deviceProfile: L.pick(['midrange','midrange','budget','premium']),
      deviceTac: null,
      usedData: L.rand(50, 8000),
      usedVoice: L.rand(0, 800),
      usedSms: L.rand(0, 50),
      notes: '',
    });
  }
  // Fill in nulls + device TACs
  for (const f of FEATURED) {
    if (f.walletSpend == null) f.walletSpend = f.walletLifetime - f.walletBalance;
    if (f.onboardedDaysAgo < f.activatedDaysAgo) f.onboardedDaysAgo = f.activatedDaysAgo + 5;
    if (!f.deviceTac) {
      const pool = f.deviceProfile === 'premium' ? premiumTACs : midTACs;
      const picked = L.pick(pool);
      f.deviceTac = picked.tac;
    }
  }

  // Fetch plans by code (already seeded)
  const plans = await L.fetchAll(TABLE_IDS['Tariff Plans']);
  const TP = await cm('Tariff Plans');
  const planByCode = {};
  for (const p of plans) planByCode[p.cells[TP['Plan Code']]] = p;

  // SIM pool — pick ICCIDs to allocate
  const sims = await L.fetchAll(TABLE_IDS['SIM Inventory']);
  const SI = await cm('SIM Inventory');
  const simIter = sims[Symbol.iterator]();

  // MSISDN pool — allocate
  const poolRows = await L.fetchAll(TABLE_IDS['MSISDN Pool']);
  const MP = await cm('MSISDN Pool');
  const standardPool = poolRows.filter(r => (r.cells[MP['Tier']] || [0])[0] === 1);
  const poolIter = standardPool[Symbol.iterator]();

  const allCreated = [];

  for (let i = 0; i < FEATURED.length; i++) {
    const f = FEATURED[i];
    console.log(`\n[${i+1}] ${f.first} ${f.last} — ${f.city} — ${f.plan}`);
    const nowMs = Date.now();
    const onboardedMs = nowMs - f.onboardedDaysAgo * 86400000;
    const activatedMs = nowMs - f.activatedDaysAgo * 86400000;
    const plan = planByCode[f.plan];

    // Customer
    const customerId = await L.createRecord(TABLE_IDS['Customers'], {
      [C['Name']]: `${f.first} ${f.last}`,
      [C['Email']]: `${f.first.toLowerCase()}.${f.last.toLowerCase()}@gmail.com`,
      [C['Phone']]: null, // will set from MSISDN
      [C['Segment']]: [f.segment],
      [C['Language']]: [i % 3 === 0 ? 2 : 1], // ~1/3 Tswana, 2/3 English
      [C['Customer Type']]: [f.type],
      [C['KYC Status']]: [3], // verified
      [C['Onboarded Date']]: onboardedMs,
      [C['Status']]: [1], // active
    });

    // KYC — Omang or Passport
    const idType = L.pick([2, 2, 2, 1]); // mostly Omang (type 2 = National ID), some passports
    await L.createRecord(TABLE_IDS['Customer Identifications'], {
      [CI['ID Type']]: [idType],
      [CI['ID Number']]: idType === 2 ? omangId() : 'BW' + L.rand(1000000, 9999999),
      [CI['Issuing Authority']]: idType === 2 ? 'Dept. of Civil & National Registration, Botswana' : 'Ministry of Nationality, Immigration & Gender Affairs',
      [CI['Issue Date']]: onboardedMs - L.rand(365, 2000) * 86400000,
      [CI['Expiry Date']]: onboardedMs + L.rand(500, 3000) * 86400000,
      [CI['Verified']]: true,
      [CI['Verification Date']]: onboardedMs,
      [CI['Verification Method']]: [L.pick([1, 2, 5])], // Manual / DigiLocker / Doc Upload
      [CI['Customer']]: [customerId],
      [CI['Scan URL']]: `https://kyc-docs.btc.bw/scans/${customerId}/front.jpg`,
    });

    // Allocate a MSISDN from pool (mark pool row as Assigned)
    let msisdnRow = poolIter.next().value;
    let msisdn;
    if (msisdnRow) {
      msisdn = msisdnRow.cells[MP['MSISDN']];
      await L.updateRecord(TABLE_IDS['MSISDN Pool'], msisdnRow._id, {
        [MP['Status']]: [3], // Assigned
        [MP['Last Assigned Date']]: activatedMs,
      });
    } else {
      msisdn = msisdnBW();
    }

    // Update customer phone
    await L.updateRecord(TABLE_IDS['Customers'], customerId, { [C['Phone']]: msisdn });

    // Wallet
    const walletId = await L.createRecord(TABLE_IDS['Wallets'], {
      [W['Wallet Code']]: `WLT-${f.first.toUpperCase()}-${msisdn.slice(-4)}`,
      [W['Customer']]: [customerId],
      [W['Current Balance']]: f.walletBalance,
      [W['Currency']]: [1], // BWP (only one option for now)
      [W['Status']]: [1],
      [W['Last Recharge Date']]: nowMs - L.rand(1, 20) * 86400000,
      [W['Last Usage Date']]: nowMs - L.rand(0, 48) * 3600000,
      [W['Lifetime Recharge']]: f.walletLifetime,
      [W['Lifetime Spend']]: f.walletSpend,
    });

    // Allocate a SIM (mark as Activated)
    let simRow = simIter.next().value;
    let iccid, imsi;
    if (simRow) {
      iccid = simRow.cells[SI['ICCID']];
      imsi = simRow.cells[SI['IMSI']];
      await L.updateRecord(TABLE_IDS['SIM Inventory'], simRow._id, { [SI['Status']]: [3] });
    } else {
      iccid = iccidBW();
      imsi = imsiBW();
    }

    // Subscription
    const subId = await L.createRecord(TABLE_IDS['Subscriptions'], {
      [S['MSISDN']]: msisdn,
      [S['IMSI']]: imsi,
      [S['ICCID']]: iccid,
      [S['APN']]: 'internet.btc.bw',
      [S['Subscription Type']]: [3], // Prepaid Hybrid
      [S['Roaming Enabled']]: f.segment === 2 || Math.random() < 0.3,
      [S['Home Network']]: 'b-mobile BW',
      [S['Activation Date']]: activatedMs,
      [S['Status']]: [1],
      [S['Customer']]: [customerId],
      [S['Current Plan']]: [plan._id],
      [S['Last Usage Date']]: nowMs - L.rand(0, 48) * 3600000,
      [S['Roaming Credit Limit Daily']]: f.segment === 2 ? 1500 : 500,
      [S['Notes']]: f.notes || null,
    });

    // Balances — 3 per sub, seeded from plan allowances (if > 0)
    const cycleStart = activatedMs;
    const cycleEnd = activatedMs + (plan.cells[TP['Validity Days']] || 30) * 86400000;
    const balances = [];
    const dataAllow = plan.cells[TP['Data Allowance (MB)']] || 0;
    const voiceAllow = plan.cells[TP['Voice Allowance (min)']] || 0;
    const smsAllow = plan.cells[TP['SMS Allowance']] || 0;

    if (dataAllow > 0) {
      const balDataId = await L.createRecord(TABLE_IDS['Balances'], {
        [B['Balance Code']]: `BAL-DATA-${msisdn.slice(-6)}`,
        [B['Cycle Start']]: cycleStart, [B['Cycle End']]: cycleEnd,
        [B['Status']]: [1], [B['Service Context']]: [1],
        [B['Initial Amount']]: dataAllow,
        [B['Rating Group']]: 10, [B['Allowance Label']]: 'data_main',
        [B['Unit Type']]: [1], // MB
        [B['Subscription']]: [subId], [B['Tariff Plan']]: [plan._id],
        [B['Effective From']]: cycleStart, [B['Effective To']]: cycleEnd,
        [B['Price Paid']]: plan.cells[TP['Price']], [B['Activation Source']]: [1],
      });
      balances.push({ id: balDataId, type: 'data', initial: dataAllow, used: f.usedData });
    }
    if (voiceAllow > 0) {
      const balVoiceId = await L.createRecord(TABLE_IDS['Balances'], {
        [B['Balance Code']]: `BAL-VOICE-${msisdn.slice(-6)}`,
        [B['Cycle Start']]: cycleStart, [B['Cycle End']]: cycleEnd,
        [B['Status']]: [1], [B['Service Context']]: [2],
        [B['Initial Amount']]: voiceAllow,
        [B['Rating Group']]: 100, [B['Allowance Label']]: 'voice_bundle',
        [B['Unit Type']]: [2], // minutes (guess — may need adjustment)
        [B['Subscription']]: [subId], [B['Tariff Plan']]: [plan._id],
        [B['Effective From']]: cycleStart, [B['Effective To']]: cycleEnd,
        [B['Price Paid']]: 0, [B['Activation Source']]: [1],
      });
      balances.push({ id: balVoiceId, type: 'voice', initial: voiceAllow, used: f.usedVoice });
    }
    if (smsAllow > 0) {
      const balSmsId = await L.createRecord(TABLE_IDS['Balances'], {
        [B['Balance Code']]: `BAL-SMS-${msisdn.slice(-6)}`,
        [B['Cycle Start']]: cycleStart, [B['Cycle End']]: cycleEnd,
        [B['Status']]: [1], [B['Service Context']]: [3],
        [B['Initial Amount']]: smsAllow,
        [B['Rating Group']]: 200, [B['Allowance Label']]: 'sms_pack',
        [B['Unit Type']]: [3], [B['Subscription']]: [subId], [B['Tariff Plan']]: [plan._id],
        [B['Effective From']]: cycleStart, [B['Effective To']]: cycleEnd,
        [B['Price Paid']]: 0, [B['Activation Source']]: [1],
      });
      balances.push({ id: balSmsId, type: 'sms', initial: smsAllow, used: f.usedSms });
    }

    // Device
    const tacRecord = tacs.find(t => t.cells[T_TAC] === f.deviceTac);
    const tacInfo = tacRecord ? tacById[tacRecord._id] : { name: 'Unknown', mfr: 'Unknown', volte: true, g5: false, year: 2020 };
    const imei = f.deviceTac + String(L.rand(1000000, 9999999));
    const deviceId = await L.createRecord(TABLE_IDS['Devices'], {
      [D['Device Code']]: `DEV-${imei.slice(-8)}`,
      [D['IMEI']]: imei,
      [D['IMEISV']]: imei.slice(0, 14) + String(L.rand(1, 9)),
      [D['TAC']]: f.deviceTac,
      [D['Device TAC']]: [tacRecord?._id],
      [D['Owner']]: [customerId],
      [D['Current Subscription']]: [subId],
      [D['First Seen']]: activatedMs,
      [D['Last Seen']]: nowMs - L.rand(0, 24) * 3600000,
      [D['Status']]: [1], // Active
      [D['Is Fraud Flagged']]: false,
      [D['Make']]: tacInfo.mfr,
      [D['Model Name']]: tacInfo.name,
      [D['Supports VoLTE']]: tacInfo.volte,
      [D['Supports 5G']]: tacInfo.g5,
      [D['Release Year']]: tacInfo.year,
    });

    // Back-link device on subscription
    await L.updateRecord(TABLE_IDS['Subscriptions'], subId, { [S['Current Device']]: [deviceId] });

    console.log(`    cust=${customerId.slice(0,8)} msisdn=${msisdn} sub=${subId.slice(0,8)} device=${tacInfo.name.slice(0,30)}`);

    allCreated.push({
      ...f,
      customerId, walletId, subId, deviceId,
      msisdn, iccid, imsi, imei,
      balances,
      planId: plan._id,
    });
  }

  fs.writeFileSync(path.join(L.ROOT, '.bw-customers-ids.json'), JSON.stringify(allCreated, null, 2));
  console.log(`\n=== PHASE 3 COMPLETE: ${allCreated.length} customers with full identity + devices ===`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
