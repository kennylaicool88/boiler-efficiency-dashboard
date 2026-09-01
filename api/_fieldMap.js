// Shared by api/live-data.js and api/health.js.
// Underscore prefix keeps Vercel from treating this as its own route.
//
// Left side = the field name the dashboard expects.
// Right side = where it actually lives in InfluxDB (measurement + field +
// device id). Each field carries its own `id` because the boiler, turbine,
// and BPV meters are separate devices in this bucket.
module.exports = {
  steamRate:       { measurement: 'PBLR',         field: 'steam_flowrate',      id: 'SAMYSK_POM_250048', unit: 't/hr' },
  steamPressure:   { measurement: 'PBLR',         field: 'steam_pressure',      id: 'SAMYSK_POM_250048', unit: 'bar g' },
  feedTemp:        { measurement: 'PBLR',         field: 'vg_inlet_water_temp', id: 'SAMYSK_POM_250048', unit: '°C' },
  elecOutput:      { measurement: 'ETRB_turbine', field: 'power_total',         id: 'SAMYSK_POM_250049', unit: 'kW' },
  exhaustPressure: { measurement: 'PSTR_bar',     field: 'bpv',                 id: 'SAMYSK_POM_250045', unit: 'bar g' },
};
