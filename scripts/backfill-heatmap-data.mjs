// Backfill historical Usage Transactions across the last 14 days × 24 hours
// with telecom-realistic traffic curves so the Usage Heatmap visually pops.
//
// Weighted distribution:
//   - Weekdays: morning peak (09-11), lunch (12-13), evening peak (17-19),
//     late-evening (20-22), very low overnight (00-05)
//   - Weekends: similar shape but shifted ~1h later + slight data bump
//
// Creates UTs tied to existing subs/balances. Also re-updates session timestamps
// on a sample so Charging Sessions also have spread.

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import * as L from './lib-common.mjs';
const T = L.loadTableIds();

const UT = T['Usage Transactions'];
const BAL = T['Balances'];
const SUBS = T['Subscriptions'];
const SESS = T['Charging Sessions'];

// ─── Hour-of-day weights (0-23) ──────────────────────────────
// Weekday pattern:
const HOURS_WEEKDAY = [
  1, 1, 1, 2, 2, 4,       // 00-05 very quiet
  8, 14, 20, 26, 28, 26,  // 06-11 morning peak
  22, 20, 18, 18, 22, 30, // 12-17 afternoon → ramp
  34, 32, 28, 24, 18, 12, // 18-23 evening peak wind-down
];
// Weekend pattern (shifted later, less morning):
const HOURS_WEEKEND = [
  3, 2, 2, 2, 2, 3,       // 00-05
  5, 8, 12, 18, 22, 24,   // 06-11 slow ramp
  26, 24, 22, 20, 22, 26, // 12-17
  30, 32, 34, 30, 24, 16, // 18-23 evening pops harder
];

// Day of week weights (Sun=0 .. Sat=6) — slight weekend lift
const DOW_WEIGHT = [1.0, 1.0, 0.95, 0.95, 1.0, 1.15, 1.10];

function pickHour(isWeekend) {
  const weights = isWeekend ? HOURS_WEEKEND : HOURS_WEEKDAY;
  const total = weights.reduce((s, v) => s + v, 0);
  let r = Math.random() * total;
  for (let h = 0; h < 24; h++) {
    r -= weights[h];
    if (r <= 0) return h;
  }
  return 23;
}

function pickDayOffset() {
  // Weighted over last 14 days
  const weights = Array.from({ length: 14 }, (_, i) => {
    const daysAgo = i;
    const dow = (new Date(Date.now() - daysAgo * 86400000)).getDay();
    return DOW_WEIGHT[dow] * (daysAgo < 7 ? 1.3 : 0.9); // recent days heavier
  });
  const total = weights.reduce((s, v) => s + v, 0);
  let r = Math.random() * total;
  for (let i = 0; i < 14; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return 7;
}

function pickTimestamp() {
  const daysAgo = pickDayOffset();
  const d = new Date(Date.now() - daysAgo * 86400000);
  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
  const hour = pickHour(isWeekend);
  d.setHours(hour, L.rand(0, 59), L.rand(0, 59), 0);
  return d.getTime();
}

async function main() {
  console.log('🔥 Backfilling historical UTs for heatmap richness...\n');

  const subs = await L.fetchAll(SUBS);
  const active = subs.filter(s => (s.cells['BFCp'] || [0])[0] === 1 && s.cells['sDya']);
  console.log('  Active subs:', active.length);

  const bals = await L.fetchAll(BAL);
  const balsBySub = {};
  for (const b of bals) {
    const ref = b.cells['yw1p'];
    const sid = Array.isArray(ref) ? ref[0] : ref;
    if (!balsBySub[sid]) balsBySub[sid] = [];
    balsBySub[sid].push({ id: b._id, rg: b.cells['dOSd'] || 10 });
  }
  console.log('  Balances loaded:', bals.length);

  const sessions = await L.fetchAll(SESS);
  const sessBySub = {};
  for (const s of sessions) {
    const ref = s.cells['1hHe'];
    const sid = Array.isArray(ref) ? ref[0] : ref;
    if (!sessBySub[sid]) sessBySub[sid] = [];
    sessBySub[sid].push(s._id);
  }
  console.log('  Charging Sessions:', sessions.length);

  const TARGET = 1500;  // Aim for ~1500 new UTs spread over 14 days × 24 hours
  console.log('\n  Creating', TARGET, 'UTs...');

  let created = 0;
  let errors = 0;
  const started = Date.now();

  for (let i = 0; i < TARGET; i++) {
    const sub = L.pick(active);
    const subBals = balsBySub[sub._id] || [];
    if (!subBals.length) continue;

    // 70% data, 20% voice, 10% SMS — realistic telco mix
    const r = Math.random();
    const svcKind = r < 0.70 ? 'data' : r < 0.90 ? 'voice' : 'sms';
    let bal = subBals.find(b => svcKind === 'data'  ? (b.rg >= 10  && b.rg <= 13)  :
                                svcKind === 'voice' ? (b.rg >= 100 && b.rg <= 102) :
                                                      (b.rg >= 200 && b.rg <= 201));
    if (!bal) bal = subBals[0];

    const rg = bal.rg;
    const isData  = rg >= 10  && rg <= 13;
    const isVoice = rg >= 100 && rg <= 102;
    const unitType = isData ? 1 : isVoice ? 2 : 3;
    const used = isData ? L.rand(5, 180) : isVoice ? L.rand(1, 15) : 1;
    const msgType = Math.random() < 0.6 ? 2 : Math.random() < 0.8 ? 1 : 3;  // mostly CCR-U, some I, some T
    const ts = pickTimestamp();
    const sessId = L.pick(sessBySub[sub._id] || []) || null;

    const cells = {
      'I5xQ': ts,
      'AjeI': [msgType],
      'xuuQ': rg,
      'cer4': 1,
      '0RM2': used,
      'i7OF': used,
      'umgX': used,
      'hmd1': 600,
      'RC5Q': 2001,
      'HtGT': [unitType],
      'HwNc': [1],
      'Rdyh': L.rand(1, 8),
      'dbQH': sub.cells['sDya'],
      'R6Dj': isData ? '*' : '267' + L.pick(['71','72','75','77']) + String(L.rand(100000, 999999)),
      'ZaUH': [sub._id],
      '2DAb': [bal.id],
    };
    if (isData) {
      cells['Fpuq'] = used * 524288;
      cells['ZUn1'] = used * 524288;
      cells['e7tD'] = 'internet.btc.bw';
    }
    if (isVoice) cells['idrW'] = used * 60;
    if (sessId) cells['Beg1'] = [sessId];

    try {
      await L.api('POST', `/v1/app-builder/table/${UT}/record`, { cells });
      created++;
      if (created % 100 === 0) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0);
        process.stdout.write(`\r  created ${created}/${TARGET}  (${elapsed}s)`);
      }
    } catch (e) {
      errors++;
      if (errors < 3) console.log('\n  err:', e.message?.slice(0, 100));
    }
    // No sleep — fire as fast as the API allows
  }

  console.log(`\n\n✅ Done — ${created} UTs created, ${errors} errors.`);
  console.log('Open "Usage Patterns Heatmap" page and refresh — should show proper 7×24 heat pattern.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
