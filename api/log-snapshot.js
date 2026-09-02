const { configured: supabaseConfigured, listStationsFull, insertLogRows } = require('./_supabase');
const { queryStationFields } = require('./_influx');
const { computeEfficiency } = require('./_efficiency');

// Called on a schedule by the GitHub Actions workflow (see
// .github/workflows/log-snapshot.yml) — not meant for browser use.
// Protected by a shared secret since the repo (and therefore this
// endpoint's existence) is public.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!process.env.LOG_SNAPSHOT_SECRET || req.headers['x-log-secret'] !== process.env.LOG_SNAPSHOT_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!supabaseConfigured()) {
    res.status(500).json({ error: 'Supabase not configured' });
    return;
  }

  let stations;
  try {
    stations = await listStationsFull();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list stations', detail: String((err && err.message) || err) });
    return;
  }

  const now = new Date().toISOString();
  const rows = [];
  const results = [];

  for (const station of stations) {
    try {
      const { output } = await queryStationFields(station.fields);

      // Manual fields never come from InfluxDB — queryStationFields skips
      // them entirely, so fill in the stored estimate here. Without this,
      // a manual field silently computes as 0 instead of its estimate.
      Object.entries(station.fields || {}).forEach(([key, cfg]) => {
        if (cfg.manual && output[key] === undefined && cfg.defaultValue !== undefined && cfg.defaultValue !== null) {
          output[key] = cfg.defaultValue;
        }
      });

      const eff = computeEfficiency(station.fuel_profile, output);
      rows.push({
        station_id: station.id,
        ts: now,
        boiler_eff: eff.boilerEff,
        chp_eff: eff.chpEff,
        steam_rate: output.steamRate !== undefined ? output.steamRate : null,
        steam_pressure: output.steamPressure !== undefined ? output.steamPressure : null,
        feed_temp: output.feedTemp !== undefined ? output.feedTemp : null,
        elec_output: output.elecOutput !== undefined ? output.elecOutput : null,
        exhaust_pressure: output.exhaustPressure !== undefined ? output.exhaustPressure : null,
        fuel_rate: eff.fuelRateT,
      });
      results.push({ station: station.id, ok: true, boilerEff: eff.boilerEff, chpEff: eff.chpEff });
    } catch (err) {
      results.push({ station: station.id, ok: false, error: String((err && err.message) || err) });
    }
  }

  try {
    if (rows.length) await insertLogRows(rows);
    res.status(200).json({ logged: rows.length, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to write log', detail: String((err && err.message) || err), results });
  }
};
