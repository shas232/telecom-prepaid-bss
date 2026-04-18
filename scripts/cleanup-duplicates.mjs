// Delete stale/duplicate columns on Subscriptions + Balances.

import * as L from './lib-common.mjs';
const TABLE_IDS = L.loadTableIds();

async function deleteColIfExists(tname, colName) {
  const cols = await L.getTableSchema(TABLE_IDS[tname]);
  const c = cols.find(x => x.name === colName);
  if (!c) { console.log(`  (not found) ${tname}.${colName}`); return false; }
  const r = await L.api('DELETE', `/v1/app-builder/table/${TABLE_IDS[tname]}/column/${c.id}`);
  const ok = r.ok || r.data?.success;
  console.log(`  ${ok ? '✓' : '✗'} deleted ${tname}.${colName} (${c.id}, type=${c.type})`);
  return ok;
}

async function main() {
  console.log('=== CLEANUP DUPLICATE / STALE COLUMNS ===\n');

  console.log('1. Stale legacy numeric columns on Subscriptions:');
  await deleteColIfExists('Subscriptions', 'Data Remaining (MB)');
  await deleteColIfExists('Subscriptions', 'Voice Remaining (min)');
  await deleteColIfExists('Subscriptions', 'SMS Remaining');

  console.log('\n2. Dead DATEDIFF zombie columns on Subscriptions:');
  await deleteColIfExists('Subscriptions', 'Days Since Activation');
  await deleteColIfExists('Subscriptions', 'Days Since Last Usage');
  await deleteColIfExists('Subscriptions', 'Is Dormant');

  console.log('\n3. Dead DATEDIFF zombie columns on Balances:');
  await deleteColIfExists('Balances', 'Days Until Expiry');
  await deleteColIfExists('Balances', 'Days Active');
  await deleteColIfExists('Balances', 'Is Expired');

  console.log('\n4. Redundant rollup on Subscriptions (Total UT Usage duplicates Total Used Balance):');
  // Actually keep Total UT Usage — useful as a cross-check indicator.
  console.log('   (keeping Total UT Usage — valuable as cross-path validation rollup)');

  console.log('\n5. Also cleaning up the same DATEDIFF zombies wherever else they exist:');
  for (const [tn, col] of [
    ['Wallets', 'Days Since Last Recharge'],
    ['Wallets', 'Is Stale Wallet'],
    ['Cases', 'Resolution Days'],
    ['Cases', 'Days Open'],
    ['Customers', 'Days as Customer'],
    ['Customers', 'Revenue per Day'],
    ['Customers', 'ARPU (monthly est)'],
    ['Charging Sessions', 'Session Duration (days)'],
  ]) {
    await deleteColIfExists(tn, col);
  }

  console.log('\n=== DONE ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
