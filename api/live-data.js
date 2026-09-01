const { InfluxDB } = require('@influxdata/influxdb-client');
const { configured: supabaseConfigured, getStationOrDefault } = require('./_supabase');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!supabaseConfigured()) {
    res.status(500).json({
      error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as environment variables in the Vercel project settings, then redeploy.',
    });
    return;
  }

  const requestedStation = req.query && req.query.station;
  let station;
  try {
    station = await getStationOrDefault(requestedStation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to look up station', detail: String((err && err.message) || err) });
    return;
  }
  if (!station) {
    res.status(400).json({ error: requestedStation ? `Unknown station "${requestedStation}".` : 'No stations configured yet.' });
    return;
  }
  const FIELD_MAP = station.fields;

  const { INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET } = process.env;
  if (!INFLUX_URL || !INFLUX_TOKEN || !INFLUX_ORG || !INFLUX_BUCKET) {
    res.status(500).json({
      error: 'InfluxDB not configured. Set INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET as environment variables in the Vercel project settings, then redeploy.',
    });
    return;
  }

  // Fields marked `manual` have no InfluxDB source — they're skipped in the
  // query entirely and never appear in the response, so a manual entry in
  // the dashboard's Hidden Data panel is never overwritten by a poll.
  const liveEntries = Object.entries(FIELD_MAP).filter(([, cfg]) => !cfg.manual);

  if (liveEntries.length === 0) {
    res.status(200).json({
      _timestamp: new Date().toISOString(),
      _fieldsFound: 0,
      _fieldsExpected: 0,
      _station: station.id,
    });
    return;
  }

  const queryApi = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN }).getQueryApi(INFLUX_ORG);

  // Group fields by (measurement, id) — several fields can share a device
  // (e.g. the three boiler fields), but each device gets its own clause so
  // a measurement/field name only matches rows from the right device.
  const groups = new Map();
  for (const [, cfg] of liveEntries) {
    const key = cfg.measurement + '|' + cfg.id;
    if (!groups.has(key)) groups.set(key, { measurement: cfg.measurement, id: cfg.id, fields: new Set() });
    groups.get(key).fields.add(cfg.field);
  }

  const clauses = [...groups.values()].map(g => {
    const fieldMatch = [...g.fields].map(f => `r._field == "${f}"`).join(' or ');
    return `(r._measurement == "${g.measurement}" and r.id == "${g.id}" and (${fieldMatch}))`;
  });

  const fluxQuery = `
    from(bucket: "${INFLUX_BUCKET}")
      |> range(start: -10m)
      |> filter(fn: (r) => ${clauses.join(' or ')})
      |> last()
  `;

  try {
    const raw = {};
    await new Promise((resolve, reject) => {
      queryApi.queryRows(fluxQuery, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          raw[o._field] = o._value;
        },
        error: reject,
        complete: resolve,
      });
    });

    const output = {};
    for (const [dashKey, cfg] of liveEntries) {
      if (raw[cfg.field] !== undefined) output[dashKey] = raw[cfg.field];
    }
    const fieldsFound = Object.keys(output).length;
    output._timestamp = new Date().toISOString();
    output._fieldsFound = fieldsFound;
    output._fieldsExpected = liveEntries.length;
    output._station = station.id;

    res.status(200).json(output);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to query InfluxDB', detail: String((err && err.message) || err) });
  }
};
