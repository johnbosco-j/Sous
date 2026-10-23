import { randomUUID } from 'node:crypto';
import type { Message, Tool as BedrockTool } from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { bedrockAvailable, converse } from '../aws/bedrock.js';
import { activeTimers, getState, Timer } from '../domain/store.js';
import { NO, PLAN_WEEK, YES, route } from './rules.js';

// The Alexa+ stand-in. It talks to Sous exactly like Alexa+ would: as an MCP client over Streamable HTTP.
// Brain: Amazon Bedrock (Converse + tool use) when credentials exist, else the deterministic router.

export interface ToolCallTrace { name: string; arguments: Record<string, unknown>; ms: number; ok: boolean }
export interface AgentResponse {
  speech: string;
  engine: 'bedrock' | 'rules';
  toolCalls: ToolCallTrace[];
  ui: null | { resourceUri: string; html: string; toolInput: Record<string, unknown>; toolResult: CallToolResult };
  timers: Timer[];
  sessionId: string;
}

interface FollowUp { prompt: string; tool: string; arguments: Record<string, unknown> }

const SYSTEM_PROMPT = `You are Alexa+, running on an Echo Show in a family kitchen. You help through the Sous tools (an MCP server).
Rules:
- Always use a tool for kitchen facts; never invent pantry contents, prices or recipes.
- Reply in one to three short spoken sentences. Usually just say the tool's "speech" field, lightly adapted. No markdown, no lists, no emojis.
- "What should we cook / what's for dinner" -> meal_suggest. "What's expiring" -> pantry_check. "Surprise me / something new" -> chef_improvise.
- "Let's cook the first one" -> cook_start with pick=1 (or the recipeId). While cooking, "next/back/repeat" -> cook_step.
- "Add what we're missing to the cart" -> shopping_cart_build with no arguments.
- shopping_checkout: confirmed=true ONLY if the user's latest message explicitly says yes to placing the order. Otherwise ask first.
- Remembering allergies or dislikes -> household_memory with action "remember".`;

const MAX_TOOL_ROUNDS = 4;

class AgentSession {
  readonly id: string;
  private client: Client | null = null;
  private tools: Tool[] = [];
  private uiCache = new Map<string, string>();
  private history: Message[] = [];
  pending: FollowUp | null = null;
  lastCartToken: string | null = null;
  lastSeen = Date.now();

  constructor(id: string, private mcpUrl: string) {
    this.id = id;
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    // Advertise MCP Apps support (extension io.modelcontextprotocol/ui), like a screen-equipped Alexa+ host.
    const client = new Client(
      { name: 'sous-alexa-plus-simulator', version: '1.0.0' },
      { capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } } as any }
    );
    const transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl));
    await client.connect(transport);
    this.tools = (await client.listTools()).tools;
    this.client = client;
    return client;
  }

  async close() {
    try { await this.client?.close(); } catch { /* already closed */ }
    this.client = null;
  }

  private resourceUriFor(name: string): string | null {
    const meta = this.tools.find(t => t.name === name)?._meta as Record<string, any> | undefined;
    return meta?.ui?.resourceUri ?? meta?.['ui/resourceUri'] ?? null;
  }

  private async html(uri: string): Promise<string> {
    const cached = this.uiCache.get(uri);
    if (cached && process.env.NODE_ENV === 'production') return cached;
    const res = await this.client!.readResource({ uri });
    const first = res.contents[0] as { text?: string };
    const text = first?.text ?? '';
    this.uiCache.set(uri, text);
    return text;
  }

  /** One MCP tools/call, with tracing and the host-side purchase gate. */
  private async call(name: string, args: Record<string, unknown>, turn: Turn): Promise<CallToolResult> {
    const client = await this.connect();
    if (name === 'shopping_checkout' && args.confirmed === true && !turn.consent) {
      // The model may not buy anything unless the person said yes (or tapped "Place order") in this very turn.
      args = { ...args, confirmed: false };
    }
    const t0 = Date.now();
    let result: CallToolResult;
    try {
      result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    } catch (err) {
      result = { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
    }
    const sc = result.structuredContent as Record<string, any> | undefined;
    turn.calls.push({ name, arguments: args, ms: Date.now() - t0, ok: !result.isError && sc?.ok !== false });
    this.pending = sc?.followUp?.tool ? sc.followUp : null;
    if (sc?.tool === 'shopping_cart_build' && sc.data?.cartToken) this.lastCartToken = sc.data.cartToken;
    if (sc?.tool === 'shopping_checkout' && sc.data?.status === 'placed') this.lastCartToken = null;
    const uri = this.resourceUriFor(name);
    if (uri && sc?.view) turn.ui = { resourceUri: uri, html: await this.html(uri), toolInput: args, toolResult: result };
    turn.lastSpeech = sc?.speech ?? (result.content?.[0] as { text?: string })?.text ?? turn.lastSpeech;
    return result;
  }

  async converse(text: string): Promise<AgentResponse> {
    this.lastSeen = Date.now();
    await this.connect();
    const turn = new Turn(YES.test(text) && !NO.test(text.replace(/\bno+t? (problem|worries)\b/i, '')));
    turn.userText = text;
    const lower = text.toLowerCase();

    // 1. A pending confirmation is resolved deterministically: a "yes" never depends on the model rebuilding arguments.
    if (this.pending) {
      const pending = this.pending;
      if (turn.consent && lower.split(/\s+/).length <= 8) {
        await this.call(pending.tool, { ...pending.arguments }, turn);
        return this.respond(turn, 'rules');
      }
      if (NO.test(lower) && lower.split(/\s+/).length <= 5) {
        this.pending = null;
        turn.lastSpeech = 'Okay, no problem.';
        return this.respond(turn, 'rules');
      }
    }
    // "Place the order" with a draft cart on screen is explicit consent for that cart.
    if (this.lastCartToken && /\b(place|confirm|complete)\b.*\border\b|\bcheck ?out\b/i.test(lower)) {
      turn.consent = true;
      await this.call('shopping_checkout', { cartToken: this.lastCartToken, confirmed: true }, turn);
      return this.respond(turn, 'rules');
    }

    if (bedrockAvailable()) {
      try {
        await this.bedrockTurn(text, turn);
        return this.respond(turn, 'bedrock');
      } catch (err) {
        console.warn(`[agent] Bedrock turn failed: ${(err as Error).message}`);
        // Never replay side effects: if Bedrock already called tools this turn, answer from those results.
        if (turn.calls.length) return this.respond(turn, 'bedrock');
        turn.reset();
      }
    }
    await this.rulesTurn(text, turn);
    return this.respond(turn, 'rules');
  }

  /** Direct tool call from a touch on an MCP App view (a tap is explicit consent for that action). */
  async touch(name: string, args: Record<string, unknown>): Promise<AgentResponse> {
    this.lastSeen = Date.now();
    const turn = new Turn(true);
    turn.userText = `(Tapped on screen: ${name})`;
    turn.lastResult = await this.call(name, args, turn);
    return this.respond(turn, 'rules');
  }

  private async rulesTurn(text: string, turn: Turn) {
    const r = route(text, { cooking: Boolean(getState().cooking), lastSuggestions: [] });
    if ('speech' in r) {
      turn.lastSpeech = r.speech;
      return;
    }
    if (r.tool === PLAN_WEEK) return this.planWeek(turn);
    await this.call(r.tool, r.args, turn);
  }

  /** Agentic chain: rank use-it-up dinners, save them as the plan, then build one cart for everything missing. */
  private async planWeek(turn: Turn) {
    const suggest = (await this.call('meal_suggest', { count: 3 }, turn)).structuredContent as any;
    const picks: { recipeId: string; title: string }[] = suggest?.data?.suggestions ?? [];
    if (!picks.length) return;
    const plan = (await this.call('meal_plan_set', { recipeIds: picks.map(p => p.recipeId) }, turn)).structuredContent as any;
    const cart = (await this.call('shopping_cart_build', {}, turn)).structuredContent as any;
    const days: { day: string; title: string }[] = plan?.data?.plan ?? [];
    const planned = days.map(d => `${d.title} ${d.day === 'Tonight' ? 'tonight' : `on ${d.day}`}`);
    const lines: { name: string }[] = cart?.data?.lines ?? [];
    const head = `I planned ${days.length} dinners around what expires first: ${planned.slice(0, -1).join(', ')}${planned.length > 1 ? ' and ' : ''}${planned[planned.length - 1]}.`;
    turn.lastSpeech = lines.length
      ? `${head} You're missing ${lines.map(l => l.name).slice(0, 4).join(', ')}: $${Number(cart.data.totalUsd).toFixed(2)} from Amazon Fresh, delivered today between 6 and 8. Should I place the order?`
      : `${head} You already have everything you need.`;
  }

  private async bedrockTurn(text: string, turn: Turn) {
    const toolSpecs: BedrockTool[] = this.tools.map(t => ({
      toolSpec: { name: t.name, description: (t.description ?? '').slice(0, 900), inputSchema: { json: sanitizeSchema(t.inputSchema) as any } }
    }));
    const hint = this.pending ? ` [Context: you just asked "${this.pending.prompt}". If the user agrees, call ${this.pending.tool} with ${JSON.stringify(this.pending.arguments)}.]` : '';
    const messages: Message[] = [...this.history, { role: 'user', content: [{ text: text + hint }] }];
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const out = await converse({
        system: [{ text: SYSTEM_PROMPT }],
        messages,
        toolConfig: { tools: toolSpecs },
        inferenceConfig: { maxTokens: 400, temperature: 0.2 }
      });
      const msg = out.output?.message;
      if (!msg) break;
      messages.push(msg);
      const uses = (msg.content ?? []).filter(c => c.toolUse).map(c => c.toolUse!);
      if (out.stopReason !== 'tool_use' || !uses.length) {
        const said = (msg.content ?? []).map(c => c.text ?? '').join(' ').replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
        if (said) turn.lastSpeech = said;
        break;
      }
      const results = [];
      for (const u of uses) {
        const res = await this.call(u.name!, (u.input ?? {}) as Record<string, unknown>, turn);
        const sc = res.structuredContent as Record<string, unknown> | undefined;
        const payload = JSON.stringify(sc ?? { text: (res.content?.[0] as { text?: string })?.text }).slice(0, 6000);
        results.push({ toolResult: { toolUseId: u.toolUseId!, content: [{ text: payload }], status: res.isError ? 'error' as const : 'success' as const } });
      }
      messages.push({ role: 'user', content: results });
    }
    // Keep a short rolling memory, always starting at a plain user turn so tool use/result pairs stay intact.
    let hist = messages;
    while (hist.length > 14) {
      const next = hist.findIndex((m, k) => k > 0 && m.role === 'user' && (m.content ?? []).some(c => c.text !== undefined));
      if (next <= 0) { hist = []; break; }
      hist = hist.slice(next);
    }
    this.history = hist;
  }

  private respond(turn: Turn, engine: 'bedrock' | 'rules'): AgentResponse {
    if (engine === 'rules') {
      this.history.push({ role: 'user', content: [{ text: turn.userText || '(no input)' }] }, { role: 'assistant', content: [{ text: turn.lastSpeech || 'Okay.' }] });
      // Bedrock requires alternating roles starting with user; rules turns are summarized as a pair.
      this.history = normalizeHistory(this.history);
    }
    return { speech: turn.lastSpeech || 'Okay.', engine, toolCalls: turn.calls, ui: turn.ui, timers: activeTimers(), sessionId: this.id };
  }
}

class Turn {
  calls: ToolCallTrace[] = [];
  ui: AgentResponse['ui'] = null;
  lastSpeech = '';
  lastResult: CallToolResult | null = null;
  userText = '';
  constructor(public consent: boolean) {}
  reset() {
    this.ui = null;
    this.lastSpeech = '';
  }
}

/** Make a history Bedrock accepts: starts with a user text turn, roles alternate. */
function normalizeHistory(h: Message[]): Message[] {
  const out: Message[] = [];
  for (const m of h) {
    if (!out.length && m.role !== 'user') continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) {
      if (m.role === 'assistant') out[out.length - 1] = { role: 'assistant', content: [...(prev.content ?? []), ...(m.content ?? [])].filter(c => c.text !== undefined).slice(-2) };
      else out.push({ role: 'assistant', content: [{ text: 'Okay.' }] }, m);
      continue;
    }
    out.push(m);
  }
  return out.slice(-14);
}

/** Bedrock tool schemas: plain JSON Schema objects without meta keys. */
function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === '$schema' || k === 'additionalProperties') continue;
    out[k] = sanitizeSchema(v);
  }
  return out;
}

const sessions = new Map<string, AgentSession>();

export function getSession(id: string | undefined, mcpUrl: string): AgentSession {
  const key = id && /^[\w-]{6,64}$/.test(id) ? id : randomUUID();
  let s = sessions.get(key);
  if (!s) {
    s = new AgentSession(key, mcpUrl);
    sessions.set(key, s);
  }
  // Evict idle simulator sessions
  for (const [k, v] of sessions) if (Date.now() - v.lastSeen > 60 * 60 * 1000) { void v.close(); sessions.delete(k); }
  return s;
}

export async function resetSessions() {
  for (const s of sessions.values()) await s.close();
  sessions.clear();
}
