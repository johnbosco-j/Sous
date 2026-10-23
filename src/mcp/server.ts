import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema, CallToolResult, GetPromptRequestSchema, ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema,
  ReadResourceRequestSchema, Tool, ToolAnnotations, McpError, ErrorCode
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { bedrockAvailable, improviseRecipe } from '../aws/bedrock.js';
import { INGREDIENT_BY_ID, RECIPE_BY_ID, Recipe, findIngredient, findRecipe } from '../domain/catalog.js';
import { LEFTOVER_DAYS, STORAGE, SUBSTITUTES } from '../domain/knowledge.js';
import {
  allergenHits, allergenHitsInText, buildCart, cartView, checkout, cookView, finishCooking, impact, listPhrase,
  normalizeAllergen, pantryView, suggestMeals, whenPhrase
} from '../domain/kitchen.js';
import { activeTimers, addDays, dayKey, daysUntil, getState, round2, update } from '../domain/store.js';

export const SERVER_VERSION = '1.0.0';
export const UI_MIME = 'text/html;profile=mcp-app';

import { Envelope, FollowUp, View, allergenWord, env, fail, lastSuggestions, tool, tools } from './registry.js';
import './tools/index.js';
export type { Envelope, FollowUp, View };

const INSTRUCTIONS = `Sous is the household's kitchen agent: pantry, meal planning, groceries, food and allergy safety, and hands-free cooking.
- Speak each tool's text content as written; it is short and voice-ready.
- Prefer meal_suggest for "what's for dinner?"; it ranks recipes by how much soon-to-expire food they rescue and already removes anything a household member is allergic to or must avoid.
- If someone describes an allergic reaction (swelling, trouble breathing, hives after eating), call allergy_emergency immediately and speak its text exactly.
- When structuredContent.followUp is present, ask its prompt. Only if the user clearly agrees in their next turn, call followUp.tool with followUp.arguments.
- Purchases: shopping_checkout needs the cartToken from shopping_cart_build and confirmed=true. Set confirmed=true ONLY after the user explicitly says yes to placing that order.
- While cooking, map "next", "back", "repeat", "what do I need" to cook_step.
- If structuredContent.view is set and the device has a screen, render the tool's ui:// resource (MCP Apps).`;

function minutesPhrase(seconds: number): string {
  if (seconds < 60) return `${seconds} second`;
  const m = Math.round(seconds / 60);
  return `${m} minute`;
}


// ---------------- pantry ----------------

tool({
  name: 'pantry_check',
  title: 'Check the pantry',
  description: 'List what is in the kitchen, soonest-expiring first, with the dollar value at risk. Use for "what\'s about to expire?" or "do we have eggs?".',
  input: z.object({
    filter: z.enum(['expiring', 'all']).default('expiring').describe('"expiring" = items that expire within withinDays'),
    withinDays: z.number().int().min(0).max(14).default(3),
    item: z.string().optional().describe('Ask about one ingredient, e.g. "eggs"')
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  view: 'pantry',
  icon: '🧺',
  handler: ({ filter, withinDays, item }) => {
    const s = getState();
    const items = pantryView(s);
    const soon = items.filter(i => i.expiresInDays !== null && i.expiresInDays <= withinDays);
    const totalValueUsd = round2(items.reduce((n, i) => n + i.valueUsd, 0));
    const atRiskValueUsd = round2(soon.reduce((n, i) => n + i.valueUsd, 0));
    const data = { items: filter === 'all' ? items : items, expiringSoon: soon, totalValueUsd, atRiskValueUsd };
    if (item) {
      const ing = findIngredient(item);
      const hit = ing && items.find(i => i.id === ing.id);
      if (!hit) return env('pantry_check', `You're out of ${ing?.name ?? item}. Want me to add it to the cart?`, data, { view: 'pantry' });
      return env('pantry_check', `You have ${hit.qty} ${hit.unit}${hit.qty === 1 ? '' : 's'} of ${hit.name}${hit.expiresInDays !== null ? `, good until ${whenPhrase(hit.expiresInDays)}` : ''}.`, data, { view: 'pantry' });
    }
    if (!soon.length) return env('pantry_check', `Nothing expires in the next ${withinDays} days. Your kitchen is in great shape.`, data, { view: 'pantry' });
    const byDay = soon.slice(0, 5).map(i => `${i.name} ${whenPhrase(i.expiresInDays)}`);
    return env('pantry_check', `${soon.length} things expire soon: ${listPhrase(byDay)}. That's about $${atRiskValueUsd.toFixed(2)} of food at risk. Want dinner ideas that use them up?`, data, {
      view: 'pantry',
      followUp: { prompt: 'Want dinner ideas that use them up?', tool: 'meal_suggest', arguments: { count: 3 } }
    });
  }
});

const SHELF_DAYS: Record<string, number | null> = { produce: 6, dairy: 10, protein: 3, bakery: 5, grains: null, pantry: null, frozen: 90 };

tool({
  name: 'pantry_update',
  title: 'Update the pantry',
  description: 'Record groceries added, ingredients used, or items that ran out. E.g. "we bought a dozen eggs", "we\'re out of milk", "I used two tomatoes".',
  input: z.object({
    items: z.array(z.object({
      name: z.string().describe('Ingredient name as spoken'),
      action: z.enum(['add', 'use', 'remove']).describe('add = bought; use = used some; remove = ran out / threw away'),
      qty: z.number().positive().optional(),
      expiresInDays: z.number().int().min(0).max(365).optional()
    })).min(1).max(10)
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  icon: '📝',
  handler: ({ items }) => {
    const unknown: string[] = [];
    const changed = update(s => {
      const out: { name: string; qty: number; unit: string; action: 'added' | 'used' | 'removed' }[] = [];
      for (const it of items) {
        const ing = findIngredient(it.name);
        if (!ing) { unknown.push(it.name); continue; }
        if (it.action === 'add') {
          const qty = it.qty ?? ing.packSize;
          const days = it.expiresInDays ?? SHELF_DAYS[ing.category] ?? null;
          s.pantry.push({ id: ing.id, qty, expiresOn: days === null ? null : addDays(new Date(), days) });
          out.push({ name: ing.name, qty, unit: ing.unit, action: 'added' });
        } else if (it.action === 'use') {
          let left = it.qty ?? 1;
          const lots = s.pantry.filter(p => p.id === ing.id && p.qty > 0).sort((a, b) => (daysUntil(a.expiresOn) ?? 999) - (daysUntil(b.expiresOn) ?? 999));
          for (const lot of lots) { const take = Math.min(lot.qty, left); lot.qty = round2(lot.qty - take); left -= take; if (left <= 0) break; }
          out.push({ name: ing.name, qty: it.qty ?? 1, unit: ing.unit, action: 'used' });
        } else {
          for (const lot of s.pantry) if (lot.id === ing.id) lot.qty = 0;
          out.push({ name: ing.name, qty: 0, unit: ing.unit, action: 'removed' });
        }
      }
      s.pantry = s.pantry.filter(p => p.qty > 0);
      return out;
    });
    const parts = changed.map(c => c.action === 'added' ? `added ${c.qty} ${c.name}` : c.action === 'used' ? `marked ${c.qty} ${c.name} as used` : `noted you're out of ${c.name}`);
    let speech = parts.length ? `Done: ${listPhrase(parts)}.` : '';
    if (unknown.length) speech += ` I don't know ${listPhrase(unknown)} yet, so I left ${unknown.length > 1 ? 'them' : 'it'} out.`;
    const data = { changed, items: pantryView(getState()) };
    return changed.length ? env('pantry_update', speech.trim(), data) : fail('pantry_update', speech.trim(), data);
  }
});

// ---------------- planning ----------------

tool({
  name: 'meal_suggest',
  title: 'Suggest use-it-up meals',
  description: 'Rank recipes by how much soon-to-expire food they rescue, minus missing ingredients and cook time. Recipes containing a household allergen are always excluded (deterministic guard); disliked ingredients are skipped. Use for "what should we cook tonight?".',
  input: z.object({
    count: z.number().int().min(1).max(6).default(3),
    meal: z.enum(['dinner', 'breakfast', 'snack', 'any']).default('dinner'),
    maxMinutes: z.number().int().min(5).max(180).optional(),
    kidFriendly: z.boolean().optional()
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  view: 'meals',
  icon: '🍽️',
  handler: (opts) => {
    const res = suggestMeals(getState(), opts);
    lastSuggestions.ids = res.suggestions.map(s => s.recipeId);
    if (!res.suggestions.length) return fail('meal_suggest', "I couldn't find a recipe that fits. Want me to improvise one from what you have?", res as any);
    const [top, ...rest] = res.suggestions;
    const uses = top.uses.slice(0, 2);
    let speech = `Tonight I'd make ${top.title}`;
    speech += uses.length ? `. It uses your ${listPhrase(uses.map(u => u.name))} before ${uses.length > 1 ? 'they expire' : 'it expires'} ${whenPhrase(uses[0].expiresInDays)}.` : '.';
    if (rest.length) speech += ` Also on screen: ${listPhrase(rest.map(r => r.title))}.`;
    const allergy = res.excluded.find(e => /allergic/.test(e.reason));
    if (allergy) speech += ` I left out ${allergy.title} because ${allergy.reason}.`;
    return env('meal_suggest', speech, res as any, {
      view: 'meals',
      followUp: { prompt: `Want to start cooking ${top.title}?`, tool: 'cook_start', arguments: { recipeId: top.recipeId } }
    });
  }
});

const improvised = new Map<string, Recipe>();

tool({
  name: 'chef_improvise',
  title: 'Improvise a recipe (Amazon Bedrock)',
  description: 'Invent a new recipe from the ingredients that expire soonest, using Amazon Bedrock. The result is checked by the deterministic allergen guard before it is shown; falls back to a template when Bedrock is off.',
  input: z.object({ request: z.string().max(200).optional().describe('Optional preference, e.g. "something spicy"') }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  view: 'meals',
  icon: '✨',
  handler: async ({ request }) => {
    const s = getState();
    const items = pantryView(s);
    const atRisk = items.filter(i => i.expiresInDays !== null && i.expiresInDays >= 0 && i.expiresInDays <= 3);
    const avoid = s.household.members.flatMap(m => m.allergies.map(a => `${a} (${m.name} is allergic)`)).concat(s.household.members.flatMap(m => m.dislikes));
    let recipe: { title: string; minutes: number; ingredients: string[]; steps: string[] } | null = null;
    let engine: 'bedrock' | 'template' = 'template';
    let blocked = '';
    if (bedrockAvailable()) {
      for (let attempt = 0; attempt < 2 && !recipe; attempt++) {
        try {
          const r = await improviseRecipe(atRisk.map(i => i.name), items.map(i => i.name), avoid, request);
          const hits = allergenHitsInText(s.household, [r.title, ...r.ingredients, ...r.steps].join(' '));
          if (hits.length) { blocked = `${hits[0].ingredient} (${hits[0].member})`; continue; }
          recipe = r;
          engine = 'bedrock';
        } catch {
          break;
        }
      }
    }
    if (!recipe) {
      const hasEggs = items.some(i => i.id === 'egg' && i.qty >= 4);
      const names = atRisk.slice(0, 4).map(i => i.name);
      recipe = hasEggs
        ? { title: 'Use-It-Up Frittata', minutes: 25, ingredients: ['6 eggs', ...names], steps: ['Heat the oven grill to high.', `Chop the ${listPhrase(names)} into bite-size pieces.`, 'Soften everything in an oven-safe pan with a little oil.', 'Pour over six beaten eggs with salt and pepper and cook gently until the edges set.', 'Finish under the grill until puffed and golden.'] }
        : { title: 'Clean-Out-The-Fridge Stir-Fry', minutes: 20, ingredients: names, steps: [`Slice the ${listPhrase(names)}.`, 'Stir-fry on high heat with oil and garlic.', 'Season and serve over rice or noodles.'] };
    }
    const id = `improvised-${Date.now().toString(36)}`;
    const catalogIngredients = recipe.ingredients.map(t => findIngredient(t.replace(/^[\d./\s]+(cups?|tbsp|tsp|g|kg|ml|cloves?|pieces?)?\s*(of\s+)?/i, ''))).filter(Boolean);
    const uniqueIds = [...new Set(catalogIngredients.map(i => i!.id))];
    improvised.set(id, {
      id, title: recipe.title, emoji: '✨', gradient: ['#22d3ee', '#7c3aed'], minutes: recipe.minutes, servings: 4, meal: 'dinner', kidFriendly: true,
      ingredients: uniqueIds.map(i => ({ id: i, qty: 1 })), steps: recipe.steps.map(text => ({ text }))
    });
    RECIPE_BY_ID.set(id, improvised.get(id)!);
    lastSuggestions.ids = [id];
    const uses = atRisk.filter(a => uniqueIds.includes(a.id)).map(a => ({ name: a.name, expiresInDays: a.expiresInDays as number }));
    const suggestion = {
      recipeId: id, title: recipe.title, emoji: '✨', gradient: ['#22d3ee', '#7c3aed'], minutes: recipe.minutes, servings: 4, kidFriendly: true, score: 0,
      uses, missing: [], reason: uses.length ? `Invented around ${listPhrase(uses.map(u => u.name))}.` : 'Invented from what you have.',
      rescueValueUsd: round2(atRisk.filter(a => uniqueIds.includes(a.id)).reduce((n, a) => n + Math.min(a.valueUsd, a.valueUsd), 0)),
      steps: recipe.steps, engine, ingredientsText: recipe.ingredients
    };
    let speech = `Here's something new: ${recipe.title}, about ${recipe.minutes} minutes.`;
    if (blocked) speech += ` I threw out a first idea because it contained ${blocked}.`;
    return env('chef_improvise', speech, { suggestions: [suggestion], excluded: [], atRisk: uses, engine }, {
      view: 'meals',
      followUp: { prompt: `Want to cook ${recipe.title}?`, tool: 'cook_start', arguments: { recipeId: id } }
    });
  }
});

tool({
  name: 'meal_plan_set',
  title: 'Save the meal plan',
  description: 'Save recipes as the plan for the coming days (first recipe tonight). The plan feeds the grocery cart.',
  input: z.object({ recipeIds: z.array(z.string()).min(1).max(7) }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🗓️',
  handler: ({ recipeIds }) => {
    const valid = recipeIds.map(id => RECIPE_BY_ID.get(id) ?? findRecipe(id)).filter((r): r is Recipe => Boolean(r));
    if (!valid.length) return fail('meal_plan_set', "I couldn't match those recipes.");
    const plan = update(s => {
      s.plan = valid.map((r, k) => ({ day: addDays(new Date(), k), recipeId: r.id }));
      return s.plan;
    });
    const view = plan.map((p, k) => {
      const r = RECIPE_BY_ID.get(p.recipeId)!;
      const [y, m, d] = p.day.split('-').map(Number);
      return { day: k === 0 ? 'Tonight' : new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' }), recipeId: r.id, title: r.title, emoji: r.emoji };
    });
    return env('meal_plan_set', `Planned ${listPhrase(view.map(v => `${v.title} ${v.day === 'Tonight' ? 'tonight' : `on ${v.day}`}`))}. Want me to build the grocery cart?`, { plan: view }, {
      followUp: { prompt: 'Build the grocery cart for this plan?', tool: 'shopping_cart_build', arguments: {} }
    });
  }
});

// ---------------- shopping ----------------

tool({
  name: 'shopping_cart_build',
  title: 'Build the grocery cart',
  description: 'Work out exactly what is missing for the chosen recipes (or the saved plan) and build a draft Amazon Fresh cart (simulated). Nothing is purchased; returns a cartToken for shopping_checkout.',
  input: z.object({
    recipeIds: z.array(z.string()).max(7).optional().describe('Defaults to the saved plan, else the last suggestions'),
    items: z.array(z.object({ name: z.string(), qty: z.number().positive().optional() })).max(10).optional().describe('Extra items, e.g. "add milk"')
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  view: 'cart',
  icon: '🛒',
  handler: ({ recipeIds, items }) => {
    const unknown: string[] = [];
    const result = update(s => {
      let ids = (recipeIds ?? []).map(id => (RECIPE_BY_ID.get(id) ?? findRecipe(id))?.id).filter((x): x is string => Boolean(x));
      if (!ids.length && !items?.length) ids = s.plan.length ? s.plan.map(p => p.recipeId) : s.cooking ? [s.cooking.recipeId] : lastSuggestions.ids.slice(0, 1);
      if (!ids.length && !items?.length) ids = suggestMeals(s, { count: 1 }).suggestions.map(x => x.recipeId);
      const extras = (items ?? []).flatMap(it => {
        const ing = findIngredient(it.name);
        if (!ing) { unknown.push(it.name); return []; }
        return [{ id: ing.id, qty: it.qty ?? ing.packSize }];
      });
      // The running shopping list rides along with whatever the recipes need.
      for (const entry of s.shoppingList) {
        const ing = findIngredient(entry.name);
        if (ing && !extras.some(e => e.id === ing.id)) extras.push({ id: ing.id, qty: ing.packSize });
      }
      const cart = buildCart(s, ids, extras);
      return { cart, view: cartView(s, cart), ids };
    });
    const { view } = result;
    if (!view.lines.length) {
      const titles = result.ids.map(id => RECIPE_BY_ID.get(id)?.title).filter(Boolean) as string[];
      return env('shopping_cart_build', `Good news: you already have everything${titles.length ? ` for ${listPhrase(titles)}` : ''}. Nothing to buy.`, view, { view: 'cart' });
    }
    const names = view.lines.map(l => l.name);
    let speech = `Your cart has ${listPhrase(names.slice(0, 4))}${names.length > 4 ? ` and ${names.length - 4} more` : ''}, $${view.totalUsd.toFixed(2)} from Amazon Fresh, delivered ${view.deliveryWindow.toLowerCase()}. Should I place the order?`;
    if (unknown.length) speech = `I couldn't find ${listPhrase(unknown)}. ` + speech;
    return env('shopping_cart_build', speech, view, {
      view: 'cart',
      followUp: { prompt: 'Should I place the order?', tool: 'shopping_checkout', arguments: { cartToken: view.cartToken, confirmed: true } }
    });
  }
});

tool({
  name: 'shopping_checkout',
  title: 'Place the grocery order',
  description: 'Place the order for a draft cart. Requires the cartToken from shopping_cart_build AND confirmed=true, which must only be set after the user explicitly agreed to this order. Without confirmation it returns the cart and asks. Replaying a placed cart returns the same order (idempotent).',
  input: z.object({
    cartToken: z.string(),
    confirmed: z.boolean().default(false).describe('true only after an explicit spoken yes for this cart')
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  view: 'cart',
  icon: '💳',
  handler: ({ cartToken, confirmed }) => {
    const out = update(s => {
      const r = checkout(s, cartToken, confirmed);
      if (r.kind === 'placed' && !r.alreadyPlaced) {
        // Ordered items come off the running shopping list.
        const ordered = new Set(r.cart.lines.map(l => l.id));
        s.shoppingList = s.shoppingList.filter(x => !ordered.has(findIngredient(x.name)?.id ?? ''));
      }
      return { r, view: 'cart' in r ? cartView(s, r.cart) : null };
    });
    const { r, view } = out;
    if (r.kind === 'unknown_cart') return fail('shopping_checkout', "I can't find that cart. Let's build a fresh one.");
    if (r.kind === 'expired') return fail('shopping_checkout', 'That cart is more than 30 minutes old, so prices may have changed. Want me to rebuild it?');
    if (r.kind === 'empty') return fail('shopping_checkout', 'That cart is empty, so there is nothing to order.');
    if (r.kind === 'needs_confirmation') {
      return env('shopping_checkout', `That's $${view!.totalUsd.toFixed(2)} for ${view!.lines.length} items. Should I place the order?`, { ...view!, status: 'awaiting_confirmation' }, {
        view: 'cart',
        followUp: { prompt: 'Place the order?', tool: 'shopping_checkout', arguments: { cartToken, confirmed: true } }
      });
    }
    const speech = r.alreadyPlaced
      ? `That order is already placed. Order ${view!.orderId} arrives ${view!.eta?.toLowerCase()}.`
      : `Order placed. $${view!.totalUsd.toFixed(2)}, arriving ${view!.eta?.toLowerCase()}. I've added the groceries to your pantry.`;
    return env('shopping_checkout', speech, view!, { view: 'cart' });
  }
});

// ---------------- cooking ----------------

function stepSpeech(prefix: string, v: NonNullable<ReturnType<typeof cookView>>): { speech: string; followUp?: FollowUp } {
  const t = v.step.timerSeconds;
  const speech = `${prefix}Step ${v.stepIndex + 1} of ${v.totalSteps}: ${v.step.text}${t ? ` Want a ${minutesPhrase(t)} timer?` : ''}`;
  return t ? { speech, followUp: { prompt: `Start a ${minutesPhrase(t)} timer?`, tool: 'timer_set', arguments: { seconds: t, label: `${v.title}: step ${v.stepIndex + 1}` } } } : { speech };
}

tool({
  name: 'cook_start',
  title: 'Start hands-free cooking',
  description: 'Start step-by-step, hands-free cooking mode for a recipe (by recipeId or spoken name). Defaults to the top suggestion.',
  input: z.object({
    recipeId: z.string().optional(),
    recipe: z.string().optional().describe('Recipe name as spoken, e.g. "the curry"'),
    pick: z.number().int().min(1).max(6).optional().describe('1 = "the first one" from the last suggestions')
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  view: 'cook',
  icon: '👩‍🍳',
  handler: ({ recipeId, recipe, pick }) => {
    const s = getState();
    let r = recipeId ? RECIPE_BY_ID.get(recipeId) ?? findRecipe(recipeId) : null;
    if (!r && recipe) r = findRecipe(recipe);
    if (!r && pick) r = RECIPE_BY_ID.get(lastSuggestions.ids[pick - 1] ?? '') ?? null;
    if (!r) r = RECIPE_BY_ID.get(lastSuggestions.ids[0] ?? '') ?? RECIPE_BY_ID.get(suggestMeals(s, { count: 1 }).suggestions[0]?.recipeId ?? '') ?? null;
    if (!r) return fail('cook_start', "I couldn't find that recipe.");
    const chosen = r;
    const v = update(st => {
      st.cooking = { recipeId: chosen.id, stepIndex: 0, startedAt: new Date().toISOString() };
      return cookView(st)!;
    });
    const missing = v.ingredients.filter(i => !i.have).map(i => i.name);
    const pre = `Let's make ${chosen.title}. ${chosen.steps.length} steps, about ${chosen.minutes} minutes.${missing.length ? ` Heads up, you're short on ${listPhrase(missing)}.` : ''} `;
    const { speech, followUp } = stepSpeech(pre, v);
    return env('cook_start', speech, v as any, { view: 'cook', followUp });
  }
});

tool({
  name: 'cook_step',
  title: 'Move through the recipe',
  description: 'Hands-free cooking controls: next, back, repeat, ingredients, or finish. Finishing records which expiring ingredients were rescued.',
  input: z.object({ action: z.enum(['next', 'back', 'repeat', 'ingredients', 'finish']).default('next') }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  view: 'cook',
  icon: '⏭️',
  handler: ({ action }) => {
    const s = getState();
    if (!s.cooking || !RECIPE_BY_ID.get(s.cooking.recipeId)) return fail('cook_step', "We're not cooking anything right now. Ask me what to cook tonight.");
    const r = RECIPE_BY_ID.get(s.cooking.recipeId)!;
    if (action === 'ingredients') {
      const v = cookView(s)!;
      return env('cook_step', `You need ${listPhrase(v.ingredients.map(i => `${i.qty} ${i.unit}${i.qty === 1 ? '' : 's'} of ${i.name}`))}.`, v as any, { view: 'cook' });
    }
    if (action === 'finish' || (action === 'next' && s.cooking.stepIndex >= r.steps.length - 1)) {
      const result = update(st => {
        const before = cookView(st)!;
        const fin = finishCooking(st);
        st.cooking = null;
        st.plan = st.plan.filter(p => p.recipeId !== r.id);
        return { view: { ...before, stepIndex: before.totalSteps - 1, done: true, rescued: fin.rescued }, fin };
      });
      const rescuedNames = [...new Set(result.fin.rescued.map(x => x.name))];
      const speech = rescuedNames.length
        ? `That's it, ${r.title} is ready! You rescued ${listPhrase(rescuedNames)}: $${result.fin.totalUsd.toFixed(2)} of food that would have gone in the bin. Enjoy!`
        : `That's it, ${r.title} is ready. Enjoy!`;
      return env('cook_step', speech, result.view as any, { view: 'cook' });
    }
    const v = update(st => {
      const c = st.cooking!;
      if (action === 'next') c.stepIndex = Math.min(c.stepIndex + 1, r.steps.length - 1);
      if (action === 'back') c.stepIndex = Math.max(0, c.stepIndex - 1);
      return cookView(st)!;
    });
    const { speech, followUp } = stepSpeech(action === 'back' ? 'Going back. ' : '', v);
    return env('cook_step', speech, v as any, { view: 'cook', followUp });
  }
});

tool({
  name: 'timer_set',
  title: 'Set a kitchen timer',
  description: 'Start a named kitchen timer. If no duration is given while cooking, uses the current step\'s suggested time.',
  input: z.object({
    minutes: z.number().positive().max(600).optional(),
    seconds: z.number().int().positive().max(36000).optional(),
    label: z.string().max(60).optional()
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  icon: '⏲️',
  handler: ({ minutes, seconds, label }) => {
    const s = getState();
    let total = seconds ?? (minutes ? Math.round(minutes * 60) : 0);
    let name = label;
    if (!total && s.cooking) {
      const v = cookView(s);
      total = v?.step.timerSeconds ?? 0;
      name ??= v ? `${v.title}: step ${v.stepIndex + 1}` : undefined;
    }
    if (!total) return fail('timer_set', 'How long should the timer be?');
    const timers = update(st => {
      st.timers.push({ id: `t_${Date.now().toString(36)}`, label: name ?? 'Kitchen timer', endsAt: new Date(Date.now() + total * 1000).toISOString(), seconds: total });
      return st.timers;
    });
    activeTimers();
    const len = total < 60 ? `${total} second${total === 1 ? '' : 's'}` : `${Math.round(total / 60)} minute${Math.round(total / 60) === 1 ? '' : 's'}`;
    return env('timer_set', `Timer set: ${len}${name ? ` for ${name.replace(/:.*$/, '')}` : ''}.`, { timers });
  }
});

// ---------------- memory & impact ----------------

tool({
  name: 'household_memory',
  title: 'Household memory',
  description: 'Read or change what Sous remembers about the household across sessions: allergies (hard rule), dislikes, and notes. E.g. "remember Ava doesn\'t like mushrooms", "Leo is allergic to peanuts".',
  input: z.object({
    action: z.enum(['get', 'remember', 'forget']).default('get'),
    member: z.string().optional().describe('Household member name'),
    kind: z.enum(['allergy', 'dislike', 'note']).optional(),
    value: z.string().max(80).optional().describe('e.g. "peanuts", "mushrooms"')
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🧠',
  handler: ({ action, member, kind, value }) => {
    if (action === 'get') {
      const h = getState().household;
      const label = (a: string) => ({ peanut: 'peanuts', 'tree-nut': 'tree nuts', egg: 'eggs' } as Record<string, string>)[a] ?? a;
      const facts = h.members.flatMap(m => [...m.allergies.map(a => `${m.name} is allergic to ${label(a)}`), ...m.dislikes.map(d => `${m.name} doesn't like ${d}`)]);
      return env('household_memory', facts.length ? `Here's what I remember: ${listPhrase(facts)}.` : "I don't have any allergies or dislikes saved yet.", { household: h });
    }
    if (!kind || !value) return fail('household_memory', 'What should I remember, and for whom?');
    const v = value.toLowerCase().trim();
    const changed = update(s => {
      if (kind === 'note') {
        if (action === 'remember') s.household.notes.push(value); else s.household.notes = s.household.notes.filter(n => !n.toLowerCase().includes(v));
        return `note: ${value}`;
      }
      const name = member?.trim() || 'Everyone';
      let m = s.household.members.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!m && action === 'remember') { m = { name: name[0].toUpperCase() + name.slice(1), allergies: [], dislikes: [] }; s.household.members.push(m); }
      if (!m) return '';
      const list = kind === 'allergy' ? m.allergies : m.dislikes;
      const key = kind === 'allergy' ? (normalizeAllergen(v) ?? v) : v;
      if (action === 'remember') { if (!list.includes(key)) list.push(key); }
      else { const k = list.indexOf(key); if (k >= 0) list.splice(k, 1); }
      return `${m.name} ${kind}: ${key}`;
    });
    const h = getState().household;
    if (!changed) return fail('household_memory', `I don't have anyone called ${member} in the household.`, { household: h });
    const who = member ?? 'Everyone';
    const speech = action === 'forget'
      ? `Okay, I've forgotten that ${who} ${kind === 'allergy' ? `is allergic to ${v}` : kind === 'dislike' ? `doesn't like ${v}` : `note`}.`
      : kind === 'allergy'
        ? `Got it. ${who} is allergic to ${v}. I'll keep it out of every suggestion, improvised recipe and cart, and that rule lives in code, not in a prompt.`
        : kind === 'dislike'
          ? `Noted: ${who} doesn't like ${v}. I'll leave it out of dinner ideas from now on.`
          : `Noted: ${value}.`;
    return env('household_memory', speech, { household: h, changed });
  }
});

tool({
  name: 'impact_report',
  title: 'Food rescued this week',
  description: 'How much food (dollars, kilograms, CO2e) the household rescued from the bin this week, plus a yearly projection.',
  input: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  view: 'impact',
  icon: '🌱',
  handler: () => {
    const d = impact(getState());
    const waste = d.wastedUsd > 0 ? ` $${d.wastedUsd.toFixed(2)} still went in the bin, so there's room to do better.` : '';
    return env('impact_report', `This week you rescued $${d.rescuedUsd.toFixed(2)} of food, about ${d.rescuedKg} kilograms, which avoids roughly ${d.co2eKg} kilograms of CO2e. At this pace that's $${d.projectionYearUsd.toLocaleString('en-US')} a year.${waste}`, d as any, { view: 'impact' });
  }
});


// ---------------- kitchen knowledge ----------------

tool({
  name: 'substitute_ingredient',
  title: 'Allergy-safe substitution',
  description: 'Suggest a substitute for an ingredient you are out of or cannot eat. Options containing any household allergen are removed (deterministic), and the reason is given.',
  input: z.object({
    ingredient: z.string().describe('e.g. "eggs", "butter", "peanut butter"'),
    member: z.string().optional().describe('Only consider this member\'s allergies; default is the whole household')
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🔁',
  handler: ({ ingredient, member }) => {
    const ing = findIngredient(ingredient);
    const options = ing ? SUBSTITUTES[ing.id] ?? [] : [];
    const name = ing?.name ?? ingredient;
    if (!options.length) return fail('substitute_ingredient', `I don't have a tested substitute for ${name} yet. Want a recipe that doesn't need it?`, { ingredient: name, options: [], removed: [] });
    const h = getState().household;
    const people = member ? h.members.filter(m => m.name.toLowerCase() === member.toLowerCase()) : h.members;
    const allergies = people.flatMap(m => m.allergies.map(a => ({ member: m.name, allergen: normalizeAllergen(a) ?? a })));
    const safe = options.filter(o => !o.allergens.some(a => allergies.some(x => x.allergen === a)));
    const removed = options.filter(o => !safe.includes(o)).map(o => {
      const hit = allergies.find(x => o.allergens.includes(x.allergen as any))!;
      return { use: o.use, reason: `${hit.member} is allergic to ${allergenWord(hit.allergen)}` };
    });
    const ownAllergy = ing ? allergenHits({ ...h, members: people }, [ing.id]) : [];
    if (!safe.length) return fail('substitute_ingredient', `Every substitute I know for ${name} clashes with an allergy here, so I'd pick a different recipe.`, { ingredient: name, options: [], removed });
    const [best, ...rest] = safe;
    let speech = `Instead of ${name}, use ${best.use}: ${best.ratio}${best.note ? `, ${best.note}` : ''}.`;
    if (rest.length) speech += ` Or ${rest[0].use}.`;
    if (removed.length) speech += ` I skipped ${removed[0].use} because ${removed[0].reason}.`;
    if (ownAllergy.length) speech = `Good call swapping it: ${ownAllergy[0].member} is allergic to ${allergenWord(normalizeAllergen(ownAllergy[0].allergen) ?? ownAllergy[0].allergen)}. ` + speech;
    return env('substitute_ingredient', speech, { ingredient: name, options: safe, removed });
  }
});

tool({
  name: 'food_safety_check',
  title: 'Is it still good?',
  description: 'Conservative, rule-based storage guidance for an ingredient in the pantry, or for leftovers: days left on its date, the general fridge window, and what to look for. Never declares food safe; past-date raw protein is always a "throw it out".',
  input: z.object({
    item: z.string().describe('e.g. "chicken", "rice", "leftover curry"'),
    cookedDaysAgo: z.number().int().min(0).max(30).optional().describe('For leftovers: how many days ago it was cooked')
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🧊',
  handler: ({ item, cookedDaysAgo }) => {
    const isLeftover = /left ?over|cooked|yesterday'?s|last night/i.test(item) || cookedDaysAgo !== undefined;
    if (isLeftover && !findIngredient(item.replace(/left ?overs?|cooked/gi, '').trim())) {
      const d = cookedDaysAgo;
      if (d === undefined) return env('food_safety_check', `Leftovers keep about ${LEFTOVER_DAYS - 1} to ${LEFTOVER_DAYS} days in the fridge if they went in within 2 hours of cooking. When was it cooked?`, { item, rule: 'leftovers', windowDays: [3, 4] });
      if (d > LEFTOVER_DAYS) return env('food_safety_check', `That was cooked ${d} days ago, past the usual 3 to 4 day window for leftovers. I'd throw it out. When in doubt, throw it out.`, { item, verdict: 'discard', cookedDaysAgo: d });
      return env('food_safety_check', `Cooked ${d} day${d === 1 ? '' : 's'} ago, so it's within the usual 3 to 4 day window for leftovers if it was refrigerated within 2 hours. Reheat it until steaming hot, and if it smells or looks off, throw it out.`, { item, verdict: 'within-window', cookedDaysAgo: d });
    }
    const ing = findIngredient(item);
    if (!ing) return fail('food_safety_check', `I don't have storage guidance for ${item}. When in doubt, throw it out.`, { item });
    const s = getState();
    const lots = s.pantry.filter(p => p.id === ing.id && p.qty > 0);
    const days = lots.map(l => daysUntil(l.expiresOn)).filter((x): x is number => x !== null);
    const soonest = days.length ? Math.min(...days) : null;
    const rule = STORAGE[ing.id];
    const tip = rule?.tip ?? '';
    let verdict: 'discard' | 'use-today' | 'within-date' | 'not-in-pantry' | 'no-date';
    let speech: string;
    if (!lots.length) { verdict = 'not-in-pantry'; speech = `I don't see ${ing.name} in the pantry.${rule ? ` In general it keeps ${rule.fridgeDays[0]} to ${rule.fridgeDays[1]} days in the fridge.` : ''}`; }
    else if (soonest === null) { verdict = 'no-date'; speech = `${ing.name} has no date recorded.${rule ? ` In general it keeps ${rule.fridgeDays[0]} to ${rule.fridgeDays[1]} days in the fridge.` : ''} Check it before using.`; }
    else if (soonest < 0) {
      verdict = 'discard';
      speech = rule?.kind === 'raw-protein'
        ? `Your ${ing.name} is past its date. Don't eat it; raw meat past its date should go in the bin.`
        : `Your ${ing.name} is past its date by ${-soonest} day${soonest === -1 ? '' : 's'}. When in doubt, throw it out.`;
    } else if (soonest <= 1) { verdict = 'use-today'; speech = `Your ${ing.name} is good until ${whenPhrase(soonest)}, so use it today or tomorrow, or freeze it now.`; }
    else { verdict = 'within-date'; speech = `Your ${ing.name} is within its date, until ${whenPhrase(soonest)}.`; }
    if (tip && verdict !== 'discard') speech += ` ${tip}`;
    return env('food_safety_check', speech, { item: ing.name, verdict, expiresInDays: soonest, fridgeDays: rule?.fridgeDays ?? null, tip });
  }
});

tool({
  name: 'recipe_details',
  title: 'Recipe details',
  description: 'Ingredients and steps for a recipe, scaled to a number of servings, with what is missing from the pantry and an allergen check against the household.',
  input: z.object({
    recipe: z.string().describe('Recipe name or id, e.g. "the curry"'),
    servings: z.number().int().min(1).max(20).optional()
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '📖',
  handler: ({ recipe, servings }) => {
    const r = RECIPE_BY_ID.get(recipe) ?? findRecipe(recipe);
    if (!r) return fail('recipe_details', `I couldn't find a recipe called ${recipe}.`, {});
    const s = getState();
    const factor = servings ? servings / r.servings : 1;
    const have = (id: string) => s.pantry.filter(p => p.id === id && p.qty > 0).reduce((n, p) => n + p.qty, 0);
    const ingredients = r.ingredients.map(ri => {
      const i = INGREDIENT_BY_ID.get(ri.id)!;
      const qty = round2(ri.qty * factor);
      return { name: i.name, qty, unit: i.unit, have: have(ri.id) >= qty };
    });
    const hits = allergenHits(s.household, r.ingredients.map(i => i.id));
    const missing = ingredients.filter(i => !i.have).map(i => i.name);
    let speech = `${r.title} serves ${servings ?? r.servings} in about ${r.minutes} minutes, ${r.steps.length} steps.`;
    if (factor !== 1) speech += ` I've scaled it by ${round2(factor)}.`;
    speech += missing.length ? ` You're missing ${listPhrase(missing)}.` : ' You have everything.';
    speech += hits.length ? ` Careful: it contains ${hits[0].ingredient}, and ${hits[0].member} is allergic to ${allergenWord(normalizeAllergen(hits[0].allergen) ?? hits[0].allergen)}.` : ' It contains none of your household\'s allergens.';
    return env('recipe_details', speech, { recipeId: r.id, title: r.title, servings: servings ?? r.servings, minutes: r.minutes, ingredients, steps: r.steps.map(x => x.text), allergenHits: hits });
  }
});

tool({
  name: 'shopping_list',
  title: 'Shopping list',
  description: 'A running shopping list that persists across sessions: get, add, remove or clear items. shopping_cart_build includes it automatically.',
  input: z.object({
    action: z.enum(['get', 'add', 'remove', 'clear']).default('get'),
    items: z.array(z.string()).max(10).optional()
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '📝',
  handler: ({ action, items }) => {
    const list = update(s => {
      if (action === 'clear') s.shoppingList = [];
      for (const raw of items ?? []) {
        const name = (findIngredient(raw)?.name ?? raw).trim().toLowerCase();
        if (!name) continue;
        if (action === 'add' && !s.shoppingList.some(x => x.name === name)) s.shoppingList.push({ name, addedAt: new Date().toISOString() });
        if (action === 'remove') s.shoppingList = s.shoppingList.filter(x => x.name !== name);
      }
      return s.shoppingList;
    });
    const names = list.map(x => x.name);
    const speech = action === 'clear' ? 'Your shopping list is cleared.'
      : action === 'add' ? `Added ${listPhrase((items ?? []).map(i => findIngredient(i)?.name ?? i))}. Your list has ${names.length} item${names.length === 1 ? '' : 's'}.`
      : action === 'remove' ? `Removed. ${names.length ? `Still on the list: ${listPhrase(names)}.` : 'Your list is empty.'}`
      : names.length ? `On your list: ${listPhrase(names)}. Say "add the list to the cart" when you're ready.` : 'Your shopping list is empty.';
    return env('shopping_list', speech, { items: list });
  }
});

tool({
  name: 'waste_log',
  title: 'Log thrown-away food',
  description: 'Record food that was thrown away, so the impact report stays honest and Sous learns what tends to go to waste.',
  input: z.object({ items: z.array(z.object({ name: z.string(), qty: z.number().positive().optional() })).min(1).max(10) }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  icon: '🗑️',
  handler: ({ items }) => {
    const unknown: string[] = [];
    const logged = update(s => {
      const out: { name: string; valueUsd: number }[] = [];
      for (const it of items) {
        const ing = findIngredient(it.name);
        if (!ing) { unknown.push(it.name); continue; }
        const onHand = s.pantry.filter(p => p.id === ing.id && p.qty > 0).reduce((n, p) => n + p.qty, 0);
        const qty = it.qty ?? (onHand || 1);
        let left = qty;
        for (const lot of s.pantry.filter(p => p.id === ing.id && p.qty > 0)) { const take = Math.min(lot.qty, left); lot.qty = round2(lot.qty - take); left -= take; }
        s.pantry = s.pantry.filter(p => p.qty > 0);
        const entry = { name: ing.name, valueUsd: round2(qty * ing.priceUsd), kg: round2(qty * ing.kg), date: dayKey(new Date()), recipeId: 'wasted' };
        s.wasted.push(entry);
        out.push({ name: entry.name, valueUsd: entry.valueUsd });
      }
      return out;
    });
    if (!logged.length) return fail('waste_log', `I don't know ${listPhrase(unknown)}, so nothing was logged.`, { logged: [] });
    const total = round2(logged.reduce((n, x) => n + x.valueUsd, 0));
    return env('waste_log', `Logged ${listPhrase(logged.map(x => x.name))} as thrown away, about $${total.toFixed(2)}. Next time I'll suggest it sooner.`, { logged, totalUsd: total });
  }
});

// ---------------- MCP wiring ----------------

const ENVELOPE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    tool: { type: 'string' },
    speech: { type: 'string', description: 'Short, voice-ready line to speak' },
    view: { type: 'string', enum: ['meals', 'cook', 'cart', 'pantry', 'impact'] },
    data: { type: 'object', additionalProperties: true },
    followUp: {
      type: 'object',
      properties: { prompt: { type: 'string' }, tool: { type: 'string' }, arguments: { type: 'object', additionalProperties: true } },
      required: ['prompt', 'tool', 'arguments']
    }
  },
  required: ['ok', 'tool', 'speech', 'data']
} as const;

function emojiIcon(emoji: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="46" font-size="44" text-anchor="middle">${emoji}</text></svg>`;
  return [{ src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, mimeType: 'image/svg+xml', sizes: ['64x64'] }];
}

export function uiUri(view: View): string {
  return `ui://sous/${view}.html`;
}

function toolList(): Tool[] {
  return tools.map(t => {
    const schema = z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: schema as Tool['inputSchema'],
      outputSchema: ENVELOPE_SCHEMA as unknown as Tool['outputSchema'],
      annotations: { title: t.title, ...t.annotations },
      icons: emojiIcon(t.icon),
      ...(t.view ? { _meta: { ui: { resourceUri: uiUri(t.view) }, 'ui/resourceUri': uiUri(t.view) } } : {})
    } as Tool;
  });
}

export const TOOL_NAMES = () => tools.map(t => t.name);

export async function callTool(name: string, args: unknown): Promise<CallToolResult> {
  const t = tools.find(x => x.name === name);
  if (!t) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
  const parsed = t.input.safeParse(args ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i: z.core.$ZodIssue) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return { content: [{ type: 'text', text: `Invalid arguments for ${name}: ${msg}` }], isError: true };
  }
  try {
    const out = await t.handler(parsed.data);
    // A refused or impossible request is a tool-level error with a spoken recovery line, never a dead end.
    return { content: [{ type: 'text', text: out.speech }], structuredContent: out as unknown as Record<string, unknown>, ...(out.ok ? {} : { isError: true }) };
  } catch (err) {
    return { content: [{ type: 'text', text: `Sous hit an error in ${name}: ${(err as Error).message}` }], isError: true };
  }
}

const VIEWS: View[] = ['meals', 'cook', 'cart', 'pantry', 'impact'];
const UI_DIR = resolve(process.env.SOUS_UI_DIR ?? 'ui');

export function viewHtml(view: View): string {
  const file = resolve(UI_DIR, `${view}.html`);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  // Minimal fallback view so any MCP Apps host still shows something useful.
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sous ${view}</title><style>body{font:20px system-ui;background:#1c1714;color:#f5efe6;padding:24px}pre{white-space:pre-wrap}</style></head><body><h1>Sous: ${view}</h1><pre id="o">Waiting for data...</pre><script>
addEventListener('message',e=>{const m=e.data||{};if(m.method==='ui/notifications/tool-result'){const sc=m.params&&m.params.structuredContent;document.getElementById('o').textContent=(sc&&sc.speech?sc.speech+'\\n\\n':'')+JSON.stringify(sc&&sc.data,null,2)}});
parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{appInfo:{name:'sous-fallback',version:'1'},appCapabilities:{},protocolVersion:'2026-01-26'}},'*');
</script></body></html>`;
}

const UI_META = { ui: { csp: { resourceDomains: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'] }, prefersBorder: false } };

export function createSousServer(): Server {
  const server = new Server(
    { name: 'sous', title: 'Sous: zero-waste kitchen agent', version: SERVER_VERSION, websiteUrl: 'https://github.com/johnbosco-j/sous', icons: emojiIcon('🍳') } as any,
    {
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
      instructions: INSTRUCTIONS
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList() }));
  server.setRequestHandler(CallToolRequestSchema, async req => callTool(req.params.name, req.params.arguments));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: 'sous://household', name: 'household', title: 'Household profile', description: 'Members, allergies, dislikes and notes', mimeType: 'application/json' },
      { uri: 'sous://pantry', name: 'pantry', title: 'Pantry', description: 'Everything in the kitchen, soonest-expiring first', mimeType: 'application/json' },
      { uri: 'sous://impact', name: 'impact', title: 'Food rescued', description: 'This week\'s rescued food, in dollars, kg and CO2e', mimeType: 'application/json' },
      ...VIEWS.map(v => ({ uri: uiUri(v), name: `${v}-view`, title: `Sous ${v} view (MCP App)`, description: `Echo Show card for the ${v} tools`, mimeType: UI_MIME, _meta: UI_META }))
    ]
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [{ uriTemplate: 'sous://recipe/{id}', name: 'recipe', title: 'Recipe', description: 'A recipe with ingredients and steps', mimeType: 'application/json' }]
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async req => {
    const uri = req.params.uri;
    const s = getState();
    const json = (data: unknown) => ({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] });
    if (uri === 'sous://household') return json(s.household);
    if (uri === 'sous://pantry') return json(pantryView(s));
    if (uri === 'sous://impact') return json(impact(s));
    const recipe = uri.match(/^sous:\/\/recipe\/(.+)$/);
    if (recipe) {
      const r = RECIPE_BY_ID.get(decodeURIComponent(recipe[1]));
      if (!r) throw new McpError(ErrorCode.InvalidParams, `Unknown recipe: ${recipe[1]}`);
      return json(r);
    }
    const view = uri.match(/^ui:\/\/sous\/(\w+)\.html$/);
    if (view && VIEWS.includes(view[1] as View)) {
      return { contents: [{ uri, mimeType: UI_MIME, text: viewHtml(view[1] as View), _meta: UI_META }] };
    }
    throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      { name: 'plan_tonight', title: 'Plan tonight\'s dinner', description: 'Use up what expires first, respect allergies, then offer to cook or shop', arguments: [{ name: 'maxMinutes', description: 'Time limit in minutes', required: false }] },
      { name: 'use_it_up_week', title: 'Use-it-up week', description: 'Plan three dinners around expiring food and build one grocery cart' }
    ]
  }));

  server.setRequestHandler(GetPromptRequestSchema, async req => {
    if (req.params.name === 'plan_tonight') {
      const max = req.params.arguments?.maxMinutes;
      return { messages: [{ role: 'user', content: { type: 'text', text: `What should we cook tonight${max ? ` in under ${max} minutes` : ''}? Use meal_suggest, read the top pick aloud, then offer to start cook mode or build the cart for anything missing.` } }] };
    }
    if (req.params.name === 'use_it_up_week') {
      return { messages: [{ role: 'user', content: { type: 'text', text: 'Plan our next three dinners around what expires soonest: call meal_suggest with count 3, save them with meal_plan_set, then shopping_cart_build. Ask me before placing any order.' } }] };
    }
    throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${req.params.name}`);
  });

  return server;
}

export function toolViewMap(): Record<string, string> {
  return Object.fromEntries(tools.filter(t => t.view).map(t => [t.name, uiUri(t.view!)]));
}

export { activeTimers };
