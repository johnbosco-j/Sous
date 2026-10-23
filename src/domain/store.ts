import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEMO_HOUSEHOLD, DEMO_PANTRY, Household, INGREDIENT_BY_ID } from './catalog.js';

// One household's kitchen state, persisted as JSON so memory survives restarts and new Alexa+ sessions.

export interface PantryEntry { id: string; qty: number; expiresOn: string | null }
export interface CartLineState { id: string; qty: number; forRecipes: string[] }
export interface CartState {
  token: string;
  createdAt: string;
  lines: CartLineState[];
  status: 'draft' | 'placed';
  orderId?: string;
  eta?: string;
}
export interface CookSession { recipeId: string; stepIndex: number; startedAt: string }
export interface Timer { id: string; label: string; endsAt: string; seconds: number }
export interface RescueEntry { name: string; valueUsd: number; kg: number; date: string; recipeId: string }

export interface KitchenState {
  version: 1;
  household: Household;
  pantry: PantryEntry[];
  plan: { day: string; recipeId: string }[];
  carts: Record<string, CartState>;
  cooking: CookSession | null;
  timers: Timer[];
  rescued: RescueEntry[];
  mealsCooked: number;
}

export const DATA_PATH = resolve(process.env.SOUS_DATA_PATH ?? 'data/kitchen.json');

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(base: Date, days: number): string {
  return dayKey(new Date(base.getTime() + days * DAY_MS));
}

/** Whole days from today until a yyyy-mm-dd date (negative when already expired). */
export function daysUntil(expiresOn: string | null, now = new Date()): number | null {
  if (!expiresOn) return null;
  const [y, m, d] = expiresOn.split('-').map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / DAY_MS);
}

export function seedState(now = new Date()): KitchenState {
  // A few earlier rescues this week so the impact view tells a story from the first demo turn.
  const history: Array<[number, string, number]> = [[-6, 'chicken-thighs', 4], [-5, 'spinach', 1], [-4, 'banana', 3], [-3, 'greek-yogurt', 2], [-2, 'tomato', 3], [-1, 'cooked-rice', 2]];
  return {
    version: 1,
    household: structuredClone(DEMO_HOUSEHOLD),
    pantry: DEMO_PANTRY.map(([id, qty, days]) => ({ id, qty, expiresOn: days === null ? null : addDays(now, days) })),
    plan: [],
    carts: {},
    cooking: null,
    timers: [],
    rescued: history.map(([offset, id, qty]) => {
      const i = INGREDIENT_BY_ID.get(id)!;
      return { name: i.name, valueUsd: round2(i.priceUsd * qty), kg: round2(i.kg * qty), date: addDays(now, offset), recipeId: 'earlier' };
    }),
    mealsCooked: 6
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

let state: KitchenState | null = null;

export function getState(): KitchenState {
  if (state) return state;
  if (existsSync(DATA_PATH)) {
    try {
      state = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as KitchenState;
      return state;
    } catch {
      // Corrupt file: fall through to a fresh seed rather than failing a voice turn.
    }
  }
  state = seedState();
  save();
  return state;
}

export function save(): void {
  if (!state) return;
  mkdirSync(dirname(DATA_PATH), { recursive: true });
  writeFileSync(DATA_PATH, JSON.stringify(state, null, 2));
}

/** Apply a mutation and persist it. */
export function update<T>(fn: (s: KitchenState) => T): T {
  const s = getState();
  const out = fn(s);
  save();
  return out;
}

export function resetState(now = new Date()): KitchenState {
  state = seedState(now);
  save();
  return state;
}

/** Drop finished timers; returns the active ones. */
export function activeTimers(now = Date.now()): Timer[] {
  const s = getState();
  const live = s.timers.filter(t => new Date(t.endsAt).getTime() > now - 5000);
  if (live.length !== s.timers.length) {
    s.timers = live;
    save();
  }
  return live;
}
