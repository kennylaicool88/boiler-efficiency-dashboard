// Shared by api/stations.js, api/live-data.js, and api/health.js.
// Underscore prefix keeps Vercel from treating this as its own route.
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
  if (res.status === 204) return null;
  return res.json();
}

function listStations() {
  return restRequest('stations?select=id,name,fields&order=name.asc');
}

function getStation(id) {
  return restRequest(`stations?id=eq.${encodeURIComponent(id)}&select=id,name,fields`).then(
    (rows) => rows[0] || null
  );
}

// Looks up a specific station by id, or falls back to the first station
// (alphabetically by name) when no id is given.
async function getStationOrDefault(id) {
  if (id) return getStation(id);
  const rows = await restRequest('stations?select=id,name,fields&order=name.asc&limit=1');
  return rows[0] || null;
}

function upsertStation(station) {
  return restRequest('stations?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: [station],
  });
}

module.exports = { configured, listStations, getStation, getStationOrDefault, upsertStation };
