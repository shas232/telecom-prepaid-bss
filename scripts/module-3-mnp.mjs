// MODULE 3: Number Management & Migration — full-depth build

import * as L from './lib-common.mjs';
const TABLE_IDS = L.loadTableIds();

async function main() {
  console.log('=== MODULE 3: NUMBER MANAGEMENT & MIGRATION ===\n');

  // 1. Create tables
  console.log('1. Creating tables...');
  const mnpId = await L.createTable('MNP Requests', 'Mobile Number Portability — port-in/out requests with regulatory workflow.', 'ArrowLeftRight', 'Telecom', 'MNP Code', 'MNP');
  const recycleId = await L.createTable('Number Recycling Rules', 'Quarantine period + reactivation fee rules per tier.', 'Recycle', 'Telecom', 'Rule Code', 'RUL');
  const auctionId = await L.createTable('Number Auctions', 'Vanity / Gold / Platinum MSISDN auctions.', 'Gavel', 'Telecom', 'Auction Code', 'AUC');
  const changeId = await L.createTable('Number Change Events', 'Audit log of every MSISDN assign/release/port/recycle.', 'History', 'Telecom', 'Event Code', 'NCE');
  console.log(`   mnp=${mnpId} recycle=${recycleId} auction=${auctionId} change=${changeId}`);

  TABLE_IDS['MNP Requests'] = mnpId;
  TABLE_IDS['Number Recycling Rules'] = recycleId;
  TABLE_IDS['Number Auctions'] = auctionId;
  TABLE_IDS['Number Change Events'] = changeId;
  L.saveTableIds(TABLE_IDS);

  // Lookups we'll need
  const custSchema = await L.getTableSchema(TABLE_IDS['Customers']);
  const custNameId = custSchema.find(c => c.name === 'Name').id;
  const subSchema = await L.getTableSchema(TABLE_IDS['Subscriptions']);
  const subMsisdnId = subSchema.find(c => c.name === 'MSISDN').id;
  const mpSchema = await L.getTableSchema(TABLE_IDS['MSISDN Pool']);
  const mpMsisdnId = mpSchema.find(c => c.name === 'MSISDN').id;

  // 2. Columns on Number Recycling Rules (no deps)
  console.log('\n2. Recycling Rules columns...');
  const rcCols = await L.createColumns(recycleId, [
    { name: 'Rule Code', type: 'text', required: true, unique: true },
    L.selectSpec('Tier', ['Standard','Gold','Platinum','Vanity'], true),
    { name: 'Quarantine Days', type: 'number', required: true },
    { name: 'Reactivation Fee', type: 'number' },
    { name: 'Effective From', type: 'date' },
    L.selectSpec('Status', ['Draft','Active','Retired'], true),
    { name: 'Regulator Reference', type: 'text' },
    { name: 'Notes', type: 'long_text' },
  ]);
  console.log('   ' + Object.keys(rcCols).length + ' cols');

  // 3. Columns on MNP Requests
  console.log('\n3. MNP Requests columns...');
  const mnpCols = await L.createColumns(mnpId, [
    { name: 'MNP Code', type: 'text', required: true, unique: true },
    L.selectSpec('Type', ['Port In','Port Out'], true),
    { name: 'MSISDN', type: 'text', required: true },
    L.refSpec('Customer', TABLE_IDS['Customers'], custNameId),
    L.refSpec('Subscription', TABLE_IDS['Subscriptions'], subMsisdnId),
    { name: 'Donor Operator', type: 'text' },
    { name: 'Recipient Operator', type: 'text' },
    { name: 'UPC Code', type: 'text' },
    { name: 'Requested At', type: 'date', required: true },
    { name: 'Scheduled Cutover', type: 'date' },
    { name: 'Actual Cutover', type: 'date' },
    L.selectSpec('Status', ['Requested','UPC Validation','Donor Approved','Scheduled','In Cutover','Complete','Rejected','Cancelled'], true),
    L.selectSpec('Rejection Reason', ['None','Outstanding Dues','Contract Period Active','Invalid UPC','Fraud Check Failed','Regulator Denial','Customer Cancelled']),
    { name: 'SLA Days Remaining', type: 'number' },
    { name: 'Notes', type: 'long_text' },
  ]);
  console.log('   ' + Object.keys(mnpCols).length + ' cols');

  // 4. Columns on Number Auctions
  console.log('\n4. Number Auctions columns...');
  const auctCols = await L.createColumns(auctionId, [
    { name: 'Auction Code', type: 'text', required: true, unique: true },
    { name: 'MSISDN', type: 'text', required: true },
    L.refSpec('MSISDN Record', TABLE_IDS['MSISDN Pool'], mpMsisdnId),
    L.selectSpec('Tier', ['Gold','Platinum','Vanity'], true),
    { name: 'Reserve Price', type: 'number', required: true },
    { name: 'Current Bid', type: 'number' },
    L.refSpec('Highest Bidder', TABLE_IDS['Customers'], custNameId),
    { name: 'Bid Count', type: 'number' },
    { name: 'Start Date', type: 'date', required: true },
    { name: 'End Date', type: 'date', required: true },
    L.selectSpec('Status', ['Draft','Open','Closed','Sold','Withdrawn','Reserved'], true),
    L.refSpec('Winner', TABLE_IDS['Customers'], custNameId),
    { name: 'Sold Price', type: 'number' },
    { name: 'Notes', type: 'long_text' },
  ]);
  console.log('   ' + Object.keys(auctCols).length + ' cols');

  // 5. Columns on Number Change Events
  console.log('\n5. Number Change Events columns...');
  const chgCols = await L.createColumns(changeId, [
    { name: 'Event Code', type: 'text', required: true, unique: true },
    { name: 'MSISDN', type: 'text', required: true },
    L.refSpec('Old Subscription', TABLE_IDS['Subscriptions'], subMsisdnId),
    L.refSpec('New Subscription', TABLE_IDS['Subscriptions'], subMsisdnId),
    L.selectSpec('Change Type', ['Assign','Release','Port In','Port Out','Recycle','Swap','Quarantine','Reactivate'], true),
    { name: 'Changed At', type: 'date', required: true },
    { name: 'Changed By', type: 'text' },
    { name: 'Reason', type: 'text' },
    { name: 'Notes', type: 'long_text' },
  ]);
  console.log('   ' + Object.keys(chgCols).length + ' cols');

  // 6. Extend MSISDN Pool with Recycle After
  console.log('\n6. Extending MSISDN Pool with Recycle After...');
  const mpExt = await L.createColumns(TABLE_IDS['MSISDN Pool'], [
    { name: 'Recycle After', type: 'date' },
  ]);
  console.log('   added: ' + Object.keys(mpExt).join(', '));

  // 7. Seed Recycling Rules
  console.log('\n7. Seeding Recycling Rules...');
  const rules = [
    { code: 'RCY-STD-01',  tier: 1, days: 90,  fee: 0,    ref: 'TRAI MNP Reg 2009', notes: 'Standard quarantine before reassignment per TRAI.' },
    { code: 'RCY-GLD-01',  tier: 2, days: 180, fee: 100,  ref: 'Internal Policy',    notes: 'Gold-tier numbers held 6 months; reactivation ₹100.' },
    { code: 'RCY-PLT-01',  tier: 3, days: 270, fee: 500,  ref: 'Internal Policy',    notes: 'Platinum — 9 month hold, ₹500 reactivation.' },
    { code: 'RCY-VAN-01',  tier: 4, days: 365, fee: 2500, ref: 'Internal Policy',    notes: 'Vanity numbers — 1 year quarantine, ₹2500 reactivation.' },
  ];
  for (const r of rules) {
    await L.createRecord(recycleId, {
      [rcCols['Rule Code']]: r.code,
      [rcCols['Tier']]: [r.tier],
      [rcCols['Quarantine Days']]: r.days,
      [rcCols['Reactivation Fee']]: r.fee,
      [rcCols['Effective From']]: Date.now() - 365 * 86400000,
      [rcCols['Status']]: [2],
      [rcCols['Regulator Reference']]: r.ref,
      [rcCols['Notes']]: r.notes,
    });
    await L.sleep(80);
  }
  console.log(`   ${rules.length} rules seeded`);

  // 8. Seed MNP Requests (8 requests: 2 in-flight port-in, 2 in-flight port-out, 2 complete, 2 rejected)
  console.log('\n8. Seeding MNP Requests...');
  const customers = await L.fetchAll(TABLE_IDS['Customers']);
  const subs = await L.fetchAll(TABLE_IDS['Subscriptions']);
  const subByMsisdn = Object.fromEntries(subs.map(s => [s.cells[subMsisdnId], s._id]));

  const competitors = ['Airtel','Vi (Vodafone Idea)','Reliance Jio','BSNL','MTNL'];
  const mnpRecords = [
    // 2 Port-In (new customer joining us)
    { type: 1, msisdn: '919811223344', status: 1, daysAgo: 1, donor: 'Airtel',       upc: 'XYZ1234', scheduled: 5,  sla: 6, note: 'Port-in request received; UPC validation pending.' },
    { type: 1, msisdn: '919822334455', status: 4, daysAgo: 3, donor: 'Jio',          upc: 'ABC5678', scheduled: 1,  sla: 4, note: 'Donor approved; scheduled for cutover tomorrow.' },
    // 2 Port-Out (our customer leaving)
    { type: 2, msisdn: '919845678901', sub: subByMsisdn['919845678901'], status: 2, daysAgo: 2, recipient: 'Airtel',   upc: 'P123456', scheduled: 5,  sla: 5, note: 'Priya Nair port-out request; UPC issued, awaiting donor cutover.' },
    { type: 2, msisdn: '919813344556', status: 5, daysAgo: 1, recipient: 'Vi',       upc: 'P987654', scheduled: 0,  sla: 3, note: 'In cutover window — service will suspend in 2h.' },
    // 2 Complete
    { type: 1, msisdn: '919899001122', status: 6, daysAgo: 20, cutoverDaysAgo: 14, donor: 'BSNL',   upc: 'DEF1122', scheduled: 14, sla: 0, note: 'Port-in completed successfully.' },
    { type: 2, msisdn: '919888776655', status: 6, daysAgo: 45, cutoverDaysAgo: 38, recipient: 'Jio', upc: 'P334455', scheduled: 38, sla: 0, note: 'Port-out completed.' },
    // 2 Rejected / Cancelled
    { type: 1, msisdn: '919800112233', status: 7, rejection: 2, daysAgo: 7, donor: 'Airtel', upc: 'FAIL001', note: 'Port-in rejected: customer has outstanding dues with current operator.' },
    { type: 2, msisdn: '919877889900', status: 8, rejection: 7, daysAgo: 5, recipient: 'Jio', upc: 'CX9876', note: 'Customer cancelled port-out; wants to stay.' },
  ];

  for (let i = 0; i < mnpRecords.length; i++) {
    const r = mnpRecords[i];
    const requestedAt = Date.now() - r.daysAgo * 86400000;
    const scheduled = r.scheduled != null ? requestedAt + r.scheduled * 86400000 : null;
    const actualCutover = r.cutoverDaysAgo != null ? Date.now() - r.cutoverDaysAgo * 86400000 : null;
    await L.createRecord(mnpId, {
      [mnpCols['MNP Code']]: `MNP-${r.msisdn.slice(-6)}-${i+1}`,
      [mnpCols['Type']]: [r.type],
      [mnpCols['MSISDN']]: r.msisdn,
      ...(r.sub ? { [mnpCols['Subscription']]: [r.sub] } : {}),
      ...(r.type === 1 && customers.length ? { [mnpCols['Customer']]: [customers[i % customers.length]._id] } : {}),
      [mnpCols['Donor Operator']]: r.donor || null,
      [mnpCols['Recipient Operator']]: r.recipient || null,
      [mnpCols['UPC Code']]: r.upc,
      [mnpCols['Requested At']]: requestedAt,
      ...(scheduled ? { [mnpCols['Scheduled Cutover']]: scheduled } : {}),
      ...(actualCutover ? { [mnpCols['Actual Cutover']]: actualCutover } : {}),
      [mnpCols['Status']]: [r.status],
      ...(r.rejection ? { [mnpCols['Rejection Reason']]: [r.rejection] } : { [mnpCols['Rejection Reason']]: [1] }),
      [mnpCols['SLA Days Remaining']]: r.sla ?? 0,
      [mnpCols['Notes']]: r.note,
    });
    await L.sleep(80);
  }
  console.log(`   ${mnpRecords.length} MNP requests seeded`);

  // 9. Seed Number Auctions (6 auctions: 3 open, 2 sold, 1 withdrawn)
  console.log('\n9. Seeding Number Auctions...');
  // Find some vanity MSISDNs in the pool
  const mpRows = await L.fetchAll(TABLE_IDS['MSISDN Pool']);
  const mpTierColId = mpSchema.find(c => c.name === 'Tier')?.id;
  const mpStatusColId = mpSchema.find(c => c.name === 'Status')?.id;
  const vanityCandidates = mpRows.filter(r => {
    const tier = (r.cells[mpTierColId] || [0])[0];
    return tier >= 2; // Gold/Platinum/Vanity
  }).slice(0, 8);
  // If none, we'll use generated MSISDNs
  const auctionSpecs = [
    { msisdn: '919900000001', tier: 3, reserve: 50000, bid: 65000, count: 4, status: 2, endDays: -2, note: 'Triple-9 platinum; hot lot.' },
    { msisdn: '919999999988', tier: 3, reserve: 75000, bid: 110000, count: 7, status: 2, endDays: -1, note: 'Sextuple-9 prefix.' },
    { msisdn: '919811111111', tier: 3, reserve: 40000, bid: 0, count: 0, status: 2, endDays: 3, note: 'Repeated-1 pattern.' },
    { msisdn: '919808080808', tier: 2, reserve: 15000, bid: 22000, count: 5, status: 4, endDays: -10, note: 'Sold — 0808 repeat.' },
    { msisdn: '919876543210', tier: 2, reserve: 20000, bid: 28500, count: 6, status: 4, endDays: -20, note: 'Sold — descending ladder.' },
    { msisdn: '919786786786', tier: 4, reserve: 8000, bid: 0, count: 0, status: 5, endDays: -5, note: 'Withdrawn at seller request.' },
  ];

  for (let i = 0; i < auctionSpecs.length; i++) {
    const a = auctionSpecs[i];
    const startDate = Date.now() - 30 * 86400000;
    const endDate = Date.now() + a.endDays * 86400000;
    const statusName = ['Draft','Open','Closed','Sold','Withdrawn','Reserved'][a.status - 1];
    const isSold = a.status === 4;
    const winner = isSold ? customers[i % customers.length]._id : null;
    const bidder = a.bid > 0 && !isSold ? customers[(i+1) % customers.length]._id : null;
    await L.createRecord(auctionId, {
      [auctCols['Auction Code']]: `AUC-${a.msisdn.slice(-5)}-${i+1}`,
      [auctCols['MSISDN']]: a.msisdn,
      ...(vanityCandidates[i] ? { [auctCols['MSISDN Record']]: [vanityCandidates[i]._id] } : {}),
      [auctCols['Tier']]: [a.tier - 1], // 1-indexed select (Gold/Platinum/Vanity = 1/2/3 in our select)
      [auctCols['Reserve Price']]: a.reserve,
      [auctCols['Current Bid']]: a.bid || null,
      ...(bidder ? { [auctCols['Highest Bidder']]: [bidder] } : {}),
      [auctCols['Bid Count']]: a.count,
      [auctCols['Start Date']]: startDate,
      [auctCols['End Date']]: endDate,
      [auctCols['Status']]: [a.status],
      ...(winner ? { [auctCols['Winner']]: [winner] } : {}),
      ...(isSold ? { [auctCols['Sold Price']]: a.bid } : {}),
      [auctCols['Notes']]: a.note,
    });
    await L.sleep(80);
  }
  console.log(`   ${auctionSpecs.length} auctions seeded`);

  // 10. Seed Number Change Events (audit trail — 30 events)
  console.log('\n10. Seeding Number Change Events...');
  const changeTypes = ['Assign','Release','Port In','Port Out','Recycle','Swap','Quarantine','Reactivate'];
  const systemAgents = ['system','retail.ops@operator','csr.ops@operator','fraud.ops@operator','bot.provisioning'];
  let chgCount = 0;
  for (let i = 0; i < 30; i++) {
    const t = L.rand(1, 8);
    const daysAgo = L.rand(1, 200);
    const msisdn = '9198' + String(L.rand(10000000, 99999999));
    const ct = changeTypes[t - 1];
    const reason = {
      'Assign': 'Initial activation from pool.',
      'Release': 'Subscription terminated; MSISDN returned to pool.',
      'Port In': 'Customer ported from competitor.',
      'Port Out': 'Customer ported to competitor.',
      'Recycle': 'Quarantine period elapsed; number reassigned.',
      'Swap': 'SIM swap; MSISDN retained.',
      'Quarantine': 'Released number entered quarantine.',
      'Reactivate': 'Dormant number reactivated.',
    }[ct];
    await L.createRecord(changeId, {
      [chgCols['Event Code']]: `NCE-${Date.now()}-${i+1}`,
      [chgCols['MSISDN']]: msisdn,
      [chgCols['Change Type']]: [t],
      [chgCols['Changed At']]: Date.now() - daysAgo * 86400000,
      [chgCols['Changed By']]: L.pick(systemAgents),
      [chgCols['Reason']]: reason,
    });
    chgCount++;
    await L.sleep(50);
  }
  console.log(`   ${chgCount} change events seeded`);

  // 11. Add lookups + rollups
  console.log('\n11. Adding lookups + rollups...');

  // MNP lookups
  await L.createColumns(mnpId, [
    L.lookupSpec('Customer Name', 'Customer', mnpCols['Customer'], 'Name', custNameId, 'text'),
  ]);

  // Auction lookups
  await L.createColumns(auctionId, [
    L.lookupSpec('Winner Name', 'Winner', auctCols['Winner'], 'Name', custNameId, 'text'),
    L.formulaSpec('Bid Premium %',
      'IF(${Reserve Price} > 0, (${Current Bid} - ${Reserve Price}) / ${Reserve Price} * 100, 0)',
      { 'Current Bid': [auctCols['Current Bid']], 'Reserve Price': [auctCols['Reserve Price']] },
      'number'),
  ]);

  // Rollup on Customers: MNP count, Auction wins
  await L.createColumns(TABLE_IDS['Customers'], [
    L.rollupSpec('MNP Request Count', 'MNP Requests', mnpId, mnpCols['Customer'], 'MNP Code', mnpCols['MNP Code'], 'COUNT'),
    L.rollupSpec('Auction Wins', 'Number Auctions', auctionId, auctCols['Winner'], 'Auction Code', auctCols['Auction Code'], 'COUNT'),
    L.rollupSpec('Auction Spend', 'Number Auctions', auctionId, auctCols['Winner'], 'Sold Price', auctCols['Sold Price'], 'SUM'),
  ]);

  // Rollup on Subscriptions: port-out attempts
  await L.createColumns(TABLE_IDS['Subscriptions'], [
    L.rollupSpec('MNP Request Count', 'MNP Requests', mnpId, mnpCols['Subscription'], 'MNP Code', mnpCols['MNP Code'], 'COUNT'),
  ]);

  // 12. Trigger evaluation
  console.log('\n12. Triggering evaluation...');
  await L.sleep(3000);
  for (const tid of [mnpId, recycleId, auctionId, changeId, TABLE_IDS['Customers'], TABLE_IDS['Subscriptions']]) {
    const rows = await L.fetchAll(tid);
    await L.evalAllComputed(tid, rows.map(r => r._id));
  }
  console.log('   eval triggered across 6 tables');

  console.log('\n=== MODULE 3 COMPLETE ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
