const { configured: supabaseConfigured, getStationOrDefault } = require('./_supabase');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!supabaseConfigured()) {
    res.status(200).json({
      configured: false,
      influxReachable: null,
      message: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as environment variables in the Vercel project settings, then redeploy.',
    });
    return;
  }

  const requestedStation = req.query && req.query.station;
  let station;
  try {
    station = await getStationOrDefault(requestedStation);
  } catch (err) {
    res.status(200).json({
      configured: false,
      influxReachable: null,
      message: 'Failed to look up station: ' + String((err && err.message) || err),
    });
    return;
  }

  const FIELD_MAP = station ? station.fields : {};

  const { INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET } = process.env;
  const configured = !!(INFLUX_URL && INFLUX_TOKEN && INFLUX_ORG && INFLUX_BUCKET);

  const base = {
    configured,
    station: station ? station.id : requestedStation || null,
    stationName: station ? station.name : null,
    org: configured ? INFLUX_ORG : null,
    bucket: configured ? INFLUX_BUCKET : null,
    deviceIds: [...new Set(Object.values(FIELD_MAP).filter((f) => !f.manual).map((f) => f.id))],
    fields: FIELD_MAP,
    fuelProfile: station ? station.fuel_profile || null : null,
  };

  if (!station) {
    res.status(200).json({
      ...base,
      influxReachable: null,
      message: requestedStation ? `Unknown station "${requestedStation}".` : 'No stations configured yet.',
    });
    return;
  }

  if (!configured) {
    res.status(200).json({
      ...base,
      influxReachable: null,
      message: 'Set INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET as environment variables in the Vercel project settings, then redeploy.',
    });
    return;
  }

  try {
    const r = await fetch(INFLUX_URL.replace(/\/$/, '') + '/health');
    const body = await r.json().catch(() => ({}));
    res.status(200).json({
      ...base,
      influxReachable: r.ok,
      influxStatus: body.status || null,
    });
  } catch (err) {
    res.status(200).json({
      ...base,
      influxReachable: false,
      error: String((err && err.message) || err),
    });
  }
};
