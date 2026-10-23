import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SOUS_DATA_PATH = join(mkdtempSync(join(tmpdir(), 'sous-core-')), 'kitchen.json');
process.env.SOUS_BEDROCK = 'off';

type Call = (name: string, args?: unknown) => Promise<any>;
let callTool: Call;
let store: typeof import('../src/domain/store.js');
let kitchen: typeof import('../src/domain/kitchen.js');

// Calls a tool through the same path MCP tools/call uses and returns the structured envelope.
async function run(name: string, args: unknown = {}) {
  const res = await callTool(name, args);
  return { res, sc: res.structuredContent as any, text: (res.content?.[0] as any)?.text as string };
}

beforeAll(async () => {
  ({ callTool } = (await import('../src/mcp/server.js')) as any);
  store = await import('../src/domain/store.js');
  kitchen = await import('../src/domain/kitchen.js');
});

beforeEach(() => {
  store.resetState();
});

describe('substitute_ingredient', () => {
  it('suggests flaxseed for eggs', async () => {
    const { sc } = await run('substitute_ingredient', { ingredient: 'eggs' });
    expect(sc.ok).toBe(true);
    expect(sc.data.options[0].use).toMatch(/flaxseed/);
    expect(sc.speech).toMatch(/Instead of eggs, use ground flaxseed/);
  });

  it('keeps tahini for peanut butter when nobody is allergic to sesame, and notes Leo\'s peanut allergy', async () => {
    const { sc } = await run('substitute_ingredient', { ingredient: 'peanut butter' });
    expect(sc.data.options.map((o: any) => o.use)).toContain('tahini');
    expect(sc.data.removed).toEqual([]);
    expect(sc.speech).toMatch(/Leo is allergic to peanuts/);
  });

  it('removes tahini once a member with a sesame allergy is remembered', async () => {
    await run('household_memory', { action: 'remember', member: 'Maya', kind: 'allergy', value: 'sesame' });
    const { sc } = await run('substitute_ingredient', { ingredient: 'peanut butter' });
    expect(sc.data.options.map((o: any) => o.use)).not.toContain('tahini');
    expect(sc.data.removed).toContainEqual({ use: 'tahini', reason: 'Maya is allergic to sesame' });
    expect(sc.speech).toMatch(/skipped tahini because Maya is allergic to sesame/);
  });

  it('only considers one member when asked', async () => {
    await run('household_memory', { action: 'remember', member: 'Maya', kind: 'allergy', value: 'sesame' });
    const { sc } = await run('substitute_ingredient', { ingredient: 'peanut butter', member: 'Sam' });
    expect(sc.data.options.map((o: any) => o.use)).toContain('tahini');
  });

  it('returns ok:false with a recovery line for an unknown ingredient', async () => {
    const { res, sc } = await run('substitute_ingredient', { ingredient: 'unobtainium' });
    expect(sc.ok).toBe(false);
    expect(res.isError).toBe(true);
    expect(sc.speech).toMatch(/don't have a tested substitute/);
  });
});

describe('food_safety_check', () => {
  it('says to use spinach today or tomorrow when it expires tomorrow', async () => {
    const { sc } = await run('food_safety_check', { item: 'spinach' });
    expect(sc.data.verdict).toBe('use-today');
    expect(sc.data.expiresInDays).toBe(1);
  });

  it('says to throw out past-date chicken and never calls it safe', async () => {
    store.update(s => {
      for (const lot of s.pantry) if (lot.id === 'chicken-thighs') lot.expiresOn = store.addDays(new Date(), -1);
    });
    const { sc } = await run('food_safety_check', { item: 'chicken' });
    expect(sc.data.verdict).toBe('discard');
    expect(sc.speech).toMatch(/Don't eat it/);
    expect(sc.speech.toLowerCase()).not.toContain('safe');
  });

  it('keeps leftovers cooked 2 days ago within the window', async () => {
    const { sc } = await run('food_safety_check', { item: 'leftover curry', cookedDaysAgo: 2 });
    expect(sc.data.verdict).toBe('within-window');
    expect(sc.speech.toLowerCase()).not.toMatch(/\bsafe\b/);
  });

  it('discards leftovers cooked 6 days ago', async () => {
    const { sc } = await run('food_safety_check', { item: 'leftover curry', cookedDaysAgo: 6 });
    expect(sc.data.verdict).toBe('discard');
    expect(sc.speech).toMatch(/throw it out/);
  });

  it('asks when leftovers were cooked if it does not know', async () => {
    const { sc } = await run('food_safety_check', { item: 'leftovers' });
    expect(sc.data.rule).toBe('leftovers');
    expect(sc.speech).toMatch(/When was it cooked/);
  });

  it('reports items that are not in the pantry', async () => {
    const { sc } = await run('food_safety_check', { item: 'cucumber' });
    expect(sc.data.verdict).toBe('not-in-pantry');
  });
});

describe('recipe_details', () => {
  it('scales quantities to 8 servings', async () => {
    const { sc } = await run('recipe_details', { recipe: 'spinach-chickpea-curry', servings: 8 });
    expect(sc.data.servings).toBe(8);
    const spinach = sc.data.ingredients.find((i: any) => i.name === 'baby spinach');
    expect(spinach.qty).toBe(2);
    expect(sc.speech).toMatch(/scaled it by 2/);
  });

  it('warns when a member is allergic to an ingredient', async () => {
    const { sc } = await run('recipe_details', { recipe: 'Peanut Sesame Noodles' });
    expect(sc.data.allergenHits.length).toBeGreaterThan(0);
    expect(sc.speech).toMatch(/Leo is allergic to peanuts/);
  });

  it('says it contains none of the household allergens otherwise', async () => {
    const { sc } = await run('recipe_details', { recipe: 'spinach-chickpea-curry' });
    expect(sc.data.allergenHits).toEqual([]);
    expect(sc.speech).toMatch(/contains none of your household's allergens/);
  });

  it('fails cleanly for an unknown recipe', async () => {
    const { sc } = await run('recipe_details', { recipe: 'zzzz qqqq' });
    expect(sc.ok).toBe(false);
  });
});

describe('shopping_list and the cart', () => {
  it('adds, gets, removes and clears items', async () => {
    let r = await run('shopping_list', { action: 'add', items: ['milk', 'cucumber'] });
    expect(r.sc.data.items.map((x: any) => x.name)).toEqual(['milk', 'cucumber']);
    r = await run('shopping_list', { action: 'add', items: ['milk'] });
    expect(r.sc.data.items).toHaveLength(2);
    r = await run('shopping_list', { action: 'get' });
    expect(r.sc.speech).toMatch(/milk and cucumber/);
    r = await run('shopping_list', { action: 'remove', items: ['milk'] });
    expect(r.sc.data.items.map((x: any) => x.name)).toEqual(['cucumber']);
    r = await run('shopping_list', { action: 'clear' });
    expect(r.sc.data.items).toEqual([]);
  });

  it('includes list items in the cart and removes them after checkout', async () => {
    await run('shopping_list', { action: 'add', items: ['cucumber'] });
    const cart = await run('shopping_cart_build', {});
    expect(cart.sc.data.lines.map((l: any) => l.name)).toContain('cucumber');
    const placed = await run('shopping_checkout', { cartToken: cart.sc.data.cartToken, confirmed: true });
    expect(placed.sc.data.status).toBe('placed');
    expect(store.getState().shoppingList.map(x => x.name)).not.toContain('cucumber');
  });
});

describe('waste_log and impact', () => {
  it('removes the item from the pantry and reports wasted dollars', async () => {
    const { sc } = await run('waste_log', { items: [{ name: 'spinach' }] });
    expect(sc.ok).toBe(true);
    expect(sc.data.totalUsd).toBeGreaterThan(0);
    expect(store.getState().pantry.some(p => p.id === 'spinach')).toBe(false);
    const impact = await run('impact_report', {});
    expect(impact.sc.data.wastedUsd).toBeGreaterThan(0);
    expect(impact.sc.speech).toMatch(/went in the bin/);
  });

  it('logs nothing for unknown food', async () => {
    const { sc } = await run('waste_log', { items: [{ name: 'unobtainium' }] });
    expect(sc.ok).toBe(false);
    expect(store.getState().wasted).toHaveLength(0);
  });
});

describe('pantry_update', () => {
  it('adds, uses and removes items', async () => {
    const eggsBefore = store.getState().pantry.filter(p => p.id === 'egg').reduce((n, p) => n + p.qty, 0);
    await run('pantry_update', { items: [{ name: 'eggs', action: 'add', qty: 12 }] });
    const eggsAfter = store.getState().pantry.filter(p => p.id === 'egg').reduce((n, p) => n + p.qty, 0);
    expect(eggsAfter).toBe(eggsBefore + 12);
    await run('pantry_update', { items: [{ name: 'tomatoes', action: 'use', qty: 2 }] });
    expect(store.getState().pantry.find(p => p.id === 'tomato')!.qty).toBe(3);
    await run('pantry_update', { items: [{ name: 'milk', action: 'remove' }] });
    expect(store.getState().pantry.some(p => p.id === 'milk')).toBe(false);
  });
});

describe('household_memory', () => {
  it('remembers, reads back and forgets a dislike', async () => {
    await run('household_memory', { action: 'remember', member: 'Ava', kind: 'dislike', value: 'mushrooms' });
    let r = await run('household_memory', { action: 'get' });
    expect(r.sc.speech).toMatch(/Ava doesn't like mushrooms/);
    expect(r.sc.speech).toMatch(/Leo is allergic to peanuts/);
    await run('household_memory', { action: 'forget', member: 'Ava', kind: 'dislike', value: 'mushrooms' });
    r = await run('household_memory', { action: 'get' });
    expect(r.sc.speech).not.toMatch(/mushrooms/);
  });

  it('asks for details when remember has no value', async () => {
    const { sc } = await run('household_memory', { action: 'remember', member: 'Ava' });
    expect(sc.ok).toBe(false);
  });
});

describe('planning, cooking and timers', () => {
  it('builds the cart from the saved plan', async () => {
    const plan = await run('meal_plan_set', { recipeIds: ['chicken-tzatziki-bowls'] });
    expect(plan.sc.data.plan[0].day).toBe('Tonight');
    const cart = await run('shopping_cart_build', {});
    expect(cart.sc.data.lines.map((l: any) => l.name)).toContain('cucumber');
    expect(cart.sc.followUp.tool).toBe('shopping_checkout');
  });

  it('uses the current cook step for a timer with no duration', async () => {
    await run('cook_start', { recipeId: 'spinach-chickpea-curry' });
    const step = await run('cook_step', { action: 'next' });
    expect(step.sc.data.step.timerSeconds).toBe(360);
    const timer = await run('timer_set', {});
    expect(timer.sc.ok).toBe(true);
    expect(timer.sc.data.timers.at(-1).seconds).toBe(360);
  });

  it('improvises a template recipe with Bedrock off and passes the allergen guard', async () => {
    const { sc } = await run('chef_improvise', {});
    const sug = sc.data.suggestions[0];
    expect(sug.engine).toBe('template');
    const text = [sug.title, ...(sug.ingredientsText ?? []), ...sug.steps].join(' ');
    expect(kitchen.allergenHitsInText(store.getState().household, text)).toEqual([]);
  });
});

describe('checkout through the tool path', () => {
  it('asks for confirmation, then places once and replays idempotently', async () => {
    const cart = await run('shopping_cart_build', { recipeIds: ['chicken-tzatziki-bowls'] });
    const token = cart.sc.data.cartToken;
    const ask = await run('shopping_checkout', { cartToken: token, confirmed: false });
    expect(ask.sc.data.status).toBe('awaiting_confirmation');
    expect(ask.sc.followUp).toMatchObject({ tool: 'shopping_checkout', arguments: { cartToken: token, confirmed: true } });
    const placed = await run('shopping_checkout', { cartToken: token, confirmed: true });
    expect(placed.sc.data.status).toBe('placed');
    const again = await run('shopping_checkout', { cartToken: token, confirmed: true });
    expect(again.sc.data.orderId).toBe(placed.sc.data.orderId);
    expect(again.sc.speech).toMatch(/already placed/);
  });

  it('rejects an unknown cart token', async () => {
    const { sc, res } = await run('shopping_checkout', { cartToken: 'cart_nope', confirmed: true });
    expect(sc.ok).toBe(false);
    expect(res.isError).toBe(true);
  });

  it('rejects invalid arguments with a tool error', async () => {
    const res = await callTool('shopping_checkout', { confirmed: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Invalid arguments/);
  });
});
