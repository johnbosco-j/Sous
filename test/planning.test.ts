import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SOUS_DATA_PATH = join(mkdtempSync(join(tmpdir(), 'sous-planning-')), 'kitchen.json');
process.env.SOUS_BEDROCK = 'off';

let callTool: typeof import('../src/mcp/server.js').callTool;
let resetState: typeof import('../src/domain/store.js').resetState;
let route: typeof import('../src/agent/rules.js').route;

beforeAll(async () => {
  ({ callTool } = await import('../src/mcp/server.js'));
  ({ resetState } = await import('../src/domain/store.js'));
  ({ route } = await import('../src/agent/rules.js'));
});

beforeEach(() => {
  resetState();
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await callTool(name, args);
  return { res, sc: res.structuredContent as any, text: (res.content as any)[0].text as string };
};

describe('unit_convert', () => {
  it.each([
    [2, 'cups', 'ml', 473],
    [500, 'ml', 'cups', 2.11],
    [1, 'tbsp', 'tsp', 3],
    [4, 'oz', 'grams', 113],
    [100, 'g', 'ounces', 3.53],
    [2, 'pounds', 'kg', 0.91],
    [1, 'kg', 'lb', 2.2],
    [350, 'fahrenheit', 'celsius', 177],
    [180, 'celsius', 'fahrenheit', 356]
  ])('%s %s -> %s', async (value, from, to, expected) => {
    const { sc, text } = await call('unit_convert', { value, from, to });
    expect(sc.ok).toBe(true);
    expect(sc.data.result).toBeCloseTo(expected, 0);
    expect(text).toMatch(new RegExp(String(expected)));
  });

  it('refuses volume to weight, which depends on the ingredient', async () => {
    const { res, sc, text } = await call('unit_convert', { value: 1, from: 'cups', to: 'grams' });
    expect(res.isError).toBe(true);
    expect(sc.ok).toBe(false);
    expect(text).toMatch(/depends on the ingredient/);
  });

  it('rejects unknown units with a recovery hint', async () => {
    const { res, text } = await call('unit_convert', { value: 3, from: 'smidgens', to: 'ml' });
    expect(res.isError).toBe(true);
    expect(text).toMatch(/don't know the unit smidgens/);
  });
});

describe('recipe_search', () => {
  it('finds recipes by ingredient and returns the meals carousel shape', async () => {
    const { sc } = await call('recipe_search', { ingredient: 'chicken' });
    expect(sc.view).toBe('meals');
    expect(sc.data.suggestions.length).toBeGreaterThan(0);
    for (const s of sc.data.suggestions) expect(s).toHaveProperty('recipeId');
    expect(Array.isArray(sc.data.excluded)).toBe(true);
    expect(Array.isArray(sc.data.atRisk)).toBe(true);
    const titles = sc.data.suggestions.map((s: any) => s.title).join(' ');
    expect(titles).toMatch(/Chicken/);
  });

  it('respects a time limit', async () => {
    const { sc } = await call('recipe_search', { maxMinutes: 20 });
    expect(sc.data.suggestions.length).toBeGreaterThan(0);
    for (const s of sc.data.suggestions) expect(s.minutes).toBeLessThanOrEqual(20);
  });

  it('filters to kid-friendly recipes', async () => {
    const { sc } = await call('recipe_search', { kidFriendly: true, count: 6 });
    for (const s of sc.data.suggestions) expect(s.kidFriendly).toBe(true);
  });

  it('filters by meal type', async () => {
    const { sc } = await call('recipe_search', { meal: 'breakfast' });
    const ids = sc.data.suggestions.map((s: any) => s.recipeId);
    expect(ids).toContain('banana-oat-pancakes');
    expect(ids).not.toContain('spinach-chickpea-curry');
  });

  it('excludes allergen recipes and says why', async () => {
    const { sc, text } = await call('recipe_search', { ingredient: 'noodles' });
    expect(sc.data.suggestions.map((s: any) => s.recipeId)).not.toContain('peanut-sesame-noodles');
    expect(sc.data.excluded).toContainEqual({ title: 'Peanut Sesame Noodles', reason: 'Leo is allergic to peanuts' });
    expect(text).toMatch(/Leo is allergic to peanuts/);
  });

  it('returns a recoverable error when nothing matches', async () => {
    const { res, sc } = await call('recipe_search', { ingredient: 'chicken', maxMinutes: 5 });
    expect(res.isError).toBe(true);
    expect(sc.data.suggestions).toEqual([]);
  });

  it('feeds "cook the first one" through lastSuggestions', async () => {
    const { sc } = await call('recipe_search', { meal: 'breakfast' });
    const top = sc.data.suggestions[0].recipeId;
    const started = await call('cook_start', { pick: 1 });
    expect(started.sc.data.recipeId).toBe(top);
  });
});

describe('meal plan', () => {
  it('reports an empty plan', async () => {
    const { sc, text } = await call('meal_plan_get');
    expect(sc.data.plan).toEqual([]);
    expect(text).toMatch(/No meals planned/);
  });

  it('reads back the plan with Tonight first', async () => {
    await call('meal_plan_set', { recipeIds: ['spinach-chickpea-curry', 'chicken-tzatziki-bowls', 'spinach-shakshuka'] });
    const { sc, text } = await call('meal_plan_get');
    expect(sc.data.plan).toHaveLength(3);
    expect(sc.data.plan[0].day).toBe('Tonight');
    expect(sc.data.plan[1].day).toBe('Tomorrow');
    expect(text).toMatch(/Tonight, Spinach & Chickpea Coconut Curry/);
  });

  it('removes one recipe by name', async () => {
    await call('meal_plan_set', { recipeIds: ['spinach-chickpea-curry', 'chicken-tzatziki-bowls', 'spinach-shakshuka'] });
    const { sc } = await call('meal_plan_clear', { recipe: 'shakshuka' });
    expect(sc.data.removed).toEqual(['Spinach Shakshuka']);
    expect(sc.data.plan).toHaveLength(2);
  });

  it('removes tonight by day', async () => {
    await call('meal_plan_set', { recipeIds: ['spinach-chickpea-curry', 'chicken-tzatziki-bowls'] });
    const { sc } = await call('meal_plan_clear', { day: 'tonight' });
    expect(sc.data.removed).toEqual(['Spinach & Chickpea Coconut Curry']);
  });

  it('clears the whole plan and is idempotent', async () => {
    await call('meal_plan_set', { recipeIds: ['spinach-chickpea-curry'] });
    expect((await call('meal_plan_clear')).text).toMatch(/cleared/);
    expect((await call('meal_plan_clear')).text).toMatch(/already empty/);
    expect((await call('meal_plan_get')).sc.data.plan).toEqual([]);
  });
});

describe('timers', () => {
  it('lists no timers when none run', async () => {
    const { sc, text } = await call('timer_list');
    expect(sc.data.timers).toEqual([]);
    expect(text).toMatch(/No timers/);
  });

  it('lists running timers with time left, soonest first', async () => {
    await call('timer_set', { minutes: 10, label: 'Rice' });
    await call('timer_set', { minutes: 3, label: 'Eggs' });
    const { sc, text } = await call('timer_list');
    expect(sc.data.timers.map((t: any) => t.label)).toEqual(['Eggs', 'Rice']);
    expect(sc.data.timers[0].secondsLeft).toBeGreaterThan(150);
    expect(text).toMatch(/2 timers/);
  });

  it('cancels by label', async () => {
    await call('timer_set', { minutes: 10, label: 'Rice' });
    await call('timer_set', { minutes: 3, label: 'Eggs' });
    const { sc } = await call('timer_cancel', { label: 'rice' });
    expect(sc.data.cancelled.map((t: any) => t.label)).toEqual(['Rice']);
    expect(sc.data.timers.map((t: any) => t.label)).toEqual(['Eggs']);
  });

  it('asks which timer when several run and none is named', async () => {
    await call('timer_set', { minutes: 10, label: 'Rice' });
    await call('timer_set', { minutes: 3, label: 'Eggs' });
    const { res, text } = await call('timer_cancel');
    expect(res.isError).toBe(true);
    expect(text).toMatch(/Which one/);
  });

  it('cancels all timers', async () => {
    await call('timer_set', { minutes: 10, label: 'Rice' });
    await call('timer_set', { minutes: 3, label: 'Eggs' });
    const { sc } = await call('timer_cancel', { all: true });
    expect(sc.data.cancelled).toHaveLength(2);
    expect((await call('timer_list')).sc.data.timers).toEqual([]);
  });
});

describe('cook_status', () => {
  it('says when nothing is cooking', async () => {
    const { sc, text } = await call('cook_status');
    expect(sc.data.cooking).toBe(false);
    expect(text).toMatch(/not cooking/);
  });

  it('tracks the current step and time to go', async () => {
    await call('cook_start', { recipeId: 'spinach-chickpea-curry' });
    await call('cook_step', { action: 'next' });
    const { sc, text } = await call('cook_status');
    expect(sc.data.cooking).toBe(true);
    expect(sc.data.stepIndex).toBe(1);
    expect(sc.data.totalSteps).toBe(6);
    expect(sc.data.stepsLeft).toBe(4);
    expect(sc.data.minutesLeft).toBeGreaterThan(0);
    expect(text).toMatch(/step 2 of 6/);
  });
});

describe('voice routes', () => {
  const ctx = { cooking: false, lastSuggestions: [] };
  it.each([
    ['convert 2 cups to ml', 'unit_convert', { value: 2, from: 'cups', to: 'ml' }],
    ['how many grams in 4 ounces', 'unit_convert', { value: 4, from: 'ounces', to: 'grams' }],
    ['350 fahrenheit in celsius', 'unit_convert', { value: 350, from: 'fahrenheit', to: 'celsius' }],
    ['find recipes with chicken', 'recipe_search', { ingredient: 'chicken' }],
    ["what's planned this week", 'meal_plan_get', {}],
    ['clear the plan', 'meal_plan_clear', {}],
    ['cancel all timers', 'timer_cancel', { all: true }],
    ['what timers are running', 'timer_list', {}],
    ['how much longer', 'cook_status', {}]
  ])('"%s" -> %s', (text, tool, args) => {
    const r = route(text, ctx) as any;
    expect(r.tool).toBe(tool);
    expect(r.args).toMatchObject(args);
  });

  it('leaves dinner questions to meal_suggest', () => {
    expect((route('What should we cook tonight?', ctx) as any).tool).toBe('meal_suggest');
  });
});
