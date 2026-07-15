import express, { Request, Response } from 'express';
import { getPersona, listPersonas } from '../prompts/personas';
import { requireApiKey } from '../services/security';
import { createConversationLog, writeConversationLog } from '../services/logger';
import * as vocalbridge from '../services/vocalbridge';
import { maskPhone } from '../services/redact';

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
 * persona's agent mapping handles the full conversation.
 */
router.post('/', requireApiKey, async (req: Request, res: Response) => {
  const { phoneNumber, persona } = req.body as { phoneNumber?: string; persona?: string };

  if (!phoneNumber) {
    return res.status(400).json({ error: 'phoneNumber is required' });
  }

  const chosen = getPersona(persona);

  try {
    const result = await vocalbridge.placeCall(phoneNumber, chosen);

    const logger = createConversationLog({
      direction: 'outbound',
      scammerNumber: phoneNumber,
      persona: chosen.id,
    });
    // Save an initial log entry; the full transcript is available via VB's
    // API and can be synced to the local dashboard with GET /api/call/sync.
    logger.save();

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

/**
 * GET /api/call/sync
 * Sync call logs from VocalBridge into the local logs directory so the
 * dashboard can display them.
 */
router.get('/sync', requireApiKey, async (req: Request, res: Response) => {
  const personaId = (req.query.persona as string) || process.env.DEFAULT_PERSONA || 'tyler';
  const chosen = getPersona(personaId);

  try {
    const logs = await vocalbridge.getCallLogs(chosen, {
      limit: Number(req.query.limit) || 20,
    });

    let synced = 0;
    for (const entry of logs) {
      try {
        const detail = await vocalbridge.getCallTranscript(entry.session_id, chosen);
        const log = vocalbridge.toConversationLog(detail, chosen);
        // Persist the VB-sourced log verbatim: this keeps VB's real
        // duration_seconds and writes to a deterministic vb-<session_id>.json
        // file so repeated syncs are idempotent instead of creating duplicates.
        writeConversationLog(log);
        synced++;
      } catch (err) {
        console.warn(`[Sync] Skipping session ${entry.session_id}:`, (err as Error).message);
      }
    }

    res.json({ synced, total: logs.length, persona: chosen.id });
  } catch (err) {
    console.error('[Sync] Failed:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
