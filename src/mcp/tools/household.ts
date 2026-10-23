// Household & shopping tools: members, receipt import, the daily brief, order history, staples, delivery windows.
import { z } from 'zod';
import { INGREDIENT_BY_ID, RECIPE_BY_ID, findIngredient } from '../../domain/catalog.js';
import { buildCart, cartView, listPhrase, pantryView, suggestMeals } from '../../domain/kitchen.js';
import { activeTimers, addDays, dayKey, getState, update } from '../../domain/store.js';
import { allergenWord, env, fail, registerRoute, tool } from '../registry.js';

function ext(s: ReturnType<typeof getState>): { deliveryWindow?: { id: string; label: string } } {
  s.ext.household ??= {};
  return s.ext.household;
}

function cap(name: string): string {
  const n = name.trim();
  return n ? n[0].toUpperCase() + n.slice(1).toLowerCase() : n;
}

// ---------------- household_members ----------------

tool({
  name: 'household_members',
  title: 'Household members',
  description: 'List, add or remove the people Sous cooks for. Removing someone also removes their allergies from meal planning, and Sous always says so out loud.',
  input: z.object({
    action: z.enum(['list', 'add', 'remove']).default('list'),
    name: z.string().max(40).optional(),
    age: z.number().int().min(0).max(120).optional()
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '👨‍👩‍👧‍👦',
  handler: ({ action, name, age }) => {
    const h = getState().household;
    if (action === 'list') {
      const people = h.members.map(m => {
        const bits = [m.age !== undefined ? `${m.age}` : '', ...m.allergies.map(a => `allergic to ${allergenWord(a)}`)].filter(Boolean);
        return bits.length ? `${m.name} (${bits.join(', ')})` : m.name;
      });
      return env('household_members', `${h.name}: ${listPhrase(people)}.`, { members: h.members });
    }
    if (!name?.trim()) return fail('household_members', `Who should I ${action}?`, { members: h.members });
    const who = cap(name);
    const existing = h.members.find(m => m.name.toLowerCase() === who.toLowerCase());
    if (action === 'add') {
      if (existing) return fail('household_members', `${existing.name} is already in the household.`, { members: h.members });
      const members = update(s => {
        s.household.members.push({ name: who, ...(age !== undefined ? { age } : {}), allergies: [], dislikes: [] });
        return s.household.members;
      });
      return env('household_members', `Added ${who} to the household. Tell me about any allergies, like "${who} is allergic to shellfish".`, { members, added: who });
    }
    if (!existing) return fail('household_members', `I don't have anyone called ${who} in the household.`, { members: h.members });
    if (h.members.length <= 1) return fail('household_members', `${existing.name} is the only member, so I'll keep them. A household needs at least one person.`, { members: h.members });
    const removed = existing;
    const members = update(s => {
      s.household.members = s.household.members.filter(m => m.name !== removed.name);
      return s.household.members;
    });
    let speech = `Removed ${removed.name} from the household.`;
    if (removed.allergies.length) {
      const words = removed.allergies.map(allergenWord);
      speech += ` Heads up: that also removes ${removed.name}'s ${listPhrase(words)} allergy from meal planning, so recipes with ${listPhrase(words)} can come back.`;
    }
    if (removed.dislikes.length) speech += ` Their dislikes, ${listPhrase(removed.dislikes)}, are cleared too.`;
    return env('household_members', speech, { members, removed: removed.name, removedAllergies: removed.allergies, removedDislikes: removed.dislikes });
  }
});

// ---------------- pantry_add_receipt ----------------

const SHELF_DAYS: Record<string, number | null> = { produce: 6, dairy: 10, protein: 3, bakery: 5, frozen: 90, grains: null, pantry: null };
const IGNORE = /\b(sub ?total|total|tax|visa|mastercard|amex|debit|cash|change due|change|balance|savings|discount|coupon|thank you|cashier|receipt|loyalty)\b/i;

export interface ParsedReceiptLine { line: string; kind: 'matched' | 'unmatched' | 'ignored' | 'empty'; id?: string; qty?: number }

/** Parse one receipt line ("2 x Baby Spinach 3.49", "MILK 1GAL", "Eggs dozen", "Tortillas x2", "3 tomatoes"). */
export function parseReceiptLine(raw: string): ParsedReceiptLine {
  const line = raw.trim();
  if (!line) return { line, kind: 'empty' };
  if (IGNORE.test(line)) return { line, kind: 'ignored' };
  let t = ` ${line.toLowerCase()} `;
  let packs: number | null = null;
  let units: number | null = null;
  const gallons = t.match(/(\d+(?:\.\d+)?)\s*gal(?:lon)?s?\b/);
  let m = t.match(/^\s*(\d+)\s*(?:x|×|@)\s+/);
  if (m) { packs = Number(m[1]); t = t.replace(m[0], ' '); }
  m = t.match(/\s(?:x|×)\s*(\d+)\s/);
  if (m && packs === null) { packs = Number(m[1]); t = t.replace(m[0], ' '); }
  m = t.match(/(?:(\d+)\s*)?dozen/);
  if (m) { units = 12 * (m[1] ? Number(m[1]) : 1); t = t.replace(m[0], ' '); }
  t = t.replace(/\$?\d+\.\d{2}\b/g, ' ').replace(/(\d+(?:\.\d+)?)\s*(gal(?:lon)?s?|lbs?|oz|kg|ct|pk|pack)\b/g, ' ');
  m = t.match(/^\s*(\d+)\s+/);
  if (m && units === null && packs === null) { units = Number(m[1]); t = t.replace(m[0], ' '); }
  const name = t.replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
  const ing = name ? findIngredient(name) : null;
  if (!ing) return { line, kind: 'unmatched' };
  let qty: number;
  if (gallons && ing.id === 'milk') qty = Math.round(Number(gallons[1]) * 16);
  else if (units !== null) qty = units * (packs ?? 1);
  else qty = (packs ?? 1) * ing.packSize;
  return { line, kind: 'matched', id: ing.id, qty };
}

export function parseReceipt(text: string): ParsedReceiptLine[] {
  let lines = text.split(/\r?\n|;/);
  if (lines.length === 1) lines = text.split(',');
  return lines.map(parseReceiptLine).filter(l => l.kind !== 'empty');
}

tool({
  name: 'pantry_add_receipt',
  title: 'Add groceries from a receipt',
  description: 'Paste or read out a grocery receipt; Sous matches each line to an ingredient, adds it to the pantry with a typical shelf life, and lists anything it could not match.',
  input: z.object({ text: z.string().min(1).max(4000).describe('Receipt text, one item per line (or comma-separated when spoken)') }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  icon: '🧾',
  handler: ({ text }) => {
    const parsed = parseReceipt(text);
    const matchedLines = parsed.filter(p => p.kind === 'matched');
    const unmatched = parsed.filter(p => p.kind === 'unmatched').map(p => p.line);
    const ignored = parsed.filter(p => p.kind === 'ignored').map(p => p.line);
    if (!matchedLines.length) {
      return fail('pantry_add_receipt', `I couldn't match any groceries on that receipt${unmatched.length ? `, for example "${unmatched[0]}"` : ''}. Try one item per line.`, { matched: [], unmatched, ignored });
    }
    const now = new Date();
    const matched = update(s => matchedLines.map(p => {
      const ing = INGREDIENT_BY_ID.get(p.id!)!;
      const days = SHELF_DAYS[ing.category] ?? null;
      s.pantry.push({ id: ing.id, qty: p.qty!, expiresOn: days === null ? null : addDays(now, days) });
      return { line: p.line, name: ing.name, qty: p.qty!, unit: ing.unit, expiresInDays: days };
    }));
    const names = [...new Set(matched.map(m => m.name))];
    let speech = `Added ${matched.length} item${matched.length === 1 ? '' : 's'} from your receipt: ${listPhrase(names)}.`;
    if (unmatched.length) speech += ` I couldn't match ${unmatched.length} line${unmatched.length === 1 ? '' : 's'}, like "${unmatched[0]}".`;
    return env('pantry_add_receipt', speech, { matched, unmatched, ignored });
  }
});

// ---------------- daily_brief ----------------

tool({
  name: 'daily_brief',
  title: 'Daily kitchen brief',
  description: 'A three-sentence morning brief: what expires today or tomorrow, tonight\'s planned dinner (or a use-it-up suggestion), and any running timers or grocery order arriving today.',
  input: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '☀️',
  handler: () => {
    const s = getState();
    const now = new Date();
    const items = pantryView(s, now);
    const today = items.filter(i => i.expiresInDays === 0).map(i => i.name);
    const tomorrow = items.filter(i => i.expiresInDays === 1).map(i => i.name);
    const expired = items.filter(i => i.expiresInDays !== null && i.expiresInDays < 0).map(i => i.name);
    const todayKey = dayKey(now);
    const planned = s.plan.find(p => p.day === todayKey);
    const tonight = planned ? suggestTitle(planned.recipeId) : null;
    const suggestion = tonight ? null : suggestMeals(s, { count: 1 }, now).suggestions[0] ?? null;
    const timers = activeTimers();
    const arriving = Object.values(s.carts)
      .filter(c => c.status === 'placed' && dayKey(new Date(c.createdAt)) === todayKey)
      .map(c => ({ orderId: c.orderId!, eta: c.eta ?? '' }));

    const parts: string[] = [];
    if (today.length && tomorrow.length) parts.push(`Kitchen brief: ${listPhrase(today)} ${today.length > 1 ? 'expire' : 'expires'} today, and ${listPhrase(tomorrow)} tomorrow.`);
    else if (today.length) parts.push(`Kitchen brief: use ${listPhrase(today)} today.`);
    else if (tomorrow.length) parts.push(`Kitchen brief: ${listPhrase(tomorrow)} ${tomorrow.length > 1 ? 'expire' : 'expires'} tomorrow.`);
    else parts.push('Kitchen brief: nothing expires today or tomorrow.');
    if (tonight) parts.push(`Tonight's plan is ${tonight}.`);
    else if (suggestion) parts.push(`No dinner planned yet, so I'd make ${suggestion.title}, which rescues $${suggestion.rescueValueUsd.toFixed(2)} of food.`);
    const extras: string[] = [];
    if (arriving.length) extras.push(`your grocery order arrives ${arriving[0].eta.toLowerCase() || 'today'}`);
    if (timers.length) extras.push(`${timers.length} timer${timers.length === 1 ? ' is' : 's are'} running`);
    if (expired.length) extras.push(`${listPhrase(expired)} ${expired.length > 1 ? 'are' : 'is'} past its date`);
    if (extras.length) parts.push(`Also, ${listPhrase(extras)}.`);
    return env('daily_brief', parts.join(' '), {
      expiringToday: today, expiringTomorrow: tomorrow, expired, tonight,
      suggestion: suggestion ? { recipeId: suggestion.recipeId, title: suggestion.title, rescueValueUsd: suggestion.rescueValueUsd } : null,
      timers, ordersArriving: arriving
    });
  }
});

function suggestTitle(recipeId: string): string {
  return RECIPE_BY_ID.get(recipeId)?.title ?? recipeId.replace(/-/g, ' ');
}

// ---------------- order_history ----------------

tool({
  name: 'order_history',
  title: 'Order history',
  description: 'Recent grocery orders placed through Sous (simulated Amazon Fresh): order id, total, items and delivery window.',
  input: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '📦',
  handler: ({ limit }) => {
    const s = getState();
    const orders = Object.values(s.carts)
      .filter(c => c.status === 'placed')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(c => {
        const v = cartView(s, c);
        return { orderId: c.orderId!, totalUsd: v.totalUsd, items: v.lines.map(l => l.name), date: c.createdAt.slice(0, 10), eta: c.eta ?? null };
      });
    if (!orders.length) return env('order_history', 'No orders yet. Say "add what we\'re missing to the cart" to start one.', { orders });
    const last = orders[0];
    const speech = `You have ${orders.length} order${orders.length === 1 ? '' : 's'}. The latest, ${last.orderId}, was $${last.totalUsd.toFixed(2)} for ${listPhrase(last.items.slice(0, 4))}${last.items.length > 4 ? ` and ${last.items.length - 4} more` : ''}${last.eta ? `, arriving ${last.eta.toLowerCase()}` : ''}.`;
    return env('order_history', speech, { orders });
  }
});

// ---------------- reorder_staples ----------------

/** Restock thresholds, in each ingredient's pantry unit. */
export const STAPLES: Record<string, number> = { egg: 4, milk: 3, butter: 4, flour: 2, onion: 1, garlic: 3 };

tool({
  name: 'reorder_staples',
  title: 'Restock the staples',
  description: 'Find staples that are running low (eggs, milk, butter, flour, onions, garlic) and build a draft Amazon Fresh (simulated) cart for them. Nothing is bought: it returns a followUp to shopping_checkout, which still needs an explicit yes.',
  input: z.object({}),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  view: 'cart',
  icon: '🥚',
  handler: () => {
    const s = getState();
    const have = (id: string) => s.pantry.filter(p => p.id === id && p.qty > 0).reduce((n, p) => n + p.qty, 0);
    const low = Object.entries(STAPLES)
      .filter(([id, min]) => have(id) < min)
      .map(([id, min]) => ({ id, name: INGREDIENT_BY_ID.get(id)!.name, have: have(id), threshold: min }));
    if (!low.length) {
      return env('reorder_staples', `Your staples are stocked: ${listPhrase(Object.keys(STAPLES).map(id => INGREDIENT_BY_ID.get(id)!.name))}. Nothing to reorder.`, { low: [] });
    }
    const view = update(st => {
      const cart = buildCart(st, [], low.map(l => ({ id: l.id, qty: INGREDIENT_BY_ID.get(l.id)!.packSize })));
      return cartView(st, cart);
    });
    const speech = `You're low on ${listPhrase(low.map(l => l.name))}. I've put ${low.length > 1 ? 'them' : 'it'} in a cart for $${view.totalUsd.toFixed(2)} from Amazon Fresh. Should I place the order?`;
    return env('reorder_staples', speech, { ...view, low }, {
      view: 'cart',
      followUp: { prompt: 'Should I place the order?', tool: 'shopping_checkout', arguments: { cartToken: view.cartToken, confirmed: true } }
    });
  }
});

// ---------------- delivery_slots ----------------

export interface DeliverySlot { id: string; label: string; day: 'today' | 'tomorrow'; startHour: number; endHour: number; available: boolean }

const SLOT_HOURS: Array<['today' | 'tomorrow', number]> = [['today', 18], ['today', 20], ['tomorrow', 8], ['tomorrow', 12], ['tomorrow', 18]];

function hourLabel(h: number): string {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const v = h % 12 === 0 ? 12 : h % 12;
  return `${v}${suffix}`;
}

/** Simulated delivery windows; today's close one hour before they start. */
export function deliverySlots(now = new Date()): DeliverySlot[] {
  return SLOT_HOURS.map(([day, start]) => {
    const end = start + 2;
    const label = `${day === 'today' ? 'Today' : 'Tomorrow'}, ${hourLabel(start).replace(/(AM|PM)$/, '')} to ${hourLabel(end)}`;
    const available = day === 'tomorrow' || now.getHours() < start - 1;
    return { id: `${day}-${String(start).padStart(2, '0')}`, label, day, startHour: start, endHour: end, available };
  });
}

function findSlot(slots: DeliverySlot[], want: string): DeliverySlot | null {
  const q = want.toLowerCase().trim();
  const n = Number(q);
  if (Number.isInteger(n) && n >= 1 && n <= slots.length) return slots[n - 1];
  const byId = slots.find(s => s.id === q);
  if (byId) return byId;
  const ordinal = ['first', 'second', 'third', 'fourth', 'fifth'].indexOf(q.replace(/\s*(one|slot)$/, '').trim());
  if (ordinal >= 0) return slots[ordinal] ?? null;
  const day = /tomorrow/.test(q) ? 'tomorrow' : /today|tonight/.test(q) ? 'today' : null;
  const hm = q.match(/(\d{1,2})\s*(am|pm)?/);
  if (hm) {
    let h = Number(hm[1]);
    if (hm[2] === 'pm' && h < 12) h += 12;
    if (!hm[2] && h < 8) h += 12;
    const hit = slots.find(s => s.startHour === h && (!day || s.day === day));
    if (hit) return hit;
  }
  if (/morning/.test(q)) return slots.find(s => s.startHour < 12 && (!day || s.day === day)) ?? null;
  if (/noon|lunch|midday/.test(q)) return slots.find(s => s.startHour === 12) ?? null;
  return null;
}

tool({
  name: 'delivery_slots',
  title: 'Delivery windows',
  description: 'List simulated Amazon Fresh delivery windows for today and tomorrow, or pick one as the preferred window (by number, id like "tomorrow-08", or words like "tomorrow morning").',
  input: z.object({
    action: z.enum(['list', 'pick']).default('list'),
    slot: z.string().max(40).optional()
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🚚',
  handler: ({ action, slot }) => {
    const slots = deliverySlots();
    const open = slots.filter(s => s.available);
    if (action === 'list' || !slot) {
      const current = ext(getState()).deliveryWindow;
      const speech = `Simulated Amazon Fresh windows: ${listPhrase(open.map((s, i) => `${slots.indexOf(s) + 1}, ${s.label.toLowerCase()}`))}.${current ? ` Your preferred window is ${current.label.toLowerCase()}.` : ' Which one should I use?'}`;
      return env('delivery_slots', speech, { slots, preferred: current ?? null, store: 'Amazon Fresh (simulated)' });
    }
    const chosen = findSlot(slots, slot);
    if (!chosen) return fail('delivery_slots', `I couldn't find a "${slot}" window. Say a number from 1 to ${slots.length}.`, { slots });
    if (!chosen.available) return fail('delivery_slots', `${chosen.label} has closed. The next open one is ${open[0]?.label.toLowerCase() ?? 'tomorrow'}.`, { slots });
    const saved = update(s => {
      ext(s).deliveryWindow = { id: chosen.id, label: chosen.label };
      return ext(s).deliveryWindow!;
    });
    return env('delivery_slots', `Saved ${chosen.label.toLowerCase()} as your preferred delivery window.`, { slots, preferred: saved, store: 'Amazon Fresh (simulated)' });
  }
});

// ---------------- voice routes ----------------

registerRoute(t => {
  if (/\bwho(?:'s| is) in (?:the |our |my )?(?:household|family)\b|\blist (?:the |our |my )?(?:household|family)(?: members)?\b|\bhousehold members\b/.test(t)) {
    return { tool: 'household_members', args: { action: 'list' } };
  }
  let m = t.match(/^(?:please )?(?:add|include)\s+([a-z]+)\s+to\s+(?:the |our |my )?(?:household|family)(?:[, ]+(?:age|aged|who is)?\s*(\d{1,3}))?/);
  if (m) return { tool: 'household_members', args: { action: 'add', name: m[1], ...(m[2] ? { age: Number(m[2]) } : {}) } };
  m = t.match(/^(?:please )?(?:remove|take)\s+([a-z]+)\s+(?:from|out of|off)\s+(?:the |our |my )?(?:household|family)/);
  if (m) return { tool: 'household_members', args: { action: 'remove', name: m[1] } };
  return null;
});

registerRoute(t => {
  const m = t.match(/^(?:here'?s|here is|add|scan|log|import)\s+(?:my |the |this |our )?(?:grocery |shopping )?receipt\s*[:,-]?\s*(.+)$/);
  return m ? { tool: 'pantry_add_receipt', args: { text: m[1] } } : null;
});

registerRoute(t =>
  /\b(?:morning|daily|kitchen) brief(?:ing)?\b|\bbrief me\b|\bstart my day\b|\bwhat'?s happening in the kitchen\b/.test(t)
    ? { tool: 'daily_brief', args: {} } : null);

registerRoute(t =>
  /\border history\b|\b(?:past|previous|recent|old) orders\b|\bwhat did (?:i|we) order\b|\bshow (?:me )?(?:my |our )?orders\b/.test(t)
    ? { tool: 'order_history', args: {} } : null);

registerRoute(t =>
  /\b(?:re-?order|restock|top up) (?:the |our |my )?(?:staples|basics|essentials)\b|\b(?:are we|am i) (?:running )?low on (?:anything|staples|basics)\b|\bwhat staples are (?:low|running low)\b/.test(t)
    ? { tool: 'reorder_staples', args: {} } : null);

registerRoute(t => {
  if (/\bdelivery (?:slots?|windows?|times?)\b|\bwhen can (?:you|it|they) deliver\b/.test(t) && !/\b(?:pick|choose|book|use)\b/.test(t)) {
    return { tool: 'delivery_slots', args: { action: 'list' } };
  }
  const m = t.match(/\b(?:pick|choose|book|use)\s+(?:the\s+)?(.+?)\s+(?:delivery\s+)?(?:slot|window)\b/) || t.match(/\bdeliver (?:it )?(tomorrow (?:morning|at \d+\s*(?:am|pm)?)|today at \d+\s*(?:am|pm)?|tonight)\b/);
  return m ? { tool: 'delivery_slots', args: { action: 'pick', slot: m[1].trim() } } : null;
});
