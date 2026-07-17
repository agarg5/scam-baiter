import 'dotenv/config';
import express, { Request, Response } from 'express';
import outboundRouter from './routes/outbound';
import dashboardRouter from './routes/dashboard';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api/call', outboundRouter);
app.use('/dashboard', dashboardRouter);

// Health check
app.get('/', (_req: Request, res: Response) => res.json({ status: 'ok', service: 'scam-baiter' }));

// ── HTTP Server ───────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`\n🎭 Scam Baiter running on port ${PORT}`);
  console.log(`   Outbound API:     POST /api/call`);
  console.log(`   Log sync:         GET  /api/call/sync`);
  console.log(`   Dashboard:        GET  /dashboard`);
  console.log(`   Inbound calls handled by VocalBridge — configure VB phone numbers`);
  console.log('');
});
