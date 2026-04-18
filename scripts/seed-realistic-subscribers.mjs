// Seed 3 realistic prepaid telecom subscribers with full billing history.
// Each subscriber gets: Customer → Wallet → Subscription → 3 Balances →
// multiple Charging Sessions → Usage Transactions across data/voice/SMS →
// Recharges + Wallet Transactions. Data is realistic Indian prepaid telecom.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://api.erpai.studio';
const TOKEN = 'erp_pat_live_REDACTED';
const APP_ID = 'afe8c4540708da6ca9e6fe79';
const TABLE_IDS = JSON.parse(fs.readFileSync(path.join(ROOT, '.table-ids.json'), 'utf8'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  for (let i = 0; i < 5; i++) {
    const res = await fetch(BASE_URL + url, opts);
    const txt = await res.text();
    let data; try { data = JSON.parse(txt); } catch { data = { raw: txt, status: res.status }; }
    if (res.status === 429) { await sleep(2000); continue; }
    return { ok: res.ok, status: res.status, data };
  }
}

async function createRecord(tname, cells) {
  const r = await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/record`, { cells });
  const id = r.data?.id || r.data?.data?.[0]?._id;
  if (!r.data?.success || !id) {
    throw new Error(`Create ${tname} failed: ${JSON.stringify(r.data).slice(0, 400)}`);
  }
  return id;
}

async function deleteRecord(tname, id) {
  await api('DELETE', `/v1/app-builder/table/${TABLE_IDS[tname]}/record/${id}`);
}

async function evalAllComputed(tname, ids) {
  const t = await api('GET', `/v1/app-builder/table/${TABLE_IDS[tname]}`);
  const cols = (t.data.columnsMetaData || []).filter(c => c.type === 'formula' || c.type === 'rollup');
  for (const c of cols) {
    await api('POST', `/v1/app-builder/table/${TABLE_IDS[tname]}/evaluate/${c.id}?appId=${APP_ID}`, {
      sessionId: `seed-${c.id}-${Date.now()}`, filter: { ids },
    });
    await sleep(300);
  }
}

// Clean up prior E2E-TEST records if they exist
async function cleanupPriorTest() {
  const oldFile = path.join(ROOT, '.e2e-test-result.json');
  if (!fs.existsSync(oldFile)) return;
  const prev = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
  console.log(`Cleaning up prior E2E-TEST (${prev.tag})...`);
  const c = prev.created || {};
  // Delete children first
  for (const u of (c.utIds || [])) await deleteRecord('Usage Transactions', u);
  if (c.wtxId) await deleteRecord('Wallet Transactions', c.wtxId);
  if (c.rechargeId) await deleteRecord('Recharges', c.rechargeId);
  if (c.chargingSessionId) await deleteRecord('Charging Sessions', c.chargingSessionId);
  for (const b of [c.balDataId, c.balVoiceId, c.balSmsId]) if (b) await deleteRecord('Balances', b);
  if (c.subscriptionId) await deleteRecord('Subscriptions', c.subscriptionId);
  if (c.walletId) await deleteRecord('Wallets', c.walletId);
  if (c.customerId) await deleteRecord('Customers', c.customerId);
  console.log('  cleanup done.');
  // Also clean up the one-off DEBUG-CREATE customer
  const custRows = (await api('POST', `/v1/app-builder/table/${TABLE_IDS['Customers']}/paged-record?pageNo=1&pageSize=300`, {})).data.data || [];
  for (const r of custRows) {
    if (r.cells['YbBh']?.startsWith('DEBUG-CREATE-')) {
      await deleteRecord('Customers', r._id);
      console.log(`  deleted debug customer ${r._id}`);
    }
  }
}

// Realistic Indian prepaid subscriber definitions
const SUBSCRIBERS = [
  {
    name: 'Arjun Sharma',
    email: 'arjun.sharma@gmail.com',
    phone: '919820123456',   // Mumbai
    msisdn: '919820123456',
    iccid: '8991012098201234561',
    imsi: '404689820123456',
    city: 'Mumbai',
    segment: 1, customerType: 1, language: 1, kycStatus: 3,
    onboardedDaysAgo: 240,   // long-time customer
    activatedDaysAgo: 12,    // current cycle
    wallet: { walletCode: 'WLT-ARJUN-001', startBalance: 185, lifetimeRecharge: 2850, lifetimeSpend: 2665 },
    profile: 'heavy_data',
    // usage pattern — heavy streaming user
    dataUsedMB: 34500,       // 67% of 51200
    voiceUsedMin: 145,
    smsUsed: 28,
    // sessions to synthesize
    sessions: 18,
    smsEvents: 12,
    recharges: [ { daysAgo: 12, amount: 50, channel: 2 }, { daysAgo: 6, amount: 30, channel: 1 } ],
  },
  {
    name: 'Priya Nair',
    email: 'priya.nair@outlook.com',
    phone: '919845678901',   // Bengaluru
    msisdn: '919845678901',
    iccid: '8991012098456789011',
    imsi: '404689845678901',
    city: 'Bengaluru',
    segment: 1, customerType: 1, language: 1, kycStatus: 3,
    onboardedDaysAgo: 95,
    activatedDaysAgo: 5,
    wallet: { walletCode: 'WLT-PRIYA-001', startBalance: 220, lifetimeRecharge: 420, lifetimeSpend: 200 },
    profile: 'light_user',
    dataUsedMB: 3200,        // 6%
    voiceUsedMin: 52,
    smsUsed: 8,
    sessions: 6,
    smsEvents: 4,
    recharges: [ { daysAgo: 5, amount: 30, channel: 4 } ],
  },
  {
    name: 'Vikram Iyer',
    email: 'vikram.iyer@yahoo.com',
    phone: '919767890123',   // Pune
    msisdn: '919767890123',
    iccid: '8991012097678901231',
    imsi: '404689767890123',
    city: 'Pune',
    segment: 2, customerType: 2, language: 1, kycStatus: 3,  // enterprise segment
    onboardedDaysAgo: 400,
    activatedDaysAgo: 18,
    wallet: { walletCode: 'WLT-VIKRAM-001', startBalance: 95, lifetimeRecharge: 4200, lifetimeSpend: 4105 },
    profile: 'voice_heavy',
    dataUsedMB: 12800,
    voiceUsedMin: 4650,      // heavy voice B2B
    smsUsed: 195,
    sessions: 42,
    smsEvents: 35,
    recharges: [ { daysAgo: 18, amount: 100, channel: 3 }, { daysAgo: 4, amount: 50, channel: 1 } ],
  },
];

// Distribute a total amount across N sessions with realistic per-session skew
function distribute(total, count, skew = 1.5) {
  if (count === 0 || total === 0) return [];
  // random weights, then normalize
  const weights = Array.from({ length: count }, (_, i) => Math.pow(Math.random() + 0.3, skew));
  const sum = weights.reduce((a, b) => a + b, 0);
  const amounts = weights.map(w => Math.round((w / sum) * total));
  // fix rounding drift
  const diff = total - amounts.reduce((a, b) => a + b, 0);
  amounts[0] += diff;
  return amounts.map(a => Math.max(1, a));
}

async function main() {
  await cleanupPriorTest();

  console.log('\n=== Seeding 3 realistic subscribers ===');
  const tp = await api('POST', `/v1/app-builder/table/${TABLE_IDS['Tariff Plans']}/paged-record?pageNo=1&pageSize=50`, {});
  const plan = (tp.data.data || []).find(p => p.cells['kSbg'] === 'Unlimited Monthly Pack');
  if (!plan) throw new Error('Plan not found');
  console.log(`Using plan: ${plan.cells['kSbg']} (₹${plan.cells['WZ99']}, ${plan.cells['vqEa']}d, ${plan.cells['43Sg']}MB data)`);

  const allCreated = [];

  for (const sub of SUBSCRIBERS) {
    console.log(`\n--- ${sub.name} (${sub.msisdn}) ---`);
    const nowMs = Date.now();
    const onboardedMs = nowMs - sub.onboardedDaysAgo * 86400_000;
    const activatedMs = nowMs - sub.activatedDaysAgo * 86400_000;
    const cycleStart = activatedMs;
    const cycleEnd = activatedMs + plan.cells['vqEa'] * 86400_000;

    // Customer
    const customerId = await createRecord('Customers', {
      YbBh: sub.name, sRZy: sub.email, VEX7: sub.phone,
      FdTq: [sub.segment], JU45: [sub.language],
      VdLL: [sub.customerType], yqnJ: [sub.kycStatus],
      EtsP: onboardedMs, jhdQ: [1],
    });
    console.log(`  customer ${customerId}`);

    // Wallet
    const walletId = await createRecord('Wallets', {
      MjRH: sub.wallet.walletCode, DoVS: [customerId],
      PEUU: sub.wallet.startBalance, VHn9: [1], Co33: [1],
      aj2c: nowMs - 1000 * 60 * 60 * 24 * sub.recharges[sub.recharges.length-1].daysAgo,
      GkdW: nowMs - 1000 * 60 * 60 * 6,
      zOPP: sub.wallet.lifetimeRecharge, QGjX: sub.wallet.lifetimeSpend,
    });
    console.log(`  wallet ${walletId} (₹${sub.wallet.startBalance})`);

    // Subscription
    const subId = await createRecord('Subscriptions', {
      sDya: sub.msisdn, s8jx: sub.iccid, '3O7g': sub.imsi,
      hq2e: 'internet', UupI: [3], '8sK7': false, gLpn: 'Home',
      Ov5X: activatedMs, BFCp: [1],
      c6QN: [customerId], vudt: [plan._id],
      '1Gy9': plan.cells['43Sg'] - sub.dataUsedMB,
      sIqm: plan.cells['CAnm'] - sub.voiceUsedMin,
      HIXG: plan.cells['ALxp'] - sub.smsUsed,
      QPEC: nowMs - 1000 * 60 * 30,
    });
    console.log(`  subscription ${subId} MSISDN=${sub.msisdn}`);

    // 3 Balances
    const balDataId = await createRecord('Balances', {
      ucLa: `BAL-DATA-${sub.msisdn}`, o4qw: cycleStart, VrcT: [1], DXPX: cycleEnd,
      Esuj: [1], aGu1: plan.cells['43Sg'], dOSd: 10, g3QJ: 'data_main', yutm: [1],
      yw1p: [subId], '1hH7': [plan._id], zlob: cycleStart, GVKg: cycleEnd,
      '42E9': plan.cells['WZ99'], uhlG: [1],
    });
    const balVoiceId = await createRecord('Balances', {
      ucLa: `BAL-VOICE-${sub.msisdn}`, o4qw: cycleStart, VrcT: [1], DXPX: cycleEnd,
      Esuj: [2], aGu1: plan.cells['CAnm'], dOSd: 20, g3QJ: 'voice_unlimited', yutm: [2],
      yw1p: [subId], '1hH7': [plan._id], zlob: cycleStart, GVKg: cycleEnd, '42E9': 0, uhlG: [1],
    });
    const balSmsId = await createRecord('Balances', {
      ucLa: `BAL-SMS-${sub.msisdn}`, o4qw: cycleStart, VrcT: [1], DXPX: cycleEnd,
      Esuj: [3], aGu1: plan.cells['ALxp'], dOSd: 30, g3QJ: 'sms_pack', yutm: [3],
      yw1p: [subId], '1hH7': [plan._id], zlob: cycleStart, GVKg: cycleEnd, '42E9': 0, uhlG: [1],
    });
    console.log(`  balances: data=${balDataId.slice(0,8)} voice=${balVoiceId.slice(0,8)} sms=${balSmsId.slice(0,8)}`);

    // Recharges + Wallet Transactions
    const rechargeIds = [];
    for (let ri = 0; ri < sub.recharges.length; ri++) {
      const rch = sub.recharges[ri];
      const ts = nowMs - rch.daysAgo * 86400_000;
      const rechargeId = await createRecord('Recharges', {
        UhkZ: `RCH-${sub.msisdn}-${ri+1}`,
        Y39a: rch.amount, WzsW: [1], cqLl: [rch.channel], MMab: [1],
        UG1r: ts, fa5r: [walletId],
        xw3H: Math.round(rch.amount * 0.1), Qxij: Math.round(rch.amount * 0.9),
        tKyH: `GW-${sub.msisdn}-${ri+1}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      });
      rechargeIds.push(rechargeId);
      // Matching wallet transaction (credit)
      await createRecord('Wallet Transactions', {
        '93aU': `WTX-RCH-${sub.msisdn}-${ri+1}`, '8n2I': rch.amount,
        ajVy: ts, FT69: [1],   // credit
        YBNC: [1], mqMb: rechargeId,
        jNFT: sub.wallet.startBalance - rch.amount + (ri === 0 ? 0 : 0),
        '1Hc4': sub.wallet.startBalance,
        NyKH: 'recharge_gateway', uw5l: `Recharge ${rch.amount} via ${rch.channel === 1 ? 'retail' : rch.channel === 2 ? 'app' : rch.channel === 3 ? 'USSD' : 'bank'}`,
        '2yFo': [walletId],
      });
    }
    // Plan purchase debit
    await createRecord('Wallet Transactions', {
      '93aU': `WTX-PLAN-${sub.msisdn}`, '8n2I': -plan.cells['WZ99'],
      ajVy: activatedMs, FT69: [2],   // debit
      YBNC: [2], mqMb: subId,
      jNFT: sub.wallet.startBalance + plan.cells['WZ99'],
      '1Hc4': sub.wallet.startBalance,
      NyKH: 'system', uw5l: `Plan activation: ${plan.cells['kSbg']}`,
      '2yFo': [walletId],
    });
    console.log(`  ${sub.recharges.length} recharges + plan debit wallet-txns created`);

    // Charging Sessions + Usage Transactions
    // Distribute data usage across `sessions` sessions, voice across half, SMS as individual events
    const dataPerSession = distribute(sub.dataUsedMB, sub.sessions);
    const voicePerSession = distribute(sub.voiceUsedMin, Math.ceil(sub.sessions / 2));
    const smsPerEvent = Array.from({ length: sub.smsEvents }, () => Math.round(sub.smsUsed / sub.smsEvents));
    // Fix SMS rounding
    const smsDiff = sub.smsUsed - smsPerEvent.reduce((a, b) => a + b, 0);
    if (smsPerEvent.length) smsPerEvent[0] = Math.max(1, smsPerEvent[0] + smsDiff);

    let sessionCount = 0;
    const utIds = [];
    const sessionIds = [];

    // Data sessions
    for (let i = 0; i < dataPerSession.length; i++) {
      const usedMB = dataPerSession[i];
      const sessionStart = Math.round(activatedMs + (i / dataPerSession.length) * (nowMs - activatedMs) + Math.random() * 60_000);
      const durationS = 120 + Math.round(Math.random() * 1200);
      const sessionEnd = sessionStart + durationS * 1000;
      const sessionId = await createRecord('Charging Sessions', {
        DCM8: `SESS-D-${sub.msisdn}-${i+1}`,
        y3qX: sessionStart, PHIm: sessionEnd, KQuF: [2],
        '4WcR': [1], tmDp: sub.msisdn, wypP: ['netflix.com','youtube.com','instagram.com','spotify.com','whatsapp.net'][i % 5],
        cnsm: [1], '1hHe': [subId], kM4Z: 'internet', UPL8: [1],
        XMVJ: Math.ceil(usedMB / 500) + 1,
        '6eUa': [1], mQLP: usedMB, ySwc: 0,
        y5bW: `LAC${Math.floor(Math.random() * 9000 + 1000)}-CI${Math.floor(Math.random() * 9000 + 1000)}`,
      });
      sessionIds.push(sessionId);
      sessionCount++;

      // Break each session into 2–4 UTs (CCR-I, CCR-U..., CCR-T)
      const nChunks = Math.min(4, Math.max(2, Math.round(usedMB / 250)));
      const chunks = distribute(usedMB, nChunks);
      for (let k = 0; k < chunks.length; k++) {
        const kind = k === 0 ? 1 : k === chunks.length - 1 ? 3 : 2;   // CCR-I / CCR-U / CCR-T
        const utId = await createRecord('Usage Transactions', {
          I5xQ: Math.round(sessionStart + (k / chunks.length) * durationS * 1000),
          AjeI: [kind], xuuQ: 10, cer4: 1,
          '0RM2': chunks[k], i7OF: chunks[k], umgX: chunks[k],
          hmd1: 600, RC5Q: 2001, HtGT: [1],
          Fpuq: chunks[k] * 524288, ZUn1: chunks[k] * 524288,
          idrW: Math.round(durationS / chunks.length), Rdyh: k + 1,
          dbQH: sub.msisdn, R6Dj: '*', e7tD: 'internet', HwNc: [1],
          Beg1: [sessionId], ZaUH: [subId], '2DAb': [balDataId],
        });
        utIds.push(utId);
      }
    }

    // Voice sessions
    for (let i = 0; i < voicePerSession.length; i++) {
      const usedMin = voicePerSession[i];
      const sessionStart = Math.round(activatedMs + (i / voicePerSession.length) * (nowMs - activatedMs) + Math.random() * 60_000);
      const durationS = usedMin * 60 + Math.round(Math.random() * 30);
      const sessionEnd = sessionStart + durationS * 1000;
      const calledMsisdns = ['919876543210','919723456789','919812345678','911122334455','919898765432'];
      const sessionId = await createRecord('Charging Sessions', {
        DCM8: `SESS-V-${sub.msisdn}-${i+1}`,
        y3qX: sessionStart, PHIm: sessionEnd, KQuF: [2],
        '4WcR': [2], tmDp: sub.msisdn, wypP: calledMsisdns[i % calledMsisdns.length],
        cnsm: [2], '1hHe': [subId], UPL8: [1],
        XMVJ: 1,
        '6eUa': [1], mQLP: usedMin, ySwc: 0,
        y5bW: `LAC${Math.floor(Math.random() * 9000 + 1000)}-CI${Math.floor(Math.random() * 9000 + 1000)}`,
      });
      sessionIds.push(sessionId);
      sessionCount++;
      const utId = await createRecord('Usage Transactions', {
        I5xQ: sessionStart, AjeI: [3], xuuQ: 20, cer4: 2,
        '0RM2': usedMin, i7OF: usedMin, umgX: usedMin,
        hmd1: 3600, RC5Q: 2001, HtGT: [2],
        idrW: durationS, Rdyh: 1,
        dbQH: sub.msisdn, R6Dj: calledMsisdns[i % calledMsisdns.length],
        Beg1: [sessionId], ZaUH: [subId], '2DAb': [balVoiceId],
      });
      utIds.push(utId);
    }

    // SMS events — one synthetic session wrapping all SMS UTs
    if (smsPerEvent.length) {
      const smsSessionStart = Math.round(activatedMs + Math.random() * (nowMs - activatedMs) * 0.3);
      const smsSessionId = await createRecord('Charging Sessions', {
        DCM8: `SESS-S-${sub.msisdn}`,
        y3qX: smsSessionStart, PHIm: nowMs - 1000 * 60 * 60, KQuF: [2],
        '4WcR': [3], tmDp: sub.msisdn, wypP: '-',
        cnsm: [3], '1hHe': [subId], UPL8: [1],
        XMVJ: smsPerEvent.length,
        '6eUa': [1], mQLP: sub.smsUsed, ySwc: 0,
      });
      sessionIds.push(smsSessionId);
      sessionCount++;
      for (let i = 0; i < smsPerEvent.length; i++) {
        const ts = Math.round(smsSessionStart + (i / smsPerEvent.length) * (nowMs - smsSessionStart - 3600_000));
        const utId = await createRecord('Usage Transactions', {
          I5xQ: ts, AjeI: [3], xuuQ: 30, cer4: 3,
          '0RM2': smsPerEvent[i], i7OF: smsPerEvent[i], umgX: smsPerEvent[i],
          hmd1: 86400, RC5Q: 2001, HtGT: [3],
          Rdyh: i+1, dbQH: sub.msisdn, R6Dj: ['919876543210','919812345678','919723456789'][i % 3],
          Beg1: [smsSessionId], ZaUH: [subId], '2DAb': [balSmsId],
        });
        utIds.push(utId);
      }
    }

    console.log(`  ${sessionCount} sessions, ${utIds.length} UTs (data=${sub.dataUsedMB}MB, voice=${sub.voiceUsedMin}min, sms=${sub.smsUsed})`);

    allCreated.push({
      name: sub.name, msisdn: sub.msisdn, profile: sub.profile,
      customerId, walletId, subId, balDataId, balVoiceId, balSmsId,
      sessionIds, utIds, rechargeIds,
      expected: {
        dataUsed: sub.dataUsedMB, voiceUsed: sub.voiceUsedMin, smsUsed: sub.smsUsed,
        dataRemaining: plan.cells['43Sg'] - sub.dataUsedMB,
        voiceRemaining: plan.cells['CAnm'] - sub.voiceUsedMin,
        smsRemaining: plan.cells['ALxp'] - sub.smsUsed,
      },
    });
  }

  // Trigger eval across all affected tables
  console.log('\n=== Triggering evaluation ===');
  const allBalIds = allCreated.flatMap(c => [c.balDataId, c.balVoiceId, c.balSmsId]);
  const allSubIds = allCreated.map(c => c.subId);
  const allCustIds = allCreated.map(c => c.customerId);
  const allWalletIds = allCreated.map(c => c.walletId);
  const allSessionIds = allCreated.flatMap(c => c.sessionIds);
  const allUtIds = allCreated.flatMap(c => c.utIds);
  const allRechargeIds = allCreated.flatMap(c => c.rechargeIds);

  await evalAllComputed('Balances', allBalIds);
  await evalAllComputed('Subscriptions', allSubIds);
  await evalAllComputed('Customers', allCustIds);
  await evalAllComputed('Wallets', allWalletIds);
  await evalAllComputed('Charging Sessions', allSessionIds);
  await evalAllComputed('Usage Transactions', allUtIds);
  await evalAllComputed('Recharges', allRechargeIds);
  await evalAllComputed('Tariff Plans', [/* plan */]);

  console.log('Waiting 60s for async settle...');
  await sleep(60000);

  fs.writeFileSync(path.join(ROOT, '.realistic-subs-result.json'), JSON.stringify(allCreated, null, 2));

  // Quick self-check on the 3 data balances
  console.log('\n=== Quick self-check: Balances ===');
  const rows = (await api('POST', `/v1/app-builder/table/${TABLE_IDS['Balances']}/paged-record?pageNo=1&pageSize=300`, {})).data.data;
  for (const c of allCreated) {
    const d = rows.find(r => r._id === c.balDataId);
    const v = rows.find(r => r._id === c.balVoiceId);
    const s = rows.find(r => r._id === c.balSmsId);
    console.log(`\n${c.name} (${c.msisdn}):`);
    console.log(`  DATA : initial=${d.cells['aGu1']} used=${d.cells['mo1lqr6ldhc5w']} remaining=${d.cells['ylwC']} (expected used=${c.expected.dataUsed}, remaining=${c.expected.dataRemaining})`);
    console.log(`  VOICE: initial=${v.cells['aGu1']} used=${v.cells['mo1lqr6ldhc5w']} remaining=${v.cells['ylwC']} (expected used=${c.expected.voiceUsed}, remaining=${c.expected.voiceRemaining})`);
    console.log(`  SMS  : initial=${s.cells['aGu1']} used=${s.cells['mo1lqr6ldhc5w']} remaining=${s.cells['ylwC']} (expected used=${c.expected.smsUsed}, remaining=${c.expected.smsRemaining})`);
  }

  console.log('\nResults saved → .realistic-subs-result.json');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
