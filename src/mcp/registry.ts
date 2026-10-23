// Shared tool registry. Tool modules (src/mcp/tools/*.ts) register here on import; server.ts serves them over MCP.
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

export type View = 'meals' | 'cook' | 'cart' | 'pantry' | 'impact' | 'alert';

export interface FollowUp { prompt: string; tool: string; arguments: Record<string, unknown> }
export interface Envelope {
  ok: boolean;
  tool: string;
  speech: string;
  view?: View;
  data: Record<string, unknown>;
  followUp?: FollowUp;
}

export interface ToolDef<S extends z.ZodType> {
  name: string;
  title: string;
  description: string;
  input: S;
  annotations: Omit<ToolAnnotations, 'title'>;
  view?: View;
  icon: string;
  handler: (args: z.infer<S>) => Promise<Envelope> | Envelope;
}

export const tools: ToolDef<any>[] = [];

export function tool<S extends z.ZodType>(def: ToolDef<S>) {
  if (tools.some(t => t.name === def.name)) throw new Error(`Duplicate tool name: ${def.name}`);
  tools.push(def);
}

export function env(tool: string, speech: string, data: Record<string, unknown>, extra: Partial<Envelope> = {}): Envelope {
  return { ok: true, tool, speech, data, ...extra };
}

export function fail(tool: string, speech: string, data: Record<string, unknown> = {}): Envelope {
  return { ok: false, tool, speech, data };
}

/** Recipe ids from the most recent suggestion list ("cook the first one"). */
export const lastSuggestions: { ids: string[] } = { ids: [] };

/** "peanut" -> "peanuts" for speech. */
export function allergenWord(a: string): string {
  return ({ peanut: 'peanuts', 'tree-nut': 'tree nuts', egg: 'eggs' } as Record<string, string>)[a] ?? a;
}

// ---- voice routes contributed by tool modules (used by the offline router) ----
export type VoiceRoute = (lowerText: string) => { tool: string; args: Record<string, unknown> } | null;
export const voiceRoutes: VoiceRoute[] = [];
export function registerRoute(fn: VoiceRoute) {
  voiceRoutes.push(fn);
}
