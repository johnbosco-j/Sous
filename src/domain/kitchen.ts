import { randomBytes } from 'node:crypto';
import {
  Allergen, CO2E_PER_KG_FOOD, Household, INGREDIENT_BY_ID, Ingredient, RECIPES, Recipe, RECIPE_BY_ID
} from './catalog.js';
import { recipeFilters } from './hooks.js';
import { CartState, KitchenState, addDays, dayKey, daysUntil, round2 } from './store.js';

// Deterministic kitchen logic. Safety-relevant decisions (allergens, purchases) live here, never in a model prompt.

// ---------- pantry ----------

export type ExpiryStatus = 'fresh' | 'soon' | 'urgent' | 'expired';

export interface PantryItemView {
  id: string; name: string; emoji: string; qty: number; unit: string; category: string;
  expiresInDays: number | null; status: ExpiryStatus; valueUsd: number;
}

export function expiryStatus(days: number | null): ExpiryStatus {
  if (days === null) return 'fresh';
  if (days < 0) return 'expired';
  if (days <= 1) return 'urgent';
  if (days <= 3) return 'soon';
  return 'fresh';
}

export function pantryView(s: KitchenState, now = new Date()): PantryItemView[] {
  return s.pantry
    .filter(p => p.qty > 0)
    .map(p => {
      const i = INGREDIENT_BY_ID.get(p.id)!;
      const days = daysUntil(p.expiresOn, now);
      return {
        id: p.id, name: i.name, emoji: i.emoji, qty: round2(p.qty), unit: i.unit, category: i.category,
        expiresInDays: days, status: expiryStatus(days), valueUsd: round2(i.priceUsd * p.qty)
      };
    })
    .sort((a, b) => (a.expiresInDays ?? 999) - (b.expiresInDays ?? 999) || a.name.localeCompare(b.name));
}

export function whenPhrase(days: number | null): string {
  if (days === null) return 'no date';
  if (days < 0) return 'already expired';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** "a, b and c" */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function have(s: KitchenState, id: string): number {
  return s.pantry.filter(p => p.id === id && p.qty > 0).reduce((n, p) => n + p.qty, 0);
}

function soonestExpiry(s: KitchenState, id: string, now: Date): number | null {
  const days = s.pantry.filter(p => p.id === id && p.qty > 0).map(p => daysUntil(p.expiresOn, now)).filter((d): d is number => d !== null);
  return days.length ? Math.min(...days) : null;
}

// ---------- allergen guard ----------

const ALLERGEN_WORDS: Record<Allergen, string[]> = {
  peanut: ['peanut', 'groundnut', 'satay', 'arachis'],
  'tree-nut': ['almond', 'cashew', 'walnut', 'pecan', 'hazelnut', 'pistachio', 'macadamia', 'tree nut'],
  dairy: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'parmesan', 'cheddar', 'ghee'],
  egg: ['egg', 'mayonnaise', 'mayo'],
  gluten: ['wheat', 'flour', 'bread', 'pasta', 'tortilla', 'barley', 'rye', 'couscous'],
  soy: ['soy', 'tofu', 'edamame', 'miso', 'tempeh'],
  sesame: ['sesame', 'tahini'],
  shellfish: ['shrimp', 'prawn', 'crab', 'lobster', 'shellfish'],
  fish: ['salmon', 'tuna', 'cod', 'anchovy', 'fish sauce', 'fish']
};

/** Normalize "peanuts", "Peanut allergy", "nuts" to a known allergen, or null for free-form ones. */
export function normalizeAllergen(text: string): Allergen | null {
  const q = text.toLowerCase();
  if (/peanut|groundnut/.test(q)) return 'peanut';
  if (/tree ?nut|almond|cashew|walnut|pecan|hazelnut|pistachio|\bnuts?\b/.test(q)) return 'tree-nut';
  if (/dairy|milk|lactose|cheese/.test(q)) return 'dairy';
  if (/\beggs?\b/.test(q)) return 'egg';
  if (/gluten|wheat|celiac|coeliac/.test(q)) return 'gluten';
  if (/\bsoy/.test(q)) return 'soy';
  if (/sesame/.test(q)) return 'sesame';
  if (/shellfish|shrimp|prawn|crab|lobster/.test(q)) return 'shellfish';
  if (/\bfish\b/.test(q)) return 'fish';
  return null;
}

export interface AllergenHit { member: string; allergen: string; ingredient: string }

/** Every (member, allergen, ingredient) clash for a list of ingredient ids. */
export function allergenHits(household: Household, ingredientIds: string[]): AllergenHit[] {
  const hits: AllergenHit[] = [];
  for (const m of household.members) {
    for (const a of m.allergies) {
      const allergen = normalizeAllergen(a);
      for (const id of ingredientIds) {
        const i = INGREDIENT_BY_ID.get(id);
        if (!i) continue;
        const clash = allergen ? i.allergens.includes(allergen) : i.name.toLowerCase().includes(a.toLowerCase());
        if (clash) hits.push({ member: m.name, allergen: a, ingredient: i.name });
      }
    }
  }
  return hits;
}

/** Text scan for model-written recipes: catches allergens even in ingredients outside our catalog. */
export function allergenHitsInText(household: Household, text: string): AllergenHit[] {
  const q = text.toLowerCase();
  const hits: AllergenHit[] = [];
  for (const m of household.members) {
    for (const a of m.allergies) {
      const allergen = normalizeAllergen(a);
      const words = allergen ? ALLERGEN_WORDS[allergen] : [a.toLowerCase()];
      const found = words.find(w => q.includes(w));
      if (found) hits.push({ member: m.name, allergen: a, ingredient: found });
    }
  }
  return hits;
}

function dislikeHits(household: Household, recipe: Recipe): string[] {
  const out: string[] = [];
  for (const m of household.members) {
    for (const d of m.dislikes) {
      const dl = d.toLowerCase().replace(/s$/, '');
      const clash = recipe.ingredients.some(ri => {
        const i = INGREDIENT_BY_ID.get(ri.id)!;
        return i.name.toLowerCase().includes(dl) || i.aliases.some(a => a.includes(dl)) || i.id.includes(dl);
      });
      if (clash) out.push(`${m.name} doesn't like ${d}`);
    }
  }
  return out;
}

// ---------- use-it-up planner ----------

export interface Suggestion {
  recipeId: string; title: string; emoji: string; gradient: [string, string]; minutes: number; servings: number;
  kidFriendly: boolean; score: number; uses: { name: string; expiresInDays: number }[];
  missing: { name: string; qty: number; unit: string }[]; reason: string; rescueValueUsd: number;
}

function urgencyWeight(days: number | null): number {
  if (days === null || days < 0) return 0;
  return [6, 5, 3, 2, 1][days] ?? 0;
}

export function scoreRecipe(s: KitchenState, recipe: Recipe, now = new Date()): Suggestion {
  let score = 0;
  let rescue = 0;
  const uses: Suggestion['uses'] = [];
  const missing: Suggestion['missing'] = [];
  for (const ri of recipe.ingredients) {
    const i = INGREDIENT_BY_ID.get(ri.id)!;
    const onHand = have(s, ri.id);
    if (onHand <= 0) {
      missing.push({ name: i.name, qty: ri.qty, unit: i.unit });
      continue;
    }
    if (onHand < ri.qty) missing.push({ name: i.name, qty: round2(ri.qty - onHand), unit: i.unit });
    const days = soonestExpiry(s, ri.id, now);
    const share = Math.min(1, ri.qty / onHand); // how much of the at-risk stock this recipe clears
    const w = urgencyWeight(days);
    score += 0.4 + w * (0.5 + share);
    if (days !== null && days >= 0 && days <= 3) {
      uses.push({ name: i.name, expiresInDays: days });
      rescue += i.priceUsd * Math.min(ri.qty, onHand);
    }
  }
  score -= missing.length * 1.6;
  score -= recipe.minutes / 60;
  uses.sort((a, b) => a.expiresInDays - b.expiresInDays);
  const usesText = uses.slice(0, 3).map(u => `${u.name} (${whenPhrase(u.expiresInDays)})`);
  let reason = uses.length ? `Uses ${listPhrase(usesText)}.` : 'Uses what you already have.';
  if (missing.length) reason += ` Needs ${listPhrase(missing.map(m => m.name))}.`;
  return {
    recipeId: recipe.id, title: recipe.title, emoji: recipe.emoji, gradient: recipe.gradient, minutes: recipe.minutes,
    servings: recipe.servings, kidFriendly: recipe.kidFriendly, score: round2(score), uses, missing, reason,
    rescueValueUsd: round2(rescue)
  };
}

export interface PlanOptions { count?: number; meal?: 'dinner' | 'breakfast' | 'snack' | 'any'; maxMinutes?: number; kidFriendly?: boolean }

export function suggestMeals(s: KitchenState, opts: PlanOptions = {}, now = new Date()) {
  const count = Math.max(1, Math.min(opts.count ?? 3, 6));
  const meal = opts.meal ?? 'dinner';
  const excluded: { title: string; reason: string }[] = [];
  const ranked: Suggestion[] = [];
  for (const r of RECIPES) {
    if (meal !== 'any' && r.meal !== meal) continue;
    const hits = allergenHits(s.household, r.ingredients.map(i => i.id));
    if (hits.length) {
      const h = hits[0];
      excluded.push({ title: r.title, reason: `${h.member} is allergic to ${h.allergen.replace(/s$/, '')}s` });
      continue;
    }
    const dislikes = dislikeHits(s.household, r);
    if (dislikes.length) {
      excluded.push({ title: r.title, reason: dislikes[0] });
      continue;
    }
    const blocked = recipeFilters.map(f => f(r, s.household, s)).find(Boolean);
    if (blocked) {
      excluded.push({ title: r.title, reason: blocked });
      continue;
    }
    if (opts.maxMinutes && r.minutes > opts.maxMinutes) continue;
    if (opts.kidFriendly && !r.kidFriendly) continue;
    ranked.push(scoreRecipe(s, r, now));
  }
  ranked.sort((a, b) => b.score - a.score);
  const atRisk = pantryView(s, now)
    .filter(p => p.expiresInDays !== null && p.expiresInDays >= 0 && p.expiresInDays <= 3)
    .map(p => ({ name: p.name, expiresInDays: p.expiresInDays as number }));
  return { suggestions: ranked.slice(0, count), excluded, atRisk };
}

// ---------- shopping ----------

export interface CartLineView { sku: string; name: string; emoji: string; qty: number; unit: string; priceUsd: number; forRecipes: string[] }

const FREE_DELIVERY_OVER = 35;
const DELIVERY_FEE = 3.99;

export function packsNeeded(i: Ingredient, qty: number): number {
  return Math.max(1, Math.ceil(qty / i.packSize));
}

export function cartView(s: KitchenState, cart: CartState) {
  const lines: CartLineView[] = cart.lines.map(l => {
    const i = INGREDIENT_BY_ID.get(l.id)!;
    const packs = packsNeeded(i, l.qty);
    const unitLabel = i.packSize > 1 ? `pack of ${i.packSize}` : i.unit;
    return { sku: `FRESH-${l.id.toUpperCase()}`, name: i.name, emoji: i.emoji, qty: packs, unit: unitLabel, priceUsd: round2(packs * i.packSize * i.priceUsd), forRecipes: l.forRecipes.map(id => RECIPE_BY_ID.get(id)?.title ?? id) };
  });
  const subtotal = round2(lines.reduce((n, l) => n + l.priceUsd, 0));
  const fee = subtotal >= FREE_DELIVERY_OVER || subtotal === 0 ? 0 : DELIVERY_FEE;
  return {
    cartToken: cart.token, status: cart.status, lines, subtotalUsd: subtotal, deliveryFeeUsd: fee,
    totalUsd: round2(subtotal + fee), deliveryWindow: 'Today, 6 to 8 PM', store: 'Amazon Fresh (simulated)',
    ...(cart.orderId ? { orderId: cart.orderId, eta: cart.eta } : {})
  };
}

/** Diff recipes against the pantry and build a draft cart. Nothing is bought here. */
export function buildCart(s: KitchenState, recipeIds: string[], extras: { id: string; qty: number }[], now = new Date()): CartState {
  const need = new Map<string, CartState['lines'][number]>();
  for (const rid of recipeIds) {
    const r = RECIPE_BY_ID.get(rid);
    if (!r) continue;
    for (const ri of r.ingredients) {
      const short = ri.qty - have(s, ri.id);
      if (short <= 0) continue;
      const line = need.get(ri.id) ?? { id: ri.id, qty: 0, forRecipes: [] };
      line.qty += short;
      if (!line.forRecipes.includes(rid)) line.forRecipes.push(rid);
      need.set(ri.id, line);
    }
  }
  for (const e of extras) {
    const line = need.get(e.id) ?? { id: e.id, qty: 0, forRecipes: [] };
    line.qty += e.qty;
    need.set(e.id, line);
  }
  const cart: CartState = { token: `cart_${randomBytes(6).toString('hex')}`, createdAt: now.toISOString(), lines: [...need.values()], status: 'draft' };
  s.carts[cart.token] = cart;
  // Keep only recent carts
  const tokens = Object.keys(s.carts);
  for (const t of tokens.slice(0, Math.max(0, tokens.length - 10))) delete s.carts[t];
  return cart;
}

export const CART_TTL_MS = 30 * 60 * 1000;

export type CheckoutOutcome =
  | { kind: 'unknown_cart' }
  | { kind: 'expired' }
  | { kind: 'empty' }
  | { kind: 'needs_confirmation'; cart: CartState }
  | { kind: 'placed'; cart: CartState; alreadyPlaced: boolean };

/** Purchase gate: a cart is only ordered with its token AND explicit confirmation; replays are idempotent. */
export function checkout(s: KitchenState, token: string, confirmed: boolean, now = new Date()): CheckoutOutcome {
  const cart = s.carts[token];
  if (!cart) return { kind: 'unknown_cart' };
  if (cart.status === 'placed') return { kind: 'placed', cart, alreadyPlaced: true };
  if (!cart.lines.length) return { kind: 'empty' };
  if (now.getTime() - new Date(cart.createdAt).getTime() > CART_TTL_MS) return { kind: 'expired' };
  if (!confirmed) return { kind: 'needs_confirmation', cart };
  cart.status = 'placed';
  cart.orderId = `112-${randomBytes(3).toString('hex').toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
  cart.eta = 'Today, 6 to 8 PM';
  // Groceries are expected tonight: add them to the pantry with a fresh shelf life.
  for (const l of cart.lines) {
    const i = INGREDIENT_BY_ID.get(l.id)!;
    const shelf = i.category === 'produce' ? 6 : i.category === 'dairy' ? 10 : i.category === 'protein' ? 3 : null;
    s.pantry.push({ id: l.id, qty: packsNeeded(i, l.qty) * i.packSize, expiresOn: shelf === null ? null : addDays(now, shelf) });
  }
  return { kind: 'placed', cart, alreadyPlaced: false };
}

// ---------- cooking ----------

export function cookView(s: KitchenState, extra: { done?: boolean; rescued?: { name: string; valueUsd: number }[] } = {}) {
  const c = s.cooking;
  if (!c) return null;
  const r = RECIPE_BY_ID.get(c.recipeId)!;
  const step = r.steps[Math.min(c.stepIndex, r.steps.length - 1)];
  return {
    recipeId: r.id, title: r.title, emoji: r.emoji, gradient: r.gradient, stepIndex: c.stepIndex, totalSteps: r.steps.length,
    step, ingredients: r.ingredients.map(ri => {
      const i = INGREDIENT_BY_ID.get(ri.id)!;
      return { name: i.name, qty: ri.qty, unit: i.unit, have: have(s, ri.id) >= ri.qty };
    }),
    done: extra.done ?? false,
    ...(extra.rescued ? { rescued: extra.rescued } : {})
  };
}

/** Finish a recipe: use ingredients up (soonest-expiring first) and record what was rescued. */
export function finishCooking(s: KitchenState, now = new Date()) {
  const c = s.cooking;
  if (!c) return { rescued: [] as { name: string; valueUsd: number }[], totalUsd: 0 };
  const r = RECIPE_BY_ID.get(c.recipeId)!;
  const rescued: { name: string; valueUsd: number; kg: number }[] = [];
  for (const ri of r.ingredients) {
    let left = ri.qty;
    const i = INGREDIENT_BY_ID.get(ri.id)!;
    const lots = s.pantry.filter(p => p.id === ri.id && p.qty > 0).sort((a, b) => (daysUntil(a.expiresOn, now) ?? 999) - (daysUntil(b.expiresOn, now) ?? 999));
    for (const lot of lots) {
      if (left <= 0) break;
      const take = Math.min(lot.qty, left);
      const days = daysUntil(lot.expiresOn, now);
      if (days !== null && days >= 0 && days <= 3) rescued.push({ name: i.name, valueUsd: round2(take * i.priceUsd), kg: round2(take * i.kg) });
      lot.qty = round2(lot.qty - take);
      left -= take;
    }
  }
  s.pantry = s.pantry.filter(p => p.qty > 0);
  const today = dayKey(now);
  for (const x of rescued) s.rescued.push({ ...x, date: today, recipeId: r.id });
  s.mealsCooked += 1;
  return { rescued: rescued.map(({ name, valueUsd }) => ({ name, valueUsd })), totalUsd: round2(rescued.reduce((n, x) => n + x.valueUsd, 0)) };
}

// ---------- impact ----------

export function impact(s: KitchenState, now = new Date()) {
  const weekStart = addDays(now, -6);
  const week = Array.from({ length: 7 }, (_, k) => {
    const day = addDays(now, k - 6);
    const usd = round2(s.rescued.filter(r => r.date === day).reduce((n, r) => n + r.valueUsd, 0));
    const [y, m, d] = day.split('-').map(Number);
    return { day: new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' }), usd };
  });
  const thisWeek = s.rescued.filter(r => r.date >= weekStart);
  const rescuedUsd = round2(thisWeek.reduce((n, r) => n + r.valueUsd, 0));
  const rescuedKg = round2(thisWeek.reduce((n, r) => n + r.kg, 0));
  const totals = new Map<string, number>();
  for (const r of thisWeek) totals.set(r.name, round2((totals.get(r.name) ?? 0) + r.valueUsd));
  const wastedUsd = round2((s.wasted ?? []).filter(r => r.date >= weekStart).reduce((n, r) => n + r.valueUsd, 0));
  return {
    rescuedUsd, rescuedKg, co2eKg: round2(rescuedKg * CO2E_PER_KG_FOOD), mealsCooked: s.mealsCooked, wastedUsd,
    itemsRescued: thisWeek.slice(-8).reverse().map(r => ({ name: r.name, valueUsd: r.valueUsd, date: r.date })),
    week, projectionYearUsd: Math.round((rescuedUsd / 7) * 365)
  };
}
