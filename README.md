# Boiler Efficiency Dashboard

Direct-method and CHP boiler efficiency dashboard for a fibre/shell-fired
boiler, with an optional live data feed from InfluxDB for steam output,
steam pressure, feedwater temperature, turbine electrical output, and
turbine exhaust (BPV) pressure.

- `index.html` — the dashboard.
- `connect.html` — InfluxDB connection status and setup instructions.
- `api/live-data.js` — Vercel serverless function that queries InfluxDB
  server-side and returns the live fields as JSON. Runs on every request
  from `index.html`; the InfluxDB token never reaches the browser.
- `api/health.js` — connection/status check used by `connect.html`.
- `api/_fieldMap.js` — maps the five dashboard fields to your real
  InfluxDB measurement, field, and device (`id` tag) names. Edit this to
  match your bucket — each field carries its own device id, since the
  boiler, turbine, and BPV meters are separate devices.

## Deploying

This project is a static site + Vercel serverless functions — no build
step required. Push to GitHub with a Vercel project linked to the repo,
and every push to the production branch redeploys automatically.

### 1. Set InfluxDB environment variables

In the Vercel project → **Settings → Environment Variables**, add:

| Name | Example |
|---|---|
| `INFLUX_URL` | `https://your-influxdb-host:8086` |
| `INFLUX_TOKEN` | a **read-only** API token scoped to the bucket |
| `INFLUX_ORG` | your org name |
| `INFLUX_BUCKET` | your bucket name |

These are only ever read server-side by `api/live-data.js` and
`api/health.js` — they're never sent to the browser or committed to git.
Device IDs (which mill/meter each field belongs to) live in
`api/_fieldMap.js`, not as env vars, since there are several of them.

### 2. Match your real InfluxDB tag names

`api/_fieldMap.js` maps `steamRate`, `steamPressure`, `feedTemp`,
`elecOutput`, and `exhaustPressure` to their real measurement/field/id
in InfluxDB. If your tag names change, edit that file and push — Vercel
redeploys automatically.

### 3. Verify

Open `/connect.html` on the deployed site — it shows whether the env
vars are set, whether InfluxDB is reachable, and the current field
mapping (including which device id each field maps to). The dashboard
itself connects automatically on load once InfluxDB is reachable.

## Local development

```bash
npm install
npx vercel dev
```

`vercel dev` serves `index.html`/`connect.html` and runs the `/api`
functions locally, reading `INFLUX_*` from a local `.env` file (not
committed — see `.gitignore`).
