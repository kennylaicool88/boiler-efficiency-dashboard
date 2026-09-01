const { InfluxDB } = require('@influxdata/influxdb-client');
const FIELD_MAP = require('./_fieldMap');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const { INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET } = process.env;
  if (!INFLUX_URL || !INFLUX_TOKEN || !INFLUX_ORG || !INFLUX_BUCKET) {
    res.status(500).json({
      error: 'InfluxDB not configured. Set INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET as environment variables in the Vercel project settings, then redeploy.',
    });
    return;
  }

  const queryApi = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN }).getQueryApi(INFLUX_ORG);

  // Group fields by (measurement, id) — several fields can share a device
  // (e.g. the three boiler fields), but each device gets its own clause so
  // a measurement/field name only matches rows from the right device.
  const groups = new Map();
  for (const cfg of Object.values(FIELD_MAP)) {
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
    for (const [dashKey, cfg] of Object.entries(FIELD_MAP)) {
      if (raw[cfg.field] !== undefined) output[dashKey] = raw[cfg.field];
    }
    const fieldsFound = Object.keys(output).length;
    output._timestamp = new Date().toISOString();
    output._fieldsFound = fieldsFound;
    output._fieldsExpected = Object.keys(FIELD_MAP).length;

    res.status(200).json(output);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to query InfluxDB', detail: String((err && err.message) || err) });
  }
};
