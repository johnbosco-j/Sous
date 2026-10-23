import { describe, expect, it } from 'vitest';
import { allergenHits, allergenHitsInText, buildCart, checkout, finishCooking, suggestMeals, CART_TTL_MS } from '../src/domain/kitchen.js';
import { seedState } from '../src/domain/store.js';
import { RECIPES } from '../src/domain/catalog.js';
import { route } from '../src/agent/rules.js';

const NOW = new Date(2026, 9, 23, 18, 0, 0);

describe('use-it-up planner', () => {
  it('ranks recipes that rescue soon-to-expire food first', () => {
    const s = seedState(NOW);
    const { suggestions, atRisk } = suggestMeals(s, { count: 3 }, NOW);
    expect(suggestions[0].recipeId).toBe('spinach-chickpea-curry');
    expect(suggestions[0].uses.map(u => u.name)).toContain('baby spinach');
    expect(atRisk.every(a => a.expiresInDays <= 3)).toBe(true);
  });

  it('never suggests a recipe containing a household allergen', () => {
    const s = seedState(NOW);
    const { suggestions, excluded } = suggestMeals(s, { count: 6, meal: 'any' }, NOW);
    expect(suggestions.map(x => x.recipeId)).not.toContain('peanut-sesame-noodles');
    expect(excluded).toContainEqual({ title: 'Peanut Sesame Noodles', reason: 'Leo is allergic to peanuts' });
  });

  it('applies new allergies immediately, across every recipe', () => {
    const s = seedState(NOW);
    s.household.members.find(m => m.name === 'Ava')!.allergies.push('dairy');
    const { suggestions } = suggestMeals(s, { count: 6, meal: 'any' }, NOW);
    for (const sug of suggestions) {
      const recipe = RECIPES.find(r => r.id === sug.recipeId)!;
      expect(allergenHits(s.household, recipe.ingredients.map(i => i.id))).toEqual([]);
    }
  });

  it('skips disliked ingredients', () => {
    const s = seedState(NOW);
    s.household.members.find(m => m.name === 'Ava')!.dislikes.push('mushrooms');
    const { suggestions, excluded } = suggestMeals(s, { count: 6 }, NOW);
    expect(suggestions.map(x => x.recipeId)).not.toContain('mushroom-risotto');
    expect(excluded.find(e => e.title === 'Mushroom Risotto')?.reason).toBe("Ava doesn't like mushrooms");
  });

  it('catches allergens in free text from a model-written recipe', () => {
    const s = seedState(NOW);
    expect(allergenHitsInText(s.household, 'Drizzle with satay sauce')).toHaveLength(1);
    expect(allergenHitsInText(s.household, 'Spinach frittata with tomatoes')).toHaveLength(0);
  });
});

describe('purchase gate', () => {
  it('builds a cart of only the missing ingredients', () => {
    const s = seedState(NOW);
    const cart = buildCart(s, ['spinach-chickpea-curry'], [], NOW);
    expect(cart.lines.map(l => l.id).sort()).toEqual(['cilantro', 'ginger']);
  });

  it('refuses to order without explicit confirmation', () => {
    const s = seedState(NOW);
    const cart = buildCart(s, ['chicken-tzatziki-bowls'], [], NOW);
    expect(checkout(s, cart.token, false, NOW).kind).toBe('needs_confirmation');
    expect(s.carts[cart.token].status).toBe('draft');
  });

  it('places once and is idempotent on replay', () => {
    const s = seedState(NOW);
    const cart = buildCart(s, ['chicken-tzatziki-bowls'], [], NOW);
    const first = checkout(s, cart.token, true, NOW);
    const again = checkout(s, cart.token, true, NOW);
    expect(first.kind).toBe('placed');
    expect(again).toMatchObject({ kind: 'placed', alreadyPlaced: true });
    expect(s.pantry.filter(p => p.id === 'cucumber')).toHaveLength(1);
  });

  it('rejects unknown and stale carts', () => {
    const s = seedState(NOW);
    expect(checkout(s, 'cart_nope', true, NOW).kind).toBe('unknown_cart');
    const cart = buildCart(s, ['chicken-tzatziki-bowls'], [], NOW);
    expect(checkout(s, cart.token, true, new Date(NOW.getTime() + CART_TTL_MS + 1000)).kind).toBe('expired');
  });
});

describe('cooking and impact', () => {
  it('uses soonest-expiring stock first and records the rescue', () => {
    const s = seedState(NOW);
    s.cooking = { recipeId: 'rescue-fried-rice', stepIndex: 4, startedAt: NOW.toISOString() };
    const before = s.rescued.length;
    const { rescued, totalUsd } = finishCooking(s, NOW);
    expect(rescued.map(r => r.name)).toContain('cooked rice');
    expect(totalUsd).toBeGreaterThan(0);
    expect(s.rescued.length).toBeGreaterThan(before);
    expect(s.pantry.find(p => p.id === 'cooked-rice')).toBeUndefined();
  });
});

describe('voice router', () => {
  const ctx = { cooking: false, lastSuggestions: [] };
  it.each([
    ['What should we cook tonight?', 'meal_suggest'],
    ["What's about to expire?", 'pantry_check'],
    ["Remember Ava doesn't like mushrooms", 'household_memory'],
    ['Leo is allergic to peanuts', 'household_memory'],
    ["Let's cook the first one", 'cook_start'],
    ['Set a timer for 10 minutes', 'timer_set'],
    ["Add what we're missing to the cart", 'shopping_cart_build'],
    ['How much food have we saved?', 'impact_report'],
    ["We're out of milk", 'pantry_update'],
    ['Plan dinners for the next three nights', '__plan_week']
  ])('%s -> %s', (text, tool) => {
    const r = route(text, ctx);
    expect('tool' in r && r.tool).toBe(tool);
  });

  it('maps cooking controls only while cooking', () => {
    expect(route('next step', { cooking: true, lastSuggestions: [] })).toEqual({ tool: 'cook_step', args: { action: 'next' } });
  });
});
