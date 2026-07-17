import express, { Request, Response } from 'express';
import { getPersona, listPersonas } from '../prompts/personas';
import { requireApiKey } from '../services/security';
import { writeConversationLog } from '../services/logger';
import * as vocalbridge from '../services/vocalbridge';
import { maskPhone } from '../services/redact';
import type { Direction, Persona } from '../types';

const router = express.Router();

/**
 * GET /api/call/personas
 * Returns the list of available personas for the dashboard / CLI tooling.
 */
router.get('/personas', (_req: Request, res: Response) => {
  res.json({ personas: listPersonas() });
});

/**
 * POST /api/call
 * Body: { phoneNumber: "+1234567890", persona: "tyler" (optional) }
 *
 * Places an outbound call through VocalBridge. The VB agent identified by the
 * persona's agent mapping handles the full conversation. No local log is
 * written here — the transcript lives in VB and reaches the dashboard via
 * GET /api/call/sync, keyed by VB's session id.
 */
router.post('/', requireApiKey, async (req: Request, res: Response) => {
  const { phoneNumber, persona } = req.body as { phoneNumber?: string; persona?: string };

  if (!phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }

  const chosen = getPersona(persona);

  try {
    const result = await vocalbridge.placeCall(phoneNumber, chosen);

    console.log(`[Outbound] Call to ${maskPhone(phoneNumber)} as ${chosen.id}, call_id: ${result.call_id}`);
    res.json({
      success: true,
      callId: result.call_id,
      to: phoneNumber,
      persona: chosen.id,
      status: result.status,
    });
  } catch (err) {
    console.error('[Outbound] Failed to initiate call:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Sync one persona's VB sessions to local logs; returns how many were written. */
async function syncPersona(persona: Persona, limit: number, direction: Direction): Promise<{ synced: number; total: number }> {
  const logs = await vocalbridge.getCallLogs(persona, { limit });

  const results = await Promise.all(
    logs.map(async (entry) => {
      try {
        // The list endpoint sometimes includes the transcript already; only
        // fetch the per-session detail when it doesn't.
        const detail = entry.transcript
          ? entry
          : await vocalbridge.getCallTranscript(entry.session_id, persona);
        // Persist the VB-sourced log verbatim: this keeps VB's real
        // duration_seconds and writes to a deterministic vb-<session_id>.json
        // file so repeated syncs are idempotent instead of creating duplicates.
        await writeConversationLog(vocalbridge.toConversationLog(detail, persona, direction));
        return true;
      } catch (err) {
        console.warn(`[Sync] Skipping session ${entry.session_id}:`, (err as Error).message);
        return false;
      }
    })
  );

  return { synced: results.filter(Boolean).length, total: logs.length };
}

/**
 * GET /api/call/sync
 * Sync call logs from VocalBridge into the local logs directory so the
 * dashboard can display them. Syncs every persona's agent unless ?persona=
 * narrows it to one. VB's log entries don't say which side initiated the
 * call, so pass ?direction=inbound|outbound to label the batch (defaults to
 * inbound — scammers calling the published numbers is the primary flow).
 */
router.get('/sync', requireApiKey, async (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 20;
  const direction: Direction = req.query.direction === 'outbound' ? 'outbound' : 'inbound';
  const personas = req.query.persona
    ? [getPersona(req.query.persona as string)]
    : listPersonas().map((p) => getPersona(p.id));

  try {
    const perPersona: Record<string, { synced: number; total: number }> = {};
    for (const persona of personas) {
      try {
        perPersona[persona.id] = await syncPersona(persona, limit, direction);
      } catch (err) {
        // One persona without a VB agent mapping shouldn't sink the others.
        console.warn(`[Sync] Persona ${persona.id} failed:`, (err as Error).message);
        perPersona[persona.id] = { synced: 0, total: 0 };
      }
    }

    const synced = Object.values(perPersona).reduce((n, r) => n + r.synced, 0);
    const total = Object.values(perPersona).reduce((n, r) => n + r.total, 0);
    res.json({ synced, total, direction, personas: perPersona });
  } catch (err) {
    console.error('[Sync] Failed:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
