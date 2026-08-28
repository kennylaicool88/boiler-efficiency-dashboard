// Shared by api/live-data.js and api/health.js.
// Underscore prefix keeps Vercel from treating this as its own route.
//
// Left side = the field name the dashboard expects.
// Right side = where it actually lives in InfluxDB (measurement + field).
// TODO: replace with your real InfluxDB measurement/field names — check
// the InfluxDB UI under Data Explorer, or ask whoever set up the
// historian/SCADA tags feeding InfluxDB.
module.exports = {
  steamRate:     { measurement: 'boiler', field: 'steam_flow_tph',      unit: 't/hr' },
  steamPressure: { measurement: 'boiler', field: 'steam_pressure_barg', unit: 'bar g' },
  feedTemp:      { measurement: 'boiler', field: 'feedwater_temp_c',    unit: '°C' },
};
