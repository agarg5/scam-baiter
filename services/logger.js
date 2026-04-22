const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const LOGS_DIR = path.join(__dirname, '..', 'logs', 'conversations');

// Ensure the log directory exists at startup
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Creates a new conversation log entry and returns a logger object.
 */
function createConversationLog({ direction, scammerNumber, ourNumber, persona = 'margaret' }) {
  const id = uuidv4();
  const startTime = new Date();
  const transcript = [];

  const log = {
    id,
    timestamp: startTime.toISOString(),
    direction,
    scammerNumber,
    ourNumber,
    duration_seconds: 0,
    transcript,
    persona,
  };

  function addTurn({ speaker, text, timestamp }) {
    transcript.push({ speaker, text, timestamp: timestamp || new Date().toISOString() });
  }

  function save() {
    const endTime = new Date();
    log.duration_seconds = Math.round((endTime - startTime) / 1000);

    const filename = `${startTime.toISOString().replace(/[:.]/g, '-')}_${id.slice(0, 8)}.json`;
    const filepath = path.join(LOGS_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(log, null, 2));
    console.log(`[Logger] Saved conversation log: ${filename}`);
    return filepath;
  }

  return { log, addTurn, save };
}

module.exports = { createConversationLog };
