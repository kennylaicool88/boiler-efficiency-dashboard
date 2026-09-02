const { configured: supabaseConfigured, getStationOrDefault } = require('./_supabase');
const { queryStationFields } = require('./_influx');

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

  try {
    const { output, fieldsFound, fieldsExpected } = await queryStationFields(station.fields);
    output._timestamp = new Date().toISOString();
    output._fieldsFound = fieldsFound;
    output._fieldsExpected = fieldsExpected;
    output._station = station.id;
    res.status(200).json(output);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to query InfluxDB', detail: String((err && err.message) || err) });
  }
};
