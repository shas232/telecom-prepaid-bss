// MODULE 2: IMEI / Device Management — full-depth build

import * as L from './lib-common.mjs';

const TABLE_IDS = L.loadTableIds();

async function main() {
  console.log('=== MODULE 2: IMEI / DEVICE MANAGEMENT ===\n');

  // ------------------------------------------------------------------
  // 1. Create tables
  // ------------------------------------------------------------------
  console.log('1. Creating tables...');
  const tacId = await L.createTable('Device TAC Database', 'Type Approval Code master — industry-standard device catalog keyed by TAC (first 8 digits of IMEI).', 'Smartphone', 'Telecom', 'TAC', 'TAC');
  const devId = await L.createTable('Devices', 'Unique device instances identified by IMEI, with owner + subscription binding.', 'Tablet', 'Telecom', 'Device Code', 'DEV');
  const eirId = await L.createTable('Equipment Identity Register', 'EIR blacklist/graylist/whitelist for stolen, lost, and blocked devices.', 'ShieldAlert', 'Telecom', 'EIR Code', 'EIR');
  const imeiEvId = await L.createTable('IMEI Change Events', 'Audit log of every IMEI change on a subscription — fraud signal.', 'ArrowRightLeft', 'Telecom', 'Event Code', 'IME');
  console.log(`   tac=${tacId} devices=${devId} eir=${eirId} events=${imeiEvId}`);

  TABLE_IDS['Device TAC Database'] = tacId;
  TABLE_IDS['Devices'] = devId;
  TABLE_IDS['Equipment Identity Register'] = eirId;
  TABLE_IDS['IMEI Change Events'] = imeiEvId;
  L.saveTableIds(TABLE_IDS);

  // ------------------------------------------------------------------
  // 2. Columns on Device TAC Database
  // ------------------------------------------------------------------
  console.log('\n2. Adding TAC columns...');
  const tacCols = await L.createColumns(tacId, [
    { name: 'TAC', type: 'text', required: true, unique: true },
    { name: 'Manufacturer', type: 'text', required: true },
    { name: 'Brand', type: 'text' },
    { name: 'Marketing Name', type: 'text', required: true },
    { name: 'Model', type: 'text' },
    { name: 'Release Year', type: 'number' },
    L.selectSpec('Form Factor', ['Phone','Tablet','Smartwatch','IoT/M2M','Modem/Hotspot','Laptop/PC'], true),
    { name: 'VoLTE Support', type: 'boolean' },
    { name: 'VoNR (5G Voice) Support', type: 'boolean' },
    { name: '5G Support', type: 'boolean' },
    { name: 'Dual SIM', type: 'boolean' },
    { name: 'eSIM Support', type: 'boolean' },
    { name: 'Band Support', type: 'text' },
    L.selectSpec('Status', ['Active','End of Life','Blocked']),
    { name: 'Notes', type: 'long_text' },
  ]);
  console.log('   ' + Object.keys(tacCols).length + ' TAC cols');

  // ------------------------------------------------------------------
  // 3. Columns on Devices (needs TAC + Customer + Subscription refs)
  // ------------------------------------------------------------------
  console.log('\n3. Adding Devices columns...');
  const custSchema = await L.getTableSchema(TABLE_IDS['Customers']);
  const custNameId = custSchema.find(c => c.name === 'Name').id;
  const subSchema = await L.getTableSchema(TABLE_IDS['Subscriptions']);
  const subMsisdnId = subSchema.find(c => c.name === 'MSISDN').id;

  const devCols = await L.createColumns(devId, [
    { name: 'Device Code', type: 'text', required: true, unique: true },
    { name: 'IMEI', type: 'text', required: true, unique: true },
    { name: 'IMEISV', type: 'text' },
    { name: 'TAC', type: 'text', required: true },
    L.refSpec('Device TAC', tacId, tacCols['Marketing Name'], true),
    L.refSpec('Owner', TABLE_IDS['Customers'], custNameId),
    L.refSpec('Current Subscription', TABLE_IDS['Subscriptions'], subMsisdnId),
    { name: 'First Seen', type: 'date' },
    { name: 'Last Seen', type: 'date' },
    L.selectSpec('Status', ['Active','Idle','Lost','Stolen','Blocked','Inactive','Unknown'], true),
    { name: 'Is Fraud Flagged', type: 'boolean' },
    { name: 'Notes', type: 'long_text' },
  ]);
  console.log('   ' + Object.keys(devCols).length + ' Device cols');

  // ------------------------------------------------------------------
  // 4. Columns on EIR
  // ------------------------------------------------------------------
  console.log('\n4. Adding EIR columns...');
  const eirCols = await L.createColumns(eirId, [
    { name: 'EIR Code', type: 'text', required: true, unique: true },
    { name: 'IMEI', type: 'text', required: true },
    L.refSpec('Device', devId, devCols['IMEI']),
    L.selectSpec('List Type', ['Blacklist','Graylist','Whitelist','Exception'], true),
    L.selectSpec('Reason', ['Stolen','Lost','Fraud','Recalled','Unpaid Dues','Regulatory','Other'], true),
    { name: 'Reported By', type: 'text' },
    { name: 'Reported At', type: 'date', required: true },
    { name: 'Country of Report', type: 'text' },
    { name: 'Police Case Number', type: 'text' },
    L.selectSpec('Status', ['Active','Cleared','Escalated','Expired'], true),
    { name: 'Cleared At', type: 'date' },
    { name: 'Cleared By', type: 'text' },
    { name: 'Notes', type: 'long_text' },
  ]);
  console.log('   ' + Object.keys(eirCols).length + ' EIR cols');

  // ------------------------------------------------------------------
  // 5. Columns on IMEI Change Events
  // ------------------------------------------------------------------
  console.log('\n5. Adding IMEI Change Events columns...');
  const evCols = await L.createColumns(imeiEvId, [
    { name: 'Event Code', type: 'text', required: true, unique: true },
    L.refSpec('Subscription', TABLE_IDS['Subscriptions'], subMsisdnId, true),
    { name: 'Old IMEI', type: 'text' },
    { name: 'New IMEI', type: 'text', required: true },
    L.refSpec('Old Device', devId, devCols['IMEI']),
    L.refSpec('New Device', devId, devCols['IMEI']),
    { name: 'Changed At', type: 'date', required: true },
    { name: 'Hours Since Previous', type: 'number' },
    { name: 'Suspicious', type: 'boolean' },
    L.selectSpec('Review Status', ['Pending','Reviewed','Confirmed Fraud','Cleared','Escalated'], true),
    { name: 'Reviewed By', type: 'text' },
    { name: 'Reviewed At', type: 'date' },
    { name: 'Resolution Notes', type: 'long_text' },
  ]);
  console.log('   ' + Object.keys(evCols).length + ' event cols');

  // ------------------------------------------------------------------
  // 6. Extend Subscriptions with Current Device ref
  // ------------------------------------------------------------------
  console.log('\n6. Extending Subscriptions with Current Device...');
  const subExt = await L.createColumns(TABLE_IDS['Subscriptions'], [
    L.refSpec('Current Device', devId, devCols['IMEI']),
  ]);
  console.log('   added: ' + Object.keys(subExt).join(', '));

  // ------------------------------------------------------------------
  // 7. Seed TAC Database (50 real-world TACs)
  // ------------------------------------------------------------------
  console.log('\n7. Seeding TAC Database...');
  // Realistic TACs (first 8 digits of real IMEIs from public GSMA data).
  // Format: [TAC, Manufacturer, Brand, Marketing Name, Model, Year, FormFactor(1-6), VoLTE, VoNR, 5G, DualSim, eSIM]
  const tacs = [
    ['35328115', 'Apple', 'Apple', 'iPhone 15 Pro', 'A2848', 2023, 1, true,  true,  true,  false, true],
    ['35328114', 'Apple', 'Apple', 'iPhone 15',     'A2846', 2023, 1, true,  true,  true,  false, true],
    ['35261211', 'Apple', 'Apple', 'iPhone 14 Pro', 'A2650', 2022, 1, true,  true,  true,  false, true],
    ['35261210', 'Apple', 'Apple', 'iPhone 14',     'A2649', 2022, 1, true,  false, true,  false, true],
    ['35262010', 'Apple', 'Apple', 'iPhone 13',     'A2482', 2021, 1, true,  false, true,  false, true],
    ['35246309', 'Apple', 'Apple', 'iPhone 12',     'A2172', 2020, 1, true,  false, true,  false, true],
    ['35235207', 'Apple', 'Apple', 'iPhone 11',     'A2111', 2019, 1, true,  false, false, false, true],
    ['35225110', 'Apple', 'Apple', 'iPhone SE (3rd gen)','A2595', 2022, 1, true, false, true, false, true],
    ['35737120', 'Samsung', 'Samsung', 'Galaxy S24 Ultra', 'SM-S928B', 2024, 1, true,  true,  true,  true,  true],
    ['35737119', 'Samsung', 'Samsung', 'Galaxy S24',       'SM-S921B', 2024, 1, true,  true,  true,  true,  true],
    ['35690111', 'Samsung', 'Samsung', 'Galaxy S23 Ultra', 'SM-S918B', 2023, 1, true,  false, true,  true,  true],
    ['35690110', 'Samsung', 'Samsung', 'Galaxy S23',       'SM-S911B', 2023, 1, true,  false, true,  true,  true],
    ['35689009', 'Samsung', 'Samsung', 'Galaxy A54 5G',    'SM-A546E', 2023, 1, true,  false, true,  true,  false],
    ['35688011', 'Samsung', 'Samsung', 'Galaxy A34 5G',    'SM-A346E', 2023, 1, true,  false, true,  true,  false],
    ['35689014', 'Samsung', 'Samsung', 'Galaxy A24',       'SM-A245F', 2023, 1, true,  false, false, true,  false],
    ['35686711', 'Samsung', 'Samsung', 'Galaxy M34 5G',    'SM-M346B', 2023, 1, true,  false, true,  true,  false],
    ['35644511', 'Samsung', 'Samsung', 'Galaxy Note 20 Ultra','SM-N986B', 2020, 1, true, false, true, true, false],
    ['35321211', 'Samsung', 'Samsung', 'Galaxy Fold 5',    'SM-F946B', 2023, 1, true,  true,  true,  true,  true],
    ['35321213', 'Samsung', 'Samsung', 'Galaxy Flip 5',    'SM-F731B', 2023, 1, true,  false, true,  true,  true],
    ['86420410', 'Xiaomi',  'Redmi', 'Redmi Note 13 Pro', '23117RA68G', 2024, 1, true, false, true, true, false],
    ['86420408', 'Xiaomi',  'Redmi', 'Redmi Note 12',      '23021RAAEG', 2023, 1, true, false, false, true, false],
    ['86420406', 'Xiaomi',  'Xiaomi','Xiaomi 14',          '2311DRK48G', 2024, 1, true, true,  true,  true, false],
    ['86420404', 'Xiaomi',  'Xiaomi','Xiaomi 13T',          '23077RABDC', 2023, 1, true, false, true, true, false],
    ['86420402', 'Xiaomi',  'POCO',  'POCO X6 5G',          '23122PCD1G', 2024, 1, true, false, true, true, false],
    ['86513015', 'OnePlus', 'OnePlus','OnePlus 12',         'CPH2581',    2024, 1, true, true,  true, true, true],
    ['86513013', 'OnePlus', 'OnePlus','OnePlus 11',         'CPH2447',    2023, 1, true, false, true, true, false],
    ['86513011', 'OnePlus', 'OnePlus','OnePlus Nord 3',     'CPH2493',    2023, 1, true, false, true, true, false],
    ['35790614', 'Google',  'Google','Pixel 8 Pro',         'GC3VE',      2023, 1, true, true,  true, true, true],
    ['35790612', 'Google',  'Google','Pixel 8',             'GKWS6',      2023, 1, true, true,  true, true, true],
    ['35790610', 'Google',  'Google','Pixel 7',             'GVU6C',      2022, 1, true, false, true, true, true],
    ['86012015', 'Realme',  'Realme','Realme 11 Pro+',      'RMX3741',    2023, 1, true, false, true, true, false],
    ['86012013', 'Realme',  'Realme','Realme GT Neo 5',     'RMX3706',    2023, 1, true, false, true, true, false],
    ['86012011', 'Realme',  'Realme','Realme Narzo 60',     'RMX3769',    2023, 1, true, false, true, true, false],
    ['86120115', 'OPPO',    'OPPO',  'OPPO Find X7 Ultra',  'PGV110',     2024, 1, true, true,  true, true, true],
    ['86120113', 'OPPO',    'OPPO',  'OPPO Reno 11 Pro',    'CPH2607',    2024, 1, true, false, true, true, false],
    ['86120111', 'OPPO',    'OPPO',  'OPPO A78',            'CPH2565',    2023, 1, true, false, false, true, false],
    ['86833510', 'Vivo',    'Vivo',  'Vivo X100 Pro',       'V2324A',     2024, 1, true, true,  true, true, true],
    ['86833508', 'Vivo',    'Vivo',  'Vivo V30 Pro',        'V2318',      2024, 1, true, false, true, true, false],
    ['86833506', 'Vivo',    'iQOO',  'iQOO Neo 9',          'V2335A',     2024, 1, true, false, true, true, false],
    ['35832611', 'Nothing', 'Nothing','Nothing Phone (2)',  'A065',       2023, 1, true, false, true, true, false],
    ['35832609', 'Nothing', 'Nothing','Nothing Phone (1)',  'A063',       2022, 1, true, false, false, true, false],
    ['35410420', 'Motorola','Moto',  'Edge 40 Neo',         'XT2307',     2023, 1, true, false, true, true, false],
    ['35410418', 'Motorola','Moto',  'G54 5G',              'XT2343',     2023, 1, true, false, true, true, false],
    ['35918620', 'Apple',   'Apple', 'iPad Pro 12.9 (6th)', 'A2764',      2022, 2, true, false, true, false, true],
    ['35918618', 'Apple',   'Apple', 'iPad Air (5th)',      'A2589',      2022, 2, true, false, true, false, true],
    ['86055010', 'Samsung', 'Samsung','Galaxy Tab S9',      'SM-X716B',   2023, 2, true, false, true, false, false],
    ['35400110', 'Apple',   'Apple',  'Apple Watch Series 9','A2982',     2023, 3, true, false, false, false, true],
    ['35400108', 'Samsung', 'Samsung','Galaxy Watch 6',     'SM-R940',    2023, 3, true, false, false, false, true],
    ['35100010', 'Huawei',  'Huawei', 'Huawei Router 5G CPE Pro 2', 'H312-371', 2022, 5, false, false, true, false, false],
    ['35100008', 'Netgear', 'Netgear','Netgear Nighthawk M6', 'MR6110',   2022, 5, false, false, true, false, false],
    ['35990010', 'Generic', 'Unknown','IoT Tracker',         'GP-TR-01',  2021, 4, false, false, false, false, false],
  ];
  const tacIds = {};
  for (const t of tacs) {
    const [tac, mfr, brand, marketing, model, year, ff, volte, vonr, g5, dual, esim] = t;
    const id = await L.createRecord(tacId, {
      [tacCols['TAC']]: tac,
      [tacCols['Manufacturer']]: mfr,
      [tacCols['Brand']]: brand,
      [tacCols['Marketing Name']]: marketing,
      [tacCols['Model']]: model,
      [tacCols['Release Year']]: year,
      [tacCols['Form Factor']]: [ff],
      [tacCols['VoLTE Support']]: volte,
      [tacCols['VoNR (5G Voice) Support']]: vonr,
      [tacCols['5G Support']]: g5,
      [tacCols['Dual SIM']]: dual,
      [tacCols['eSIM Support']]: esim,
      [tacCols['Status']]: [year < 2018 ? 2 : 1],
      [tacCols['Band Support']]: g5 ? '2G/3G/4G/5G' : volte ? '2G/3G/4G (VoLTE)' : '2G/3G/4G',
    });
    tacIds[tac] = { id, marketing, volte, g5 };
    await L.sleep(70);
  }
  console.log(`   ${Object.keys(tacIds).length} TACs seeded`);

  // ------------------------------------------------------------------
  // 8. Seed Devices (attach to all existing subs + some orphan devices)
  // ------------------------------------------------------------------
  console.log('\n8. Seeding Devices (attached to subs)...');
  const subs = await L.fetchAll(TABLE_IDS['Subscriptions']);
  // Get customer ref id on Subscriptions
  const subCustColId = subSchema.find(c => c.name === 'Customer').id;
  const subStatusColId = subSchema.find(c => c.name === 'Status').id;

  const deviceIds = [];
  const tacList = Object.entries(tacIds);
  // premium TACs for corporate/heavy users
  const premiumTacs = tacs.filter(t => t[0] >= '35737119' || t[0] === '35328115' || t[0] === '35328114').map(t => t[0]);
  const budgetTacs = tacs.filter(t => t[5] >= 2022 && t[6] === 1 && !premiumTacs.includes(t[0])).map(t => t[0]);

  for (const s of subs) {
    const status = (s.cells[subStatusColId] || [0])[0];
    if (status === 3) continue; // skip terminated
    const msisdn = s.cells[subMsisdnId];
    const customerIds = s.cells[subCustColId];
    const customerId = Array.isArray(customerIds) ? customerIds[0] : customerIds;
    if (!msisdn || !customerId) continue;

    // Pick TAC based on MSISDN / customer profile
    let tacChoice;
    if (msisdn === '919820123456') tacChoice = '35328115'; // Arjun — iPhone 15 Pro
    else if (msisdn === '919845678901') tacChoice = '35689009'; // Priya — Galaxy A54
    else if (msisdn === '919767890123') tacChoice = '35737120'; // Vikram — Galaxy S24 Ultra (B2B)
    else tacChoice = L.pick(Math.random() < 0.3 ? premiumTacs : budgetTacs);

    const imei = tacChoice + String(L.rand(1000000, 9999999)); // 8 + 7 = 15 digits
    const firstSeen = Date.now() - L.rand(30, 600) * 86400000;
    const lastSeen = Date.now() - L.rand(0, 24) * 3600000;
    const id = await L.createRecord(devId, {
      [devCols['Device Code']]: `DEV-${imei.slice(-8)}`,
      [devCols['IMEI']]: imei,
      [devCols['IMEISV']]: imei.slice(0, 14) + String(L.rand(1, 9)),
      [devCols['TAC']]: tacChoice,
      [devCols['Device TAC']]: [tacIds[tacChoice].id],
      [devCols['Owner']]: [customerId],
      [devCols['Current Subscription']]: [s._id],
      [devCols['First Seen']]: firstSeen,
      [devCols['Last Seen']]: lastSeen,
      [devCols['Status']]: [1], // Active
      [devCols['Is Fraud Flagged']]: false,
    });
    deviceIds.push({ id, imei, tac: tacChoice, subId: s._id, customerId });
    await L.sleep(70);

    // Update Subscription to point at this device
    await L.updateRecord(TABLE_IDS['Subscriptions'], s._id, { [subExt['Current Device']]: [id] });
    await L.sleep(50);
  }
  console.log(`   ${deviceIds.length} devices seeded + linked`);

  // Plus a few unattached devices (inventory / lost / stolen)
  console.log('\n   Adding 5 unattached/lost/stolen devices...');
  const extraStates = [
    { status: 'Lost',   tac: '35261211', note: 'Reported lost by customer; awaiting claim verification.' },
    { status: 'Stolen', tac: '35690111', note: 'Stolen at airport; police case filed.' },
    { status: 'Stolen', tac: '35790614', note: 'Device snatch; police case Patrakar-PS 2024/441.' },
    { status: 'Blocked',tac: '86420408', note: 'Blocked due to unpaid dues on associated account.' },
    { status: 'Idle',   tac: '35737119', note: 'New inventory — not yet issued to customer.' },
  ];
  const specialDevices = [];
  const statusMap = { 'Active':1,'Idle':2,'Lost':3,'Stolen':4,'Blocked':5,'Inactive':6,'Unknown':7 };
  for (const ex of extraStates) {
    const imei = ex.tac + String(L.rand(1000000, 9999999));
    const id = await L.createRecord(devId, {
      [devCols['Device Code']]: `DEV-${imei.slice(-8)}`,
      [devCols['IMEI']]: imei,
      [devCols['TAC']]: ex.tac,
      [devCols['Device TAC']]: [tacIds[ex.tac].id],
      [devCols['First Seen']]: Date.now() - L.rand(60, 400) * 86400000,
      [devCols['Last Seen']]: Date.now() - L.rand(1, 30) * 86400000,
      [devCols['Status']]: [statusMap[ex.status]],
      [devCols['Is Fraud Flagged']]: ex.status === 'Stolen',
      [devCols['Notes']]: ex.note,
    });
    specialDevices.push({ id, imei, status: ex.status, note: ex.note });
    await L.sleep(80);
  }
  console.log(`   ${specialDevices.length} special devices added`);

  // ------------------------------------------------------------------
  // 9. Seed EIR entries for the stolen/lost/blocked devices
  // ------------------------------------------------------------------
  console.log('\n9. Seeding EIR entries...');
  let eirCount = 0;
  for (const d of specialDevices) {
    if (!['Lost','Stolen','Blocked'].includes(d.status)) continue;
    const listType = d.status === 'Blocked' ? 2 : 1; // Blacklist for lost/stolen, Graylist for blocked
    const reasonMap = { 'Stolen':1, 'Lost':2, 'Blocked':5 };
    await L.createRecord(eirId, {
      [eirCols['EIR Code']]: `EIR-${d.imei.slice(-8)}`,
      [eirCols['IMEI']]: d.imei,
      [eirCols['Device']]: [d.id],
      [eirCols['List Type']]: [listType],
      [eirCols['Reason']]: [reasonMap[d.status]],
      [eirCols['Reported By']]: d.status === 'Blocked' ? 'billing.collections@operator' : 'customer via retail store',
      [eirCols['Reported At']]: Date.now() - L.rand(1, 90) * 86400000,
      [eirCols['Country of Report']]: 'India',
      [eirCols['Police Case Number']]: d.status === 'Stolen' ? 'FIR-' + L.rand(100, 999) + '/2026' : null,
      [eirCols['Status']]: [1],
      [eirCols['Notes']]: d.note,
    });
    eirCount++;
    await L.sleep(80);
  }
  console.log(`   ${eirCount} EIR entries seeded`);

  // ------------------------------------------------------------------
  // 10. Seed IMEI Change Events
  // ------------------------------------------------------------------
  console.log('\n10. Seeding IMEI change events...');
  // 1. Arjun upgraded iPhone (clean change, reviewed)
  // 2. Vikram changed device (clean, reviewed)
  // 3. A random sub had SUSPICIOUS change (rapid IMEI swap — fraud alert)
  const arjun = deviceIds.find(d => d.subId && subs.find(s => s._id === d.subId)?.cells[subMsisdnId] === '919820123456');
  const vikram = deviceIds.find(d => d.subId && subs.find(s => s._id === d.subId)?.cells[subMsisdnId] === '919767890123');
  const suspiciousSub = subs.find(s => !['919820123456','919845678901','919767890123'].includes(s.cells[subMsisdnId]) && (s.cells[subStatusColId] || [0])[0] === 1);
  const suspiciousDev = suspiciousSub ? deviceIds.find(d => d.subId === suspiciousSub._id) : null;

  const changeEvents = [];
  if (arjun) {
    const oldImei = '35261211' + String(L.rand(1000000, 9999999));
    changeEvents.push({
      subId: arjun.subId, oldImei, newImei: arjun.imei, newDeviceId: arjun.id,
      hoursAgo: 60 * 24, hoursBetween: 24 * 365, suspicious: false, review: 'Reviewed',
      notes: 'Annual device upgrade; customer moved from iPhone 14 Pro to iPhone 15 Pro.'
    });
  }
  if (vikram) {
    const oldImei = '35690111' + String(L.rand(1000000, 9999999));
    changeEvents.push({
      subId: vikram.subId, oldImei, newImei: vikram.imei, newDeviceId: vikram.id,
      hoursAgo: 15 * 24, hoursBetween: 24 * 180, suspicious: false, review: 'Reviewed',
      notes: 'Corporate device refresh — previous Samsung S23 handed back.'
    });
  }
  if (suspiciousDev) {
    const oldImei = '86012013' + String(L.rand(1000000, 9999999));
    changeEvents.push({
      subId: suspiciousDev.subId, oldImei, newImei: suspiciousDev.imei, newDeviceId: suspiciousDev.id,
      hoursAgo: 2, hoursBetween: 0.5, suspicious: true, review: 'Pending',
      notes: 'SIM moved to different device twice in under 30 minutes — possible SIM swap fraud. Under review.'
    });
  }

  const reviewMap = { 'Pending':1, 'Reviewed':2, 'Confirmed Fraud':3, 'Cleared':4, 'Escalated':5 };
  for (let i = 0; i < changeEvents.length; i++) {
    const e = changeEvents[i];
    await L.createRecord(imeiEvId, {
      [evCols['Event Code']]: `IME-${Date.now()}-${i+1}`,
      [evCols['Subscription']]: [e.subId],
      [evCols['Old IMEI']]: e.oldImei,
      [evCols['New IMEI']]: e.newImei,
      [evCols['New Device']]: [e.newDeviceId],
      [evCols['Changed At']]: Date.now() - e.hoursAgo * 3600000,
      [evCols['Hours Since Previous']]: e.hoursBetween,
      [evCols['Suspicious']]: e.suspicious,
      [evCols['Review Status']]: [reviewMap[e.review]],
      [evCols['Reviewed By']]: e.review === 'Reviewed' ? 'fraud.ops@operator' : null,
      [evCols['Reviewed At']]: e.review === 'Reviewed' ? Date.now() - (e.hoursAgo - 2) * 3600000 : null,
      [evCols['Resolution Notes']]: e.notes,
    });
    await L.sleep(80);
  }
  console.log(`   ${changeEvents.length} IMEI change events seeded`);

  // ------------------------------------------------------------------
  // 11. Add lookups + rollups
  // ------------------------------------------------------------------
  console.log('\n11. Adding lookups + rollups...');

  // Devices lookups
  await L.createColumns(devId, [
    L.lookupSpec('Make', 'Device TAC', devCols['Device TAC'], 'Manufacturer', tacCols['Manufacturer'], 'text'),
    L.lookupSpec('Model Name', 'Device TAC', devCols['Device TAC'], 'Marketing Name', tacCols['Marketing Name'], 'text'),
    L.lookupSpec('Supports VoLTE', 'Device TAC', devCols['Device TAC'], 'VoLTE Support', tacCols['VoLTE Support'], 'boolean'),
    L.lookupSpec('Supports 5G', 'Device TAC', devCols['Device TAC'], '5G Support', tacCols['5G Support'], 'boolean'),
    L.lookupSpec('Release Year', 'Device TAC', devCols['Device TAC'], 'Release Year', tacCols['Release Year'], 'number'),
  ]);

  // EIR lookups
  await L.createColumns(eirId, [
    L.lookupSpec('Device Status', 'Device', eirCols['Device'], 'Status', devCols['Status'], 'text'),
  ]);

  // IMEI Change Events lookups
  await L.createColumns(imeiEvId, [
    L.lookupSpec('MSISDN', 'Subscription', evCols['Subscription'], 'MSISDN', subMsisdnId, 'text'),
  ]);

  // Rollups on TAC Database (active device count per model)
  await L.createColumns(tacId, [
    L.rollupSpec('Active Devices', 'Devices', devId, devCols['Device TAC'], 'IMEI', devCols['IMEI'], 'COUNT'),
  ]);

  // Rollups on Devices (EIR blacklist count)
  await L.createColumns(devId, [
    L.rollupSpec('EIR Entries', 'Equipment Identity Register', eirId, eirCols['Device'], 'EIR Code', eirCols['EIR Code'], 'COUNT'),
  ]);

  // Rollups on Subscriptions
  await L.createColumns(TABLE_IDS['Subscriptions'], [
    L.rollupSpec('IMEI Change Count', 'IMEI Change Events', imeiEvId, evCols['Subscription'], 'Event Code', evCols['Event Code'], 'COUNT'),
  ]);

  // Rollups on Customers (device count)
  await L.createColumns(TABLE_IDS['Customers'], [
    L.rollupSpec('Device Count', 'Devices', devId, devCols['Owner'], 'Device Code', devCols['Device Code'], 'COUNT'),
  ]);

  // ------------------------------------------------------------------
  // 12. Trigger evaluation
  // ------------------------------------------------------------------
  console.log('\n12. Triggering evaluation...');
  await L.sleep(3000);
  for (const tid of [tacId, devId, eirId, imeiEvId, TABLE_IDS['Subscriptions'], TABLE_IDS['Customers']]) {
    const rows = await L.fetchAll(tid);
    await L.evalAllComputed(tid, rows.map(r => r._id));
  }
  console.log('   eval triggered across 6 tables');

  console.log('\n=== MODULE 2 COMPLETE ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
