import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

process.env.SOUS_DATA_PATH = join(mkdtempSync(join(tmpdir(), 'sous-proto-')), 'kitchen.json');
process.env.SOUS_BEDROCK = 'off';

let http: HttpServer;
let base: string;
let client: Client;
let tools: Tool[];

beforeAll(async () => {
  const { createApp } = await import('../src/index.js');
  http = createApp().listen(0);
  await new Promise(r => http.once('listening', r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  client = new Client({ name: 'protocol-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  ({ tools } = await client.listTools());
});

afterAll(async () => {
  await client.close();
  http.close();
});

/** Text of the first resource content block (text or blob union). */
const textOf = (res: { contents: Array<{ text?: unknown } | Record<string, unknown>> }) => String((res.contents[0] as { text?: unknown }).text ?? '');

const rawPost = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body)
  });

describe('tool metadata (MCP 2025-11-25)', () => {
  it('every tool has a title, icons, annotations, an object inputSchema and an outputSchema', () => {
    expect(tools.length).toBeGreaterThanOrEqual(17);
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.icons?.length, t.name).toBeGreaterThan(0);
      expect(t.annotations, t.name).toBeTruthy();
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(t.outputSchema, t.name).toBeTruthy();
      expect(t.description?.length ?? 0, t.name).toBeGreaterThan(20);
    }
  });

  it('tool names are unique snake_case ASCII under 64 characters', () => {
    const names = tools.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(n.length).toBeLessThanOrEqual(64);
    }
  });

  it('read-only tools declare readOnlyHint and the purchase tool is open-world and idempotent', () => {
    for (const n of ['pantry_check', 'meal_suggest', 'impact_report', 'food_safety_check', 'recipe_details', 'substitute_ingredient']) {
      expect(tools.find(t => t.name === n)?.annotations?.readOnlyHint, n).toBe(true);
    }
    const checkout = tools.find(t => t.name === 'shopping_checkout')!;
    expect(checkout.annotations).toMatchObject({ openWorldHint: true, idempotentHint: true, readOnlyHint: false });
  });

  it('every MCP Apps link points at a listed ui:// resource', async () => {
    const { resources } = await client.listResources();
    const uris = new Set(resources.map(r => r.uri));
    const linked = tools.map(t => (t._meta as any)?.ui?.resourceUri).filter(Boolean);
    expect(linked.length).toBeGreaterThanOrEqual(5);
    for (const u of linked) expect(uris.has(u), u).toBe(true);
  });
});

describe('resources, templates and prompts', () => {
  it('lists 3 sous:// data resources and 6 ui:// MCP Apps views', async () => {
    const { resources } = await client.listResources();
    const data = resources.filter(r => r.uri.startsWith('sous://'));
    const ui = resources.filter(r => r.uri.startsWith('ui://sous/'));
    expect(data.map(r => r.uri).sort()).toEqual(['sous://household', 'sous://impact', 'sous://pantry']);
    expect(ui).toHaveLength(6);
    for (const r of ui) expect(r.mimeType).toBe('text/html;profile=mcp-app');
  });

  it('reads household, pantry and impact as JSON', async () => {
    const household = JSON.parse(textOf(await client.readResource({ uri: 'sous://household' })));
    expect(household.members.map((m: any) => m.name)).toContain('Leo');
    const pantry = JSON.parse(textOf(await client.readResource({ uri: 'sous://pantry' })));
    expect(pantry.length).toBeGreaterThan(5);
    expect(pantry[0]).toHaveProperty('expiresInDays');
    const impact = JSON.parse(textOf(await client.readResource({ uri: 'sous://impact' })));
    expect(impact).toHaveProperty('rescuedUsd');
  });

  it('serves view HTML that speaks the MCP Apps handshake', async () => {
    const res = await client.readResource({ uri: 'ui://sous/cook.html' });
    expect(res.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    expect(textOf(res)).toMatch(/ui\/initialize/);
  });

  it('reads a recipe through the sous://recipe/{id} template', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map(t => t.uriTemplate)).toContain('sous://recipe/{id}');
    const recipe = JSON.parse(textOf(await client.readResource({ uri: 'sous://recipe/spinach-chickpea-curry' })));
    expect(recipe.title).toBe('Spinach & Chickpea Coconut Curry');
    expect(recipe.steps.length).toBeGreaterThan(3);
  });

  it('errors on an unknown recipe and an unknown resource', async () => {
    await expect(client.readResource({ uri: 'sous://recipe/nope' })).rejects.toThrow();
    await expect(client.readResource({ uri: 'sous://nothing-here' })).rejects.toThrow();
  });

  it('renders the plan_tonight prompt with maxMinutes and the use_it_up_week prompt', async () => {
    const tonight = await client.getPrompt({ name: 'plan_tonight', arguments: { maxMinutes: '20' } });
    expect((tonight.messages[0].content as any).text).toMatch(/under 20 minutes/);
    const week = await client.getPrompt({ name: 'use_it_up_week' });
    expect((week.messages[0].content as any).text).toMatch(/meal_plan_set/);
    await expect(client.getPrompt({ name: 'nope' })).rejects.toThrow();
  });
});

describe('tool calls and errors', () => {
  it('rejects an unknown tool', async () => {
    const outcome = await client.callTool({ name: 'no_such_tool', arguments: {} }).then(r => (r.isError ? 'isError' : 'ok'), () => 'rejected');
    expect(['isError', 'rejected']).toContain(outcome);
  });

  it('returns structuredContent plus matching spoken text', async () => {
    const res = await client.callTool({ name: 'pantry_check', arguments: { filter: 'expiring', withinDays: 2 } });
    const sc = res.structuredContent as any;
    expect(sc.ok).toBe(true);
    expect((res.content as any)[0].text).toBe(sc.speech);
    expect(sc.data.expiringSoon.every((i: any) => i.expiresInDays <= 2)).toBe(true);
  });

  it('answers ping', async () => {
    await expect(client.ping()).resolves.toBeTruthy();
  });
});

describe('Streamable HTTP transport', () => {
  it('reports protocol, transport and tools on /healthz', async () => {
    const h = await (await fetch(`${base}/healthz`)).json();
    expect(h).toMatchObject({ ok: true, name: 'sous', protocol: '2025-11-25', transport: 'streamable-http', mcp: '/mcp', mode: 'sessions' });
    expect(h.tools).toBeGreaterThanOrEqual(17);
  });

  it('issues an Mcp-Session-Id on initialize', async () => {
    const res = await rawPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } });
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
    await res.body?.cancel();
  });

  it('rejects a non-initialize POST without a session with 400', async () => {
    const res = await rawPost({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown session id', async () => {
    const del = await fetch(`${base}/mcp`, { method: 'DELETE', headers: { 'mcp-session-id': 'not-a-real-session' } });
    expect(del.status).toBe(404);
    const post = await rawPost({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'mcp-session-id': 'not-a-real-session' });
    expect(post.status).toBe(404);
  });

  it('rejects GET without a session id with 400', async () => {
    const res = await fetch(`${base}/mcp`, { headers: { accept: 'text/event-stream' } });
    expect(res.status).toBe(400);
  });

  it('exposes Mcp-Session-Id to browsers via CORS', async () => {
    const res = await fetch(`${base}/mcp`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-expose-headers')).toMatch(/Mcp-Session-Id/);
  });
});
