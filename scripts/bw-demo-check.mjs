// BW DEMO-READINESS CHECK — run before every pitch.
// Validates: table fill, hero subscriber chain, cross-module rollups, custom pages.
// Reports ✓ / ✗ per check with a final score.

import * as L from './lib-common.mjs';
import fs from 'node:fs';
import path from 'node:path';

const TABLE_IDS = L.loadTableIds();
const CUSTOMERS = JSON.parse(fs.readFileSync(path.join(L.ROOT, '.bw-customers-ids.json'), 'utf8'));

async function cm(tn) {
  const cols = await L.getTableSchema(TABLE_IDS[tn]);
  return Object.fromEntries(cols.map(c => [c.name, c.id]));
}

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}  ${detail}`); failed++; failures.push(`${name}  ${detail}`); }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  b-mobile DEMO-READINESS CHECK');
  console.log('═══════════════════════════════════════════════════════');

  // ── Part A: Table fill — at least N records ──────────────────
  console.log('\nA. TABLE FILL (minimum record counts)');
  const minCounts = {
    'Customers': 20, 'Customer Identifications': 20,
    'Subscriptions': 20, 'Wallets': 20, 'Balances': 25, 'Devices': 20,
    'Roaming Partners': 30, 'Roaming Zones': 8, 'Roaming Rate Cards': 80,
    'Roaming Sessions': 3, 'TAP Records': 10,
    'Tariff Plans': 15, 'Channels': 8, 'Distribution Partners': 5,
    'Notification Templates': 8, 'MSISDN Pool': 50, 'SIM Inventory': 40,
    'Device TAC Database': 50, 'Network Elements': 5,
    'Recharges': 50, 'Wallet Transactions': 50,
    'Charging Sessions': 100, 'Usage Transactions': 300, 'Call Detail Records': 100,
    'Notifications Sent': 50, 'Customer Lifecycle Events': 15,
    'Number Auctions': 5, 'Number Change Events': 20,
    'IMEI Change Events': 2, 'Equipment Identity Register': 2,
    'Cases': 5, 'Promotion Redemptions': 5,
  };
  for (const [tn, min] of Object.entries(minCounts)) {
    if (!TABLE_IDS[tn]) { check(`${tn} table exists`, false, 'table missing'); continue; }
    const rows = await L.fetchAll(TABLE_IDS[tn]);
    check(`${tn.padEnd(32)} ≥ ${min}  (actual ${rows.length})`, rows.length >= min);
  }

  // ── Part B: Hero subscriber (Thabo Khumalo) chain ────────────
  console.log('\nB. HERO SUBSCRIBER CHAIN — Thabo Khumalo');
  const thabo = CUSTOMERS[0];
  const SUB = await cm('Subscriptions');
  const subs = await L.fetchAll(TABLE_IDS['Subscriptions']);
  const thaboSub = subs.find(s => s._id === thabo.subId);
  check('Thabo\'s subscription exists', !!thaboSub);
  if (thaboSub) {
    check(`MSISDN matches  (${thabo.msisdn})`, thaboSub.cells[SUB['MSISDN']] === thabo.msisdn);
    check('Customer Name lookup resolves',  thaboSub.cells[SUB['Customer Name']] === 'Thabo Khumalo');
    check('Plan Price lookup > 0',  (thaboSub.cells[SUB['Plan Price']] || 0) > 0);
    check('Total Initial Balance rollup > 0', (thaboSub.cells[SUB['Total Initial Balance']] || 0) > 0);
    check('Total Used Balance rollup > 0',   (thaboSub.cells[SUB['Total Used Balance']] || 0) > 0);
    check('UT Count rollup > 0',              (thaboSub.cells[SUB['UT Count']] || 0) > 0);
    check('Roaming Session Count = 2',        thaboSub.cells[SUB['Roaming Session Count']] === 2);
    check('Lifetime Roaming Charges > 0',     (thaboSub.cells[SUB['Lifetime Roaming Charges']] || 0) > 0);
    check('IMEI Change Count = 1',            thaboSub.cells[SUB['IMEI Change Count']] === 1);
    check('Current Device ref set',           !!thaboSub.cells[SUB['Current Device']]);
  }

  // ── Part C: Cross-module rollups ─────────────────────────────
  console.log('\nC. CROSS-MODULE ROLLUPS');
  const C = await cm('Customers');
  const custs = await L.fetchAll(TABLE_IDS['Customers']);
  const thaboCust = custs.find(c => c._id === thabo.customerId);
  if (thaboCust) {
    check('Customer.Subscription Count = 1', thaboCust.cells[C['Subscription Count']] === 1);
    check('Customer.Device Count = 1',        thaboCust.cells[C['Device Count']] === 1);
    check('Customer.Wallet Balance > 0',      (thaboCust.cells[C['Wallet Balance']] || 0) > 0);
  }

  const RP = await cm('Roaming Partners');
  const partners = await L.fetchAll(TABLE_IDS['Roaming Partners']);
  const activeSession = partners.filter(p => (p.cells[RP['Session Count']] || 0) > 0).length;
  check(`At least 3 partners with sessions (actual ${activeSession})`, activeSession >= 3);
  const topRev = Math.max(...partners.map(p => p.cells[RP['Total Roaming Revenue']] || 0));
  check(`Top partner revenue ≥ P500 (actual ${topRev})`, topRev >= 500);

  const RZ = await cm('Roaming Zones');
  const zones = await L.fetchAll(TABLE_IDS['Roaming Zones']);
  const sadc = zones.find(z => z.cells[RZ['Zone Code']] === 'SADC');
  check('SADC zone has session activity', sadc && (sadc.cells[RZ['Session Count']] || 0) > 0);

  const TAC = await cm('Device TAC Database');
  const tacs = await L.fetchAll(TABLE_IDS['Device TAC Database']);
  const tacsWithDevices = tacs.filter(t => (t.cells[TAC['Active Devices']] || 0) > 0).length;
  check(`TACs with ≥1 active device (actual ${tacsWithDevices})`, tacsWithDevices >= 15);

  // ── Part D: Data integrity ───────────────────────────────────
  console.log('\nD. DATA INTEGRITY');
  const BAL = await cm('Balances');
  const bals = await L.fetchAll(TABLE_IDS['Balances']);
  const badMath = bals.filter(b => {
    const i = b.cells[BAL['Initial Amount']] || 0;
    const u = b.cells[BAL['Used Amount']] || 0;
    const r = b.cells[BAL['Remaining Amount']];
    return u > i || (r != null && Math.abs((i - u) - r) > 0.01);
  });
  check(`All balances pass math sanity (Init − Used = Remaining)`, badMath.length === 0, `${badMath.length} broken`);

  const W = await cm('Wallets');
  const wallets = await L.fetchAll(TABLE_IDS['Wallets']);
  const negWallets = wallets.filter(w => (w.cells[W['Current Balance']] || 0) < 0);
  check('No negative wallet balances', negWallets.length === 0, `${negWallets.length} negative`);

  // ── Part E: BW-specific markers ──────────────────────────────
  console.log('\nE. BW-SPECIFIC MARKERS');
  // MSISDN prefix
  const allBwFormat = subs.every(s => /^267[7][1-7]/.test(s.cells[SUB['MSISDN']] || ''));
  check('All subscriptions use +267 MSISDN format', allBwFormat);

  // IMSI MCC 652
  const allBwImsi = subs.every(s => (s.cells[SUB['IMSI']] || '').startsWith('652'));
  check('All IMSIs start with 652 (Botswana MCC)', allBwImsi);

  // No Indian leftovers in customer names
  const NAMES_C = C['Name'];
  const noIndianNames = !custs.some(c => /Arjun|Priya|Vikram|Rohan Gupta/i.test(c.cells[NAMES_C] || ''));
  check('No Indian customer names remaining', noIndianNames);

  // TP prices in Pula range (P5-P349 realistic)
  const TP = await cm('Tariff Plans');
  const plans = await L.fetchAll(TABLE_IDS['Tariff Plans']);
  const paulaRange = plans.every(p => {
    const price = p.cells[TP['Price']] || 0;
    return price >= 2 && price <= 500;
  });
  check('Tariff plan prices in BW Pula range (P2-P500)', paulaRange);

  // Network Elements have *.btc.bw FQDNs
  const NE = await cm('Network Elements');
  const nes = await L.fetchAll(TABLE_IDS['Network Elements']);
  const bwFqdns = nes.every(n => (n.cells[NE['FQDN']] || '').endsWith('.btc.bw'));
  check('All Network Elements have btc.bw FQDNs', bwFqdns);

  // ── Part F: Custom pages respond ─────────────────────────────
  console.log('\nF. CUSTOM PAGES');
  const pageResp = await L.api('GET', `/v1/agent/app/custom-pages?appId=${L.APP_ID}`);
  const pages = pageResp.data?.response?.data || pageResp.data?.data || [];
  const requiredSlugs = ['roaming-dashboard','device-monitor','mnp-dashboard','customer-360','prepaid-customer-balances','cdr-settlement','usage-heatmap','telecom-overview'];
  for (const slug of requiredSlugs) {
    const p = pages.find(x => x.slug === slug);
    check(`Page "${slug}"`, !!p, p ? '' : 'MISSING');
  }

  // ── Final summary ────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  const total = passed + failed;
  const pct = ((passed / total) * 100).toFixed(0);
  console.log(`  RESULT: ${passed}/${total} passed (${pct}%)`);
  if (failed === 0) {
    console.log('  🟢 READY TO DEMO');
  } else if (failed <= 3) {
    console.log('  🟡 MOSTLY READY — minor issues:');
    for (const f of failures) console.log('    · ' + f);
  } else {
    console.log('  🔴 NOT READY — fix these first:');
    for (const f of failures) console.log('    · ' + f);
  }
  console.log('═══════════════════════════════════════════════════════\n');

  // Exit code reflects readiness
  process.exit(failed > 3 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
