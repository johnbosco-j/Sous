import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

process.env.SOUS_DATA_PATH = join(mkdtempSync(join(tmpdir(), 'sous-')), 'kitchen.json');
process.env.SOUS_BEDROCK = 'off';

let http: HttpServer;
let url: URL;
let client: Client;
let transport: StreamableHTTPClientTransport;

beforeAll(async () => {
  const { createApp } = await import('../src/index.js');
  http = createApp().listen(0);
  await new Promise(r => http.once('listening', r));
  url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`);
  client = new Client({ name: 'test', version: '1' });
  transport = new StreamableHTTPClientTransport(url);
  await client.connect(transport);
});

afterAll(async () => {
  await client.close();
  http.close();
});

describe('MCP over Streamable HTTP', () => {
  it('negotiates protocol 2025-11-25 with a session id and instructions', () => {
    expect(transport.protocolVersion).toBe('2025-11-25');
    expect(transport.sessionId).toBeTruthy();
    expect(client.getInstructions()).toMatch(/Purchases/);
  });

  it('lists tools with annotations, output schemas and MCP Apps UI links', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(17);
    const suggest = tools.find(t => t.name === 'meal_suggest')!;
    expect(suggest.annotations?.readOnlyHint).toBe(true);
    expect(suggest.outputSchema).toBeTruthy();
    expect((suggest._meta as any).ui.resourceUri).toBe('ui://sous/meals.html');
    const checkout = tools.find(t => t.name === 'shopping_checkout')!;
    expect(checkout.annotations?.openWorldHint).toBe(true);
  });

  it('serves MCP App views as text/html;profile=mcp-app resources', async () => {
    const { resources } = await client.listResources();
    expect(resources.filter(r => r.uri.startsWith('ui://sous/'))).toHaveLength(6);
    const res = await client.readResource({ uri: 'ui://sous/meals.html' });
    expect(res.contents[0].mimeType).toBe('text/html;profile=mcp-app');
    expect((res.contents[0] as { text: string }).text).toMatch(/<html/i);
  });

  it('returns structuredContent that matches the envelope, plus spoken text', async () => {
    const res = await client.callTool({ name: 'meal_suggest', arguments: { count: 2 } });
    const sc = res.structuredContent as any;
    expect(sc.ok).toBe(true);
    expect(sc.view).toBe('meals');
    expect(sc.data.suggestions).toHaveLength(2);
    expect((res.content as any)[0].text).toBe(sc.speech);
  });

  it('rejects invalid arguments with a tool error, not a crash', async () => {
    const res = await client.callTool({ name: 'meal_suggest', arguments: { count: 99 } });
    expect(res.isError).toBe(true);
  });

  it('exposes prompts and resource templates', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map(p => p.name)).toEqual(['plan_tonight', 'use_it_up_week']);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates[0].uriTemplate).toBe('sous://recipe/{id}');
  });
});
