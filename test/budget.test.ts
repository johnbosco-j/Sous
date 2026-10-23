import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SOUS_DATA_PATH = join(mkdtempSync(join(tmpdir(), 'sous-budget-')), 'kitchen.json');
process.env.SOUS_BEDROCK = 'off';

type Sc = { ok: boolean; tool: string; speech: string; view?: string; data: any; followUp?: any };
let callTool: typeof import('../src/mcp/server.js').callTool;
let TOOL_NAMES: typeof import('../src/mcp/server.js').TOOL_NAMES;
let store: typeof import('../src/domain/store.js');
let route: typeof import('../src/agent/rules.js').route;

beforeAll(async () => {
  ({ callTool, TOOL_NAMES } = await import('../src/mcp/server.js'));
  store = await import('../src/domain/store.js');
  ({ route } = await import('../src/agent/rules.js'));
});

beforeEach(() => {
  store.resetState();
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<Sc> {
  const res = await callTool(name, args);
  return res.structuredContent as unknown as Sc;
}

async function placeOrder(items: string[]) {
  const cart = await call('shopping_cart_build', { items: items.map(name => ({ name })) });
  const placed = await call('shopping_checkout', { cartToken: cart.data.cartToken, confirmed: true });
  expect(placed.data.status).toBe('placed');
  return placed.data.totalUsd as number;
}

describe('budget tools', () => {
  it('registers all eight budget tools', () => {
    for (const name of ['budget_set', 'budget_status', 'budget_meal_plan', 'price_check', 'donate_surplus', 'leftovers_log', 'leftovers_ideas', 'waste_insights']) {
      expect(TOOL_NAMES()).toContain(name);
    }
  });

  it('budget_set stores the weekly budget and reports spend so far', async () => {
    const r = await call('budget_set', { weeklyUsd: 120 });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ weeklyUsd: 120, spentUsd: 0, remainingUsd: 120 });
    expect(store.getState().ext.budget.weeklyUsd).toBe(120);
  });

  it('budget_set rejects a negative budget', async () => {
    const res = await callTool('budget_set', { weeklyUsd: -5 });
    expect(res.isError).toBe(true);
  });

  it('budget_status without a budget still reports spend', async () => {
    const r = await call('budget_status');
    expect(r.data.weeklyUsd).toBeNull();
    expect(r.data.spentUsd).toBe(0);
  });

  it('budget_status counts placed orders this week', async () => {
    await call('budget_set', { weeklyUsd: 100 });
    const total = await placeOrder(['cucumber']);
    const r = await call('budget_status');
    expect(r.data.spentUsd).toBeCloseTo(total, 2);
    expect(r.data.remainingUsd).toBeCloseTo(100 - total, 2);
    expect(r.data.level).toBe('ok');
  });

  it('budget_status ignores draft carts that were never ordered', async () => {
    await call('budget_set', { weeklyUsd: 50 });
    await call('shopping_cart_build', { items: [{ name: 'feta' }] });
    const r = await call('budget_status');
    expect(r.data.spentUsd).toBe(0);
  });

  it('budget_status warns above 80 percent', async () => {
    const total = await placeOrder(['cucumber']);
    await call('budget_set', { weeklyUsd: Math.round((total / 0.9) * 100) / 100 });
    const r = await call('budget_status');
    expect(r.data.level).toBe('warning');
    expect(r.speech).toMatch(/left/);
  });

  it('budget_status flags going over budget', async () => {
    await placeOrder(['feta', 'cucumber']);
    await call('budget_set', { weeklyUsd: 1 });
    const r = await call('budget_status');
    expect(r.data.level).toBe('over');
    expect(r.speech).toMatch(/over/);
  });
});

describe('budget_meal_plan', () => {
  it('ranks dinners by out-of-pocket cost per serving', async () => {
    const r = await call('budget_meal_plan', { count: 4 });
    expect(r.ok).toBe(true);
    expect(r.view).toBe('meals');
    const costs = r.data.suggestions.map((x: any) => x.costPerServingUsd);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
  });

  it('keeps every pick under the cap', async () => {
    const r = await call('budget_meal_plan', { maxUsdPerServing: 0.5, count: 6 });
    expect(r.ok).toBe(true);
    for (const s of r.data.suggestions) expect(s.costPerServingUsd).toBeLessThanOrEqual(0.5);
  });

  it('never offers a recipe with a household allergen', async () => {
    const r = await call('budget_meal_plan', { count: 6 });
    expect(r.data.suggestions.map((x: any) => x.recipeId)).not.toContain('peanut-sesame-noodles');
  });

  it('feeds "cook the first one" with the cheapest pick', async () => {
    const r = await call('budget_meal_plan', {});
    const cook = await call('cook_start', { pick: 1 });
    expect(cook.data.recipeId).toBe(r.data.suggestions[0].recipeId);
  });

  it('fails clearly when nothing fits the cap', async () => {
    store.update(s => { s.pantry = []; });
    const r = await call('budget_meal_plan', { maxUsdPerServing: 0.01 });
    expect(r.ok).toBe(false);
    expect(r.speech).toMatch(/Nothing fits/);
  });
});

describe('price_check', () => {
  it('prices a pack and a unit from the catalog', async () => {
    const r = await call('price_check', { item: 'eggs' });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ packSize: 12, unitUsd: 0.33, packUsd: 3.96 });
    expect(r.data.onHand).toBe(9);
  });

  it('fails for unknown items', async () => {
    const r = await call('price_check', { item: 'unicorn steak' });
    expect(r.ok).toBe(false);
  });
});

describe('donate_surplus', () => {
  it('proposes expiring surplus, skips raw meat and home-cooked food, and asks first', async () => {
    const r = await call('donate_surplus', {});
    const names = r.data.items.map((i: any) => i.name);
    expect(names).toContain('baby spinach');
    expect(names).not.toContain('chicken thighs');
    expect(names).not.toContain('cooked rice');
    expect(r.data.skipped.map((s: any) => s.name)).toEqual(expect.arrayContaining(['chicken thighs', 'cooked rice']));
    expect(r.data.place.name).toMatch(/simulated/);
    expect(r.followUp).toMatchObject({ tool: 'donate_surplus', arguments: { confirm: true } });
    expect(store.getState().pantry.some(p => p.id === 'spinach')).toBe(true);
  });

  it('confirming removes the items and counts them as rescued food', async () => {
    const before = (await call('impact_report')).data.rescuedUsd;
    const r = await call('donate_surplus', { confirm: true });
    expect(r.data.status).toBe('donated');
    const s = store.getState();
    expect(s.pantry.some(p => p.id === 'spinach')).toBe(false);
    expect(s.rescued.some(x => x.recipeId === 'donated')).toBe(true);
    expect(s.ext.budget.donations).toHaveLength(1);
    const after = (await call('impact_report')).data.rescuedUsd;
    expect(after).toBeGreaterThan(before);
  });

  it('keeps food that the saved meal plan needs', async () => {
    await call('meal_plan_set', { recipeIds: ['spinach-chickpea-curry'] });
    const r = await call('donate_surplus', {});
    expect(r.data.items.map((i: any) => i.name)).not.toContain('baby spinach');
  });
});

describe('leftovers', () => {
  it('logs leftovers with a 4-day window', async () => {
    const r = await call('leftovers_log', { action: 'add', dish: 'coconut curry', servings: 3 });
    expect(r.data.leftover).toMatchObject({ dish: 'coconut curry', servings: 3, daysLeft: 4, status: 'ok' });
  });

  it('flags leftovers past the window as throw out', async () => {
    const r = await call('leftovers_log', { action: 'add', dish: 'pasta bake', cookedDaysAgo: 6 });
    expect(r.data.leftover.status).toBe('throw-out');
    expect(r.speech).toMatch(/throw it out/);
  });

  it('lists leftovers with days left and throw-out flags', async () => {
    await call('leftovers_log', { action: 'add', dish: 'fried rice', cookedDaysAgo: 3 });
    await call('leftovers_log', { action: 'add', dish: 'old stew', cookedDaysAgo: 5 });
    const r = await call('leftovers_log', { action: 'list' });
    expect(r.data.leftovers).toHaveLength(2);
    expect(r.speech).toMatch(/fried rice, 1 day left/);
    expect(r.speech).toMatch(/old stew is past 4 days/);
  });

  it('removes leftovers once eaten', async () => {
    await call('leftovers_log', { action: 'add', dish: 'curry' });
    const r = await call('leftovers_log', { action: 'remove', dish: 'curry' });
    expect(r.ok).toBe(true);
    expect(store.getState().ext.budget.leftovers).toHaveLength(0);
  });

  it('suggests ideas backed by what is in the pantry', async () => {
    await call('leftovers_log', { action: 'add', dish: 'chickpea curry' });
    const r = await call('leftovers_ideas', {});
    expect(r.data.ideas[0]).toMatchObject({ dish: 'chickpea curry', haveExtra: true });
    expect(r.speech).toMatch(/tortillas/);
  });

  it('falls back to freezing when the extra ingredient is missing', async () => {
    store.update(s => { s.pantry = s.pantry.filter(p => p.id !== 'tortilla'); });
    await call('leftovers_log', { action: 'add', dish: 'curry' });
    const r = await call('leftovers_ideas', {});
    expect(r.speech).toMatch(/freeze/);
  });

  it('explains when no leftovers are logged', async () => {
    const r = await call('leftovers_ideas', {});
    expect(r.data.ideas).toEqual([]);
  });
});

describe('waste_insights', () => {
  it('celebrates a month without waste', async () => {
    const r = await call('waste_insights', {});
    expect(r.data.totalUsd).toBe(0);
  });

  it('summarises waste by item and category with a tip', async () => {
    await call('waste_log', { items: [{ name: 'spinach' }, { name: 'milk', qty: 2 }] });
    const r = await call('waste_insights', {});
    expect(r.data.totalUsd).toBeGreaterThan(0);
    expect(r.data.items[0].name).toBe('baby spinach');
    expect(r.data.categories.map((c: any) => c.category)).toEqual(expect.arrayContaining(['produce', 'dairy']));
    expect(r.data.tips.length).toBeGreaterThan(0);
  });
});

describe('budget voice routes', () => {
  const ctx = { cooking: false, lastSuggestions: [] };
  it.each([
    ['set our grocery budget to 120 dollars', 'budget_set', { weeklyUsd: 120 }],
    ["how's our budget?", 'budget_status', {}],
    ['how much have we spent this week', 'budget_status', {}],
    ['cheap dinner ideas', 'budget_meal_plan', {}],
    ['dinners under $2 per serving', 'budget_meal_plan', { maxUsdPerServing: 2 }],
    ['how much are eggs', 'price_check', { item: 'eggs' }],
    ['can we donate the extra food?', 'donate_surplus', {}],
    ['what can I do with the leftovers', 'leftovers_ideas', {}],
    ['we have leftover curry from yesterday', 'leftovers_log', { action: 'add', dish: 'curry', cookedDaysAgo: 1 }],
    ['what leftovers do we have', 'leftovers_log', { action: 'list' }],
    ['what do we waste the most', 'waste_insights', {}]
  ])('"%s" -> %s', (text, tool, args) => {
    const r = route(text, ctx);
    expect(r).toMatchObject({ tool, args });
  });

  it('does not treat "how much is it" as a price check', () => {
    const r = route('how much is it?', ctx);
    expect('tool' in r && r.tool).not.toBe('price_check');
  });
});
