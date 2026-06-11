const express = require('express');
const router = express.Router();
const { readConversations, computeStats } = require('../services/logReader');
const { requireDashboardKey } = require('../services/security');

/**
 * Escape user-controlled text before embedding in HTML. Transcripts contain
 * whatever the scammer typed, so this is the one thing we must not skip.
 */
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDuration(seconds) {
  const s = Math.round(Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  return `${m}m ${rem}s`;
}

function renderTranscript(turns = []) {
  if (!turns.length) return '<p class="muted">No transcript captured.</p>';
  return turns.map((t) => {
    const who = t.speaker === 'agent' ? 'agent' : 'scammer';
    return `<div class="turn ${who}"><span class="who">${esc(who)}</span>${esc(t.text)}</div>`;
  }).join('');
}

const STYLE = `
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; color: #1a1a1a; background: #fafafa; }
  h1 { margin-bottom: 4px; }
  .cards { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0 28px; }
  .card { background: #fff; border: 1px solid #e2e2e2; border-radius: 10px; padding: 14px 18px; flex: 1; min-width: 140px; }
  .card .num { font-size: 28px; font-weight: 700; }
  .card .label { color: #666; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e2e2; border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #eee; font-size: 14px; }
  th { background: #f3f3f3; }
  details { background: #fff; border: 1px solid #e2e2e2; border-radius: 10px; margin: 8px 0; padding: 8px 14px; }
  summary { cursor: pointer; font-weight: 600; }
  .meta { color: #666; font-size: 13px; margin: 6px 0 10px; }
  .turn { margin: 6px 0; padding: 8px 12px; border-radius: 8px; max-width: 80%; }
  .turn.scammer { background: #ffeaea; }
  .turn.agent { background: #e8f0ff; margin-left: auto; }
  .who { display: block; font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 2px; }
  .muted { color: #999; }
  h2 { margin-top: 32px; }
`;

/**
 * GET /dashboard
 * Renders an HTML overview of all saved conversations: total time wasted,
 * per-persona breakdown, and browsable transcripts.
 */
router.get('/', requireDashboardKey, (req, res) => {
  const convos = readConversations();
  const stats = computeStats(convos);

  const personaRows = Object.entries(stats.byPersona)
    .sort((a, b) => b[1].seconds - a[1].seconds)
    .map(([id, s]) => `<tr><td>${esc(id)}</td><td>${s.calls}</td><td>${fmtDuration(s.seconds)}</td></tr>`)
    .join('') || '<tr><td colspan="3" class="muted">No calls yet.</td></tr>';

  const keyQs = req.query.key ? `?key=${esc(req.query.key)}` : '';

  const convoBlocks = convos.map((c) => `
    <details>
      <summary>${esc(c.persona || 'unknown')} — ${esc(c.scammerNumber || 'unknown')} — ${fmtDuration(c.duration_seconds)} <span class="muted">(${esc(c.direction || '')}, ${esc((c.timestamp || '').slice(0, 16).replace('T', ' '))})</span></summary>
      <div class="meta">${(c.transcript || []).length} turns · log: ${esc(c.file || '')}</div>
      ${renderTranscript(c.transcript)}
    </details>
  `).join('') || '<p class="muted">No conversations logged yet.</p>';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Scam Baiter — Dashboard</title>
  <style>${STYLE}</style>
</head>
<body>
  <h1>🎭 Scam Baiter</h1>
  <p class="muted">Time wasted on scammers, by the numbers.</p>

  <div class="cards">
    <div class="card"><div class="num">${stats.totalCalls}</div><div class="label">total calls</div></div>
    <div class="card"><div class="num">${fmtDuration(stats.totalSeconds)}</div><div class="label">time wasted</div></div>
    <div class="card"><div class="num">${stats.byDirection.inbound}</div><div class="label">inbound</div></div>
    <div class="card"><div class="num">${stats.byDirection.outbound}</div><div class="label">outbound</div></div>
  </div>

  <h2>By persona</h2>
  <table>
    <thead><tr><th>Persona</th><th>Calls</th><th>Time wasted</th></tr></thead>
    <tbody>${personaRows}</tbody>
  </table>

  <h2>Conversations</h2>
  ${convoBlocks}

  <p class="muted" style="margin-top:32px">Refresh to update · <a href="/dashboard${keyQs}">reload</a></p>
</body>
</html>`;

  res.type('html').send(html);
});

module.exports = router;
