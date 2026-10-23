import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { bedrockConfig, bedrockStatus } from './aws/bedrock.js';
import { getSession, resetSessions } from './agent/agent.js';
import { impact, pantryView } from './domain/kitchen.js';
import { activeTimers, getState, resetState } from './domain/store.js';
import { SERVER_VERSION, TOOL_NAMES, createSousServer } from './mcp/server.js';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const MCP_PATH = '/mcp';
const SELF_MCP_URL = process.env.SOUS_MCP_URL ?? `http://127.0.0.1:${PORT}${MCP_PATH}`;
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean);
const SESSION_TTL_MS = 60 * 60 * 1000;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // CORS so MCP Inspector and remote agents can connect; Mcp-Session-Id must be readable by browsers.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID');
    res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id, Mcp-Protocol-Version');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  // ---------- MCP: Streamable HTTP (spec 2025-11-25), one endpoint, sessions via Mcp-Session-Id ----------
  type Session = { transport: StreamableHTTPServerTransport; server: Server; lastSeen: number };
  const sessions = new Map<string, Session>();
  const security = ALLOWED_HOSTS.length ? { enableDnsRebindingProtection: true, allowedHosts: ALLOWED_HOSTS } : {};

  const rpcError = (res: Response, status: number, code: number, message: string) =>
    res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

  app.post(MCP_PATH, async (req: Request, res: Response) => {
    const sid = req.header('mcp-session-id');
    try {
      if (sid) {
        const s = sessions.get(sid);
        if (!s) return rpcError(res, 404, -32001, 'Session not found; re-initialize');
        s.lastSeen = Date.now();
        return await s.transport.handleRequest(req, res, req.body);
      }
      if (!isInitializeRequest(req.body)) {
        return rpcError(res, 400, -32000, 'Bad Request: send initialize first (no Mcp-Session-Id)');
      }
      const server = createSousServer();
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: id => { sessions.set(id, { transport, server, lastSeen: Date.now() }); },
        ...security
      });
      transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request failed', err);
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal error');
    }
  });

  // GET opens the server-to-client SSE stream; DELETE ends the session.
  const bySession = async (req: Request, res: Response) => {
    const sid = req.header('mcp-session-id');
    const s = sid ? sessions.get(sid) : undefined;
    if (!s) return rpcError(res, sid ? 404 : 400, -32001, sid ? 'Session not found' : 'Missing Mcp-Session-Id');
    s.lastSeen = Date.now();
    await s.transport.handleRequest(req, res);
  };
  app.get(MCP_PATH, bySession);
  app.delete(MCP_PATH, bySession);

  setInterval(() => {
    for (const [id, s] of sessions) if (Date.now() - s.lastSeen > SESSION_TTL_MS) { void s.transport.close(); sessions.delete(id); }
  }, 60_000).unref();

  // ---------- Alexa+ simulator API (the agent is a real MCP client of /mcp) ----------
  app.post('/api/converse', async (req, res) => {
    const text = String(req.body?.text ?? '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: 'text is required' });
    try {
      const session = getSession(req.body?.sessionId, SELF_MCP_URL);
      res.json(await session.converse(text));
    } catch (err) {
      console.error('[agent] converse failed', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/tool', async (req, res) => {
    const name = String(req.body?.name ?? '');
    if (!TOOL_NAMES().includes(name)) return res.status(400).json({ error: `Unknown tool ${name}` });
    try {
      const session = getSession(req.body?.sessionId, SELF_MCP_URL);
      res.json(await session.touch(name, (req.body?.arguments ?? {}) as Record<string, unknown>));
    } catch (err) {
      console.error('[agent] tool failed', err);
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/state', (_req, res) => {
    const s = getState();
    const atRisk = pantryView(s).filter(p => p.expiresInDays !== null && p.expiresInDays >= 0 && p.expiresInDays <= 3);
    res.json({ timers: activeTimers(), impact: impact(s), household: s.household, cooking: s.cooking, atRisk, bedrock: bedrockStatus().available, bedrockStatus: bedrockStatus() });
  });

  app.post('/api/reset', async (_req, res) => {
    resetState();
    await resetSessions();
    res.json({ ok: true });
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true, name: 'sous', version: SERVER_VERSION, protocol: LATEST_PROTOCOL_VERSION, transport: 'streamable-http', mcp: MCP_PATH, tools: TOOL_NAMES().length, bedrock: bedrockStatus() }));

  // ---------- web: landing page and the Echo Show simulator ----------
  const web = resolve('web');
  app.get('/device', (_req, res) => {
    const file = resolve(web, 'device.html');
    if (existsSync(file)) return res.sendFile(file);
    res.status(503).send('Simulator not built yet.');
  });
  app.use(express.static(web, { extensions: ['html'] }));

  return app;
}

const isMain = process.argv[1] && resolve(process.argv[1]).endsWith(resolve('src/index.ts').split('/').slice(-2).join('/'));
if (isMain || process.env.SOUS_START === '1') {
  getState();
  createApp().listen(PORT, HOST, () => {
    console.log(`Sous MCP server  http://localhost:${PORT}${MCP_PATH}  (Streamable HTTP, protocol ${LATEST_PROTOCOL_VERSION})`);
    console.log(`Echo Show sim    http://localhost:${PORT}/device`);
    console.log(`Landing page     http://localhost:${PORT}/`);
    console.log(`Agent brain      ${bedrockConfig.enabled ? `Amazon Bedrock (${bedrockConfig.modelId}, ${bedrockConfig.region})` : 'deterministic rules (set AWS credentials to enable Bedrock)'}`);
  });
}
