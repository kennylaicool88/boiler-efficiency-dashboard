const { getStationOrDefault, listLogRows } = require('./_supabase');

// Mill operates on local time (Malaysia, UTC+8, no DST). A "cycle day"
// runs 07:00 to 06:59:59 the next calendar day.
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
function enumerateDays(fromStr, toStr) {
  const days = [];
  let cur = new Date(fromStr + 'T00:00:00Z');
  const end = new Date(toStr + 'T00:00:00Z');
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return days;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const requestedStation = req.query && req.query.station;
  const requestedDay = req.query && req.query.day; // 'YYYY-MM-DD', optional
  const requestedFrom = req.query && req.query.from; // 'YYYY-MM-DD', optional (with `to`, requests hourlySeries)
  const requestedTo = req.query && req.query.to;
  const days = Math.min(60, Math.max(1, parseInt((req.query && req.query.days) || '14', 10) || 14));

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

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let rows;
  try {
    rows = await listLogRows(station.id, since);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read log', detail: String((err && err.message) || err) });
    return;
  }

  // Daily averages, one row per cycle day.
  const dayMap = {};
  rows.forEach((r) => {
    const key = cycleDayKey(new Date(r.ts));
    if (!dayMap[key]) dayMap[key] = { boilerSum: 0, boilerN: 0, chpSum: 0, chpN: 0 };
    if (r.boiler_eff !== null && r.boiler_eff !== undefined) { dayMap[key].boilerSum += r.boiler_eff; dayMap[key].boilerN++; }
    if (r.chp_eff !== null && r.chp_eff !== undefined) { dayMap[key].chpSum += r.chp_eff; dayMap[key].chpN++; }
  });
  const daily = Object.keys(dayMap).sort().map((key) => {
    const v = dayMap[key];
    return {
      day: key,
      boilerEffAvg: v.boilerN ? v.boilerSum / v.boilerN : null,
      chpEffAvg: v.chpN ? v.chpSum / v.chpN : null,
      samples: Math.max(v.boilerN, v.chpN),
    };
  });

  // Hourly averages for one cycle day — the requested day, or the most
  // recent day present in the data, or today if there's no data yet.
  const targetDay = requestedDay || (daily.length ? daily[daily.length - 1].day : cycleDayKey(new Date()));
  const hourMap = {};
  rows.forEach((r) => {
    const d = new Date(r.ts);
    if (cycleDayKey(d) !== targetDay) return;
    const h = cycleHour(d);
    if (!hourMap[h]) hourMap[h] = { boilerSum: 0, boilerN: 0, chpSum: 0, chpN: 0 };
    if (r.boiler_eff !== null && r.boiler_eff !== undefined) { hourMap[h].boilerSum += r.boiler_eff; hourMap[h].boilerN++; }
    if (r.chp_eff !== null && r.chp_eff !== undefined) { hourMap[h].chpSum += r.chp_eff; hourMap[h].chpN++; }
  });
  const hourly = [];
  for (let i = 0; i < 24; i++) {
    const h = (7 + i) % 24;
    const v = hourMap[h];
    hourly.push({
      hour: h,
      boilerEffAvg: v && v.boilerN ? v.boilerSum / v.boilerN : null,
      chpEffAvg: v && v.chpN ? v.chpSum / v.chpN : null,
      samples: v ? Math.max(v.boilerN, v.chpN) : 0,
    });
  }

  // Hourly series spanning a multi-day range (Date Range view on the
  // chart) — every (day, hour) slot between `from` and `to` inclusive, in
  // chronological order, with nulls where there's no data. Only computed
  // when both are given, to keep the response lean for single-day callers.
  let hourlySeries = null;
  if (requestedFrom && requestedTo) {
    const bucketMap = {};
    rows.forEach((r) => {
      const d = new Date(r.ts);
      const day = cycleDayKey(d);
      if (day < requestedFrom || day > requestedTo) return;
      const key = day + '|' + cycleHour(d);
      if (!bucketMap[key]) bucketMap[key] = { boilerSum: 0, boilerN: 0, chpSum: 0, chpN: 0 };
      if (r.boiler_eff !== null && r.boiler_eff !== undefined) { bucketMap[key].boilerSum += r.boiler_eff; bucketMap[key].boilerN++; }
      if (r.chp_eff !== null && r.chp_eff !== undefined) { bucketMap[key].chpSum += r.chp_eff; bucketMap[key].chpN++; }
    });
    hourlySeries = [];
    enumerateDays(requestedFrom, requestedTo).forEach((day) => {
      for (let i = 0; i < 24; i++) {
        const h = (7 + i) % 24;
        const v = bucketMap[day + '|' + h];
        hourlySeries.push({
          day,
          hour: h,
          boilerEffAvg: v && v.boilerN ? v.boilerSum / v.boilerN : null,
          chpEffAvg: v && v.chpN ? v.chpSum / v.chpN : null,
          samples: v ? Math.max(v.boilerN, v.chpN) : 0,
        });
      }
    });
  }

  res.status(200).json({
    station: station.id,
    stationName: station.name,
    cycleDay: targetDay,
    hourly,
    daily,
    hourlySeries,
  });
};
