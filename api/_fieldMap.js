// Shared by api/live-data.js and api/health.js.
// Underscore prefix keeps Vercel from treating this as its own route.
//
// Left side = the field name the dashboard expects.
// Right side = where it actually lives in InfluxDB (measurement + field).
// Source: SAMYSK_POM_250048, measurement "PBLR".
module.exports = {
  steamRate:     { measurement: 'PBLR', field: 'steam_flowrate',      unit: 't/hr' },
  steamPressure: { measurement: 'PBLR', field: 'steam_pressure',      unit: 'bar g' },
  feedTemp:      { measurement: 'PBLR', field: 'vg_inlet_water_temp', unit: '°C' },
};
