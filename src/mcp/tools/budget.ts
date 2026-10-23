// Budget and community tools: weekly grocery budget, cheapest use-it-up dinners, prices, donating surplus food,
// leftovers tracking, and waste insights. Deterministic; module state lives in getState().ext.budget.
// Context: USDA ERS reports 13.5% of US households were food insecure at some point in 2023.

import { z } from 'zod';
import { INGREDIENT_BY_ID, RECIPE_BY_ID, findIngredient } from '../../domain/catalog.js';
import { cartView, listPhrase, packsNeeded, pantryView, suggestMeals } from '../../domain/kitchen.js';
import { LEFTOVER_DAYS } from '../../domain/knowledge.js';
import { KitchenState, addDays, dayKey, daysUntil, getState, round2, update } from '../../domain/store.js';
import { env, fail, lastSuggestions, registerRoute, tool } from '../registry.js';

interface Leftover { id: string; dish: string; servings: number; cookedOn: string }
interface Donation { date: string; place: string; items: { name: string; qty: number; unit: string; valueUsd: number }[] }
interface BudgetState { weeklyUsd: number | null; leftovers: Leftover[]; donations: Donation[] }

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Community food-sharing points. Simulated: fictional names for the demo, not real locations. */
export const COMMUNITY_FRIDGES = [
  { name: 'Elm Street Community Fridge (simulated)', accepts: 'produce, dairy and sealed packaged food', hours: 'open 24 hours' },
  { name: 'Riverside Food Pantry (simulated)', accepts: 'sealed packaged and shelf-stable food', hours: 'open 9 AM to 6 PM' }
];

function budgetState(s: KitchenState): BudgetState {
  const b = (s.ext.budget ??= { weeklyUsd: null, leftovers: [], donations: [] }) as BudgetState;
  b.leftovers ??= [];
  b.donations ??= [];
  return b;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Total of placed orders created in the last 7 days. */
export function spentThisWeek(s: KitchenState, now = new Date()) {
  const orders = Object.values(s.carts)
    .filter(c => c.status === 'placed' && now.getTime() - new Date(c.createdAt).getTime() <= WEEK_MS)
    .map(c => ({ orderId: c.orderId ?? c.token, totalUsd: cartView(s, c).totalUsd, createdAt: c.createdAt }));
  return { orders, spentUsd: round2(orders.reduce((n, o) => n + o.totalUsd, 0)) };
}

/** Out-of-pocket cost of a recipe: missing ingredients, rounded up to whole store packs. */
export function missingCostUsd(s: KitchenState, recipeId: string): number {
  const r = RECIPE_BY_ID.get(recipeId);
  if (!r) return 0;
  let cost = 0;
  for (const ri of r.ingredients) {
    const onHand = s.pantry.filter(p => p.id === ri.id && p.qty > 0).reduce((n, p) => n + p.qty, 0);
    const short = ri.qty - onHand;
    if (short <= 0) continue;
    const i = INGREDIENT_BY_ID.get(ri.id)!;
    cost += packsNeeded(i, short) * i.packSize * i.priceUsd;
  }
  return round2(cost);
}

// ---------------- budget ----------------

tool({
  name: 'budget_set',
  title: 'Set the weekly grocery budget',
  description: 'Set the household\'s weekly grocery budget in US dollars. budget_status and budget_meal_plan use it.',
  input: z.object({ weeklyUsd: z.number().positive().max(5000).describe('Weekly grocery budget in USD, e.g. 120') }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '💰',
  handler: ({ weeklyUsd }) => {
    const { spentUsd } = update(s => {
      budgetState(s).weeklyUsd = round2(weeklyUsd);
      return spentThisWeek(s);
    });
    return env('budget_set', `Weekly grocery budget set to ${usd(weeklyUsd)}. You've spent ${usd(spentUsd)} so far this week.`, { weeklyUsd: round2(weeklyUsd), spentUsd, remainingUsd: round2(weeklyUsd - spentUsd) });
  }
});

tool({
  name: 'budget_status',
  title: 'How is the grocery budget doing?',
  description: 'Money spent on placed grocery orders in the last 7 days versus the weekly budget, with what is left. Warns above 80%.',
  input: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '📊',
  handler: () => {
    const s = getState();
    const b = budgetState(s);
    const { orders, spentUsd } = spentThisWeek(s);
    if (b.weeklyUsd === null) {
      return env('budget_status', `You've spent ${usd(spentUsd)} on ${orders.length} order${orders.length === 1 ? '' : 's'} this week. Tell me a weekly budget and I'll keep track.`, { weeklyUsd: null, spentUsd, orders });
    }
    const remainingUsd = round2(b.weeklyUsd - spentUsd);
    const pct = b.weeklyUsd > 0 ? Math.round((spentUsd / b.weeklyUsd) * 100) : 0;
    const level = pct > 100 ? 'over' : pct > 80 ? 'warning' : 'ok';
    let speech = `You've spent ${usd(spentUsd)} of your ${usd(b.weeklyUsd)} weekly budget, ${pct} percent.`;
    if (level === 'over') speech += ` That's ${usd(-remainingUsd)} over. I'll stick to what's already in the kitchen.`;
    else if (level === 'warning') speech += ` Only ${usd(remainingUsd)} left, so I'll favour meals that use what you have.`;
    else speech += ` ${usd(remainingUsd)} left this week.`;
    return env('budget_status', speech, { weeklyUsd: b.weeklyUsd, spentUsd, remainingUsd, percentUsed: pct, level, orders });
  }
});

tool({
  name: 'budget_meal_plan',
  title: 'Cheapest use-it-up dinners',
  description: 'Rank use-it-up dinners (allergens already excluded) by the out-of-pocket cost per serving of their missing ingredients, keep those under an optional cap, and show them as a carousel.',
  input: z.object({
    maxUsdPerServing: z.number().positive().max(50).optional().describe('Cap on the cost per serving of missing ingredients'),
    count: z.number().int().min(1).max(6).default(3)
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  view: 'meals',
  icon: '🪙',
  handler: ({ maxUsdPerServing, count }) => {
    const s = getState();
    const res = suggestMeals(s, { count: 6 });
    const priced = res.suggestions.map(sug => {
      const costUsd = missingCostUsd(s, sug.recipeId);
      const costPerServingUsd = round2(costUsd / Math.max(1, sug.servings));
      return { ...sug, missingCostUsd: costUsd, costPerServingUsd, reason: `${costPerServingUsd === 0 ? 'Nothing to buy.' : `${usd(costPerServingUsd)} a serving to buy.`} ${sug.reason}` };
    });
    const within = priced
      .filter(p => maxUsdPerServing === undefined || p.costPerServingUsd <= maxUsdPerServing)
      .sort((a, b) => a.costPerServingUsd - b.costPerServingUsd || b.score - a.score)
      .slice(0, count);
    if (!within.length) {
      return fail('budget_meal_plan', `Nothing fits under ${usd(maxUsdPerServing ?? 0)} a serving right now. The cheapest is ${priced[0] ? `${priced.sort((a, b) => a.costPerServingUsd - b.costPerServingUsd)[0].title} at ${usd(priced[0].costPerServingUsd)}` : 'not available'}.`, { suggestions: [], excluded: res.excluded, atRisk: res.atRisk });
    }
    lastSuggestions.ids = within.map(w => w.recipeId);
    const [top, ...rest] = within;
    let speech = top.costPerServingUsd === 0
      ? `Cheapest tonight: ${top.title}, and you already have everything, so it costs nothing extra.`
      : `Cheapest tonight: ${top.title}, about ${usd(top.costPerServingUsd)} a serving for what's missing.`;
    if (rest.length) speech += ` Also: ${listPhrase(rest.map(r => `${r.title} at ${usd(r.costPerServingUsd)}`))}.`;
    return env('budget_meal_plan', speech, { suggestions: within, excluded: res.excluded, atRisk: res.atRisk, maxUsdPerServing: maxUsdPerServing ?? null }, {
      view: 'meals',
      followUp: { prompt: `Want to cook ${top.title}?`, tool: 'cook_start', arguments: { recipeId: top.recipeId } }
    });
  }
});

tool({
  name: 'price_check',
  title: 'Check a price',
  description: 'Catalog price of an ingredient (simulated Amazon Fresh prices): pack size, pack price and unit price, plus how much is already in the pantry.',
  input: z.object({ item: z.string().describe('Ingredient name, e.g. "eggs"') }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🏷️',
  handler: ({ item }) => {
    const ing = findIngredient(item);
    if (!ing) return fail('price_check', `I don't have a price for ${item}.`, { item });
    const packUsd = round2(ing.packSize * ing.priceUsd);
    const onHand = round2(getState().pantry.filter(p => p.id === ing.id && p.qty > 0).reduce((n, p) => n + p.qty, 0));
    const pack = ing.packSize > 1 ? `a pack of ${ing.packSize} ${ing.unit}${ing.unit.endsWith('s') ? '' : 's'}` : `one ${ing.unit}`;
    let speech = `${ing.name[0].toUpperCase()}${ing.name.slice(1)}: ${pack} is ${usd(packUsd)}${ing.packSize > 1 ? `, about ${usd(ing.priceUsd)} each` : ''}.`;
    speech += onHand > 0 ? ` You already have ${onHand}.` : ' You have none right now.';
    return env('price_check', speech, { item: ing.name, packSize: ing.packSize, unit: ing.unit, packUsd, unitUsd: ing.priceUsd, onHand, store: 'Amazon Fresh (simulated)' });
  }
});

// ---------------- community ----------------

/** Expiring-soon stock the saved plan won't use, minus things community fridges usually can't take. */
export function surplus(s: KitchenState, now = new Date()) {
  const need = new Map<string, number>();
  for (const p of s.plan) for (const ri of RECIPE_BY_ID.get(p.recipeId)?.ingredients ?? []) need.set(ri.id, (need.get(ri.id) ?? 0) + ri.qty);
  const items: { id: string; name: string; qty: number; unit: string; valueUsd: number; expiresInDays: number }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const v of pantryView(s, now)) {
    if (v.expiresInDays === null || v.expiresInDays < 0 || v.expiresInDays > 2) continue;
    const spare = round2(v.qty - (need.get(v.id) ?? 0));
    if (spare <= 0) continue;
    const ing = INGREDIENT_BY_ID.get(v.id)!;
    // Shared fridges generally refuse raw meat and home-cooked food.
    if (ing.category === 'protein' && v.id !== 'egg') { skipped.push({ name: v.name, reason: 'community fridges usually can\'t take raw meat' }); continue; }
    if (v.id === 'cooked-rice') { skipped.push({ name: v.name, reason: 'home-cooked food usually isn\'t accepted' }); continue; }
    items.push({ id: v.id, name: v.name, qty: spare, unit: v.unit, valueUsd: round2(spare * ing.priceUsd), expiresInDays: v.expiresInDays });
  }
  return { items, skipped };
}

tool({
  name: 'donate_surplus',
  title: 'Donate food you won\'t use',
  description: 'Find food expiring within 2 days that the saved meal plan does not need and suggest a community fridge (simulated, fictional names). With confirm=true, removes it from the pantry, records the donation, and counts it as rescued food.',
  input: z.object({
    confirm: z.boolean().default(false).describe('true only after the person agrees to donate these items'),
    place: z.number().int().min(1).max(COMMUNITY_FRIDGES.length).optional().describe('1-based index of the community fridge')
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  icon: '🤝',
  handler: ({ confirm, place }) => {
    const fridge = COMMUNITY_FRIDGES[(place ?? 1) - 1];
    const now = new Date();
    const { items, skipped } = surplus(getState(), now);
    if (!items.length) {
      const why = skipped.length ? ` ${listPhrase(skipped.map(x => x.name))} ${skipped.length > 1 ? 'are' : 'is'} better cooked tonight.` : '';
      return env('donate_surplus', `Nothing to donate right now: everything expiring soon is part of your plan.${why}`, { items: [], skipped, place: fridge });
    }
    const total = round2(items.reduce((n, i) => n + i.valueUsd, 0));
    if (!confirm) {
      return env('donate_surplus', `You won't use ${listPhrase(items.map(i => i.name))} before ${items.length > 1 ? 'they expire' : 'it expires'}, about ${usd(total)} of food. ${fridge.name} takes ${fridge.accepts} and is ${fridge.hours}. Want to donate it?`, { items, skipped, totalUsd: total, place: fridge, status: 'proposed' }, {
        followUp: { prompt: 'Donate these items?', tool: 'donate_surplus', arguments: { confirm: true, place: place ?? 1 } }
      });
    }
    const donation = update(s => {
      const today = dayKey(now);
      for (const it of items) {
        let left = it.qty;
        const lots = s.pantry.filter(p => p.id === it.id && p.qty > 0).sort((a, b) => (daysUntil(a.expiresOn, now) ?? 999) - (daysUntil(b.expiresOn, now) ?? 999));
        for (const lot of lots) { const take = Math.min(lot.qty, left); lot.qty = round2(lot.qty - take); left = round2(left - take); if (left <= 0) break; }
        const ing = INGREDIENT_BY_ID.get(it.id)!;
        s.rescued.push({ name: it.name, valueUsd: it.valueUsd, kg: round2(it.qty * ing.kg), date: today, recipeId: 'donated' });
      }
      s.pantry = s.pantry.filter(p => p.qty > 0);
      const d: Donation = { date: today, place: fridge.name, items: items.map(({ name, qty, unit, valueUsd }) => ({ name, qty, unit, valueUsd })) };
      budgetState(s).donations.push(d);
      return d;
    });
    return env('donate_surplus', `Thank you. I've noted ${listPhrase(items.map(i => i.name))} for ${fridge.name}, about ${usd(total)} of food that will feed a neighbour instead of the bin.`, { items, skipped, totalUsd: total, place: fridge, status: 'donated', donation });
  }
});

// ---------------- leftovers ----------------

function leftoverView(l: Leftover, now = new Date()) {
  const age = -(daysUntil(l.cookedOn, now) ?? 0);
  const daysLeft = LEFTOVER_DAYS - age;
  return { ...l, ageDays: age, daysLeft, status: daysLeft < 0 ? 'throw-out' : daysLeft <= 1 ? 'eat-soon' : 'ok' } as const;
}

tool({
  name: 'leftovers_log',
  title: 'Track leftovers',
  description: `Log cooked leftovers (eat within ${LEFTOVER_DAYS} days, refrigerate within 2 hours), list them with days left, or remove them once eaten or thrown away. Anything past the window is flagged "throw out".`,
  input: z.object({
    action: z.enum(['add', 'list', 'remove']).default('list'),
    dish: z.string().max(80).optional(),
    servings: z.number().int().min(1).max(20).optional(),
    cookedDaysAgo: z.number().int().min(0).max(14).default(0)
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  icon: '🥡',
  handler: ({ action, dish, servings, cookedDaysAgo }) => {
    const now = new Date();
    if (action === 'add') {
      if (!dish) return fail('leftovers_log', 'What are the leftovers?', {});
      const entry = update(s => {
        const l: Leftover = { id: `lo_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, dish: dish.trim(), servings: servings ?? 2, cookedOn: addDays(now, -cookedDaysAgo) };
        budgetState(s).leftovers.push(l);
        return leftoverView(l, now);
      });
      const speech = entry.daysLeft < 0
        ? `That ${entry.dish} was cooked ${entry.ageDays} days ago, past the ${LEFTOVER_DAYS}-day window, so I'd throw it out.`
        : `Logged ${entry.servings} serving${entry.servings === 1 ? '' : 's'} of ${entry.dish}. Eat ${entry.daysLeft === 0 ? 'it today' : `within ${entry.daysLeft} day${entry.daysLeft === 1 ? '' : 's'}`}, and reheat until steaming hot.`;
      return env('leftovers_log', speech, { leftover: entry, leftovers: budgetState(getState()).leftovers.map(l => leftoverView(l, now)) });
    }
    if (action === 'remove') {
      if (!dish) return fail('leftovers_log', 'Which leftovers should I remove?', {});
      const removed = update(s => {
        const b = budgetState(s);
        const k = b.leftovers.findIndex(l => l.dish.toLowerCase().includes(dish.toLowerCase()) || dish.toLowerCase().includes(l.dish.toLowerCase()));
        return k >= 0 ? b.leftovers.splice(k, 1)[0] : null;
      });
      if (!removed) return fail('leftovers_log', `I don't have ${dish} in the leftovers.`, {});
      return env('leftovers_log', `Removed the ${removed.dish} from your leftovers.`, { removed, leftovers: budgetState(getState()).leftovers.map(l => leftoverView(l, now)) });
    }
    const list = budgetState(getState()).leftovers.map(l => leftoverView(l, now));
    if (!list.length) return env('leftovers_log', 'No leftovers logged. After dinner, tell me what\'s left and I\'ll keep an eye on it.', { leftovers: [] });
    const out = list.filter(l => l.status === 'throw-out');
    const ok = list.filter(l => l.status !== 'throw-out').sort((a, b) => a.daysLeft - b.daysLeft);
    let speech = ok.length ? `Leftovers: ${listPhrase(ok.map(l => `${l.dish}, ${l.daysLeft === 0 ? 'eat today' : `${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'} left`}`))}.` : '';
    if (out.length) speech += ` ${listPhrase(out.map(l => l.dish))} ${out.length > 1 ? 'are' : 'is'} past ${LEFTOVER_DAYS} days, so throw ${out.length > 1 ? 'them' : 'it'} out.`;
    return env('leftovers_log', speech.trim(), { leftovers: list });
  }
});

const LEFTOVER_IDEAS: { match: RegExp; idea: string; needs?: string }[] = [
  { match: /curry|stew|chili|dal/i, idea: 'wrap it in warm tortillas with a spoon of yogurt', needs: 'tortilla' },
  { match: /rice/i, idea: 'turn it into egg fried rice', needs: 'egg' },
  { match: /chicken|turkey/i, idea: 'shred it into quesadillas', needs: 'tortilla' },
  { match: /pasta|penne|spaghetti|noodle/i, idea: 'bake it with cheese on top', needs: 'cheddar' },
  { match: /shakshuka|vegetable|veg|roast/i, idea: 'blend it into a soup or fold it into an omelette', needs: 'egg' },
  { match: /banana|pancake|bread/i, idea: 'freeze slices for smoothies or French toast', needs: 'milk' }
];

tool({
  name: 'leftovers_ideas',
  title: 'Ideas for leftovers',
  description: 'Practical ways to use the logged leftovers before their window closes, preferring ideas whose extra ingredient is already in the pantry.',
  input: z.object({ dish: z.string().max(80).optional().describe('One leftover dish; default is all logged leftovers') }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '💡',
  handler: ({ dish }) => {
    const s = getState();
    const now = new Date();
    let list = budgetState(s).leftovers.map(l => leftoverView(l, now)).filter(l => l.status !== 'throw-out');
    if (dish) list = list.filter(l => l.dish.toLowerCase().includes(dish.toLowerCase()) || dish.toLowerCase().includes(l.dish.toLowerCase()));
    const targets = list.length ? list.map(l => ({ dish: l.dish, daysLeft: l.daysLeft as number | null })) : dish ? [{ dish, daysLeft: null }] : [];
    if (!targets.length) return env('leftovers_ideas', 'You have no leftovers logged. Tell me what\'s left after dinner and I\'ll suggest a second meal.', { ideas: [] });
    const has = (id: string) => s.pantry.some(p => p.id === id && p.qty > 0);
    const ideas = targets.map(t => {
      const m = LEFTOVER_IDEAS.find(x => x.match.test(t.dish));
      if (!m) return { dish: t.dish, daysLeft: t.daysLeft, idea: 'freeze it in single portions for an easy lunch', haveExtra: true };
      const haveExtra = !m.needs || has(m.needs);
      return { dish: t.dish, daysLeft: t.daysLeft, idea: haveExtra ? m.idea : 'freeze it in single portions for an easy lunch', haveExtra, needs: m.needs ? INGREDIENT_BY_ID.get(m.needs)?.name : undefined };
    });
    const speech = ideas.slice(0, 3).map(i => `For the ${i.dish}, ${i.idea}${i.daysLeft === 0 ? ', today' : ''}.`).join(' ');
    return env('leftovers_ideas', speech, { ideas });
  }
});

// ---------------- waste ----------------

const WASTE_TIPS: Record<string, string> = {
  produce: 'store greens with a paper towel in a sealed box, and plan them into the first dinner of the week',
  dairy: 'buy smaller packs, and freeze milk or yogurt you won\'t finish',
  bakery: 'freeze half the loaf as soon as you buy it and toast from frozen',
  protein: 'freeze meat on the day you buy it if it isn\'t planned within two days',
  grains: 'cool cooked rice quickly and use it within a day or two for fried rice',
  pantry: 'move older packs to the front of the shelf',
  frozen: 'label bags with the date so nothing gets lost'
};

tool({
  name: 'waste_insights',
  title: 'What do we waste most?',
  description: 'From logged thrown-away food in the last 30 days: total value, most-wasted items and categories, and one practical tip for each top category.',
  input: z.object({ days: z.number().int().min(1).max(90).default(30) }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🔍',
  handler: ({ days }) => {
    const s = getState();
    const since = addDays(new Date(), -(days - 1));
    const recent = (s.wasted ?? []).filter(w => w.date >= since);
    if (!recent.length) return env('waste_insights', `Nothing logged as thrown away in the last ${days} days. Nice work.`, { totalUsd: 0, items: [], categories: [], tips: [] });
    const byItem = new Map<string, number>();
    const byCat = new Map<string, number>();
    for (const w of recent) {
      byItem.set(w.name, round2((byItem.get(w.name) ?? 0) + w.valueUsd));
      const cat = findIngredient(w.name)?.category ?? 'other';
      byCat.set(cat, round2((byCat.get(cat) ?? 0) + w.valueUsd));
    }
    const items = [...byItem].map(([name, valueUsd]) => ({ name, valueUsd })).sort((a, b) => b.valueUsd - a.valueUsd);
    const categories = [...byCat].map(([category, valueUsd]) => ({ category, valueUsd })).sort((a, b) => b.valueUsd - a.valueUsd);
    const tips = categories.slice(0, 2).filter(c => WASTE_TIPS[c.category]).map(c => ({ category: c.category, tip: WASTE_TIPS[c.category] }));
    const totalUsd = round2(recent.reduce((n, w) => n + w.valueUsd, 0));
    let speech = `In the last ${days} days, ${usd(totalUsd)} of food was thrown away. Most of it was ${listPhrase(items.slice(0, 2).map(i => i.name))}.`;
    if (tips[0]) speech += ` Tip for ${tips[0].category}: ${tips[0].tip}.`;
    return env('waste_insights', speech, { totalUsd, days, items, categories, tips });
  }
});

// ---------------- voice routes (offline router) ----------------

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

registerRoute(t => {
  let m = t.match(/\b(?:set|make|change)\s+(?:our|my|the)\s+(?:weekly\s+)?(?:grocery\s+|food\s+)?budget\s+(?:to|at|of)\s+\$?(\d+(?:\.\d+)?)/)
    || t.match(/\b(?:our|my)\s+(?:weekly\s+)?(?:grocery\s+|food\s+)?budget\s+is\s+\$?(\d+(?:\.\d+)?)/);
  if (m) return { tool: 'budget_set', args: { weeklyUsd: Number(m[1]) } };
  if (/\bhow much (?:have|did) (?:we|i) spen[dt]\b|\bhow'?s (?:our|my|the) (?:grocery )?budget\b|\bbudget status\b|\bare we (?:on|over|under|within) (?:our |the )?budget\b|\bhow much (?:budget|money) (?:do we have |is )?left\b/.test(t)) {
    return { tool: 'budget_status', args: {} };
  }
  m = t.match(/\bunder \$?(\d+(?:\.\d+)?)\s*(?:dollars?\s*)?(?:a|per) (?:serving|portion|person)/);
  if (m) return { tool: 'budget_meal_plan', args: { maxUsdPerServing: Number(m[1]) } };
  if (/\b(cheap|cheapest|budget|affordable|inexpensive|low[- ]cost)\b.*\b(dinners?|meals?|recipes?|ideas?|eat)\b/.test(t)) return { tool: 'budget_meal_plan', args: {} };
  m = t.match(/\bhow much (?:does|do|is|are) (?:a |an |the |some )?([a-z\s-]+?) cost\b/) || t.match(/\bprice of (?:a |an |the |some )?([a-z\s-]+?)\??$/) || t.match(/\bhow much (?:is|are) (?:a |an |the |some )?([a-z\s-]+?)\??$/);
  if (m && !/^(it|that|this|everything|the order|order|the cart|cart|left|food)$/.test(m[1].trim()) && findIngredient(m[1].trim())) return { tool: 'price_check', args: { item: m[1].trim() } };
  if (/\bdonat(?:e|ion|ing)\b|\bcommunity fridge\b|\bfood bank\b|\bgive away (?:the |our |some )?(?:extra|spare|surplus)/.test(t)) return { tool: 'donate_surplus', args: {} };
  if (/\bwhat (?:can|should) (?:i|we) do with (?:the |our |these |those |my )?left ?overs?\b|\bleft ?overs? ideas?\b|\bideas for (?:the |our )?left ?overs?\b|\buse up (?:the |our )?left ?overs?\b/.test(t)) return { tool: 'leftovers_ideas', args: {} };
  if (/\bwhat left ?overs?\b|\bwhich left ?overs?\b|\blist (?:the |our )?left ?overs?\b|\bleft ?overs? do we have\b|\bany left ?overs?\b/.test(t)) return { tool: 'leftovers_log', args: { action: 'list' } };
  m = t.match(/\b(?:we ate|we finished|i ate|i finished)\s+(?:the\s+)?left ?overs?\s+(?:of\s+|from\s+)?(?:the\s+)?([a-z\s-]+?)\??$/);
  if (m) return { tool: 'leftovers_log', args: { action: 'remove', dish: m[1].trim() } };
  m = t.match(/\b(?:we have|we've got|there'?s|there are|log|save|we got)\s+(?:some\s+)?left ?overs?\s+(?:of\s+|from\s+)?(?:the\s+)?([a-z\s-]+?)(?:\s+from\s+(today|tonight|yesterday|last night|(\d+|one|two|three|four|five|six) days? ago))?\??$/)
    || t.match(/\b(?:we have|we've got|there'?s|there is)\s+(?:some\s+)?(?:left ?over|leftover)\s+([a-z\s-]+?)(?:\s+from\s+(today|tonight|yesterday|last night|(\d+|one|two|three|four|five|six) days? ago))?\??$/);
  if (m) {
    const when = m[2];
    const ago = !when || /today|tonight/.test(when) ? 0 : /yesterday|last night/.test(when) ? 1 : Number(m[3]) || NUM[m[3]] || 0;
    return { tool: 'leftovers_log', args: { action: 'add', dish: m[1].trim(), cookedDaysAgo: ago } };
  }
  if (/\bwhat do (?:we|i) (?:waste|throw (?:out|away)) (?:the )?most\b|\bwaste (?:insights|report|stats|breakdown)\b|\bhow much (?:food )?(?:have we|did we|have i|did i) (?:wasted|thrown (?:out|away))\b/.test(t)) {
    return { tool: 'waste_insights', args: {} };
  }
  return null;
});
