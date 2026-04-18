// BW re-skin Phase 2: catalog + infrastructure seeding.
// - Tariff Plans (real b-mobile plans: beFREE Plus, TurnUp data, boosters)
// - Services, Business Rules, Promotions, Bundles, Bundle Components
// - Roaming Zones + Partners + Rate Cards
// - Channels, Distribution Partners, Partner Contracts
// - Notification Templates
// - MSISDN Pool, SIM Inventory, Recharge Vouchers
// - Network Elements (BW MCC/MNC)
// - Number Recycling Rules already exist — just refresh regulator refs

import * as L from './lib-common.mjs';
import fs from 'node:fs';
import path from 'node:path';

const TABLE_IDS = L.loadTableIds();

async function cm(tn) {
  const cols = await L.getTableSchema(TABLE_IDS[tn]);
  return Object.fromEntries(cols.map(c => [c.name, c.id]));
}

async function main() {
  console.log('=== BW PHASE 2: CATALOG + INFRA ===\n');

  const IDS = {}; // store all IDs for downstream scripts

  // ────────────────────────────────────────────────────────────
  // 1. Tariff Plans (real b-mobile beFREE Plus + TurnUp + Boosters)
  // ────────────────────────────────────────────────────────────
  console.log('1. Tariff Plans (real b-mobile lineup)');
  const TP = await cm('Tariff Plans');
  const plans = [
    // beFREE Plus voice+data combos
    { code: 'BFP-DAILY-BASIC', name: 'beFREE Plus Daily Basic', price: 5,  validity: 1,  type: 1, data: 0,      voice: 30,   sms: 0,   region: 'Botswana', prio: 50 },
    { code: 'BFP-DAILY-UNLTD', name: 'beFREE Plus Daily Unlimited', price: 10, validity: 1,  type: 1, data: 0,   voice: 9999, sms: 0,   region: 'Botswana', prio: 50 },
    { code: 'BFP-WEEKLY',      name: 'beFREE Plus Weekly', price: 30, validity: 7,  type: 3, data: 200,    voice: 9999, sms: 0,   region: 'Botswana', prio: 40 },
    { code: 'BFP-MONTHLY',     name: 'beFREE Plus Monthly', price: 110, validity: 30, type: 3, data: 1024,   voice: 9999, sms: 0,   region: 'Botswana', prio: 30 },
    // TurnUp data bundles — premium monthly
    { code: 'TURNUP-4GB-30',   name: 'TurnUp 4 GB Monthly', price: 65,  validity: 30, type: 2, data: 4096,   voice: 0,    sms: 0,   region: 'Botswana', prio: 35 },
    { code: 'TURNUP-8GB-30',   name: 'TurnUp 8 GB Monthly', price: 92,  validity: 30, type: 2, data: 8192,   voice: 0,    sms: 0,   region: 'Botswana', prio: 35 },
    { code: 'TURNUP-30GB-30',  name: 'TurnUp 30 GB Monthly', price: 199, validity: 30, type: 2, data: 30720,  voice: 0,    sms: 0,   region: 'Botswana', prio: 30 },
    { code: 'TURNUP-50GB-30',  name: 'TurnUp 50 GB Monthly', price: 269, validity: 30, type: 2, data: 51200,  voice: 0,    sms: 0,   region: 'Botswana', prio: 25 },
    { code: 'TURNUP-100GB-30', name: 'TurnUp 100 GB Monthly', price: 349, validity: 30, type: 2, data: 102400, voice: 0,    sms: 0,   region: 'Botswana', prio: 20 },
    // Data boosters (short validity)
    { code: 'TURNUP-1_5GB-1',  name: 'TurnUp 1.5 GB Daily', price: 10, validity: 1, type: 2, data: 1536, voice: 0, sms: 0, region: 'Botswana', prio: 60 },
    { code: 'TURNUP-5GB-7',    name: 'TurnUp 5 GB Weekly', price: 50, validity: 7, type: 2, data: 5120, voice: 0, sms: 0, region: 'Botswana', prio: 45 },
    // Social boosters
    { code: 'LIVE-SOCIAL-D',   name: 'Live Social Daily', price: 5,  validity: 1,  type: 2, data: 1536, voice: 0, sms: 0, region: 'Botswana', prio: 55 },
    { code: 'LIVE-SOCIAL-W',   name: 'Live Social Weekly', price: 15, validity: 7,  type: 2, data: 1536, voice: 0, sms: 0, region: 'Botswana', prio: 50 },
    { code: 'LIVE-SOCIAL-M',   name: 'Live Social Monthly', price: 61, validity: 30, type: 2, data: 1536, voice: 0, sms: 0, region: 'Botswana', prio: 40 },
    // TikTok specific
    { code: 'TIKTOK-D',        name: 'TikTok Daily', price: 5,  validity: 1,  type: 2, data: 250,  voice: 0, sms: 0, region: 'Botswana', prio: 55 },
    { code: 'TIKTOK-M',        name: 'TikTok Monthly', price: 41, validity: 30, type: 2, data: 2048, voice: 0, sms: 0, region: 'Botswana', prio: 40 },
    // Time-slice offerings
    { code: 'NIGHT-RIDERS',    name: 'Night Riders (Unlimited 00-05)', price: 10, validity: 1, type: 2, data: 99999, voice: 0, sms: 0, region: 'Botswana', prio: 70 },
    { code: 'BIG-TIME',        name: 'Big Time 4-Hour Unlimited', price: 20, validity: 1, type: 2, data: 99999, voice: 0, sms: 0, region: 'Botswana', prio: 70 },
  ];

  IDS.plans = {};
  for (const p of plans) {
    const id = await L.createRecord(TABLE_IDS['Tariff Plans'], {
      [TP['Plan Code']]: p.code,
      [TP['Plan Name']]: p.name,
      [TP['Price']]: p.price,
      [TP['Currency']]: [1], // will rename to BWP later if needed
      [TP['Plan Type']]: [p.type],
      [TP['Validity Days']]: p.validity,
      [TP['Auto Renew Default']]: false,
      [TP['Priority On Charge']]: p.prio,
      [TP['Region']]: p.region,
      [TP['Status']]: [1],
      [TP['Data Allowance (MB)']]: p.data,
      [TP['Voice Allowance (min)']]: p.voice,
      [TP['SMS Allowance']]: p.sms,
      [TP['Data Overage Rate']]: 1,      // P1/MB out-of-bundle (real BTC rate)
      [TP['Voice Overage Rate']]: 1.34,  // P1.34/min peak
      [TP['SMS Overage Rate']]: 0.3,     // P0.30 national
      [TP['Data Overage Action']]: [1],
      [TP['Voice Overage Action']]: [1],
      [TP['SMS Overage Action']]: [1],
      [TP['Roaming Zones Included']]: '',  // empty for BW plans (no free roaming)
    });
    IDS.plans[p.code] = id;
    await L.sleep(60);
  }
  console.log(`   ${plans.length} tariff plans seeded`);

  // ────────────────────────────────────────────────────────────
  // 2. Services catalog
  // ────────────────────────────────────────────────────────────
  console.log('\n2. Services catalog');
  const SV = await cm('Services');
  const services = [
    { code: 'VOC-ONNET',   name: 'Voice On-net',   type: 1, rg: 100 },
    { code: 'VOC-OFFNET',  name: 'Voice Off-net',  type: 1, rg: 101 },
    { code: 'VOC-INTL',    name: 'Voice International', type: 1, rg: 102 },
    { code: 'SMS-DOM',     name: 'SMS Domestic',   type: 2, rg: 200 },
    { code: 'SMS-INTL',    name: 'SMS International', type: 2, rg: 201 },
    { code: 'DATA-4G',     name: '4G Data',        type: 3, rg: 10 },
    { code: 'DATA-5G',     name: '5G Data',        type: 3, rg: 11 },
    { code: 'DATA-SOCIAL', name: 'Social Apps Data', type: 3, rg: 12 },
    { code: 'DATA-TIKTOK', name: 'TikTok Data',    type: 3, rg: 13 },
  ];
  IDS.services = {};
  for (const s of services) {
    const id = await L.createRecord(TABLE_IDS['Services'], {
      [SV['Service Code']]: s.code,
      [SV['Service Name']]: s.name,
      [SV['Service Family']]: [s.type],
      [SV['Default Rating Group']]: s.rg,
      [SV['Unit Type']]: [s.type === 1 ? 1 : s.type === 2 ? 3 : 2],   // voice=min(1), sms=count(3), data=mb(2)
      [SV['PAYG Rate']]: s.type === 1 ? 1.34 : s.type === 2 ? 0.3 : 1.0,
    });
    IDS.services[s.code] = id;
    await L.sleep(60);
  }
  console.log(`   ${services.length} services`);

  // ────────────────────────────────────────────────────────────
  // 3. Business Rules
  // ────────────────────────────────────────────────────────────
  console.log('\n3. Business Rules');
  const BR = await cm('Business Rules');
  const rules = [
    { code: 'BR-DEPLETION-ORDER', name: 'Balance Depletion Priority', type: 1, desc: 'Deplete bonus balances first, then plan allowances, then wallet (lowest priority number wins).' },
    { code: 'BR-LOW-BAL-ALERT',   name: 'Low Balance Notification', type: 2, desc: 'Send SMS when wallet balance < P5.00.' },
    { code: 'BR-DORMANCY',        name: 'Dormancy → Deactivation', type: 3, desc: '90 days no revenue event → Subscription status = Suspended.' },
    { code: 'BR-RECYCLE',         name: 'Number Recycling',        type: 3, desc: 'After 90 days suspension, quarantine MSISDN for 90 more days, then return to pool.' },
    { code: 'BR-BONUS-P50',       name: 'Voucher Bonus P50 (+10%)', type: 4, desc: 'P50 voucher recharge → +P5 bonus airtime (14-day validity).' },
    { code: 'BR-BONUS-P100',      name: 'Voucher Bonus P100 (+20%)', type: 4, desc: 'P100 voucher recharge → +P20 bonus airtime (14-day validity).' },
    { code: 'BR-OOB-DATA',        name: 'Out-of-Bundle Data',      type: 1, desc: 'Post-depletion: charge P1.00 per MB from wallet.' },
    { code: 'BR-OFFPEAK',         name: 'Off-Peak Voice Discount', type: 1, desc: 'Mon-Sat 21:00-06:59 + all day Sun/holidays: P0.61/min vs P1.34 peak.' },
  ];
  for (const r of rules) {
    await L.createRecord(TABLE_IDS['Business Rules'], {
      [BR['Rule Code']]: r.code,
      [BR['Rule Name']]: r.name,
      [BR['Rule Type']]: [r.type],
      [BR['Description']]: r.desc,
      [BR['Status']]: [1],
      [BR['Priority']]: 50,
    });
    await L.sleep(60);
  }
  console.log(`   ${rules.length} rules`);

  // ────────────────────────────────────────────────────────────
  // 4. Promotions
  // ────────────────────────────────────────────────────────────
  console.log('\n4. Promotions (BTC Pasela loyalty + welcome + weekend)');
  const PR = await cm('Promotions');
  const promos = [
    { code: 'PASELA',        name: 'BTC Pasela Loyalty',        type: 1, start: -400, end: +400, desc: 'Earn 1 point per P1 airtime usage; redeem for bundles.' },
    { code: 'WELCOME-SIM',   name: 'Welcome SIM Bonus',         type: 2, start: -365, end: +365, desc: 'P5 credit + 100 MB on first activation.' },
    { code: 'BDAY-DOUBLE',   name: 'Birthday Double Airtime',   type: 2, start: -90,  end: +275, desc: 'On your birthday, recharges get 2× bonus airtime.' },
    { code: 'WKND-UNLTD',    name: 'Weekend Unlimited On-net',  type: 1, start: -30,  end: +30,  desc: 'Free on-net voice + SMS Saturday-Sunday.' },
    { code: 'FIRST-TOPUP',   name: 'First Recharge Data Doubler', type: 2, start: -180, end: +90, desc: 'First recharge over P50 gets 2× data on next bundle.' },
  ];
  IDS.promos = {};
  for (const p of promos) {
    const id = await L.createRecord(TABLE_IDS['Promotions'], {
      [PR['Promotion Code']]: p.code,
      [PR['Promotion Name']]: p.name,
      [PR['Type']]: [p.type],
      [PR['Start Date']]: Date.now() + p.start * 86400000,
      [PR['End Date']]: Date.now() + p.end * 86400000,
      [PR['Status']]: [2],
      [PR['Eligibility Rules']]: p.desc,
      [PR['Total Budget']]: 500000,
      [PR['Max Redemptions Per Customer']]: 10,
    });
    IDS.promos[p.code] = id;
    await L.sleep(60);
  }
  console.log(`   ${promos.length} promos`);

  // ────────────────────────────────────────────────────────────
  // 5. Bundles + Bundle Components (booster stacking)
  // ────────────────────────────────────────────────────────────
  console.log('\n5. Bundles');
  const BN = await cm('Bundles');
  const bundles = [
    { code: 'BND-MOBILE-LIFE', name: 'Mobile Life Pack', type: 1, price: 250, validity: 30, desc: 'Monthly plan + Social + Night Riders combo.' },
    { code: 'BND-STUDENT',     name: 'Student Bundle',   type: 1, price: 75,  validity: 30, desc: 'Budget data + social for students.' },
  ];
  IDS.bundles = {};
  for (const b of bundles) {
    const id = await L.createRecord(TABLE_IDS['Bundles'], {
      [BN['Bundle Code']]: b.code,
      [BN['Bundle Name']]: b.name,
      [BN['Bundle Price']]: b.price,
      [BN['Validity Days']]: b.validity,
      [BN['Discount vs Components']]: 10,
      [BN['Status']]: [1],
    });
    IDS.bundles[b.code] = id;
    await L.sleep(60);
  }

  console.log('\n   5b. Bundle Components');
  const BC = await cm('Bundle Components');
  await L.createRecord(TABLE_IDS['Bundle Components'], {
    [BC['Bundle']]: [IDS.bundles['BND-MOBILE-LIFE']],
    [BC['Offering']]: [IDS.plans['BFP-MONTHLY']],
    [BC['Quantity']]: 1, [BC['Sequence']]: 1, [BC['Notes']]: 'Base voice+data plan',
  });
  await L.createRecord(TABLE_IDS['Bundle Components'], {
    [BC['Bundle']]: [IDS.bundles['BND-MOBILE-LIFE']],
    [BC['Offering']]: [IDS.plans['LIVE-SOCIAL-M']],
    [BC['Quantity']]: 1, [BC['Sequence']]: 2, [BC['Notes']]: 'Social add-on',
  });
  await L.createRecord(TABLE_IDS['Bundle Components'], {
    [BC['Bundle']]: [IDS.bundles['BND-STUDENT']],
    [BC['Offering']]: [IDS.plans['TURNUP-4GB-30']],
    [BC['Quantity']]: 1, [BC['Sequence']]: 1, [BC['Notes']]: 'Student data',
  });
  await L.createRecord(TABLE_IDS['Bundle Components'], {
    [BC['Bundle']]: [IDS.bundles['BND-STUDENT']],
    [BC['Offering']]: [IDS.plans['LIVE-SOCIAL-W']],
    [BC['Quantity']]: 1, [BC['Sequence']]: 2, [BC['Notes']]: 'Weekly social',
  });
  console.log(`   4 components`);

  // ────────────────────────────────────────────────────────────
  // 6. Roaming Zones — SADC-first restructure
  // ────────────────────────────────────────────────────────────
  console.log('\n6. Roaming Zones (SADC-first)');
  const RZ = await cm('Roaming Zones');
  const zones = [
    { code: 'SADC',    name: 'SADC (Southern Africa)', region: 6, prio: 1, voice: 2,  data: 0.5, sms: 0.5,  countries: 16, desc: 'SADC Home and Away — reduced rates for SADC member states under CRASA directive.' },
    { code: 'AFR',     name: 'Rest of Africa',         region: 6, prio: 2, voice: 8,  data: 3,   sms: 2,    countries: 38, desc: 'Non-SADC African countries.' },
    { code: 'ME',      name: 'Middle East',            region: 2, prio: 3, voice: 12, data: 5,   sms: 3,    countries: 15, desc: 'Gulf states + Levant.' },
    { code: 'EU',      name: 'Europe',                 region: 3, prio: 4, voice: 15, data: 6,   sms: 3,    countries: 30, desc: 'EU + EEA + Switzerland.' },
    { code: 'UK',      name: 'United Kingdom',         region: 3, prio: 4, voice: 18, data: 7,   sms: 4,    countries: 1,  desc: 'Post-Brexit UK.' },
    { code: 'NA',      name: 'North America',          region: 4, prio: 5, voice: 25, data: 10,  sms: 5,    countries: 3,  desc: 'USA, Canada, Mexico.' },
    { code: 'ANZ',     name: 'Australia & NZ',         region: 6, prio: 5, voice: 22, data: 9,   sms: 5,    countries: 2,  desc: 'Australia and New Zealand.' },
    { code: 'AP',      name: 'Asia-Pacific',           region: 1, prio: 5, voice: 20, data: 8,   sms: 4,    countries: 20, desc: 'East and Southeast Asia.' },
    { code: 'ROW',     name: 'Rest of World',          region: 5, prio: 9, voice: 60, data: 25,  sms: 10,   countries: 100,desc: 'All other markets — premium pricing.' },
  ];
  IDS.zones = {};
  for (const z of zones) {
    const id = await L.createRecord(TABLE_IDS['Roaming Zones'], {
      [RZ['Zone Code']]: z.code,
      [RZ['Zone Name']]: z.name,
      [RZ['Description']]: z.desc,
      [RZ['Region']]: [z.region],
      [RZ['Priority']]: z.prio,
      [RZ['Default Voice Rate (per min)']]: z.voice,
      [RZ['Default Data Rate (per MB)']]: z.data,
      [RZ['Default SMS Rate']]: z.sms,
      [RZ['Countries Count']]: z.countries,
      [RZ['Status']]: [1],
    });
    IDS.zones[z.code] = id;
    await L.sleep(60);
  }
  console.log(`   ${zones.length} zones`);

  // ────────────────────────────────────────────────────────────
  // 7. Roaming Partners (real SADC + long-haul operators)
  // ────────────────────────────────────────────────────────────
  console.log('\n7. Roaming Partners');
  const RP = await cm('Roaming Partners');
  // Full 40-partner list — SADC priority, then wider Africa, then long-haul
  const partners = [
    // SADC — priority routes for Batswana travelers
    { code: 'ZAF-VOD-01', name: 'Vodacom',        country: 'South Africa', cc: 'ZA', mcc: '655', mnc: '01', zone: 'SADC', voiceIot: 1.8, dataIot: 0.4,  smsIot: 0.4, currency: 'USD' },
    { code: 'ZAF-MTN-01', name: 'MTN South Africa',country: 'South Africa', cc: 'ZA', mcc: '655', mnc: '10', zone: 'SADC', voiceIot: 1.8, dataIot: 0.4,  smsIot: 0.4, currency: 'USD' },
    { code: 'ZAF-CLC-01', name: 'Cell C',          country: 'South Africa', cc: 'ZA', mcc: '655', mnc: '07', zone: 'SADC', voiceIot: 2.0, dataIot: 0.5,  smsIot: 0.5, currency: 'USD' },
    { code: 'ZAF-TKM-01', name: 'Telkom Mobile',   country: 'South Africa', cc: 'ZA', mcc: '655', mnc: '02', zone: 'SADC', voiceIot: 2.0, dataIot: 0.5,  smsIot: 0.5, currency: 'USD' },
    { code: 'NAM-MTC-01', name: 'MTC Namibia',     country: 'Namibia',      cc: 'NA', mcc: '649', mnc: '01', zone: 'SADC', voiceIot: 1.9, dataIot: 0.5,  smsIot: 0.5, currency: 'USD' },
    { code: 'NAM-TNM-01', name: 'TN Mobile',       country: 'Namibia',      cc: 'NA', mcc: '649', mnc: '03', zone: 'SADC', voiceIot: 1.9, dataIot: 0.5,  smsIot: 0.5, currency: 'USD' },
    { code: 'ZWE-ECN-01', name: 'Econet Wireless', country: 'Zimbabwe',     cc: 'ZW', mcc: '648', mnc: '04', zone: 'SADC', voiceIot: 2.0, dataIot: 0.6,  smsIot: 0.5, currency: 'USD' },
    { code: 'ZWE-NET-01', name: 'NetOne',          country: 'Zimbabwe',     cc: 'ZW', mcc: '648', mnc: '01', zone: 'SADC', voiceIot: 2.0, dataIot: 0.6,  smsIot: 0.5, currency: 'USD' },
    { code: 'ZMB-MTN-01', name: 'MTN Zambia',      country: 'Zambia',       cc: 'ZM', mcc: '645', mnc: '02', zone: 'SADC', voiceIot: 2.1, dataIot: 0.7,  smsIot: 0.5, currency: 'USD' },
    { code: 'ZMB-AIR-01', name: 'Airtel Zambia',   country: 'Zambia',       cc: 'ZM', mcc: '645', mnc: '01', zone: 'SADC', voiceIot: 2.1, dataIot: 0.7,  smsIot: 0.5, currency: 'USD' },
    { code: 'MOZ-VOD-01', name: 'Vodacom Mozambique', country: 'Mozambique', cc: 'MZ', mcc: '643', mnc: '04', zone: 'SADC', voiceIot: 2.2, dataIot: 0.8,  smsIot: 0.6, currency: 'USD' },
    { code: 'MOZ-MOV-01', name: 'Movitel',         country: 'Mozambique',   cc: 'MZ', mcc: '643', mnc: '03', zone: 'SADC', voiceIot: 2.2, dataIot: 0.8,  smsIot: 0.6, currency: 'USD' },
    { code: 'LSO-VOD-01', name: 'Vodacom Lesotho', country: 'Lesotho',      cc: 'LS', mcc: '651', mnc: '01', zone: 'SADC', voiceIot: 2.0, dataIot: 0.5,  smsIot: 0.5, currency: 'USD' },
    { code: 'SWZ-MTN-01', name: 'MTN Eswatini',    country: 'Eswatini',     cc: 'SZ', mcc: '653', mnc: '10', zone: 'SADC', voiceIot: 2.0, dataIot: 0.5,  smsIot: 0.5, currency: 'USD' },
    { code: 'AGO-UNI-01', name: 'Unitel',          country: 'Angola',       cc: 'AO', mcc: '631', mnc: '02', zone: 'SADC', voiceIot: 2.5, dataIot: 1.2,  smsIot: 0.7, currency: 'USD' },
    { code: 'MWI-AIR-01', name: 'Airtel Malawi',   country: 'Malawi',       cc: 'MW', mcc: '650', mnc: '10', zone: 'SADC', voiceIot: 2.1, dataIot: 0.7,  smsIot: 0.5, currency: 'USD' },
    { code: 'TZA-VOD-01', name: 'Vodacom Tanzania',country: 'Tanzania',     cc: 'TZ', mcc: '640', mnc: '04', zone: 'SADC', voiceIot: 2.1, dataIot: 0.7,  smsIot: 0.5, currency: 'USD' },
    // Rest of Africa
    { code: 'KEN-SAF-01', name: 'Safaricom',       country: 'Kenya',        cc: 'KE', mcc: '639', mnc: '02', zone: 'AFR', voiceIot: 3,   dataIot: 1.2,  smsIot: 0.7, currency: 'USD' },
    { code: 'NGA-MTN-01', name: 'MTN Nigeria',     country: 'Nigeria',      cc: 'NG', mcc: '621', mnc: '30', zone: 'AFR', voiceIot: 3.5, dataIot: 1.5,  smsIot: 0.8, currency: 'USD' },
    { code: 'EGY-VOD-01', name: 'Vodafone Egypt',  country: 'Egypt',        cc: 'EG', mcc: '602', mnc: '02', zone: 'AFR', voiceIot: 3.5, dataIot: 1.5,  smsIot: 0.8, currency: 'USD' },
    { code: 'GHA-MTN-01', name: 'MTN Ghana',       country: 'Ghana',        cc: 'GH', mcc: '620', mnc: '01', zone: 'AFR', voiceIot: 3,   dataIot: 1.3,  smsIot: 0.7, currency: 'USD' },
    // Middle East
    { code: 'ARE-ETI-01', name: 'Etisalat (e&)',   country: 'UAE',          cc: 'AE', mcc: '424', mnc: '02', zone: 'ME',  voiceIot: 5,   dataIot: 2,    smsIot: 1,   currency: 'USD' },
    { code: 'ARE-DU-01',  name: 'du',              country: 'UAE',          cc: 'AE', mcc: '424', mnc: '03', zone: 'ME',  voiceIot: 5,   dataIot: 2,    smsIot: 1,   currency: 'USD' },
    { code: 'SAU-STC-01', name: 'STC Saudi',       country: 'Saudi Arabia', cc: 'SA', mcc: '420', mnc: '01', zone: 'ME',  voiceIot: 5,   dataIot: 2,    smsIot: 1,   currency: 'USD' },
    // Europe
    { code: 'DEU-TMO-01', name: 'T-Mobile Germany',country: 'Germany',      cc: 'DE', mcc: '262', mnc: '01', zone: 'EU',  voiceIot: 9,   dataIot: 3,    smsIot: 1.5, currency: 'EUR' },
    { code: 'FRA-ORA-01', name: 'Orange France',   country: 'France',       cc: 'FR', mcc: '208', mnc: '01', zone: 'EU',  voiceIot: 9,   dataIot: 3,    smsIot: 1.5, currency: 'EUR' },
    // UK
    { code: 'GBR-VOD-01', name: 'Vodafone UK',     country: 'United Kingdom', cc: 'GB', mcc: '234', mnc: '15', zone: 'UK', voiceIot: 10, dataIot: 4,   smsIot: 2,   currency: 'GBP' },
    { code: 'GBR-EE-01',  name: 'EE',              country: 'United Kingdom', cc: 'GB', mcc: '234', mnc: '30', zone: 'UK', voiceIot: 10, dataIot: 4,   smsIot: 2,   currency: 'GBP' },
    // North America
    { code: 'USA-TMO-01', name: 'T-Mobile USA',    country: 'United States', cc: 'US', mcc: '310', mnc: '260', zone: 'NA', voiceIot: 15, dataIot: 5,   smsIot: 2.5, currency: 'USD' },
    { code: 'USA-VZW-01', name: 'Verizon',         country: 'United States', cc: 'US', mcc: '311', mnc: '480', zone: 'NA', voiceIot: 17, dataIot: 6,   smsIot: 2.5, currency: 'USD' },
    // ANZ
    { code: 'AUS-TLS-01', name: 'Telstra',         country: 'Australia',    cc: 'AU', mcc: '505', mnc: '01', zone: 'ANZ', voiceIot: 13, dataIot: 5,    smsIot: 2,   currency: 'AUD' },
    // Asia-Pacific
    { code: 'SGP-SGT-01', name: 'Singtel',         country: 'Singapore',    cc: 'SG', mcc: '525', mnc: '01', zone: 'AP',  voiceIot: 6,   dataIot: 2,    smsIot: 1.2, currency: 'USD' },
    { code: 'IND-AIR-01', name: 'Bharti Airtel',   country: 'India',        cc: 'IN', mcc: '404', mnc: '10', zone: 'AP',  voiceIot: 5,   dataIot: 1.5,  smsIot: 1,   currency: 'USD' },
    { code: 'CHN-CMC-01', name: 'China Mobile',    country: 'China',        cc: 'CN', mcc: '460', mnc: '00', zone: 'AP',  voiceIot: 7,   dataIot: 2.5,  smsIot: 1.5, currency: 'USD' },
  ];
  IDS.partners = {};
  const ccToPrefix = { ZA:'+27', NA:'+264', ZW:'+263', ZM:'+260', MZ:'+258', LS:'+266', SZ:'+268', AO:'+244', MW:'+265', TZ:'+255', KE:'+254', NG:'+234', EG:'+20', GH:'+233', AE:'+971', SA:'+966', DE:'+49', FR:'+33', GB:'+44', US:'+1', AU:'+61', SG:'+65', IN:'+91', CN:'+86' };
  for (const p of partners) {
    const id = await L.createRecord(TABLE_IDS['Roaming Partners'], {
      [RP['Partner Code']]: p.code,
      [RP['Partner Name']]: p.name,
      [RP['Country']]: p.country,
      [RP['Country Code']]: p.cc,
      [RP['MCC']]: p.mcc,
      [RP['MNC']]: p.mnc,
      [RP['VLR Prefix']]: ccToPrefix[p.cc] || '+0',
      [RP['Status']]: [3],
      [RP['Contract Type']]: [3],
      [RP['Settlement Currency']]: [['USD','EUR','SDR','INR','GBP','AUD','SGD'].indexOf(p.currency)+1],
      [RP['IOT Voice Rate (per min)']]: p.voiceIot,
      [RP['IOT Data Rate (per MB)']]: p.dataIot,
      [RP['IOT SMS Rate']]: p.smsIot,
      [RP['Onboarded Date']]: Date.now() - L.rand(200, 2000) * 86400000,
      [RP['Contact Email']]: `roaming@${p.name.toLowerCase().replace(/[^a-z]/g,'')}.example`,
      [RP['Contact Phone']]: (ccToPrefix[p.cc] || '+0') + ' ' + L.rand(10000000, 99999999),
      [RP['Zone']]: [IDS.zones[p.zone]],
    });
    IDS.partners[p.code] = { id, zone: p.zone, voiceIot: p.voiceIot, dataIot: p.dataIot, smsIot: p.smsIot, currency: p.currency };
    await L.sleep(50);
  }
  console.log(`   ${partners.length} partners`);

  // ────────────────────────────────────────────────────────────
  // 8. Rate cards (3 services × all partners)
  // ────────────────────────────────────────────────────────────
  console.log('\n8. Rate Cards');
  const RC = await cm('Roaming Rate Cards');
  const svcs = [
    { svc: 'Voice MO', unit: 'per minute', iotKey: 'voiceIot', mk: 2.2 },
    { svc: 'SMS MO',   unit: 'per SMS',    iotKey: 'smsIot',   mk: 2.5 },
    { svc: 'Data',     unit: 'per MB',     iotKey: 'dataIot',  mk: 3.0 },
  ];
  let rcCount = 0;
  for (const [code, info] of Object.entries(IDS.partners)) {
    for (const s of svcs) {
      const wholesale = info[s.iotKey];
      const customer = Math.round(wholesale * s.mk * 100) / 100;
      await L.createRecord(TABLE_IDS['Roaming Rate Cards'], {
        [RC['Rate Code']]: `RC-${code}-${s.svc.replace(/\s/g,'')}`,
        [RC['Partner']]: [info.id],
        [RC['Zone']]: [IDS.zones[info.zone]],
        [RC['Service Type']]: [['Voice MO','Voice MT','SMS MO','SMS MT','Data','Video Call'].indexOf(s.svc)+1],
        [RC['Unit']]: [['per minute','per MB','per SMS','per event'].indexOf(s.unit)+1],
        [RC['Customer Rate']]: customer,
        [RC['Wholesale Rate (IOT)']]: wholesale,
        [RC['Currency']]: [['USD','EUR','SDR','INR','GBP'].indexOf(info.currency)+1 || 1],
        [RC['Effective From']]: Date.now() - 180 * 86400000,
        [RC['Effective To']]: Date.now() + 365 * 86400000,
        [RC['Status']]: [2],
      });
      rcCount++;
      await L.sleep(40);
    }
  }
  console.log(`   ${rcCount} rate cards`);

  // ────────────────────────────────────────────────────────────
  // 9. Channels (USSD, retail, mobile app, SMEGA, self-care)
  // ────────────────────────────────────────────────────────────
  console.log('\n9. Channels');
  const CH = await cm('Channels');
  const channels = [
    { code: 'USSD-180',      name: 'USSD *180# — Bundles',        type: 1, enabled: true,  hours: '24/7',              cfg: '{"shortcode":"*180#","timeout_s":30,"provider":"SDP"}' },
    { code: 'USSD-134',      name: 'USSD *134# — Balance',        type: 1, enabled: true,  hours: '24/7',              cfg: '{"shortcode":"*134#","timeout_s":15}' },
    { code: 'USSD-104',      name: 'USSD *104# — Voucher',        type: 1, enabled: true,  hours: '24/7',              cfg: '{"shortcode":"*104*PIN#","timeout_s":30}' },
    { code: 'SMEGA',         name: 'SMEGA Mobile Money',          type: 1, enabled: true,  hours: '24/7',              cfg: '{"shortcode":"*151#","platform":"Comviva mobiquity"}' },
    { code: 'CARE-111',      name: 'Customer Care 111',           type: 3, enabled: true,  hours: '08:00-20:00 Mon-Sun', cfg: '{"number":"111","ivr_langs":["en","tsn"]}' },
    { code: 'APP-BTC',       name: 'BTC Mobile App',              type: 4, enabled: true,  hours: '24/7',              cfg: '{"min_version":"3.1.0","push":"FCM+APNs"}' },
    { code: 'WEB-SELFCARE',  name: 'selfservice.btc.bw',          type: 5, enabled: true,  hours: '24/7',              cfg: '{"base_url":"https://selfservice.btc.bw","sso":true}' },
    { code: 'RETAIL-BTC',    name: 'BTC Shops',                   type: 6, enabled: true,  hours: 'Mon-Sat 09:00-18:00', cfg: '{"locations":["Gaborone Main Mall","Rail Park","Game City","Francistown","Maun","Kasane","Palapye","Lobatse","Serowe"]}' },
    { code: 'RETAIL-AGENT',  name: 'Approved Dealers/Agents',     type: 6, enabled: true,  hours: 'variable',          cfg: '{"count":450,"coverage":"nationwide"}' },
    { code: 'SMS-SHORTCODE', name: 'SMS Short Codes',             type: 2, enabled: true,  hours: '24/7',              cfg: '{"codes":[1515,16263],"aggregator":"SDP"}' },
  ];
  IDS.channels = {};
  for (const c of channels) {
    const id = await L.createRecord(TABLE_IDS['Channels'], {
      [CH['Channel Code']]: c.code,
      [CH['Channel Name']]: c.name,
      [CH['Channel Type']]: [c.type],
      [CH['Enabled']]: c.enabled,
      [CH['Operating Hours']]: c.hours,
      [CH['Config JSON']]: c.cfg,
    });
    IDS.channels[c.code] = id;
    await L.sleep(60);
  }
  console.log(`   ${channels.length} channels`);

  // ────────────────────────────────────────────────────────────
  // 10. Distribution Partners (BW retail)
  // ────────────────────────────────────────────────────────────
  console.log('\n10. Distribution Partners');
  const DP = await cm('Distribution Partners');
  const dist = [
    { code: 'DP-GABO-01', name: 'Gaborone Mobile Hub',  type: 1, region: 'South-East',  tier: 1, status: 3, contact: 'Kabelo Mogotsi' },
    { code: 'DP-FT-01',   name: 'Francistown Telecoms Ltd', type: 2, region: 'North-East', tier: 1, status: 3, contact: 'Lerato Molefe' },
    { code: 'DP-MAUN-01', name: 'Maun Connect Dealer',  type: 1, region: 'North-West',  tier: 2, status: 3, contact: 'Thabo Seretse' },
    { code: 'DP-CHOP-01', name: 'Choppies Airtime Counter', type: 4, region: 'Nationwide', tier: 1, status: 3, contact: 'Distribution Desk' },
    { code: 'DP-ENGEN-01',name: 'Engen Forecourt Vouchers', type: 5, region: 'Nationwide', tier: 3, status: 3, contact: 'Fuel Retail' },
    { code: 'DP-SPAR-01', name: 'Spar Mobile Corner',   type: 4, region: 'Urban',        tier: 2, status: 3, contact: 'Distribution Desk' },
    { code: 'DP-BTC-DIR', name: 'BTC Direct Retail',    type: 1, region: 'Nationwide',   tier: 1, status: 3, contact: 'Internal' },
    { code: 'DP-APP-01',  name: 'BTC Mobile App (Self-Sales)', type: 3, region: 'Digital', tier: 1, status: 3, contact: 'App Platform' },
  ];
  IDS.dist = {};
  for (const d of dist) {
    const id = await L.createRecord(TABLE_IDS['Distribution Partners'], {
      [DP['Partner Code']]: d.code,
      [DP['Partner Name']]: d.name,
      [DP['Partner Type']]: [d.type],
      [DP['Status']]: [d.status],
      [DP['Onboarded Date']]: Date.now() - L.rand(200, 1800) * 86400000,
      [DP['Wallet Balance']]: L.rand(5000, 50000),
      [DP['Contact Person']]: d.contact,
      [DP['Commission Scheme']]: d.tier === 1 ? '5% on all recharges + P25 per activation' : d.tier === 2 ? '3.5% + P15' : '2% + P10',
      [DP['Region']]: d.region,
      [DP['Tier']]: [d.tier],
      [DP['Contact Email']]: `partners-${d.code.toLowerCase()}@btc.bw`,
      [DP['Contact Phone']]: '+26771' + L.rand(100000, 999999),
    });
    IDS.dist[d.code] = id;
    await L.sleep(60);
  }
  console.log(`   ${dist.length} distribution partners`);

  // ────────────────────────────────────────────────────────────
  // 11. Partner Contracts
  // ────────────────────────────────────────────────────────────
  console.log('\n11. Partner Contracts');
  const PC = await cm('Partner Contracts');
  for (const [code, pid] of Object.entries(IDS.dist)) {
    await L.createRecord(TABLE_IDS['Partner Contracts'], {
      [PC['Contract Number']]: `CTR-${code}`,
      [PC['Partner']]: [pid],
      [PC['Status']]: [2],
      [PC['Effective From']]: Date.now() - L.rand(200, 1800) * 86400000,
      [PC['Effective To']]: Date.now() + L.rand(180, 720) * 86400000,
      [PC['Commission Structure']]: 'Tiered: 2-5% on recharge value; P10-25 flat fee on new-line activation; monthly bonus for meeting P100k recharge target.',
      [PC['SLA Targets']]: 'Dispute resolution: 48h. Payout cycle: monthly by the 15th. Min service availability: 99%.',
      [PC['Termination Clauses']]: '30-day notice. Immediate termination on regulatory non-compliance or outstanding dues > P50k.',
      [PC['Signed Document URL']]: `https://contracts.btc.bw/${code}.pdf`,
    });
    await L.sleep(60);
  }
  console.log(`   ${Object.keys(IDS.dist).length} contracts`);

  // ────────────────────────────────────────────────────────────
  // 12. Notification Templates
  // ────────────────────────────────────────────────────────────
  console.log('\n12. Notification Templates');
  const NT = await cm('Notification Templates');
  const templates = [
    { code: 'TPL-WELCOME',    name: 'Welcome to b-mobile',       trig: 8, chan: 1, lang: 1, subj: 'Welcome to b-mobile', body: 'Dumela {name}! Welcome to b-mobile. Your MSISDN {msisdn} is active on {plan}. Dial *180# for bundles, *134# for balance. Enjoy!', vars: '{name},{msisdn},{plan}' },
    { code: 'TPL-LOW-BAL',    name: 'Low Balance Alert',         trig: 1, chan: 1, lang: 1, subj: 'Low balance', body: 'Hi {name}, your b-mobile balance is P{balance}. Recharge via *104*PIN# or the BTC app.', vars: '{name},{balance}' },
    { code: 'TPL-PLAN-EXP',   name: 'Plan Expiring Soon',        trig: 2, chan: 1, lang: 1, subj: 'Plan expiring', body: 'Your {plan} expires in {days} days. Renew via *180# to stay connected.', vars: '{plan},{days}' },
    { code: 'TPL-RECH-OK',    name: 'Recharge Successful',       trig: 3, chan: 1, lang: 1, subj: 'Recharge success', body: 'Recharge of P{amount} successful. New balance: P{new_balance}. Ref: {ref}', vars: '{amount},{new_balance},{ref}' },
    { code: 'TPL-PLAN-ACT',   name: 'Plan Activated',            trig: 4, chan: 1, lang: 1, subj: 'Plan activated', body: 'Your {plan} is active! Data: {data}MB, Voice: {voice}min, SMS: {sms}. Valid {days} days.', vars: '{plan},{data},{voice},{sms},{days}' },
    { code: 'TPL-PROMO',      name: 'Promotion Eligible',        trig: 5, chan: 1, lang: 1, subj: 'Special offer', body: 'Exclusive for you {name}: {promo} — {offer}. Reply YES to opt in.', vars: '{name},{promo},{offer}' },
    { code: 'TPL-DEPLETED',   name: 'Bucket Depleted',           trig: 6, chan: 1, lang: 1, subj: 'Bundle depleted', body: 'Your {service} bundle is finished. Top up via *180# or pay-as-you-go at P{rate}/unit.', vars: '{service},{rate}' },
    { code: 'TPL-KYC',        name: 'KYC Required',              trig: 7, chan: 1, lang: 1, subj: 'KYC required', body: 'Dear customer, please present your Omang/Passport at any BTC shop by {deadline} to keep your line active.', vars: '{deadline}' },
    // Tswana versions (for bilingual)
    { code: 'TPL-WELCOME-TN', name: 'Welcome (Tswana)',          trig: 8, chan: 1, lang: 2, subj: 'Amogetswe kwa b-mobile', body: 'Dumela {name}! Amogetswe kwa b-mobile. Nomoro ya gago {msisdn} e simolotse.', vars: '{name},{msisdn}' },
    { code: 'TPL-LOW-BAL-TN', name: 'Low Balance (Tswana)',      trig: 1, chan: 1, lang: 2, subj: 'Madi a fetile', body: 'Dumela {name}, madi a gago a b-mobile ke P{balance}. Tsweela go tsaya bundle.', vars: '{name},{balance}' },
  ];
  IDS.templates = {};
  for (const t of templates) {
    const id = await L.createRecord(TABLE_IDS['Notification Templates'], {
      [NT['Template Code']]: t.code,
      [NT['Template Name']]: t.name,
      [NT['Trigger Event']]: [t.trig],
      [NT['Channel Type']]: [t.chan],
      [NT['Subject']]: t.subj,
      [NT['Body']]: t.body,
      [NT['Variables']]: t.vars,
      [NT['Language']]: [t.lang],
      [NT['Enabled']]: true,
    });
    IDS.templates[t.code] = id;
    await L.sleep(60);
  }
  console.log(`   ${templates.length} templates (bilingual EN/TN)`);

  // ────────────────────────────────────────────────────────────
  // 13. MSISDN Pool — BW format, tiered
  // ────────────────────────────────────────────────────────────
  console.log('\n13. MSISDN Pool (BW format, tiered)');
  const MP = await cm('MSISDN Pool');
  // Generate 60 pool numbers — mix of tiers
  function genMsisdn() {
    const prefixes = ['71', '72', '75', '77']; // BTC/beMobile allocated prefixes
    return '267' + L.pick(prefixes) + String(L.rand(100000, 999999));
  }
  const vanityPool = [
    { msisdn: '26771234567', tier: 4, notes: 'Ladder ascending — vanity' },
    { msisdn: '26772222222', tier: 3, notes: 'Repeated 2 — platinum' },
    { msisdn: '26775555555', tier: 3, notes: 'Repeated 5 — platinum' },
    { msisdn: '26777777777', tier: 3, notes: 'Lucky 7s — platinum' },
    { msisdn: '26771000000', tier: 2, notes: 'Round number — gold' },
    { msisdn: '26775000500', tier: 2, notes: 'Memorable pattern — gold' },
    { msisdn: '26772468024', tier: 2, notes: 'Evens ladder — gold' },
  ];
  let poolCount = 0;
  for (const v of vanityPool) {
    await L.createRecord(TABLE_IDS['MSISDN Pool'], {
      [MP['MSISDN']]: v.msisdn,
      [MP['Status']]: [1], // Available
      [MP['Tier']]: [v.tier],
      [MP['Notes']]: v.notes,
    });
    poolCount++; await L.sleep(40);
  }
  // Add 53 standard pool numbers
  for (let i = 0; i < 53; i++) {
    await L.createRecord(TABLE_IDS['MSISDN Pool'], {
      [MP['MSISDN']]: genMsisdn(),
      [MP['Status']]: [1], // Available
      [MP['Tier']]: [1],   // Standard
      [MP['Last Assigned Date']]: Date.now() - L.rand(200, 1000) * 86400000,
    });
    poolCount++; await L.sleep(40);
  }
  console.log(`   ${poolCount} MSISDNs seeded`);

  // ────────────────────────────────────────────────────────────
  // 14. SIM Inventory — BW ICCID format
  // ────────────────────────────────────────────────────────────
  console.log('\n14. SIM Inventory (BW ICCID + IMSI)');
  const SI = await cm('SIM Inventory');
  // ICCID BW: 89267 + issuer(04=BTC) + 12 digits + luhn
  // IMSI BW:  65204 (MCC 652 + MNC 04) + 10 digits
  const warehouses = ['Gaborone DC', 'Francistown Hub', 'Maun Staging', 'Central Depot'];
  const vendors = ['Gemalto', 'Idemia', 'Valid (Giesecke+Devrient)', 'Eastcompeace'];
  let simCount = 0;
  for (let i = 0; i < 50; i++) {
    const iccid = '8926704' + String(L.rand(100000000000, 999999999999));
    const imsi = '65204' + String(L.rand(1000000000, 9999999999));
    await L.createRecord(TABLE_IDS['SIM Inventory'], {
      [SI['ICCID']]: iccid,
      [SI['IMSI']]: imsi,
      [SI['Status']]: [1], // In Stock
      [SI['Warehouse Location']]: L.pick(warehouses),
      [SI['Vendor']]: L.pick(vendors),
      [SI['Batch ID']]: 'BATCH-2025-' + String(L.rand(1, 20)).padStart(3, '0'),
      [SI['Received Date']]: Date.now() - L.rand(30, 365) * 86400000,
    });
    simCount++; await L.sleep(40);
  }
  console.log(`   ${simCount} SIMs`);

  // ────────────────────────────────────────────────────────────
  // 15. Recharge Vouchers (empty table — check if has columns)
  // ────────────────────────────────────────────────────────────
  console.log('\n15. Recharge Vouchers — skipping (table has no columns)');

  // ────────────────────────────────────────────────────────────
  // 16. Network Elements (BW OCS / PGW / SMSC)
  // ────────────────────────────────────────────────────────────
  console.log('\n16. Network Elements (wipe+reseed with BW MCC/MNC)');
  // First wipe existing
  const existing = await L.fetchAll(TABLE_IDS['Network Elements']);
  for (const r of existing) { await L.api('DELETE', `/v1/app-builder/table/${TABLE_IDS['Network Elements']}/record/${r._id}`); await L.sleep(40); }

  const NE = await cm('Network Elements');
  const nes = [
    { code: 'OCS-PRIMARY-GAB', type: 1, region: 'South-East',   status: 1, realm: 'ocs.btc.bw',  fqdn: 'ocs1.btc.bw'  },
    { code: 'OCS-DR-FT',       type: 1, region: 'North-East',   status: 2, realm: 'ocs.btc.bw',  fqdn: 'ocs2.btc.bw'  },
    { code: 'PGW-CORE-GAB',    type: 2, region: 'South-East',   status: 1, realm: 'epc.btc.bw',  fqdn: 'pgw.btc.bw'   },
    { code: 'PCRF-GAB',        type: 3, region: 'South-East',   status: 1, realm: 'epc.btc.bw',  fqdn: 'pcrf.btc.bw'  },
    { code: 'SMSC-GAB',        type: 4, region: 'South-East',   status: 1, realm: 'smsc.btc.bw', fqdn: 'smsc.btc.bw'  },
    { code: 'HLR-GAB',         type: 5, region: 'South-East',   status: 1, realm: 'hlr.btc.bw',  fqdn: 'hlr.btc.bw'   },
    { code: 'MSC-GAB-1',       type: 6, region: 'South-East',   status: 1, realm: 'cs.btc.bw',   fqdn: 'msc1.btc.bw'  },
    { code: 'MSC-FT',          type: 6, region: 'North-East',   status: 1, realm: 'cs.btc.bw',   fqdn: 'msc2.btc.bw'  },
    { code: 'GGSN-GAB',        type: 2, region: 'South-East',   status: 1, realm: 'epc.btc.bw',  fqdn: 'ggsn.btc.bw'  },
  ];
  for (const n of nes) {
    await L.createRecord(TABLE_IDS['Network Elements'], {
      [NE['Element Code']]: n.code,
      [NE['Element Type']]: [n.type],
      [NE['Status']]: [n.status],
      [NE['Region']]: n.region,
      [NE['Diameter Realm']]: n.realm,
      [NE['FQDN']]: n.fqdn,
      [NE['Last Heartbeat']]: Date.now() - L.rand(5000, 300000),
      [NE['IP Address']]: '10.' + L.rand(1,254) + '.' + L.rand(1,254) + '.' + L.rand(1,254),
    });
    await L.sleep(60);
  }
  console.log(`   ${nes.length} network elements`);

  // Persist IDS for next scripts
  fs.writeFileSync(path.join(L.ROOT, '.bw-catalog-ids.json'), JSON.stringify(IDS, null, 2));
  console.log('\n=== CATALOG COMPLETE — IDs saved to .bw-catalog-ids.json ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
