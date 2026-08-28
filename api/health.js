const FIELD_MAP = require('./_fieldMap');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const { INFLUX_URL, INFLUX_TOKEN, INFLUX_ORG, INFLUX_BUCKET } = process.env;
  const configured = !!(INFLUX_URL && INFLUX_TOKEN && INFLUX_ORG && INFLUX_BUCKET);

  const base = {
    configured,
    org: configured ? INFLUX_ORG : null,
    bucket: configured ? INFLUX_BUCKET : null,
    fields: FIELD_MAP,
  };

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
