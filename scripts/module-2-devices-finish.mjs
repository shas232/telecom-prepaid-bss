// Finish Module 2: just add lookups + rollups (tables, columns, records already created).

import * as L from './lib-common.mjs';
const TABLE_IDS = L.loadTableIds();

async function colId(tname, name) {
  const cols = await L.getTableSchema(TABLE_IDS[tname]);
  return cols.find(c => c.name === name)?.id;
}

async function main() {
  const tacId = TABLE_IDS['Device TAC Database'];
  const devId = TABLE_IDS['Devices'];
  const eirId = TABLE_IDS['Equipment Identity Register'];
  const imeiEvId = TABLE_IDS['IMEI Change Events'];

  const devTacRefId = await colId('Devices', 'Device TAC');
  const devImeiColId = await colId('Devices', 'IMEI');
  const devCodeColId = await colId('Devices', 'Device Code');
  const devOwnerColId = await colId('Devices', 'Owner');
  const devStatusColId = await colId('Devices', 'Status');
  const tacMfrColId = await colId('Device TAC Database', 'Manufacturer');
  const tacMarketingColId = await colId('Device TAC Database', 'Marketing Name');
  const tacVolteColId = await colId('Device TAC Database', 'VoLTE Support');
  const tac5gColId = await colId('Device TAC Database', '5G Support');
  const tacYearColId = await colId('Device TAC Database', 'Release Year');
  const eirDeviceRefId = await colId('Equipment Identity Register', 'Device');
  const eirCodeColId = await colId('Equipment Identity Register', 'EIR Code');
  const evSubRefId = await colId('IMEI Change Events', 'Subscription');
  const evEventCodeColId = await colId('IMEI Change Events', 'Event Code');
  const subMsisdnId = await colId('Subscriptions', 'MSISDN');

  console.log('Adding Devices lookups...');
  await L.createColumns(devId, [
    L.lookupSpec('Make', 'Device TAC', devTacRefId, 'Manufacturer', tacMfrColId, 'text'),
    L.lookupSpec('Model Name', 'Device TAC', devTacRefId, 'Marketing Name', tacMarketingColId, 'text'),
    L.lookupSpec('Supports VoLTE', 'Device TAC', devTacRefId, 'VoLTE Support', tacVolteColId, 'boolean'),
    L.lookupSpec('Supports 5G', 'Device TAC', devTacRefId, '5G Support', tac5gColId, 'boolean'),
    L.lookupSpec('Release Year', 'Device TAC', devTacRefId, 'Release Year', tacYearColId, 'number'),
  ]);

  console.log('Adding EIR lookups...');
  await L.createColumns(eirId, [
    L.lookupSpec('Device Status', 'Device', eirDeviceRefId, 'Status', devStatusColId, 'text'),
  ]);

  console.log('Adding IMEI Change Events lookups...');
  await L.createColumns(imeiEvId, [
    L.lookupSpec('MSISDN', 'Subscription', evSubRefId, 'MSISDN', subMsisdnId, 'text'),
  ]);

  console.log('Adding TAC rollup (Active Devices)...');
  await L.createColumns(tacId, [
    L.rollupSpec('Active Devices', 'Devices', devId, devTacRefId, 'IMEI', devImeiColId, 'COUNT'),
  ]);

  console.log('Adding Devices rollup (EIR Entries)...');
  await L.createColumns(devId, [
    L.rollupSpec('EIR Entries', 'Equipment Identity Register', eirId, eirDeviceRefId, 'EIR Code', eirCodeColId, 'COUNT'),
  ]);

  console.log('Adding Subscriptions rollup (IMEI Change Count)...');
  await L.createColumns(TABLE_IDS['Subscriptions'], [
    L.rollupSpec('IMEI Change Count', 'IMEI Change Events', imeiEvId, evSubRefId, 'Event Code', evEventCodeColId, 'COUNT'),
  ]);

  console.log('Adding Customers rollup (Device Count)...');
  await L.createColumns(TABLE_IDS['Customers'], [
    L.rollupSpec('Device Count', 'Devices', devId, devOwnerColId, 'Device Code', devCodeColId, 'COUNT'),
  ]);

  console.log('Triggering evaluation...');
  await L.sleep(3000);
  for (const tid of [tacId, devId, eirId, imeiEvId, TABLE_IDS['Subscriptions'], TABLE_IDS['Customers']]) {
    const rows = await L.fetchAll(tid);
    await L.evalAllComputed(tid, rows.map(r => r._id));
  }

  console.log('\n=== MODULE 2 FINISH COMPLETE ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
