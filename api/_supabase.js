// Shared by api/stations.js, api/live-data.js, api/health.js, and
// api/log-snapshot.js. Underscore prefix keeps Vercel from treating this
// as its own route.
//
// Talks to Supabase's auto-generated REST API (PostgREST) directly via
// fetch — no SDK needed for the handful of operations this app does.
// Always uses the service_role key, so this must only ever run server-side.

function configured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function restRequest(path, options) {
  options = options || {};
  const headers = Object.assign(
    {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    options.headers || {}
  );
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${options.method || 'GET'} ${path} failed: ${res.status} ${text}`);
  }
  // `Prefer: return=minimal` responses (e.g. 201 Created on insert) have an
  // empty body, not just 204 — parse defensively rather than assuming JSON.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function listStations() {
  return restRequest('stations?select=id,name,fields&order=name.asc');
}

// Full station rows (including fuel_profile) for the background logger.
function listStationsFull() {
  return restRequest('stations?select=id,name,fields,fuel_profile&order=name.asc');
}

function getStation(id) {
  return restRequest(`stations?id=eq.${encodeURIComponent(id)}&select=id,name,fields,fuel_profile`).then(
    (rows) => rows[0] || null
  );
}

// Looks up a specific station by id, or falls back to the first station
// (alphabetically by name) when no id is given.
async function getStationOrDefault(id) {
  if (id) return getStation(id);
  const rows = await restRequest('stations?select=id,name,fields,fuel_profile&order=name.asc&limit=1');
  return rows[0] || null;
}

function upsertStation(station) {
  return restRequest('stations?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: [station],
  });
}

function insertLogRows(rows) {
  return restRequest('efficiency_log', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: rows,
  });
}

// Supabase's PostgREST enforces its own server-side max-rows-per-request
// cap (observed at 1000) regardless of a client-supplied `limit` — asking
// for more in one request doesn't get more back. Sorted ts.asc, that
// silently returns only the OLDEST rows within the cap and drops
// everything newer once a station's logged history within the requested
// window passes it — at a 5-minute cadence that's under 4 days. Paginate
// with Range headers instead, looping until a page comes back short.
const PAGE_SIZE = 1000;
async function restRequestAllPages(path) {
  const all = [];
  let offset = 0;
  for (;;) {
    const page = await restRequest(path, { headers: { Range: `${offset}-${offset + PAGE_SIZE - 1}` } });
    if (!page || !page.length) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

function listLogRows(stationId, sinceISO) {
  return restRequestAllPages(
    `efficiency_log?station_id=eq.${encodeURIComponent(stationId)}&ts=gte.${encodeURIComponent(sinceISO)}&select=ts,boiler_eff,chp_eff,steam_rate,elec_output&order=ts.asc`
  );
}

// Full rows (all logged fields) for the Daily Report, which needs the raw
// live values behind the efficiency numbers, not just the two averages.
function listLogRowsFull(stationId, sinceISO) {
  return restRequestAllPages(
    `efficiency_log?station_id=eq.${encodeURIComponent(stationId)}&ts=gte.${encodeURIComponent(sinceISO)}&select=ts,boiler_eff,chp_eff,steam_rate,steam_pressure,feed_temp,elec_output,exhaust_pressure,fuel_rate&order=ts.asc`
  );
}

module.exports = {
  configured,
  listStations,
  listStationsFull,
  getStation,
  getStationOrDefault,
  upsertStation,
  insertLogRows,
  listLogRows,
  listLogRowsFull,
};
