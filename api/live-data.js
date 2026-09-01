const { InfluxDB } = require('@influxdata/influxdb-client');
const FIELD_MAP = require('./_fieldMap');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const { INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET, INFLUX_SITE_ID } = process.env;
  if (!INFLUX_URL || !INFLUX_TOKEN || !INFLUX_ORG || !INFLUX_BUCKET || !INFLUX_SITE_ID) {
    res.status(500).json({
      error: 'InfluxDB not configured. Set INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET, INFLUX_SITE_ID as environment variables in the Vercel project settings, then redeploy.',
    });
    return;
  }

  const queryApi = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN }).getQueryApi(INFLUX_ORG);

  const measurements = [...new Set(Object.values(FIELD_MAP).map(f => f.measurement))];
  const fields = [...new Set(Object.values(FIELD_MAP).map(f => f.field))];

  const fluxQuery = `
    from(bucket: "${INFLUX_BUCKET}")
      |> range(start: -10m)
      |> filter(fn: (r) => ${measurements.map(m => `r._measurement == "${m}"`).join(' or ')})
      |> filter(fn: (r) => ${fields.map(f => `r._field == "${f}"`).join(' or ')})
      |> filter(fn: (r) => r.id == "${INFLUX_SITE_ID}")
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
