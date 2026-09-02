// Shared by api/log-snapshot.js. Mirrors the client-side calculation in
// index.html's recalc() exactly, so logged history matches what the
// dashboard itself would show for the same inputs.

const STEAM_TABLE = [
  [1, 2675], [2, 2707], [3, 2725], [5, 2748], [7, 2764], [10, 2778], [13, 2787],
  [15, 2792], [17, 2795], [20, 2799], [22, 2800], [25, 2801], [30, 2803], [35, 2802], [40, 2801],
];

function hgAt(p) {
  if (p <= STEAM_TABLE[0][0]) return STEAM_TABLE[0][1];
  if (p >= STEAM_TABLE[STEAM_TABLE.length - 1][0]) return STEAM_TABLE[STEAM_TABLE.length - 1][1];
  for (let i = 0; i < STEAM_TABLE.length - 1; i++) {
    const a = STEAM_TABLE[i], b = STEAM_TABLE[i + 1];
    if (p >= a[0] && p <= b[0]) {
      const f = (p - a[0]) / (b[0] - a[0]);
      return a[1] + f * (b[1] - a[1]);
    }
  }
  return STEAM_TABLE[STEAM_TABLE.length - 1][1];
}

// fuel: { ffb, fibrePct, fibreGcv, shellPct, shellGcv, efbPct, efbGcv }
// live: { steamRate, steamPressure, feedTemp, elecOutput, exhaustPressure }
function computeEfficiency(fuel, live) {
  fuel = fuel || {};
  live = live || {};

  const ffb = Number(fuel.ffb) || 0;
  const fibrePct = Number(fuel.fibrePct) || 0;
  const fibreGcv = Number(fuel.fibreGcv) || 0;
  const shellPct = Number(fuel.shellPct) || 0;
  const shellGcv = Number(fuel.shellGcv) || 0;
  const efbPct = Number(fuel.efbPct) || 0;
  const efbGcv = Number(fuel.efbGcv) || 0;

  const fibreRateT = (ffb * fibrePct) / 100;
  const shellRateT = (ffb * shellPct) / 100;
  const efbRateT = (ffb * efbPct) / 100;
  const fuelRateT = fibreRateT + shellRateT + efbRateT;

  const fuelDutyKW = (fibreRateT * 1000 * fibreGcv + shellRateT * 1000 * shellGcv + efbRateT * 1000 * efbGcv) / 3600;

  const steamRate = Number(live.steamRate) || 0;
  const steamPressure = Number(live.steamPressure) || 0;
  const feedTemp = Number(live.feedTemp) || 0;
  const elecOutput = Number(live.elecOutput) || 0;
  const exhaustPressure = Number(live.exhaustPressure) || 0;

  const hSteam = hgAt(steamPressure);
  const hFeed = 4.186 * feedTemp;
  const steamRateKg = steamRate * 1000;
  const steamDutyKW = (steamRateKg * (hSteam - hFeed)) / 3600;

  const boilerEff = fuelDutyKW > 0 ? (steamDutyKW / fuelDutyKW) * 100 : null;

  const hExhaust = hgAt(exhaustPressure);
  const processHeatKW = (steamRateKg * (hExhaust - hFeed)) / 3600;
  const chpEff = fuelDutyKW > 0 ? ((elecOutput + processHeatKW) / fuelDutyKW) * 100 : null;

  return { boilerEff, chpEff, fuelRateT };
}

module.exports = { hgAt, computeEfficiency };
