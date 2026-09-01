const { configured, listStations, upsertStation } = require('./_supabase');

const FIELD_KEYS = ['steamRate', 'steamPressure', 'feedTemp', 'elecOutput', 'exhaustPressure'];
const UNITS = {
  steamRate: 't/hr',
  steamPressure: 'bar g',
  feedTemp: '°C',
  elecOutput: 'kW',
  exhaustPressure: 'bar g',
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (!configured()) {
    res.status(500).json({
      error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as environment variables in the Vercel project settings, then redeploy.',
    });
    return;
  }

  if (req.method === 'GET') {
    try {
      const rows = await listStations();
      res.status(200).json({ stations: rows.map((r) => ({ id: r.id, name: r.name })) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to list stations', detail: String((err && err.message) || err) });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const id = String(body.id || '').trim();
      const name = String(body.name || '').trim();
      const fieldsIn = body.fields || {};

      if (!/^[a-z0-9-]+$/.test(id)) {
        res.status(400).json({ error: 'Station id must be lowercase letters, numbers, and hyphens only.' });
        return;
      }
      if (!name) {
        res.status(400).json({ error: 'Station name is required.' });
        return;
      }

      const fields = {};
      for (const key of FIELD_KEYS) {
        const f = fieldsIn[key] || {};
        if (f.manual) {
          const entry = { manual: true, unit: UNITS[key] };
          if (f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== '') {
            const num = Number(f.defaultValue);
            if (!Number.isNaN(num)) entry.defaultValue = num;
          }
          fields[key] = entry;
          continue;
        }
        if (!f.measurement || !f.field || !f.id) {
          res.status(400).json({ error: `Missing measurement/field/id for "${key}" (or mark it as manual).` });
          return;
        }
        fields[key] = {
          measurement: String(f.measurement).trim(),
          field: String(f.field).trim(),
          id: String(f.id).trim(),
          unit: UNITS[key],
        };
      }

      const rows = await upsertStation({ id, name, fields });
      res.status(200).json({ station: rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to save station', detail: String((err && err.message) || err) });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
