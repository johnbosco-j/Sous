// Planning and cook-along helpers: recipe search, reading and clearing the plan, unit conversion, timers, cook status.
import { z } from 'zod';
import { RECIPES, RECIPE_BY_ID, findIngredient, findRecipe } from '../../domain/catalog.js';
import { recipeFilters } from '../../domain/hooks.js';
import { allergenHits, cookView, listPhrase, normalizeAllergen, pantryView, scoreRecipe } from '../../domain/kitchen.js';
import { activeTimers, addDays, dayKey, getState, update } from '../../domain/store.js';
import { allergenWord, env, fail, lastSuggestions, registerRoute, tool } from '../registry.js';

// ---------------- recipe search ----------------

tool({
  name: 'recipe_search',
  title: 'Search recipes',
  description: 'Find recipes by ingredient, time limit, kid-friendliness or meal type, ranked by how much soon-to-expire food they use. Recipes with a household allergen (or a saved diet restriction) are excluded with the reason. Returns the same carousel data as meal_suggest.',
  input: z.object({
    ingredient: z.string().max(60).optional().describe('e.g. "chicken", "eggs"'),
    maxMinutes: z.number().int().min(5).max(240).optional(),
    kidFriendly: z.boolean().optional(),
    meal: z.enum(['dinner', 'breakfast', 'snack', 'any']).default('any'),
    count: z.number().int().min(1).max(6).default(5)
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  view: 'meals',
  icon: '🔎',
  handler: ({ ingredient, maxMinutes, kidFriendly, meal, count }) => {
    const s = getState();
    const ing = ingredient ? findIngredient(ingredient) : null;
    const word = ingredient?.toLowerCase().trim();
    const excluded: { title: string; reason: string }[] = [];
    const matches = RECIPES.filter(r => {
      if (meal !== 'any' && r.meal !== meal) return false;
      if (maxMinutes && r.minutes > maxMinutes) return false;
      if (kidFriendly && !r.kidFriendly) return false;
      if (word) {
        const uses = ing ? r.ingredients.some(x => x.id === ing.id) : r.title.toLowerCase().includes(word);
        if (!uses) return false;
      }
      return true;
    }).filter(r => {
      const hits = allergenHits(s.household, r.ingredients.map(i => i.id));
      if (hits.length) {
        excluded.push({ title: r.title, reason: `${hits[0].member} is allergic to ${allergenWord(normalizeAllergen(hits[0].allergen) ?? hits[0].allergen)}` });
        return false;
      }
      const blocked = recipeFilters.map(f => f(r, s.household, s)).find(Boolean);
      if (blocked) {
        excluded.push({ title: r.title, reason: blocked });
        return false;
      }
      return true;
    });
    const suggestions = matches.map(r => scoreRecipe(s, r)).sort((a, b) => b.score - a.score).slice(0, count);
    const atRisk = pantryView(s)
      .filter(p => p.expiresInDays !== null && p.expiresInDays >= 0 && p.expiresInDays <= 3)
      .map(p => ({ name: p.name, expiresInDays: p.expiresInDays as number }));
    const data = { suggestions, excluded, atRisk, query: { ingredient: ing?.name ?? ingredient ?? null, maxMinutes: maxMinutes ?? null, kidFriendly: kidFriendly ?? null, meal } };
    const what = [ing ? `with ${ing.name}` : word ? `matching ${word}` : '', maxMinutes ? `under ${maxMinutes} minutes` : '', kidFriendly ? 'that kids like' : ''].filter(Boolean).join(' ');
    if (!suggestions.length) {
      let speech = `I couldn't find a recipe${what ? ` ${what}` : ''}.`;
      if (excluded.length) speech += ` I left out ${excluded[0].title} because ${excluded[0].reason}.`;
      return fail('recipe_search', speech, data);
    }
    lastSuggestions.ids = suggestions.map(x => x.recipeId);
    const [top] = suggestions;
    let speech = `I found ${suggestions.length} recipe${suggestions.length === 1 ? '' : 's'}${what ? ` ${what}` : ''}: ${listPhrase(suggestions.slice(0, 3).map(x => x.title))}. Top pick: ${top.title}, ${top.minutes} minutes.`;
    if (excluded.length) speech += ` I left out ${excluded[0].title} because ${excluded[0].reason}.`;
    return env('recipe_search', speech, data, {
      view: 'meals',
      followUp: { prompt: `Want to cook ${top.title}?`, tool: 'cook_start', arguments: { recipeId: top.recipeId } }
    });
  }
});

// ---------------- meal plan ----------------

function dayLabel(date: string, now = new Date()): string {
  if (date === dayKey(now)) return 'Tonight';
  if (date === addDays(now, 1)) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
}

function planView() {
  const s = getState();
  const today = dayKey(new Date());
  return s.plan
    .filter(p => p.day >= today && RECIPE_BY_ID.has(p.recipeId))
    .map(p => {
      const r = RECIPE_BY_ID.get(p.recipeId)!;
      return { day: dayLabel(p.day), date: p.day, recipeId: r.id, title: r.title, emoji: r.emoji, minutes: r.minutes };
    });
}

tool({
  name: 'meal_plan_get',
  title: 'Read the meal plan',
  description: 'Read back the saved dinner plan for the coming days (Tonight, Tomorrow, then weekdays).',
  input: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🗓️',
  handler: () => {
    const plan = planView();
    if (!plan.length) return env('meal_plan_get', 'No meals planned yet. Say "plan dinners for the next three nights".', { plan });
    return env('meal_plan_get', `The plan: ${listPhrase(plan.map(p => `${p.day}, ${p.title}`))}.`, { plan });
  }
});

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function matchesDay(date: string, spoken: string, now = new Date()): boolean {
  const q = spoken.toLowerCase().trim();
  if (/^(tonight|today)$/.test(q)) return date === dayKey(now);
  if (q === 'tomorrow') return date === addDays(now, 1);
  const wd = WEEKDAYS.indexOf(q);
  if (wd >= 0) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).getDay() === wd;
  }
  return date === q;
}

tool({
  name: 'meal_plan_clear',
  title: 'Clear the meal plan',
  description: 'Remove one planned dinner (by recipe name or day such as "tonight", "Saturday") or clear the whole plan when neither is given.',
  input: z.object({
    recipe: z.string().max(80).optional().describe('Recipe to remove, e.g. "the shakshuka"'),
    day: z.string().max(20).optional().describe('"tonight", "tomorrow", a weekday, or yyyy-mm-dd')
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  icon: '🧹',
  handler: ({ recipe, day }) => {
    const target = recipe ? RECIPE_BY_ID.get(recipe) ?? findRecipe(recipe) : null;
    if (recipe && !target) return fail('meal_plan_clear', `I couldn't find ${recipe} in the plan.`, { plan: planView() });
    const removed = update(s => {
      const before = s.plan;
      if (!recipe && !day) s.plan = [];
      else s.plan = before.filter(p => !((target ? p.recipeId === target.id : true) && (day ? matchesDay(p.day, day) : true)));
      return before.filter(p => !s.plan.includes(p)).map(p => RECIPE_BY_ID.get(p.recipeId)?.title ?? p.recipeId);
    });
    const plan = planView();
    if (!recipe && !day) return env('meal_plan_clear', removed.length ? 'Done. The meal plan is cleared.' : 'The meal plan was already empty.', { removed, plan });
    if (!removed.length) return fail('meal_plan_clear', `Nothing in the plan matched${target ? ` ${target.title}` : ''}${day ? ` on ${day}` : ''}.`, { removed, plan });
    return env('meal_plan_clear', `Removed ${listPhrase(removed)}. ${plan.length ? `Still planned: ${listPhrase(plan.map(p => p.title))}.` : 'Nothing else is planned.'}`, { removed, plan });
  }
});

// ---------------- unit conversion ----------------

type Dim = 'volume' | 'mass' | 'temp';
const UNITS: Record<string, { dim: Dim; base: number; name: [string, string] }> = {
  cup: { dim: 'volume', base: 236.6, name: ['cup', 'cups'] },
  tbsp: { dim: 'volume', base: 14.8, name: ['tablespoon', 'tablespoons'] },
  tsp: { dim: 'volume', base: 4.93, name: ['teaspoon', 'teaspoons'] },
  ml: { dim: 'volume', base: 1, name: ['milliliter', 'milliliters'] },
  l: { dim: 'volume', base: 1000, name: ['liter', 'liters'] },
  oz: { dim: 'mass', base: 28.35, name: ['ounce', 'ounces'] },
  lb: { dim: 'mass', base: 453.6, name: ['pound', 'pounds'] },
  g: { dim: 'mass', base: 1, name: ['gram', 'grams'] },
  kg: { dim: 'mass', base: 1000, name: ['kilogram', 'kilograms'] },
  f: { dim: 'temp', base: 1, name: ['degree Fahrenheit', 'degrees Fahrenheit'] },
  c: { dim: 'temp', base: 1, name: ['degree Celsius', 'degrees Celsius'] }
};

const ALIASES: Array<[RegExp, string]> = [
  [/^(cups?)$/, 'cup'],
  [/^(tbsps?|tbs|tablespoons?)$/, 'tbsp'],
  [/^(tsps?|teaspoons?)$/, 'tsp'],
  [/^(ml|mls|milliliters?|millilitres?)$/, 'ml'],
  [/^(l|liters?|litres?)$/, 'l'],
  [/^(oz|ounces?)$/, 'oz'],
  [/^(lbs?|pounds?)$/, 'lb'],
  [/^(g|grams?|grammes?)$/, 'g'],
  [/^(kg|kgs|kilos?|kilograms?)$/, 'kg'],
  [/^(°?f|fahrenheit|degrees? fahrenheit)$/, 'f'],
  [/^(°?c|celsius|centigrade|degrees? celsius)$/, 'c']
];

export function normalizeUnit(text: string): string | null {
  const q = text.toLowerCase().trim().replace(/\.$/, '');
  for (const [re, unit] of ALIASES) if (re.test(q)) return unit;
  return null;
}

export function convert(value: number, from: string, to: string): number | null {
  const a = UNITS[from], b = UNITS[to];
  if (!a || !b || a.dim !== b.dim) return null;
  if (a.dim === 'temp') {
    if (from === to) return value;
    return from === 'f' ? (value - 32) * 5 / 9 : value * 9 / 5 + 32;
  }
  return (value * a.base) / b.base;
}

function pretty(n: number, temp: boolean): string {
  if (temp) return String(Math.round(n));
  const abs = Math.abs(n);
  const v = abs >= 100 ? Math.round(n) : abs >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
  return String(v);
}

tool({
  name: 'unit_convert',
  title: 'Convert kitchen units',
  description: 'Convert cooking measurements: cups, tablespoons, teaspoons, milliliters, liters; ounces, pounds, grams, kilograms; Fahrenheit and Celsius. Refuses volume-to-weight conversions, which depend on the ingredient.',
  input: z.object({
    value: z.number().min(-100).max(100000),
    from: z.string().max(30).describe('e.g. "cups", "oz", "fahrenheit"'),
    to: z.string().max(30).describe('e.g. "ml", "grams", "celsius"')
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '⚖️',
  handler: ({ value, from, to }) => {
    const f = normalizeUnit(from), t = normalizeUnit(to);
    if (!f || !t) return fail('unit_convert', `I don't know the unit ${!f ? from : to}. Try cups, tablespoons, grams, ounces or degrees.`, { value, from, to });
    const result = convert(value, f, t);
    if (result === null) return fail('unit_convert', `${UNITS[f].name[1]} measure ${UNITS[f].dim === 'temp' ? 'temperature' : UNITS[f].dim} and ${UNITS[t].name[1]} measure ${UNITS[t].dim === 'temp' ? 'temperature' : UNITS[t].dim}, so it depends on the ingredient. Check the package for a weight.`.replace(/^./, c => c.toUpperCase()), { value, from: f, to: t });
    const temp = UNITS[f].dim === 'temp';
    const out = pretty(result, temp);
    const unitName = (u: string, n: number) => UNITS[u].name[Math.abs(n) === 1 ? 0 : 1];
    const speech = `${pretty(value, temp)} ${unitName(f, value)} is ${temp ? '' : 'about '}${out} ${unitName(t, Number(out))}.`;
    return env('unit_convert', speech, { value, from: f, to: t, result: Number(out), exact: result });
  }
});

// ---------------- timers ----------------

function leftPhrase(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const m = Math.round(seconds / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

function timerViews(now = Date.now()) {
  return activeTimers(now)
    .map(t => ({ id: t.id, label: t.label, endsAt: t.endsAt, seconds: t.seconds, secondsLeft: Math.max(0, Math.round((new Date(t.endsAt).getTime() - now) / 1000)) }))
    .filter(t => t.secondsLeft > 0)
    .sort((a, b) => a.secondsLeft - b.secondsLeft);
}

tool({
  name: 'timer_list',
  title: 'List kitchen timers',
  description: 'List the running kitchen timers with the time left on each, soonest first.',
  input: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '⏱️',
  handler: () => {
    const timers = timerViews();
    if (!timers.length) return env('timer_list', 'No timers are running.', { timers });
    const parts = timers.map(t => `${t.label.replace(/:.*$/, '')} has ${leftPhrase(t.secondsLeft)} left`);
    return env('timer_list', `${timers.length === 1 ? 'One timer' : `${timers.length} timers`}: ${listPhrase(parts)}.`, { timers });
  }
});

tool({
  name: 'timer_cancel',
  title: 'Cancel kitchen timers',
  description: 'Cancel a running timer by label or id, or all timers. With several timers and no label, asks which one.',
  input: z.object({
    label: z.string().max(60).optional().describe('Part of the timer label, e.g. "curry"'),
    id: z.string().max(40).optional(),
    all: z.boolean().optional()
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  icon: '🛑',
  handler: ({ label, id, all }) => {
    const running = timerViews();
    if (!running.length) return env('timer_cancel', 'There are no timers to cancel.', { cancelled: [], timers: [] });
    if (!all && !label && !id && running.length > 1) {
      return fail('timer_cancel', `You have ${running.length} timers: ${listPhrase(running.map(t => t.label.replace(/:.*$/, '')))}. Which one should I cancel?`, { cancelled: [], timers: running });
    }
    const q = label?.toLowerCase().trim();
    const pick = (t: { id: string; label: string }) => all || (!label && !id) || (id ? t.id === id : t.label.toLowerCase().includes(q!));
    const cancelled = running.filter(pick);
    if (!cancelled.length) return fail('timer_cancel', `I couldn't find a timer called ${label ?? id}.`, { cancelled: [], timers: running });
    const ids = new Set(cancelled.map(t => t.id));
    update(s => { s.timers = s.timers.filter(t => !ids.has(t.id)); });
    const timers = timerViews();
    const speech = cancelled.length === 1
      ? `Cancelled the ${cancelled[0].label.replace(/:.*$/, '')} timer.`
      : `Cancelled ${cancelled.length} timers.`;
    return env('timer_cancel', speech + (timers.length ? ` ${timers.length} still running.` : ''), { cancelled, timers });
  }
});

// ---------------- cook status ----------------

tool({
  name: 'cook_status',
  title: 'Where are we in the recipe?',
  description: 'Report the current cook-along position: recipe, step number, the current step, steps left and an estimate of minutes to go, plus running timers.',
  input: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🍲',
  handler: () => {
    const s = getState();
    const recipe = s.cooking ? RECIPE_BY_ID.get(s.cooking.recipeId) : null;
    if (!s.cooking || !recipe) {
      return env('cook_status', "We're not cooking anything right now. Ask me what to cook tonight, then say \"let's cook the first one\".", { cooking: false });
    }
    const v = cookView(s)!;
    const stepsLeft = v.totalSteps - v.stepIndex - 1;
    const remaining = recipe.steps.slice(v.stepIndex);
    const timerMinutes = remaining.reduce((n, st) => n + (st.timerSeconds ?? 0), 0) / 60;
    const shareMinutes = recipe.minutes * (remaining.length / recipe.steps.length);
    const minutesLeft = Math.max(1, Math.round(Math.max(timerMinutes, shareMinutes)));
    const timers = timerViews();
    let speech = `We're on step ${v.stepIndex + 1} of ${v.totalSteps} of ${recipe.title}: ${v.step.text} About ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} to go.`;
    if (timers.length) speech += ` ${timers.length === 1 ? 'One timer is' : `${timers.length} timers are`} running.`;
    return env('cook_status', speech, {
      cooking: true, recipeId: recipe.id, title: recipe.title, stepIndex: v.stepIndex, totalSteps: v.totalSteps,
      stepsLeft, minutesLeft, step: v.step, timers
    });
  }
});

// ---------------- voice routes (offline router) ----------------

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, twelve: 12, half: 0.5 };

registerRoute(t => {
  // "convert 2 cups to ml", "how many grams in 4 ounces", "350 fahrenheit in celsius"
  let m = t.match(/(?:convert\s+)?(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|eight|ten|twelve|half)\s+(?:a\s+)?([a-z°]+(?:\s+(?:fahrenheit|celsius))?)\s+(?:to|in|into|in to)\s+([a-z°]+(?:\s+(?:fahrenheit|celsius))?)\??$/);
  if (m && normalizeUnit(m[2]) && normalizeUnit(m[3])) {
    return { tool: 'unit_convert', args: { value: Number(m[1]) || NUM[m[1]], from: m[2], to: m[3] } };
  }
  m = t.match(/how many\s+([a-z°]+)\s+(?:is|are|in|make)\s+(?:a\s+)?(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|eight|ten|twelve|half)?\s*([a-z°]+)\??$/);
  if (m && normalizeUnit(m[1]) && normalizeUnit(m[3])) {
    return { tool: 'unit_convert', args: { value: m[2] ? Number(m[2]) || NUM[m[2]] : 1, from: m[3], to: m[1] } };
  }
  return null;
});

registerRoute(t => {
  const m = t.match(/\b(?:find|search(?: for)?|show me|look up|any)\s+(?:some\s+)?(?:recipes?|dinners?|meals?|ideas?)\s*(?:with|using|that use|for)?\s*([a-z\s]*?)?(?:\s+(?:under|in less than|in under)\s+(\d+)\s*min(?:ute)?s?)?\??$/);
  if (!m) return null;
  const ingredient = (m[1] ?? '').replace(/\b(kids?|kid-friendly|quick|easy)\b/g, '').trim();
  return {
    tool: 'recipe_search',
    args: { ...(ingredient ? { ingredient } : {}), ...(m[2] ? { maxMinutes: Number(m[2]) } : {}), ...(/\bkids?\b|kid-friendly/.test(t) ? { kidFriendly: true } : {}), ...(/breakfast/.test(t) ? { meal: 'breakfast' } : {}) }
  };
});

registerRoute(t => {
  if (/\bwhat'?s planned\b|\bshow (?:me )?(?:the |our |my )?(?:dinner )?plan\b|\bwhat are we (?:cooking|eating) this week\b|\bread (?:me )?the plan\b/.test(t)) return { tool: 'meal_plan_get', args: {} };
  const m = t.match(/\b(?:clear|cancel|delete|reset|remove)\s+(?:the |our |my )?(?:whole )?plan\b|\bremove\s+(?:the\s+)?(.+?)\s+from\s+(?:the\s+)?plan\b|\bskip\s+(?:dinner\s+)?(tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (!m) return null;
  if (m[1]) return { tool: 'meal_plan_clear', args: { recipe: m[1].trim() } };
  if (m[2]) return { tool: 'meal_plan_clear', args: { day: m[2] } };
  return { tool: 'meal_plan_clear', args: {} };
});

registerRoute(t => {
  // Plural "timers" only: the core router sends any singular "timer" phrase to timer_set first.
  if (/\b(?:cancel|stop|clear|delete)\s+(?:all\s+)?(?:the\s+|my\s+)?timers\b/.test(t)) return { tool: 'timer_cancel', args: { all: true } };
  if (/\b(?:what|which|list|show)(?:\s+\w+)?\s+timers\b|\btimers\s+(?:are\s+)?running\b|\bhow (?:long|much time) is left\b|\btime left\b/.test(t)) return { tool: 'timer_list', args: {} };
  return null;
});

registerRoute(t => {
  if (/\bwhere are we\b|\bhow much longer\b|\bwhat step (?:are we on|is this|am i on)\b|\bcook(?:ing)? status\b|\bhow far along\b/.test(t)) return { tool: 'cook_status', args: {} };
  return null;
});
