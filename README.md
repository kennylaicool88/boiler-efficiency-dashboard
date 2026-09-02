# Boiler Efficiency Dashboard

Direct-method and CHP boiler efficiency dashboard for a fibre/shell-fired
boiler, with a live data feed from InfluxDB for steam output, steam
pressure, feedwater temperature, turbine electrical output, and turbine
exhaust (BPV) pressure. Supports monitoring multiple stations
(customers/mills) via a station switcher, with stations added/edited
directly from the app. Also logs efficiency snapshots on a schedule so
hourly/daily history can be charted and traced over time.

- `index.html` — the dashboard. Sidebar has a station selector plus
  Dashboard / Live Data Feed / Settings / Hidden Data / History sections.
  Settings includes an Add/Edit Station form (field mapping + Fuel
  Profile) and an All Stations list.
- `connect.html` — standalone legacy connection-status page (superseded
  by the in-page Settings section, kept for direct-URL access).
- `api/live-data.js` — queries InfluxDB server-side for the selected
  station (`?station=<id>`, defaults to the first station) and returns
  its live fields as JSON. Polled by `index.html`; the InfluxDB token
  never reaches the browser.
- `api/health.js` — connection/status check for a station.
- `api/stations.js` — `GET` lists stations; `POST` adds/updates a
  station (field mapping + Fuel Profile), used by the Add/Edit form.
- `api/log-snapshot.js` — computes and logs one efficiency snapshot per
  station. Called on a schedule by GitHub Actions, not by the browser;
  protected by a shared secret (`x-log-secret` header).
- `api/efficiency-history.js` — aggregates the logged snapshots into
  hourly averages (for one cycle day) and daily averages (last N days),
  used by the History section's chart and table.
- `api/_supabase.js` — thin REST helper for Supabase (service_role key,
  server-side only).
- `api/_influx.js` — shared InfluxDB query logic (used by `live-data.js`
  and `log-snapshot.js`).
- `api/_efficiency.js` — shared boiler/CHP efficiency math (mirrors
  `index.html`'s client-side calculation exactly), used by
  `log-snapshot.js` so logged history matches what the dashboard itself
  would show.
- `.github/workflows/log-snapshot.yml` — GitHub Actions workflow that
  calls `api/log-snapshot.js` every 5 minutes.

Station data lives in Supabase, not the repo. Table `stations`: `id`,
`name`, `fields` (jsonb — the 5 dashboard fields, each either
`{ measurement, field, id, unit }` for a live InfluxDB tag, or
`{ manual: true, unit, defaultValue? }` for a field with no live
sensor), `fuel_profile` (jsonb — FFB throughput + fuel mix + GCV, used
only by the background logger since fuel data isn't live-fed). Table
`efficiency_log`: one row per station per snapshot (timestamp, boiler
efficiency, CHP efficiency, and the raw live values behind them).

**Cycle day**: a mill "day" runs 07:00–06:59:59 the next calendar day
(Malaysia time, UTC+8, hardcoded in `api/efficiency-history.js`).
Hourly/daily aggregation in the History section is bucketed on this
cycle, not the calendar day.

## Deploying

Static site + Vercel serverless functions — no build step. Push to
GitHub with a Vercel project linked to the repo; every push to the
production branch redeploys automatically. The repo is public (no
secrets are ever committed — all tokens are Vercel/GitHub secrets) so
GitHub Actions minutes are unlimited and free.

### 1. Set Vercel environment variables

Project → **Settings → Environment Variables**:

| Name | Example |
|---|---|
| `INFLUX_URL` | `https://your-influxdb-host:8086` |
| `INFLUX_TOKEN` | a **read-only** API token scoped to the bucket |
| `INFLUX_ORG` | your org name |
| `INFLUX_BUCKET` | your bucket name |
| `SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role secret key |
| `LOG_SNAPSHOT_SECRET` | any random string — shared with the GitHub Actions secret of the same name |

All read server-side only — never sent to the browser or committed.

### 2. Set up the Supabase tables (one-time)

In the Supabase SQL Editor:

```sql
create table stations (
  id text primary key,
  name text not null,
  fields jsonb not null,
  fuel_profile jsonb,
  created_at timestamptz default now()
);
alter table stations enable row level security;

create table efficiency_log (
  id bigint generated always as identity primary key,
  station_id text not null references stations(id) on delete cascade,
  ts timestamptz not null default now(),
  boiler_eff numeric,
  chp_eff numeric,
  steam_rate numeric,
  steam_pressure numeric,
  feed_temp numeric,
  elec_output numeric,
  exhaust_pressure numeric,
  fuel_rate numeric
);
create index efficiency_log_station_ts_idx on efficiency_log (station_id, ts desc);
alter table efficiency_log enable row level security;
```

RLS is enabled with **no policies** on both tables — unreachable via
Supabase's public API (the `anon` key), while the dashboard's
server-side functions (`service_role`, which bypasses RLS) work fine.

### 3. Set the GitHub Actions secret

Repo → **Settings → Secrets and variables → Actions → New repository
secret** → name it `LOG_SNAPSHOT_SECRET`, same value as the Vercel env
var above. This is what lets the scheduled workflow authenticate to
`api/log-snapshot.js`.

### 4. Add/edit stations

Use the Add/Edit Station form in the dashboard's Settings section — it
saves straight to Supabase and appears in the sidebar switcher
immediately. The **All Stations** list has an Edit button per station
to load its current mapping and Fuel Profile back into the form.

### 5. Verify

- Settings section shows whether env vars are set and InfluxDB is
  reachable for the selected station.
- History section shows the hourly chart and daily table once the
  GitHub Actions workflow has logged a few snapshots (check the
  Actions tab in GitHub for run status; `workflow_dispatch` lets you
  trigger one manually to test without waiting).

## Local development

```bash
npm install
npx vercel dev
```

`vercel dev` serves `index.html`/`connect.html` and runs the `/api`
functions locally, reading env vars from a local `.env` file (not
committed — see `.gitignore`).
