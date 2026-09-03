const { getStationOrDefault, listLogRowsFull } = require('./_supabase');

// Mill operates on local time (Malaysia, UTC+8, no DST). A "cycle day"
// runs 07:00 to 06:59:59 the next calendar day. Mirrors
// api/efficiency-history.js exactly so both features agree on day/hour
// boundaries.
const MILL_OFFSET_MS = 8 * 60 * 60 * 1000;

function toLocal(d) {
  return new Date(d.getTime() + MILL_OFFSET_MS);
}
function cycleDayKey(d) {
  const local = toLocal(d);
  const hour = local.getUTCHours();
  const key = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  if (hour < 7) key.setUTCDate(key.getUTCDate() - 1);
  return key.toISOString().slice(0, 10);
}
function cycleHour(d) {
  return toLocal(d).getUTCHours();
}

function stats(vals) {
  const v = vals.filter((x) => x !== null && x !== undefined && isFinite(x));
  if (!v.length) return { avg: null, min: null, max: null };
  return { avg: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v) };
}

function avgOf(vals) {
  const v = vals.filter((x) => x !== null && x !== undefined && isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const requestedStation = req.query && req.query.station;
  const requestedDay = req.query && req.query.day; // 'YYYY-MM-DD', optional

  let station;
  try {
    station = await getStationOrDefault(requestedStation);
  } catch (err) {
    res.status(500).json({ error: 'Failed to look up station', detail: String((err && err.message) || err) });
    return;
  }
  if (!station) {
    res.status(400).json({ error: requestedStation ? `Unknown station "${requestedStation}".` : 'No stations configured yet.' });
    return;
  }

  // Fetch 3 days back so we can find the target cycle day (default: most
  // recent day with data) even right at a day boundary.
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  let rows;
  try {
    rows = await listLogRowsFull(station.id, since);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read log', detail: String((err && err.message) || err) });
    return;
  }

  const dayKeys = [...new Set(rows.map((r) => cycleDayKey(new Date(r.ts))))].sort();
  const targetDay = requestedDay || (dayKeys.length ? dayKeys[dayKeys.length - 1] : cycleDayKey(new Date()));
  const dayRows = rows.filter((r) => cycleDayKey(new Date(r.ts)) === targetDay).sort((a, b) => new Date(a.ts) - new Date(b.ts));

  const base = {
    station: station.id,
    stationName: station.name,
    cycleDay: targetDay,
    fuelProfile: station.fuel_profile || null,
  };

  if (!dayRows.length) {
    res.status(200).json({ ...base, hasData: false });
    return;
  }

  // ---- Hourly breakdown ----
  const hourMap = {};
  dayRows.forEach((r) => {
    const h = cycleHour(new Date(r.ts));
    if (!hourMap[h]) hourMap[h] = { boiler: [], chp: [], steamRate: [], steamPressure: [], feedTemp: [], elecOutput: [] };
    const m = hourMap[h];
    m.boiler.push(r.boiler_eff);
    m.chp.push(r.chp_eff);
    m.steamRate.push(r.steam_rate);
    m.steamPressure.push(r.steam_pressure);
    m.feedTemp.push(r.feed_temp);
    m.elecOutput.push(r.elec_output);
  });
  const hourly = [];
  for (let i = 0; i < 24; i++) {
    const h = (7 + i) % 24;
    const m = hourMap[h];
    hourly.push({
      hour: h,
      boilerEffAvg: m ? avgOf(m.boiler) : null,
      chpEffAvg: m ? avgOf(m.chp) : null,
      steamRateAvg: m ? avgOf(m.steamRate) : null,
      steamPressureAvg: m ? avgOf(m.steamPressure) : null,
      feedTempAvg: m ? avgOf(m.feedTemp) : null,
      elecOutputAvg: m ? avgOf(m.elecOutput) : null,
      samples: m ? m.boiler.filter((x) => x !== null && x !== undefined).length : 0,
    });
  }

  // ---- Daily summary ----
  const boilerEff = stats(dayRows.map((r) => r.boiler_eff));
  const chpEff = stats(dayRows.map((r) => r.chp_eff));

  // Steam mass / electrical energy for the day, integrated over the actual
  // logging intervals (not assumed to be exactly 5 min), so this stays
  // correct if the logging cadence ever changes. A gap longer than 30 min
  // (e.g. a logging outage) is clamped so it doesn't inflate the total.
  let totalSteamT = 0;
  let totalElecKWh = 0;
  for (let i = 0; i < dayRows.length; i++) {
    let intervalHr;
    if (i < dayRows.length - 1) intervalHr = (new Date(dayRows[i + 1].ts) - new Date(dayRows[i].ts)) / 3600000;
    else if (i > 0) intervalHr = (new Date(dayRows[i].ts) - new Date(dayRows[i - 1].ts)) / 3600000;
    else intervalHr = 5 / 60;
    intervalHr = Math.min(Math.max(intervalHr, 0), 0.5);
    if (dayRows[i].steam_rate !== null && dayRows[i].steam_rate !== undefined) totalSteamT += dayRows[i].steam_rate * intervalHr;
    if (dayRows[i].elec_output !== null && dayRows[i].elec_output !== undefined) totalElecKWh += dayRows[i].elec_output * intervalHr;
  }

  // Fuel consumption is derived from the station's Fuel Profile, which is
  // set manually rather than live-measured, so it's constant across the
  // day unless the profile itself was edited — this total is an estimate
  // based on that stored figure, not a separately-measured quantity.
  const fuelRateAvg = avgOf(dayRows.map((r) => r.fuel_rate));
  const hoursCovered = dayRows.length > 1 ? (new Date(dayRows[dayRows.length - 1].ts) - new Date(dayRows[0].ts)) / 3600000 : 0;
  const fuelTonnesEstimate = fuelRateAvg !== null ? fuelRateAvg * 24 : null;

  // ---- Why did efficiency drop? ----
  // Fuel input is fixed for the day (Fuel Profile isn't live-measured), so
  // boiler efficiency = steam heat output / (constant) fuel heat input —
  // every swing in efficiency is mathematically driven by the live steam
  // readings (steam rate, steam pressure, feedwater temp). For each hour
  // that's notably below the day's average, compare its readings against
  // the day's own averages and flag which moved most in the
  // efficiency-reducing direction.
  const dayAvgSteamRate = avgOf(dayRows.map((r) => r.steam_rate));
  const dayAvgSteamPressure = avgOf(dayRows.map((r) => r.steam_pressure));
  const dayAvgFeedTemp = avgOf(dayRows.map((r) => r.feed_temp));

  function pctDelta(hourVal, dayAvg) {
    if (hourVal === null || hourVal === undefined || dayAvg === null || dayAvg === undefined || dayAvg === 0) return null;
    return ((hourVal - dayAvg) / dayAvg) * 100;
  }

  const DROP_THRESHOLD_PCT = 15; // an hour is "notably low" if its boiler eff is >15% below the day average (relative)
  const lowEfficiencyHours = hourly
    .filter((h) => h.samples > 0 && h.boilerEffAvg !== null && boilerEff.avg !== null && boilerEff.avg > 0)
    .map((h) => {
      const deltaPct = ((h.boilerEffAvg - boilerEff.avg) / boilerEff.avg) * 100;
      const steamRateDeltaPct = pctDelta(h.steamRateAvg, dayAvgSteamRate);
      const steamPressureDeltaPct = pctDelta(h.steamPressureAvg, dayAvgSteamPressure);
      const feedTempDeltaPct = pctDelta(h.feedTempAvg, dayAvgFeedTemp);

      // Each factor's "efficiency-reducing push": steam rate down, steam
      // pressure down, or feedwater temp up all push efficiency down in
      // this model. Only count a factor if it's actually pointing that way.
      const pushes = [
        { name: 'Steam output', deltaPct: steamRateDeltaPct, reducing: steamRateDeltaPct !== null && steamRateDeltaPct < 0 },
        { name: 'Steam pressure', deltaPct: steamPressureDeltaPct, reducing: steamPressureDeltaPct !== null && steamPressureDeltaPct < 0 },
        { name: 'Feedwater temperature', deltaPct: feedTempDeltaPct, reducing: feedTempDeltaPct !== null && feedTempDeltaPct > 0 },
      ].filter((p) => p.reducing);
      pushes.sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

      return {
        hour: h.hour,
        boilerEffAvg: h.boilerEffAvg,
        deltaPctFromDayAvg: deltaPct,
        steamRateAvg: h.steamRateAvg,
        steamRateDeltaPct,
        steamPressureAvg: h.steamPressureAvg,
        steamPressureDeltaPct,
        feedTempAvg: h.feedTempAvg,
        feedTempDeltaPct,
        primaryDriver: pushes.length ? pushes[0].name : null,
        primaryDriverDeltaPct: pushes.length ? pushes[0].deltaPct : null,
      };
    })
    .filter((h) => h.deltaPctFromDayAvg <= -DROP_THRESHOLD_PCT)
    .sort((a, b) => a.deltaPctFromDayAvg - b.deltaPctFromDayAvg)
    .slice(0, 5);

  res.status(200).json({
    ...base,
    hasData: true,
    samples: dayRows.length,
    hoursCovered,
    summary: {
      boilerEff,
      chpEff,
      totalSteamT,
      totalElecKWh,
      fuelRateAvgTHr: fuelRateAvg,
      fuelTonnesEstimate,
      dayAvgSteamRate,
      dayAvgSteamPressure,
      dayAvgFeedTemp,
    },
    hourly,
    lowEfficiencyHours,
  });
};
