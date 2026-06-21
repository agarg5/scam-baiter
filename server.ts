import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { validateSignalWireSignature } from './services/security';
import inboundRouter from './routes/inbound';
import outboundRouter from './routes/outbound';
import smsRouter from './routes/sms';
import dashboardRouter from './routes/dashboard';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/inbound', validateSignalWireSignature, inboundRouter);
app.use('/api/call', outboundRouter);
app.use('/sms', validateSignalWireSignature, smsRouter);
app.use('/dashboard', dashboardRouter);

// Health check
app.get('/', (_req: Request, res: Response) => res.json({ status: 'ok', service: 'scam-baiter' }));

// Call status callback (SignalWire fires this on call state changes — kept for
// SMS-originated status updates and general diagnostics)
app.post('/call-status', validateSignalWireSignature, (req: Request, res: Response) => {
  console.log(`[Status] Call ${req.body.CallSid}: ${req.body.CallStatus}`);
  res.sendStatus(200);
});

// ── HTTP Server ───────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8000;
const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`\n🎭 Scam Baiter running on port ${PORT}`);
  console.log(`   Outbound API:     POST /api/call`);
  console.log(`   Log sync:         GET  /api/call/sync`);
  console.log(`   SMS webhook:      POST /sms`);
  console.log(`   Dashboard:        GET  /dashboard`);
  console.log(`   Inbound calls handled by VocalBridge — configure VB phone numbers`);
  console.log('');
});
