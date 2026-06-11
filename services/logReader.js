const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs', 'conversations');

/**
 * Read every saved conversation log, newest first. Malformed files are skipped
 * rather than crashing the dashboard.
 */
function readConversations() {
  if (!fs.existsSync(LOGS_DIR)) return [];

  const files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith('.json'));
  const convos = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, file), 'utf8'));
      convos.push({ file, ...data });
    } catch (err) {
      console.error(`[logReader] Skipping ${file}:`, err.message);
    }
  }
  convos.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return convos;
}

/**
 * Aggregate stats across all conversations: total time wasted, call counts,
 * and a per-persona breakdown.
 */
function computeStats(convos) {
  const stats = {
    totalCalls: convos.length,
    totalSeconds: 0,
    byPersona: {},
    byDirection: { inbound: 0, outbound: 0 },
  };

  for (const c of convos) {
    const secs = Number(c.duration_seconds) || 0;
    stats.totalSeconds += secs;

    const p = c.persona || 'unknown';
    if (!stats.byPersona[p]) stats.byPersona[p] = { calls: 0, seconds: 0 };
    stats.byPersona[p].calls += 1;
    stats.byPersona[p].seconds += secs;

    if (c.direction === 'outbound') stats.byDirection.outbound += 1;
    else stats.byDirection.inbound += 1;
  }

  return stats;
}

module.exports = { readConversations, computeStats, LOGS_DIR };
