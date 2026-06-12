import fs from 'fs';
import path from 'path';
import type { Persona, PersonaSummary } from '../types';

/**
 * Auto-load every persona module in this directory. To add a new persona,
 * drop a file like `myguy.ts` here that does `export = { ...persona }` with:
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
 * Files starting with `_` or named `personas.*` are ignored. At runtime this
 * runs from dist/prompts and loads the compiled .js persona files.
 */
const PERSONAS: Record<string, Persona> = {};

for (const file of fs.readdirSync(__dirname)) {
  if (!file.endsWith('.js') && !file.endsWith('.ts')) continue;
  if (file.endsWith('.d.ts')) continue;
  const base = file.replace(/\.(js|ts)$/, '');
  if (base === 'personas' || file.startsWith('_')) continue;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(path.join(__dirname, file)) as Persona;
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

function getPersona(name?: string): Persona {
  const key = name || DEFAULT_PERSONA;
  return PERSONAS[key] || PERSONAS[DEFAULT_PERSONA] || Object.values(PERSONAS)[0];
}

function listPersonas(): PersonaSummary[] {
  return Object.values(PERSONAS).map(({ id, name, description, voiceId }) => ({
    id,
    name,
    description,
    voiceId,
  }));
}

export { PERSONAS, getPersona, listPersonas };
