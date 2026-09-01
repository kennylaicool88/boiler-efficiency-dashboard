# Boiler Efficiency Dashboard

Direct-method and CHP boiler efficiency dashboard for a fibre/shell-fired
boiler, with an optional live data feed from InfluxDB for steam output,
steam pressure, feedwater temperature, turbine electrical output, and
turbine exhaust (BPV) pressure. Supports monitoring multiple stations
(customers/mills) from the same dashboard via a station switcher, and
stations can be added directly from the app — no code changes needed.

- `index.html` — the dashboard. Sidebar has a station selector plus
  Dashboard / Live Data Feed / Settings / Hidden Data sections. The
  Settings section includes an **Add Station** form.
- `connect.html` — standalone legacy connection-status page (the same
  info now also lives in the dashboard's in-page Settings section).
- `api/live-data.js` — Vercel serverless function that queries InfluxDB
  server-side for the currently selected station and returns its live
  fields as JSON (`?station=<id>`, defaults to the first station if
  omitted). Runs on every poll from `index.html`; the InfluxDB token
  never reaches the browser.
- `api/health.js` — connection/status check for a station (`?station=<id>`),
  used by the dashboard's Settings section and by `connect.html`.
- `api/stations.js` — `GET` lists configured stations (`id` + `name`)
  for the sidebar switcher; `POST` adds/updates a station (used by the
  Add Station form).
- `api/_supabase.js` — thin helper for talking to Supabase's REST API
  with the service_role key. Underscore prefix keeps Vercel from
  treating it as its own route.

Station data (name + field mappings) lives in a Supabase Postgres table
called `stations`, not in the repo — so adding a station doesn't require
a code push. Each row: `id` (text, e.g. `samysk-pom`), `name` (text),
`fields` (jsonb: `steamRate`/`steamPressure`/`feedTemp`/`elecOutput`/
`exhaustPressure`, each `{ measurement, field, id, unit }` pointing to
its real InfluxDB measurement/field/device-id).

## Deploying

This project is a static site + Vercel serverless functions — no build
step required. Push to GitHub with a Vercel project linked to the repo,
and every push to the production branch redeploys automatically.

### 1. Set environment variables

In the Vercel project → **Settings → Environment Variables**, add:

| Name | Example |
|---|---|
| `INFLUX_URL` | `https://your-influxdb-host:8086` |
| `INFLUX_TOKEN` | a **read-only** API token scoped to the bucket |
| `INFLUX_ORG` | your org name |
| `INFLUX_BUCKET` | your bucket name |
| `SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API → service_role secret key |

These are only ever read server-side — never sent to the browser or
committed to git. All stations share the same InfluxDB connection; what
differs per station is the device ids and measurement/field names,
stored in Supabase.

### 2. Set up the Supabase table (one-time)

In the Supabase SQL Editor:

```sql
create table stations (
  id text primary key,
  name text not null,
  fields jsonb not null,
  created_at timestamptz default now()
);

alter table stations enable row level security;
```

RLS is enabled with **no policies** — the table becomes unreachable via
Supabase's public API (the `anon` key), while the dashboard's server-side
functions (using `service_role`, which bypasses RLS) keep working fine.

### 3. Add stations

Use the **Add Station** form in the dashboard's Settings section (name,
station id, and the 5 fields' measurement/field/device-id) — it saves
straight to Supabase and the station appears in the sidebar switcher
immediately. Alternatively, insert a row into the `stations` table
directly in Supabase.

### 4. Verify

Open the dashboard's **Settings** section (left sidebar) — it shows
whether the env vars are set, whether InfluxDB is reachable, and the
current field mapping for whichever station is selected. The dashboard
connects automatically on load once InfluxDB is reachable.

## Local development

```bash
npm install
npx vercel dev
```

`vercel dev` serves `index.html`/`connect.html` and runs the `/api`
functions locally, reading env vars from a local `.env` file (not
committed — see `.gitignore`).
