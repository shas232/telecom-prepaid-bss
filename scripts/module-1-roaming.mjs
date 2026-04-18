// MODULE 1: Roaming Management — full-depth build
// Creates 5 tables, extends 2 existing, seeds realistic data, adds rollups + lookups.

import * as L from './lib-common.mjs';

const TABLE_IDS = L.loadTableIds();

async function main() {
  console.log('=== MODULE 1: ROAMING MANAGEMENT ===\n');

  // ------------------------------------------------------------------
  // 1. Create tables
  // ------------------------------------------------------------------
  console.log('1. Creating tables...');
  const rpId = await L.createTable('Roaming Partners', 'Inter-operator carrier agreements for international roaming.', 'Globe2', 'Telecom', 'Partner Code', 'PC');
  const rzId = await L.createTable('Roaming Zones', 'Geographic roaming zones used for rate card pricing.', 'Map', 'Telecom', 'Zone Code', 'ZC');
  const rrcId = await L.createTable('Roaming Rate Cards', 'Per-partner, per-service, per-zone rate cards.', 'Receipt', 'Telecom', 'Rate Code', 'RC');
  const rsId = await L.createTable('Roaming Sessions', 'Live and historical out-of-country session records.', 'Plane', 'Telecom', 'Session Code', 'RSC');
  const tapId = await L.createTable('TAP Records', 'Inbound TAP3 settlement files from foreign operators.', 'FileText', 'Telecom', 'TAP Code', 'TAP');
  console.log(`   partners=${rpId} zones=${rzId} rates=${rrcId} sessions=${rsId} tap=${tapId}`);

  TABLE_IDS['Roaming Partners'] = rpId;
  TABLE_IDS['Roaming Zones'] = rzId;
  TABLE_IDS['Roaming Rate Cards'] = rrcId;
  TABLE_IDS['Roaming Sessions'] = rsId;
  TABLE_IDS['TAP Records'] = tapId;
  L.saveTableIds(TABLE_IDS);

  // ------------------------------------------------------------------
  // 2. Create columns on Roaming Zones (no refs needed — first)
  // ------------------------------------------------------------------
  console.log('\n2. Adding columns to Roaming Zones...');
  const zoneCols = await L.createColumns(rzId, [
    { name: 'Zone Code', type: 'text', required: true, unique: true },
    { name: 'Zone Name', type: 'text', required: true },
    { name: 'Description', type: 'long_text' },
    L.selectSpec('Region', ['Asia-Pacific','Middle East','Europe','Americas','Africa','Oceania']),
    { name: 'Priority', type: 'number' },
    { name: 'Default Voice Rate (per min)', type: 'number' },
    { name: 'Default Data Rate (per MB)', type: 'number' },
    { name: 'Default SMS Rate', type: 'number' },
    { name: 'Countries Count', type: 'number' },
    L.selectSpec('Status', ['Active','Retired']),
  ]);
  console.log('   ' + Object.keys(zoneCols).length + ' zone cols');

  // ------------------------------------------------------------------
  // 3. Create columns on Roaming Partners
  // ------------------------------------------------------------------
  console.log('\n3. Adding columns to Roaming Partners...');
  const partnerCols = await L.createColumns(rpId, [
    { name: 'Partner Code', type: 'text', required: true, unique: true },
    { name: 'Partner Name', type: 'text', required: true },
    { name: 'Country', type: 'text', required: true },
    { name: 'Country Code', type: 'text' },
    { name: 'MCC', type: 'text', required: true },
    { name: 'MNC', type: 'text', required: true },
    { name: 'VLR Prefix', type: 'text' },
    L.selectSpec('Status', ['Prospect','Onboarding','Active','Suspended','Terminated'], true),
    L.selectSpec('Contract Type', ['Prepaid','Postpaid','Both']),
    L.selectSpec('Settlement Currency', ['USD','EUR','SDR','INR','GBP','AUD','SGD']),
    { name: 'IOT Voice Rate (per min)', type: 'number' },
    { name: 'IOT Data Rate (per MB)', type: 'number' },
    { name: 'IOT SMS Rate', type: 'number' },
    { name: 'Onboarded Date', type: 'date' },
    { name: 'Contact Email', type: 'email' },
    { name: 'Contact Phone', type: 'phone' },
    { name: 'Notes', type: 'long_text' },
    L.refSpec('Zone', rzId, zoneCols['Zone Code']),
  ]);
  console.log('   ' + Object.keys(partnerCols).length + ' partner cols');

  // ------------------------------------------------------------------
  // 4. Create columns on Roaming Rate Cards (needs partner + zone refs)
  // ------------------------------------------------------------------
  console.log('\n4. Adding columns to Roaming Rate Cards...');
  const rcCols = await L.createColumns(rrcId, [
    { name: 'Rate Code', type: 'text', required: true, unique: true },
    L.refSpec('Partner', rpId, partnerCols['Partner Name'], true),
    L.refSpec('Zone', rzId, zoneCols['Zone Name']),
    L.selectSpec('Service Type', ['Voice MO','Voice MT','SMS MO','SMS MT','Data','Video Call'], true),
    L.selectSpec('Unit', ['per minute','per MB','per SMS','per event']),
    { name: 'Customer Rate', type: 'number', required: true },
    { name: 'Wholesale Rate (IOT)', type: 'number' },
    L.selectSpec('Currency', ['USD','EUR','SDR','INR','GBP']),
    { name: 'Effective From', type: 'date' },
    { name: 'Effective To', type: 'date' },
    L.selectSpec('Status', ['Draft','Active','Expired','Suspended']),
    { name: 'Notes', type: 'long_text' },
  ]);
  console.log('   ' + Object.keys(rcCols).length + ' rate-card cols');

  // ------------------------------------------------------------------
  // 5. Create columns on Roaming Sessions (needs Subscriptions + Partner + Zone refs)
  // ------------------------------------------------------------------
  console.log('\n5. Adding columns to Roaming Sessions...');
  // Find Subscriptions MSISDN col id
  const subSchema = await L.getTableSchema(TABLE_IDS['Subscriptions']);
  const subMsisdnId = subSchema.find(c => c.name === 'MSISDN').id;

  const rsCols = await L.createColumns(rsId, [
    { name: 'Session Code', type: 'text', required: true, unique: true },
    L.refSpec('Subscription', TABLE_IDS['Subscriptions'], subMsisdnId, true),
    L.refSpec('Partner', rpId, partnerCols['Partner Name'], true),
    L.refSpec('Zone', rzId, zoneCols['Zone Name']),
    { name: 'Country', type: 'text' },
    { name: 'VLR Address', type: 'text' },
    { name: 'Entered At', type: 'date', required: true },
    { name: 'Left At', type: 'date' },
    L.selectSpec('Status', ['Active','Completed','Force Closed','Suspicious'], true),
    L.selectSpec('Bill Shock Level', ['None','50%','80%','100%','Blocked']),
    { name: 'Data Usage (MB)', type: 'number' },
    { name: 'Voice Usage (min)', type: 'number' },
    { name: 'SMS Count', type: 'number' },
    { name: 'Total Charged', type: 'number' },
    { name: 'Daily Cap', type: 'number' },
    { name: 'Notes', type: 'long_text' },
  ]);
  console.log('   ' + Object.keys(rsCols).length + ' session cols');

  // ------------------------------------------------------------------
  // 6. Create columns on TAP Records
  // ------------------------------------------------------------------
  console.log('\n6. Adding columns to TAP Records...');
  const tapCols = await L.createColumns(tapId, [
    { name: 'TAP Code', type: 'text', required: true, unique: true },
    L.refSpec('Partner', rpId, partnerCols['Partner Name'], true),
    { name: 'File Name', type: 'text' },
    { name: 'Period Start', type: 'date', required: true },
    { name: 'Period End', type: 'date', required: true },
    { name: 'Total Events', type: 'number' },
    { name: 'Total Amount', type: 'number' },
    L.selectSpec('Currency', ['USD','EUR','SDR','INR','GBP']),
    L.selectSpec('Status', ['Received','Validated','Reconciled','Disputed','Settled','Rejected'], true),
    { name: 'Received Date', type: 'date' },
    { name: 'Settled Date', type: 'date' },
    { name: 'Dispute Reason', type: 'text' },
    { name: 'Reconciliation Notes', type: 'long_text' },
  ]);
  console.log('   ' + Object.keys(tapCols).length + ' TAP cols');

  // ------------------------------------------------------------------
  // 7. Extend existing tables
  // ------------------------------------------------------------------
  console.log('\n7. Extending Subscriptions + Tariff Plans...');
  const subExt = await L.createColumns(TABLE_IDS['Subscriptions'], [
    { name: 'Roaming Credit Limit Daily', type: 'number' },
    L.refSpec('Current Roaming Zone', rzId, zoneCols['Zone Name']),
  ]);
  console.log('   subscriptions: ' + Object.keys(subExt).join(', '));
  const tpExt = await L.createColumns(TABLE_IDS['Tariff Plans'], [
    { name: 'Roaming Zones Included', type: 'text' },
  ]);
  console.log('   tariff plans: ' + Object.keys(tpExt).join(', '));

  // ------------------------------------------------------------------
  // 8. Seed Roaming Zones
  // ------------------------------------------------------------------
  console.log('\n8. Seeding Roaming Zones...');
  const zones = [
    { code: 'SAARC',   name: 'SAARC & Neighbors',     region: 1, prio: 1, voice: 4, data: 2,   sms: 1,  countries: 7,  desc: 'Nepal, Bhutan, Sri Lanka, Bangladesh, Pakistan, Maldives, Afghanistan.' },
    { code: 'ASEAN',   name: 'Southeast Asia',        region: 1, prio: 2, voice: 8, data: 3,   sms: 2,  countries: 10, desc: 'Singapore, Malaysia, Thailand, Indonesia, Philippines, Vietnam, Myanmar, Laos, Cambodia, Brunei.' },
    { code: 'GCC',     name: 'Gulf Cooperation',      region: 2, prio: 3, voice: 12,data: 5,   sms: 3,  countries: 6,  desc: 'UAE, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman.' },
    { code: 'EU',      name: 'Europe',                region: 3, prio: 4, voice: 15,data: 6,   sms: 3,  countries: 27, desc: 'European Union member states with reciprocal roaming pacts.' },
    { code: 'UK',      name: 'United Kingdom',        region: 3, prio: 4, voice: 18,data: 7,   sms: 4,  countries: 1,  desc: 'UK-specific pricing post-Brexit.' },
    { code: 'NA',      name: 'North America',         region: 4, prio: 5, voice: 25,data: 10,  sms: 5,  countries: 3,  desc: 'USA, Canada, Mexico.' },
    { code: 'ANZ',     name: 'Australia & NZ',        region: 6, prio: 5, voice: 22,data: 9,   sms: 5,  countries: 2,  desc: 'Australia and New Zealand.' },
    { code: 'ROW',     name: 'Rest of World',         region: 5, prio: 9, voice: 60,data: 25,  sms: 10, countries: 150,desc: 'All other countries — premium pricing.' },
  ];
  const zoneIds = {};
  for (const z of zones) {
    const id = await L.createRecord(rzId, {
      [zoneCols['Zone Code']]: z.code,
      [zoneCols['Zone Name']]: z.name,
      [zoneCols['Description']]: z.desc,
      [zoneCols['Region']]: [z.region],
      [zoneCols['Priority']]: z.prio,
      [zoneCols['Default Voice Rate (per min)']]: z.voice,
      [zoneCols['Default Data Rate (per MB)']]: z.data,
      [zoneCols['Default SMS Rate']]: z.sms,
      [zoneCols['Countries Count']]: z.countries,
      [zoneCols['Status']]: [1],
    });
    zoneIds[z.code] = id;
    await L.sleep(100);
  }
  console.log(`   ${Object.keys(zoneIds).length} zones seeded`);

  // ------------------------------------------------------------------
  // 9. Seed Roaming Partners
  // ------------------------------------------------------------------
  console.log('\n9. Seeding Roaming Partners...');
  const partners = [
    { code: 'NPL-NTC-01', name: 'Nepal Telecom',         country: 'Nepal',       cc: 'NP', mcc: '429', mnc: '01', zone: 'SAARC', voiceIot: 3,  dataIot: 1.5, smsIot: 0.5, currency: 'USD' },
    { code: 'LKA-DLG-01', name: 'Dialog Axiata',         country: 'Sri Lanka',   cc: 'LK', mcc: '413', mnc: '02', zone: 'SAARC', voiceIot: 3.5,dataIot: 1.5, smsIot: 0.5, currency: 'USD' },
    { code: 'SGP-SGT-01', name: 'Singtel',               country: 'Singapore',   cc: 'SG', mcc: '525', mnc: '01', zone: 'ASEAN', voiceIot: 6,  dataIot: 2.2, smsIot: 1.5, currency: 'USD' },
    { code: 'MYS-MXS-01', name: 'Maxis Malaysia',        country: 'Malaysia',    cc: 'MY', mcc: '502', mnc: '12', zone: 'ASEAN', voiceIot: 6,  dataIot: 2.2, smsIot: 1.5, currency: 'USD' },
    { code: 'THA-AIS-01', name: 'AIS Thailand',          country: 'Thailand',    cc: 'TH', mcc: '520', mnc: '03', zone: 'ASEAN', voiceIot: 6,  dataIot: 2.2, smsIot: 1.5, currency: 'USD' },
    { code: 'ARE-ETI-01', name: 'Etisalat',              country: 'UAE',         cc: 'AE', mcc: '424', mnc: '02', zone: 'GCC',   voiceIot: 9,  dataIot: 3.5, smsIot: 2,   currency: 'USD' },
    { code: 'SAU-STC-01', name: 'STC Saudi',             country: 'Saudi Arabia',cc: 'SA', mcc: '420', mnc: '01', zone: 'GCC',   voiceIot: 9,  dataIot: 3.5, smsIot: 2,   currency: 'USD' },
    { code: 'GBR-VOD-01', name: 'Vodafone UK',           country: 'United Kingdom', cc: 'GB', mcc: '234', mnc: '15', zone: 'UK', voiceIot: 12, dataIot: 5, smsIot: 3, currency: 'GBP' },
    { code: 'DEU-TMO-01', name: 'T-Mobile Germany',      country: 'Germany',     cc: 'DE', mcc: '262', mnc: '01', zone: 'EU',    voiceIot: 11, dataIot: 4.5, smsIot: 2.5, currency: 'EUR' },
    { code: 'USA-TMO-01', name: 'T-Mobile USA',          country: 'United States', cc: 'US', mcc: '310', mnc: '260', zone: 'NA', voiceIot: 18, dataIot: 7,  smsIot: 4,   currency: 'USD' },
    { code: 'USA-VZW-01', name: 'Verizon',               country: 'United States', cc: 'US', mcc: '311', mnc: '480', zone: 'NA', voiceIot: 20, dataIot: 8,  smsIot: 4,   currency: 'USD' },
    { code: 'AUS-TLS-01', name: 'Telstra',               country: 'Australia',   cc: 'AU', mcc: '505', mnc: '01', zone: 'ANZ',   voiceIot: 16, dataIot: 6.5, smsIot: 3.5, currency: 'AUD' },
  ];
  const partnerIds = {};
  for (const p of partners) {
    const id = await L.createRecord(rpId, {
      [partnerCols['Partner Code']]: p.code,
      [partnerCols['Partner Name']]: p.name,
      [partnerCols['Country']]: p.country,
      [partnerCols['Country Code']]: p.cc,
      [partnerCols['MCC']]: p.mcc,
      [partnerCols['MNC']]: p.mnc,
      [partnerCols['VLR Prefix']]: '+' + (p.cc === 'SG' ? '65' : p.cc === 'MY' ? '60' : p.cc === 'TH' ? '66' : p.cc === 'AE' ? '971' : p.cc === 'SA' ? '966' : p.cc === 'GB' ? '44' : p.cc === 'DE' ? '49' : p.cc === 'US' ? '1' : p.cc === 'AU' ? '61' : p.cc === 'NP' ? '977' : p.cc === 'LK' ? '94' : '0'),
      [partnerCols['Status']]: [3], // Active
      [partnerCols['Contract Type']]: [3], // Both
      [partnerCols['Settlement Currency']]: [['USD','EUR','SDR','INR','GBP','AUD','SGD'].indexOf(p.currency)+1],
      [partnerCols['IOT Voice Rate (per min)']]: p.voiceIot,
      [partnerCols['IOT Data Rate (per MB)']]: p.dataIot,
      [partnerCols['IOT SMS Rate']]: p.smsIot,
      [partnerCols['Onboarded Date']]: Date.now() - L.rand(200, 1500) * 86400000,
      [partnerCols['Contact Email']]: 'roaming@' + p.name.toLowerCase().replace(/\s/g, '') + '.example.com',
      [partnerCols['Contact Phone']]: p.mcc + p.mnc + '0000',
      [partnerCols['Zone']]: [zoneIds[p.zone]],
    });
    partnerIds[p.code] = { id, zone: p.zone, voiceIot: p.voiceIot, dataIot: p.dataIot, smsIot: p.smsIot, currency: p.currency, name: p.name };
    await L.sleep(100);
  }
  console.log(`   ${Object.keys(partnerIds).length} partners seeded`);

  // ------------------------------------------------------------------
  // 10. Seed Rate Cards (3 services per partner × default markup)
  // ------------------------------------------------------------------
  console.log('\n10. Seeding Rate Cards...');
  const services = [
    { svc: 'Voice MO', unit: 'per minute', iotKey: 'voiceIot', mk: 2.2 },
    { svc: 'Voice MT', unit: 'per minute', iotKey: 'voiceIot', mk: 1.5 },
    { svc: 'SMS MO',   unit: 'per SMS',    iotKey: 'smsIot',   mk: 2.5 },
    { svc: 'Data',     unit: 'per MB',     iotKey: 'dataIot',  mk: 3.0 },
  ];
  let rcCount = 0;
  for (const [code, info] of Object.entries(partnerIds)) {
    for (const s of services) {
      const wholesale = info[s.iotKey];
      const customer = Math.round(wholesale * s.mk * 100) / 100;
      await L.createRecord(rrcId, {
        [rcCols['Rate Code']]: `RC-${code}-${s.svc.replace(/\s/g,'')}`,
        [rcCols['Partner']]: [info.id],
        [rcCols['Zone']]: [zoneIds[info.zone]],
        [rcCols['Service Type']]: [['Voice MO','Voice MT','SMS MO','SMS MT','Data','Video Call'].indexOf(s.svc)+1],
        [rcCols['Unit']]: [['per minute','per MB','per SMS','per event'].indexOf(s.unit)+1],
        [rcCols['Customer Rate']]: customer,
        [rcCols['Wholesale Rate (IOT)']]: wholesale,
        [rcCols['Currency']]: [['USD','EUR','SDR','INR','GBP'].indexOf(info.currency)+1 || 1],
        [rcCols['Effective From']]: Date.now() - 180 * 86400000,
        [rcCols['Effective To']]: Date.now() + 365 * 86400000,
        [rcCols['Status']]: [2], // Active
      });
      rcCount++;
      await L.sleep(60);
    }
  }
  console.log(`   ${rcCount} rate cards seeded`);

  // ------------------------------------------------------------------
  // 11. Seed Roaming Sessions (realistic: Vikram in Singapore, Priya in UAE, plus historical)
  // ------------------------------------------------------------------
  console.log('\n11. Seeding Roaming Sessions...');
  // Find our 3 realistic subs
  const subs = await L.fetchAll(TABLE_IDS['Subscriptions']);
  const subByMsisdn = {};
  for (const s of subs) subByMsisdn[s.cells[subMsisdnId]] = s._id;
  const arjunSub = subByMsisdn['919820123456'];
  const priyaSub = subByMsisdn['919845678901'];
  const vikramSub = subByMsisdn['919767890123'];

  const sessionsToCreate = [
    // Vikram — business traveler, currently in Singapore (ACTIVE session)
    { sub: vikramSub, partner: 'SGP-SGT-01', country: 'Singapore', vlr: '+6590000001', enteredDaysAgo: 2, active: true,
      data: 1450, voice: 85, sms: 12, charged: 420, shock: '50%' },
    // Vikram — previous trip UAE (completed)
    { sub: vikramSub, partner: 'ARE-ETI-01', country: 'UAE', vlr: '+97150000001', enteredDaysAgo: 35, leftDaysAgo: 28,
      data: 2100, voice: 145, sms: 28, charged: 890, shock: '80%' },
    // Priya — currently in UAE (ACTIVE)
    { sub: priyaSub, partner: 'ARE-ETI-01', country: 'UAE', vlr: '+97150000002', enteredDaysAgo: 1, active: true,
      data: 380, voice: 22, sms: 5, charged: 95, shock: 'None' },
    // Priya — older trip Thailand
    { sub: priyaSub, partner: 'THA-AIS-01', country: 'Thailand', vlr: '+66900000001', enteredDaysAgo: 70, leftDaysAgo: 63,
      data: 850, voice: 32, sms: 8, charged: 180, shock: 'None' },
    // Arjun — US trip completed
    { sub: arjunSub, partner: 'USA-TMO-01', country: 'United States', vlr: '+13100000001', enteredDaysAgo: 90, leftDaysAgo: 82,
      data: 3200, voice: 180, sms: 15, charged: 1650, shock: '80%' },
    // Arjun — UK business trip (force-closed due to bill shock)
    { sub: arjunSub, partner: 'GBR-VOD-01', country: 'United Kingdom', vlr: '+44700000001', enteredDaysAgo: 120, leftDaysAgo: 118,
      data: 4500, voice: 220, sms: 30, charged: 2400, shock: 'Blocked', force: true },
  ];
  for (let i = 0; i < sessionsToCreate.length; i++) {
    const s = sessionsToCreate[i];
    const partnerInfo = partnerIds[s.partner];
    const status = s.active ? 1 : s.force ? 3 : 2; // Active/Completed/Force Closed
    const shockIdx = ['None','50%','80%','100%','Blocked'].indexOf(s.shock) + 1;
    await L.createRecord(rsId, {
      [rsCols['Session Code']]: `ROAM-${s.sub.slice(0,6)}-${i+1}`,
      [rsCols['Subscription']]: [s.sub],
      [rsCols['Partner']]: [partnerInfo.id],
      [rsCols['Zone']]: [zoneIds[partnerInfo.zone]],
      [rsCols['Country']]: s.country,
      [rsCols['VLR Address']]: s.vlr,
      [rsCols['Entered At']]: Date.now() - s.enteredDaysAgo * 86400000,
      ...(s.leftDaysAgo != null ? { [rsCols['Left At']]: Date.now() - s.leftDaysAgo * 86400000 } : {}),
      [rsCols['Status']]: [status],
      [rsCols['Bill Shock Level']]: [shockIdx],
      [rsCols['Data Usage (MB)']]: s.data,
      [rsCols['Voice Usage (min)']]: s.voice,
      [rsCols['SMS Count']]: s.sms,
      [rsCols['Total Charged']]: s.charged,
      [rsCols['Daily Cap']]: 500,
    });
    await L.sleep(100);
  }
  // Also update Vikram + Priya subscriptions to point at current zone
  await L.updateRecord(TABLE_IDS['Subscriptions'], vikramSub, {
    [subExt['Current Roaming Zone']]: [zoneIds['ASEAN']],
    [subExt['Roaming Credit Limit Daily']]: 1000,
  });
  await L.updateRecord(TABLE_IDS['Subscriptions'], priyaSub, {
    [subExt['Current Roaming Zone']]: [zoneIds['GCC']],
    [subExt['Roaming Credit Limit Daily']]: 500,
  });
  await L.updateRecord(TABLE_IDS['Subscriptions'], arjunSub, {
    [subExt['Roaming Credit Limit Daily']]: 800,
  });
  console.log(`   ${sessionsToCreate.length} sessions seeded (2 active, 3 completed, 1 force-closed)`);

  // ------------------------------------------------------------------
  // 12. Seed TAP Records (monthly settlement files)
  // ------------------------------------------------------------------
  console.log('\n12. Seeding TAP Records...');
  let tapCount = 0;
  for (const [code, info] of Object.entries(partnerIds).slice(0, 8)) {
    // 1-2 TAP files per partner
    for (let m = 0; m < 2; m++) {
      const periodStart = Date.now() - (60 - m * 30) * 86400000;
      const periodEnd = periodStart + 30 * 86400000;
      const totalEvents = L.rand(50, 500);
      const totalAmount = Math.round(totalEvents * L.rand(5, 25) * 100) / 100;
      const statusIdx = m === 0 ? 6 : L.pick([3, 5]); // recent=Settled, older=Reconciled/Settled
      await L.createRecord(tapId, {
        [tapCols['TAP Code']]: `TAP-${code}-${m+1}`,
        [tapCols['Partner']]: [info.id],
        [tapCols['File Name']]: `TAP3_${code}_${new Date(periodStart).toISOString().slice(0,7)}.xml`,
        [tapCols['Period Start']]: periodStart,
        [tapCols['Period End']]: periodEnd,
        [tapCols['Total Events']]: totalEvents,
        [tapCols['Total Amount']]: totalAmount,
        [tapCols['Currency']]: [['USD','EUR','SDR','INR','GBP'].indexOf(info.currency)+1 || 1],
        [tapCols['Status']]: [statusIdx],
        [tapCols['Received Date']]: periodEnd + 86400000,
        ...(statusIdx === 6 ? { [tapCols['Settled Date']]: periodEnd + 86400000 * 14 } : {}),
      });
      tapCount++;
      await L.sleep(80);
    }
  }
  console.log(`   ${tapCount} TAP records seeded`);

  // ------------------------------------------------------------------
  // 13. Add lookups + rollups
  // ------------------------------------------------------------------
  console.log('\n13. Adding lookups + rollups...');

  // Roaming Sessions lookups
  await L.createColumns(rsId, [
    L.lookupSpec('MSISDN', 'Subscription', rsCols['Subscription'], 'MSISDN', subMsisdnId, 'text'),
    L.lookupSpec('Partner Name', 'Partner', rsCols['Partner'], 'Partner Name', partnerCols['Partner Name'], 'text'),
    L.lookupSpec('Zone Name', 'Zone', rsCols['Zone'], 'Zone Name', zoneCols['Zone Name'], 'text'),
  ]);

  // TAP Records lookups
  await L.createColumns(tapId, [
    L.lookupSpec('Partner Name', 'Partner', tapCols['Partner'], 'Partner Name', partnerCols['Partner Name'], 'text'),
  ]);

  // Rate Cards lookups
  await L.createColumns(rrcId, [
    L.lookupSpec('Partner Name', 'Partner', rcCols['Partner'], 'Partner Name', partnerCols['Partner Name'], 'text'),
    L.lookupSpec('Zone Name', 'Zone', rcCols['Zone'], 'Zone Name', zoneCols['Zone Name'], 'text'),
    L.formulaSpec('Markup %',
      'IF(${Wholesale Rate (IOT)} > 0, (${Customer Rate} - ${Wholesale Rate (IOT)}) / ${Customer Rate} * 100, 0)',
      { 'Customer Rate': [rcCols['Customer Rate']], 'Wholesale Rate (IOT)': [rcCols['Wholesale Rate (IOT)']] },
      'number'),
  ]);

  // Rollups on Partners (Total Revenue, Session Count, TAP Count)
  await L.createColumns(rpId, [
    L.rollupSpec('Total Roaming Revenue', 'Roaming Sessions', rsId, rsCols['Partner'], 'Total Charged', rsCols['Total Charged'], 'SUM'),
    L.rollupSpec('Session Count', 'Roaming Sessions', rsId, rsCols['Partner'], 'Session Code', rsCols['Session Code'], 'COUNT'),
    L.rollupSpec('TAP File Count', 'TAP Records', tapId, tapCols['Partner'], 'TAP Code', tapCols['TAP Code'], 'COUNT'),
    L.rollupSpec('Total Settlement', 'TAP Records', tapId, tapCols['Partner'], 'Total Amount', tapCols['Total Amount'], 'SUM'),
    L.rollupSpec('Rate Card Count', 'Roaming Rate Cards', rrcId, rcCols['Partner'], 'Rate Code', rcCols['Rate Code'], 'COUNT'),
  ]);

  // Rollups on Zones
  await L.createColumns(rzId, [
    L.rollupSpec('Partner Count', 'Roaming Partners', rpId, partnerCols['Zone'], 'Partner Code', partnerCols['Partner Code'], 'COUNT'),
    L.rollupSpec('Total Zone Revenue', 'Roaming Sessions', rsId, rsCols['Zone'], 'Total Charged', rsCols['Total Charged'], 'SUM'),
    L.rollupSpec('Session Count', 'Roaming Sessions', rsId, rsCols['Zone'], 'Session Code', rsCols['Session Code'], 'COUNT'),
  ]);

  // Rollup on Subscriptions (roaming session count for each sub)
  await L.createColumns(TABLE_IDS['Subscriptions'], [
    L.rollupSpec('Roaming Session Count', 'Roaming Sessions', rsId, rsCols['Subscription'], 'Session Code', rsCols['Session Code'], 'COUNT'),
    L.rollupSpec('Lifetime Roaming Charges', 'Roaming Sessions', rsId, rsCols['Subscription'], 'Total Charged', rsCols['Total Charged'], 'SUM'),
  ]);

  // ------------------------------------------------------------------
  // 14. Trigger evaluation
  // ------------------------------------------------------------------
  console.log('\n14. Triggering evaluation...');
  await L.sleep(3000);
  for (const [tname, tid] of [['Roaming Partners', rpId], ['Roaming Zones', rzId], ['Roaming Rate Cards', rrcId], ['Roaming Sessions', rsId], ['TAP Records', tapId], ['Subscriptions', TABLE_IDS['Subscriptions']]]) {
    const rows = await L.fetchAll(tid);
    await L.evalAllComputed(tid, rows.map(r => r._id));
  }
  console.log('   eval triggered across 6 tables');

  console.log('\n=== MODULE 1 COMPLETE ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
