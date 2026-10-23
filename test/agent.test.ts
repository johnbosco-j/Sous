import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SOUS_DATA_PATH = join(mkdtempSync(join(tmpdir(), 'sous-agent-')), 'kitchen.json');

// Scripted stand-in for Amazon Bedrock's Converse API: each call pops the next model reply.
const replies: any[] = [];
const seen: any[] = [];
vi.mock('../src/aws/bedrock.js', () => ({
  bedrockAvailable: () => true,
  bedrockStatus: () => ({ enabled: true, available: true }),
  bedrockConfig: { enabled: true, modelId: 'mock', region: 'us-east-1', timeoutMs: 1000 },
  improviseRecipe: async () => { throw new Error('not used'); },
  converse: async (input: any) => {
    seen.push(input);
    const next = replies.shift();
    if (!next) throw new Error('no scripted reply');
    return next;
  }
}));

const toolUse = (name: string, input: object, id = `tu_${name}`) => ({
  stopReason: 'tool_use',
  output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: id, name, input } }] } }
});
const say = (text: string) => ({ stopReason: 'end_turn', output: { message: { role: 'assistant', content: [{ text }] } } });

let http: HttpServer;
let getSession: typeof import('../src/agent/agent.js').getSession;
let mcpUrl: string;

beforeAll(async () => {
  const { createApp } = await import('../src/index.js');
  ({ getSession } = await import('../src/agent/agent.js'));
  http = createApp().listen(0);
  await new Promise(r => http.once('listening', r));
  mcpUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
});

afterAll(() => {
  http.close();
});

describe('Bedrock-driven Alexa+ agent over MCP', () => {
  it('maps MCP tools to Bedrock toolConfig and runs the tool loop', async () => {
    replies.push(toolUse('meal_suggest', { count: 3 }), say('Tonight I would make the curry.'));
    const res = await getSession('test-session-1', mcpUrl).converse('What should we cook tonight?');
    expect(res.engine).toBe('bedrock');
    expect(res.toolCalls.map(c => c.name)).toEqual(['meal_suggest']);
    expect(res.speech).toBe('Tonight I would make the curry.');
    expect(res.ui?.resourceUri).toBe('ui://sous/meals.html');
    const specs = seen[0].toolConfig.tools.map((t: any) => t.toolSpec.name);
    expect(specs).toContain('shopping_checkout');
    // The tool result went back to the model as a toolResult block
    const result = seen[1].messages.find((m: any) => m.content?.[0]?.toolResult);
    expect(result.role).toBe('user');
    expect(result.content[0].toolResult.toolUseId).toBe('tu_meal_suggest');
    expect(JSON.parse(result.content[0].toolResult.content[0].text).tool).toBe('meal_suggest');
  });

  it('blocks a model that tries to buy without the person saying yes', async () => {
    const s = getSession('test-session-2', mcpUrl);
    replies.push(toolUse('shopping_cart_build', { items: [{ name: 'milk' }] }), say('Cart ready.'));
    const built = await s.converse('Add milk to the cart');
    const token = s.lastCartToken!;
    expect(token).toMatch(/^cart_/);
    expect(built.toolCalls[0].name).toBe('shopping_cart_build');

    // The model jumps ahead and sets confirmed=true although the person only asked a question.
    replies.push(toolUse('shopping_checkout', { cartToken: token, confirmed: true }), say('Ordered!'));
    const sneaky = await s.converse('How much is it?');
    const result = sneaky.ui?.toolResult.structuredContent as any;
    expect(sneaky.toolCalls[0].arguments.confirmed).toBe(false);
    expect(result.data.status).toBe('awaiting_confirmation');

    // An explicit yes places it, deterministically, through the pending followUp.
    const yes = await s.converse('Yes, place the order');
    expect((yes.ui?.toolResult.structuredContent as any).data.status).toBe('placed');
  });
});
