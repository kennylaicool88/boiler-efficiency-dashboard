const { InfluxDB } = require('@influxdata/influxdb-client');

// Shared by api/live-data.js and api/log-snapshot.js.
// Underscore prefix keeps Vercel from treating this as its own route.

// Fields marked `manual` have no InfluxDB source and are skipped entirely.
function buildQuery(bucket, fieldMap) {
  const liveEntries = Object.entries(fieldMap).filter(([, cfg]) => !cfg.manual);
  if (liveEntries.length === 0) return { query: null, liveEntries };

  const groups = new Map();
  for (const [, cfg] of liveEntries) {
    const key = cfg.measurement + '|' + cfg.id;
    if (!groups.has(key)) groups.set(key, { measurement: cfg.measurement, id: cfg.id, fields: new Set() });
    groups.get(key).fields.add(cfg.field);
  }
  const clauses = [...groups.values()].map((g) => {
    const fieldMatch = [...g.fields].map((f) => `r._field == "${f}"`).join(' or ');
    return `(r._measurement == "${g.measurement}" and r.id == "${g.id}" and (${fieldMatch}))`;
  });
  const query = `
    from(bucket: "${bucket}")
      |> range(start: -10m)
      |> filter(fn: (r) => ${clauses.join(' or ')})
      |> last()
  `;
  return { query, liveEntries };
}

// Returns { output, fieldsFound, fieldsExpected }. Throws if InfluxDB env
// vars are missing or the query fails.
async function queryStationFields(fieldMap) {
  const { INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET } = process.env;
  if (!INFLUX_URL || !INFLUX_TOKEN || !INFLUX_ORG || !INFLUX_BUCKET) {
    throw new Error('InfluxDB not configured (INFLUX_URL/INFLUX_TOKEN/INFLUX_ORG/INFLUX_BUCKET)');
  }

  const { query, liveEntries } = buildQuery(INFLUX_BUCKET, fieldMap);
  if (!query) return { output: {}, fieldsFound: 0, fieldsExpected: 0 };

  const queryApi = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN }).getQueryApi(INFLUX_ORG);
  const raw = {};
  await new Promise((resolve, reject) => {
    queryApi.queryRows(query, {
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
  return { output, fieldsFound: Object.keys(output).length, fieldsExpected: liveEntries.length };
}

module.exports = { queryStationFields };
