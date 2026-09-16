const Anthropic = require('@anthropic-ai/sdk');
const { listStations, listLogRowsFull } = require('./_supabase');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_HISTORY_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 4000;
const DAILY_HISTORY_DAYS = 14;

// Mill operates on local time (Malaysia, UTC+8, no DST). A "cycle day" runs
// 07:00 to 06:59:59 the next calendar day — mirrors api/efficiency-history.js
// and api/daily-report.js.
const MILL_OFFSET_MS = 8 * 60 * 60 * 1000;
function cycleDayKey(d) {
  const local = new Date(d.getTime() + MILL_OFFSET_MS);
  const hour = local.getUTCHours();
  const key = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  if (hour < 7) key.setUTCDate(key.getUTCDate() - 1);
  return key.toISOString().slice(0, 10);
}

function fmtOrDash(v, d) {
  return v === null || v === undefined || !isFinite(v) ? '–' : v.toFixed(d);
}

function aggregateDaily(rows) {
  const dayMap = {};
  rows.forEach((r) => {
    const key = cycleDayKey(new Date(r.ts));
    if (!dayMap[key]) {
      dayMap[key] = { boilerSum: 0, boilerN: 0, chpSum: 0, chpN: 0, steamSum: 0, steamN: 0, fuelSum: 0, fuelN: 0, elecSum: 0, elecN: 0, samples: 0 };
    }
    const d = dayMap[key];
    d.samples++;
    if (r.boiler_eff !== null && r.boiler_eff !== undefined) { d.boilerSum += r.boiler_eff; d.boilerN++; }
    if (r.chp_eff !== null && r.chp_eff !== undefined) { d.chpSum += r.chp_eff; d.chpN++; }
    if (r.steam_rate !== null && r.steam_rate !== undefined) { d.steamSum += r.steam_rate; d.steamN++; }
    if (r.fuel_rate !== null && r.fuel_rate !== undefined) { d.fuelSum += r.fuel_rate; d.fuelN++; }
    if (r.elec_output !== null && r.elec_output !== undefined) { d.elecSum += r.elec_output; d.elecN++; }
  });
  return Object.keys(dayMap).sort().map((day) => {
    const d = dayMap[day];
    return {
      day,
      boilerEffAvg: d.boilerN ? d.boilerSum / d.boilerN : null,
      chpEffAvg: d.chpN ? d.chpSum / d.chpN : null,
      steamRateAvg: d.steamN ? d.steamSum / d.steamN : null,
      fuelRateAvg: d.fuelN ? d.fuelSum / d.fuelN : null,
      elecOutputAvg: d.elecN ? d.elecSum / d.elecN : null,
      samples: d.samples,
    };
  });
}

// Trailing DAILY_HISTORY_DAYS days of daily averages, plus the single most
// recent logged row (used as a "recent reading" for stations other than the
// one the browser is actively viewing — accurate to within one logging
// cycle, ~5 min, with no extra live InfluxDB query needed).
async function fetchStationLog(stationId) {
  const since = new Date(Date.now() - DAILY_HISTORY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = await listLogRowsFull(stationId, since); // ascending by ts
  return {
    dailyHistory: aggregateDaily(rows),
    latestRow: rows.length ? rows[rows.length - 1] : null,
  };
}

function dailyHistoryLines(dailyHistory) {
  if (!dailyHistory || !dailyHistory.length) return ['No logged daily history is available yet.'];
  return dailyHistory.map(
    (d) =>
      `- ${d.day}: boiler ${fmtOrDash(d.boilerEffAvg, 1)}%, CHP ${fmtOrDash(d.chpEffAvg, 1)}%, steam ${fmtOrDash(d.steamRateAvg, 1)} t/hr, fuel ${fmtOrDash(d.fuelRateAvg, 2)} t/hr, elec ${fmtOrDash(d.elecOutputAvg, 0)} kW (${d.samples} samples)`
  );
}

function latestRowLine(row) {
  if (!row) return 'No logged readings yet for this station.';
  const when = new Date(row.ts).toLocaleString();
  return (
    `Most recent logged snapshot (${when}): boiler eff ${fmtOrDash(row.boiler_eff, 1)}%, CHP eff ${fmtOrDash(row.chp_eff, 1)}%, ` +
    `steam ${fmtOrDash(row.steam_rate, 1)} t/hr, steam pressure ${fmtOrDash(row.steam_pressure, 1)} bar g, feedwater temp ${fmtOrDash(row.feed_temp, 1)} °C, ` +
    `elec output ${fmtOrDash(row.elec_output, 0)} kW, exhaust pressure ${fmtOrDash(row.exhaust_pressure, 2)} bar g, fuel rate ${fmtOrDash(row.fuel_rate, 2)} t/hr.`
  );
}

function buildSystemPrompt(ctx, selectedStationName, selectedDailyHistory, otherStations) {
  const lines = [
    'You are an assistant embedded in a boiler and CHP (combined heat & power) efficiency dashboard that monitors one or more fibre/shell-fired boilers at palm oil mills.',
    'Help the user interpret the numbers on their dashboard, answer questions about boiler/CHP efficiency, steam rate, fuel mix, trends over recent days, and — when more than one station is given below — compare stations against each other.',
    "Treat the data below as ground truth. Don't invent sensor values or history that aren't given, and say so if something you'd need isn't in the data provided.",
    'Keep answers concise and practical — a few sentences, or a short list when that helps.',
  ];

  lines.push(`\n## Currently viewed station: ${selectedStationName || 'unknown'}`);
  if (ctx.timestamp) lines.push(`As of: ${ctx.timestamp}`);

  if (ctx.live && typeof ctx.live === 'object') {
    const entries = Object.entries(ctx.live).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (entries.length) {
      lines.push('\nCurrent readings:');
      entries.forEach(([k, v]) => lines.push(`- ${k}: ${v}`));
    }
  }

  if (ctx.computed && typeof ctx.computed === 'object') {
    const entries = Object.entries(ctx.computed).filter(([, v]) => v !== undefined && v !== null && v !== '');
    if (entries.length) {
      lines.push('\nComputed metrics:');
      entries.forEach(([k, v]) => lines.push(`- ${k}: ${v}`));
    }
  }

  lines.push(`\nDaily averages, last ${selectedDailyHistory.length} day(s) with logged data (each "day" is a 07:00–06:59:59 mill cycle day, most recent last):`);
  lines.push(...dailyHistoryLines(selectedDailyHistory));

  if (otherStations && otherStations.length) {
    lines.push('\n## Other stations available for comparison:');
    otherStations.forEach((s) => {
      lines.push(`\n### ${s.name}`);
      lines.push(latestRowLine(s.latestRow));
      lines.push(`Daily averages, last ${s.dailyHistory.length} day(s):`);
      lines.push(...dailyHistoryLines(s.dailyHistory));
    });
  }

  return lines.join('\n');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { ANTHROPIC_API_KEY } = process.env;
  if (!ANTHROPIC_API_KEY) {
    res.status(500).json({
      error: 'AI chat not configured. Set ANTHROPIC_API_KEY as an environment variable in the Vercel project settings, then redeploy.',
    });
    return;
  }

  const body = req.body || {};
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  const requestedStation = body.station;

  const messages = rawMessages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    res.status(400).json({ error: 'Invalid message history — expected at least one user message.' });
    return;
  }

  let stations = [];
  try {
    stations = await listStations();
  } catch (err) {
    console.error('chat: failed to list stations, continuing with just the viewed station', err);
  }

  const selected = stations.find((s) => s.id === requestedStation) || stations[0] || null;
  const selectedStationName = context.stationName || (selected && selected.name) || requestedStation || null;

  let selectedDailyHistory = [];
  let otherStations = [];
  const results = await Promise.all(
    stations.map(async (s) => {
      try {
        const { dailyHistory, latestRow } = await fetchStationLog(s.id);
        return { id: s.id, name: s.name, dailyHistory, latestRow };
      } catch (err) {
        console.error(`chat: failed to load history for station ${s.id}, continuing without it`, err);
        return { id: s.id, name: s.name, dailyHistory: [], latestRow: null };
      }
    })
  );
  const selectedId = selected ? selected.id : null;
  selectedDailyHistory = results.find((r) => r.id === selectedId)?.dailyHistory || [];
  otherStations = results.filter((r) => r.id !== selectedId);

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1536,
      output_config: { effort: 'low' },
      system: buildSystemPrompt(context, selectedStationName, selectedDailyHistory, otherStations),
      messages,
    });

    if (response.stop_reason === 'refusal') {
      res.status(200).json({ reply: "I can't help with that one." });
      return;
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    res.status(200).json({ reply: textBlock ? textBlock.text : '' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reach the AI assistant', detail: String((err && err.message) || err) });
  }
};
