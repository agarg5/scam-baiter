const fs = require('fs');
const path = require('path');

/**
 * Auto-load every persona module in this directory. To add a new persona,
 * drop a file like `myguy.js` here that exports:
 *
 *   {
 *     id: 'myguy',                 // unique key (used in ?persona=... and API)
 *     name: 'Display Name',
 *     description: 'One-liner shown in logs and the dashboard.',
 *     voiceId: 'elevenlabs_voice_id_or_null',
 *     systemPrompt: '...',         // main agent prompt
 *     outboundPrompt: '...',       // prepended with the opening line for outbound
 *   }
 *
 * Files starting with `_` or named `personas.js` are ignored.
 */
const PERSONAS = {};

for (const file of fs.readdirSync(__dirname)) {
  if (!file.endsWith('.js')) continue;
  if (file === 'personas.js' || file.startsWith('_')) continue;

  const mod = require(path.join(__dirname, file));
  if (!mod || !mod.id) {
    console.warn(`[personas] Skipping ${file}: missing "id" export`);
    continue;
  }
  if (PERSONAS[mod.id]) {
    console.warn(`[personas] Duplicate id "${mod.id}" in ${file}`);
    continue;
  }
  PERSONAS[mod.id] = mod;
}

const DEFAULT_PERSONA = process.env.DEFAULT_PERSONA || 'tyler';

function getPersona(name) {
  const key = name || DEFAULT_PERSONA;
  return PERSONAS[key] || PERSONAS[DEFAULT_PERSONA] || Object.values(PERSONAS)[0];
}

function listPersonas() {
  return Object.values(PERSONAS).map(({ id, name, description, voiceId }) => ({
    id,
    name,
    description,
    voiceId,
  }));
}

module.exports = { PERSONAS, getPersona, listPersonas };
