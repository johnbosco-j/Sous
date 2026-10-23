import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

process.env.SOUS_DATA_PATH = join(mkdtempSync(join(tmpdir(), 'sous-auth-')), 'kitchen.json');
process.env.SOUS_BEDROCK = 'off';

let http: HttpServer;
let url: URL;

beforeAll(async () => {
  process.env.SOUS_API_KEYS = 'kitchen-key-1,kitchen-key-2';
  const { createApp } = await import('../src/index.js');
  http = createApp().listen(0);
  await new Promise(r => http.once('listening', r));
  url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`);
  delete process.env.SOUS_API_KEYS;
});

afterAll(() => {
  http.close();
});

const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
const post = (headers: Record<string, string>) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(init) });

describe('optional API-key auth on /mcp', () => {
  it('rejects requests without a key', async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe(-32001);
  });

  it('rejects a wrong key', async () => {
    expect((await post({ authorization: 'Bearer nope' })).status).toBe(401);
  });

  it('accepts any configured key and completes an MCP session', async () => {
    const client = new Client({ name: 'auth-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer kitchen-key-2' } } }));
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(17);
    await client.close();
  });

  it('leaves CORS preflight open', async () => {
    const res = await fetch(url, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
  });
});
