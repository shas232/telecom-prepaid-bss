// BW re-skin Phase 1: wipe all transactional + identity + catalog data.
// Preserves: schema (tables/columns), Device TAC Database, Number Recycling Rules,
// Network Elements (will re-seed with BW MCC/MNC later).

import * as L from './lib-common.mjs';
const TABLE_IDS = L.loadTableIds();

// Order = child-first. Anything NOT in this list stays untouched.
const WIPE_ORDER = [
  // Charging / usage chain (children first)
  'Usage Transactions',
  'Call Detail Records',
  'Charging Sessions',
  // Money
  'Wallet Transactions',
  'Recharges',
  'Partner Commissions',
  // Promotions / bonuses
  'Bonus Grants',
  'Balance Transfers',
  'Promotion Redemptions',
  // Customer activity
  'Customer Interactions',
  'Customer Lifecycle Events',
  'Cases',
  'Notifications Sent',
  // Orders
  'Order Items',
  'Orders',
  // Allowance
  'Balances',
  // Roaming
  'Roaming Sessions',
  'TAP Records',
  'Roaming Rate Cards',
  // Devices (keep TAC DB, Network Elements)
  'IMEI Change Events',
  'Equipment Identity Register',
  'Devices',
  // MNP (keep Rules)
  'Number Change Events',
  'Number Auctions',
  'MNP Requests',
  // Roaming top-level (after children cleaned)
  'Roaming Partners',
  'Roaming Zones',
  // Identity (children first)
  'Subscription Status History',
  'FF Members',
  'CUG Members',
  'Friends and Family Groups',
  'Closed User Groups',
  'Account Hierarchy',
  'Subscriptions',
  'Customer Identifications',
  'Wallets',
  'Customers',
  // Catalog
  'Bundle Components',
  'Bundles',
  'Tariff Plans',
  'Promotions',
  'Business Rules',
  'Services',
  // Inventory
  'SIM Inventory',
  'MSISDN Pool',
  'Recharge Vouchers',
  // Partner / channel
  'Partner Contracts',
  'Distribution Partners',
  'Channels',
  'Notification Templates',
];

// Preserve list (explicit — safety net)
const PRESERVE = new Set([
  'Device TAC Database',
  'Network Elements',
  'Number Recycling Rules',
  'Users',
]);

async function main() {
  console.log('=== BW WIPE — Phase 1 ===\n');
  console.log('Preserving: ' + [...PRESERVE].join(', '));
  console.log('Wiping: ' + WIPE_ORDER.length + ' tables\n');

  let totalDeleted = 0;
  for (const tn of WIPE_ORDER) {
    if (!TABLE_IDS[tn]) { console.log(`  skip (missing): ${tn}`); continue; }
    if (PRESERVE.has(tn)) { console.log(`  skip (preserve): ${tn}`); continue; }
    const rows = await L.fetchAll(TABLE_IDS[tn]);
    if (!rows.length) { console.log(`  ${tn}: already empty`); continue; }
    process.stdout.write(`  ${tn}: deleting ${rows.length}... `);
    let ok = 0;
    for (const r of rows) {
      const res = await L.api('DELETE', `/v1/app-builder/table/${TABLE_IDS[tn]}/record/${r._id}`);
      if (res.ok || res.data?.success) ok++;
      await L.sleep(40);
    }
    console.log(`${ok}/${rows.length} ✓`);
    totalDeleted += ok;
  }

  console.log(`\n=== WIPE COMPLETE: ${totalDeleted} records deleted ===`);

  // Verify
  console.log('\n=== Verification ===');
  for (const tn of WIPE_ORDER) {
    if (!TABLE_IDS[tn] || PRESERVE.has(tn)) continue;
    const rows = await L.fetchAll(TABLE_IDS[tn]);
    if (rows.length) console.log(`  ⚠  ${tn}: still has ${rows.length} rows`);
  }
  console.log('done');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
