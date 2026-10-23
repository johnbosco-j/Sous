// Tool module: safety. Allergy emergencies, label scanning, diet needs, per-person meal checks,
// cross-contact prep and safe cooking temperatures. All deterministic: no model decides anything here.
import { z } from 'zod';
import { tool, env, fail, registerRoute, allergenWord } from '../registry.js';
import { Household, INGREDIENT_BY_ID, RECIPE_BY_ID, Recipe, findRecipe } from '../../domain/catalog.js';
import { allergenHits, allergenHitsInText, listPhrase, normalizeAllergen } from '../../domain/kitchen.js';
import { KitchenState, getState, update } from '../../domain/store.js';
import { registerRecipeFilter } from '../../domain/hooks.js';

// ---------------- allergy emergency (the kitchen's red-flag engine) ----------------

interface SignRule { id: string; re: RegExp; level: 'emergency' | 'watch'; needs?: RegExp; escalate?: RegExp }

const BODY = /\b(lips?|tongue|face|throat|mouth|eyes?|eyelids?)\b/;
const SIGNS: SignRule[] = [
  { id: 'swelling', re: /\b(swell(?:ing|ed|s)?|swollen|puff(?:y|ing) up)\b/g, level: 'watch', escalate: BODY },
  { id: 'breathing', re: /\b(?:trouble|difficulty|hard|can'?t|cannot|struggling|struggles|struggle) (?:to )?breath(?:e|ing)?\b|\bshort(?:ness)? of breath\b|\bnot breathing\b|\bgasping\b|\bbreathing (?:is )?(?:hard|difficult|fast|noisy)\b/g, level: 'emergency' },
  { id: 'wheezing', re: /\bwheez(?:e|es|ing|y)\b/g, level: 'emergency' },
  { id: 'throat', re: /\bthroat (?:is |feels |feeling )?(?:tight|tightening|closing|closing up|scratchy and tight)\b|\btight(?:ness)? (?:in|of) (?:the |his |her |their |my )?throat\b|\bcan'?t swallow\b/g, level: 'emergency' },
  { id: 'hives', re: /\b(hives|welts|rash)\b/g, level: 'watch', escalate: /\b(spread(?:ing|s)?|all over|everywhere|whole body|getting worse)\b/ },
  { id: 'vomiting', re: /\b(vomit(?:ing|ed|s)?|throwing up|threw up|being sick)\b/g, level: 'watch', escalate: /\b(again|repeated(?:ly)?|keeps|keep|won'?t stop|several|twice|multiple|over and over)\b/ },
  { id: 'collapse', re: /\b(faint(?:ed|ing)?|passed out|passing out|unconscious|collapsed|unresponsive|dizzy|light-?headed|floppy)\b/g, level: 'emergency' },
  { id: 'blue', re: /\b(lips?|face|skin) (?:(?:is|are|look|looks|looking|turning|turned|going|gone|has|have) ){0,2}(?:blue|grey|gray|pale and clammy)\b/g, level: 'emergency' },
  { id: 'anaphylaxis', re: /\b(anaphyla\w*|epi-?pen|epinephrine|auvi-?q|adrenaline (?:pen|shot))\b/g, level: 'emergency' },
  { id: 'mild', re: /\b(itch(?:y|ing)|tingl(?:y|ing)|stomach ?ache|tummy ache|stomach pain|nause(?:a|ous)|red (?:patches|blotches)|sneez(?:ing|es)|runny nose)\b/g, level: 'watch' }
];
const NEGATION = /\b(no|not|without|isn'?t|aren'?t|doesn'?t|don'?t|didn'?t|never|denies|nor|wasn'?t|weren'?t|none)\b/;

/** Signs found in the description, skipping any negated within the 3 words before them ("no trouble breathing"). */
export function findSigns(description: string): { emergency: string[]; watch: string[] } {
  const t = description.toLowerCase().replace(/[’]/g, "'");
  const emergency = new Set<string>();
  const watch = new Set<string>();
  for (const rule of SIGNS) {
    for (const m of t.matchAll(rule.re)) {
      const before = t.slice(0, m.index ?? 0).split(/[.;!?]/).pop() ?? '';
      const lastWords = before.trim().split(/\s+/).slice(-3).join(' ');
      if (NEGATION.test(lastWords)) continue;
      const severe = rule.level === 'emergency' || Boolean(rule.escalate && rule.escalate.test(t));
      (severe ? emergency : watch).add(rule.id);
    }
  }
  return { emergency: [...emergency], watch: [...watch].filter(w => !emergency.has(w)) };
}

function memberIn(text: string, household: Household): string | undefined {
  const t = text.toLowerCase();
  return household.members.find(m => new RegExp(`\\b${m.name.toLowerCase()}\\b`).test(t))?.name;
}

export const EMERGENCY_TEXT = (member?: string) =>
  `This could be a severe allergic reaction. Call 911 now. ${member ? `If ${member} has` : 'If they have'} a prescribed epinephrine auto-injector, use it as directed. Don't wait to see if it gets better.`;
export const WATCH_TEXT = "Watch closely. If there's any swelling, trouble breathing or the symptoms spread, call 911 right away.";

tool({
  name: 'allergy_emergency',
  title: 'Allergic reaction help',
  description: 'Call immediately when anyone describes a possible allergic reaction (swelling, trouble breathing, wheezing, hives, vomiting, dizziness after eating). Deterministic sign detection with negation handling. Severe signs return a fixed emergency instruction (call 911, use a prescribed epinephrine auto-injector). Speak the text exactly and add nothing. Never diagnoses or reassures.',
  input: z.object({
    description: z.string().min(1).max(500).describe('What the person said is happening, verbatim'),
    member: z.string().optional().describe('Who is affected, if known')
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  icon: '🚨',
  view: 'alert',
  handler: ({ description, member }) => {
    const household = getState().household;
    const who = member?.trim() || memberIn(description, household);
    const signs = findSigns(description);
    const level: 'emergency' | 'watch' = signs.emergency.length ? 'emergency' : 'watch';
    const speech = level === 'emergency' ? EMERGENCY_TEXT(who) : WATCH_TEXT;
    const knownAllergies = who ? household.members.find(m => m.name.toLowerCase() === who.toLowerCase())?.allergies ?? [] : [];
    update(s => {
      s.ext.safety ??= {};
      s.ext.safety.incidents ??= [];
      s.ext.safety.incidents.push({ at: new Date().toISOString(), member: who ?? null, level, signs: [...signs.emergency, ...signs.watch], description: description.slice(0, 200) });
      s.ext.safety.incidents = s.ext.safety.incidents.slice(-50);
    });
    return env('allergy_emergency', speech, { level, member: who ?? null, signs, knownAllergies, call: level === 'emergency' ? '911' : null }, { view: 'alert' });
  }
});

// ---------------- label scanning ----------------

const PRECAUTION = /\b(may contain|may also contain|processed in a facility|made in a facility|produced in a facility|manufactured in a facility|manufactured on (?:shared )?equipment|made on (?:shared )?equipment|packed in a facility|traces? of|shared equipment)\b/;

function householdFor(member?: string): Household {
  const h = getState().household;
  if (!member) return h;
  return { ...h, members: h.members.filter(m => m.name.toLowerCase() === member.trim().toLowerCase()) };
}

tool({
  name: 'allergen_scan',
  title: 'Scan a label for allergens',
  description: 'Check a product label or ingredient list (free text) against the household\'s saved allergies. Flags definite allergens and precautionary "may contain" / "made in a facility" statements separately. Ignores "peanut-free"-style claims.',
  input: z.object({
    text: z.string().min(1).max(2000).describe('The label or ingredient list, as read out or pasted'),
    member: z.string().optional().describe('Only check this member\'s allergies')
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🏷️',
  handler: ({ text, member }) => {
    const h = householdFor(member);
    if (member && !h.members.length) return fail('allergen_scan', `I don't have anyone called ${member} in the household.`, { verdict: 'unknown-member' });
    if (!h.members.some(m => m.allergies.length)) {
      return env('allergen_scan', 'No one here has an allergy saved yet, so I have nothing to check this label against. Tell me about any allergies and I\'ll remember them.', { verdict: 'no-allergies-saved', contains: [], mayContain: [] });
    }
    // "peanut-free" or "free from nuts" are claims, not ingredients.
    const cleaned = text.toLowerCase().replace(/\b[\w-]+[- ]free\b/g, ' ').replace(/\bfree (?:from|of) [\w\s,]+?(?=[.;]|$)/g, ' ');
    const idx = cleaned.search(PRECAUTION);
    const main = idx >= 0 ? cleaned.slice(0, idx) : cleaned;
    const precaution = idx >= 0 ? cleaned.slice(idx) : '';
    const contains = allergenHitsInText(h, main);
    const mayContain = allergenHitsInText(h, precaution).filter(p => !contains.some(c => c.member === p.member && c.allergen === p.allergen));
    const word = (a: string) => allergenWord(normalizeAllergen(a) ?? a);
    if (contains.length) {
      const c = contains[0];
      const others = [...new Set(contains.slice(1).map(x => x.member))].filter(n => n !== c.member);
      return env('allergen_scan', `Careful: this contains ${c.ingredient}, and ${c.member} is allergic to ${word(c.allergen)}.${others.length ? ` It also affects ${listPhrase(others)}.` : ''} I'd keep it away from ${c.member}.`, { verdict: 'contains', contains, mayContain });
    }
    if (mayContain.length) {
      const c = mayContain[0];
      return env('allergen_scan', `The label says it may contain ${c.ingredient}. With ${c.member}'s ${word(c.allergen).replace(/s$/, '')} allergy, I'd skip it.`, { verdict: 'may-contain', contains, mayContain });
    }
    const who = listPhrase(h.members.filter(m => m.allergies.length).map(m => m.name));
    return env('allergen_scan', `I don't see anything on ${who}'s allergy list in that label. Recipes change, so check the label each time you buy it.`, { verdict: 'none-found', contains, mayContain });
  }
});

// ---------------- diet needs ----------------

export const DIETS = ['low-sodium', 'diabetes-friendly', 'vegetarian', 'soft-foods', 'dairy-free', 'gluten-free'] as const;
export type Diet = typeof DIETS[number];

export function dietPhrase(member: string, need: string): string {
  switch (need) {
    case 'low-sodium': return `${member} needs low sodium`;
    case 'diabetes-friendly': return `${member} needs diabetes-friendly meals`;
    case 'vegetarian': return `${member} is vegetarian`;
    case 'soft-foods': return `${member} needs soft foods`;
    case 'dairy-free': return `${member} eats dairy-free`;
    case 'gluten-free': return `${member} eats gluten-free`;
    default: return `${member} needs ${need}`;
  }
}

/** True when a recipe breaks a diet need. */
export function breaksDiet(recipe: Recipe, need: string): boolean {
  const ids = recipe.ingredients.map(i => i.id);
  const has = (...xs: string[]) => xs.some(x => ids.includes(x));
  const anyAllergen = (a: string) => ids.some(id => INGREDIENT_BY_ID.get(id)?.allergens.includes(a as any));
  switch (need) {
    case 'vegetarian': return has('chicken-thighs');
    case 'low-sodium': return has('soy-sauce', 'feta', 'parmesan', 'cheddar');
    case 'diabetes-friendly': return has('sugar') || recipe.id === 'banana-bread';
    case 'soft-foods': return ['chicken-quesadillas', 'rescue-fried-rice'].includes(recipe.id);
    case 'dairy-free': return anyAllergen('dairy');
    case 'gluten-free': return anyAllergen('gluten');
    default: return false;
  }
}

function diets(state: KitchenState): Record<string, string[]> {
  return state.ext?.safety?.diets ?? {};
}

registerRecipeFilter((recipe, _household, state) => {
  for (const [member, needs] of Object.entries(diets(state))) {
    for (const need of needs) if (breaksDiet(recipe, need)) return dietPhrase(member, need);
  }
  return null;
});

const cap = (s: string) => s.trim().charAt(0).toUpperCase() + s.trim().slice(1).toLowerCase();

tool({
  name: 'diet_profile',
  title: 'Diet needs',
  description: 'Get, set or remove a household member\'s diet need (low-sodium, diabetes-friendly, vegetarian, soft-foods, dairy-free, gluten-free). Saved across sessions; meal_suggest then sets aside recipes that break a need and says why. Setting a need for a new name adds that person to the household.',
  input: z.object({
    action: z.enum(['get', 'set', 'remove']).default('get'),
    member: z.string().optional(),
    need: z.enum(DIETS).optional()
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🥗',
  handler: ({ action, member, need }) => {
    if (action === 'get') {
      const all = diets(getState());
      const facts = Object.entries(all).flatMap(([m, ns]) => ns.map(n => dietPhrase(m, n)));
      return env('diet_profile', facts.length ? `${facts.join('. ')}. I plan around all of that.` : 'No diet needs saved yet. You can say things like "Grandpa needs low sodium".', { diets: all });
    }
    if (!member || !need) return fail('diet_profile', 'Who is it for, and which need? For example: Grandpa needs low sodium.', { diets: diets(getState()) });
    const name = cap(member);
    const result = update(s => {
      s.ext.safety ??= {};
      s.ext.safety.diets ??= {};
      const d: Record<string, string[]> = s.ext.safety.diets;
      const key = Object.keys(d).find(k => k.toLowerCase() === name.toLowerCase()) ?? name;
      let added = false;
      if (action === 'set') {
        d[key] = [...new Set([...(d[key] ?? []), need])];
        if (!s.household.members.some(m => m.name.toLowerCase() === name.toLowerCase())) {
          s.household.members.push({ name, allergies: [], dislikes: [] });
          added = true;
        }
      } else {
        d[key] = (d[key] ?? []).filter(n => n !== need);
        if (!d[key].length) delete d[key];
      }
      return { diets: { ...d }, added };
    });
    const speech = action === 'set'
      ? `Got it. ${dietPhrase(name, need)}.${result.added ? ` I've added ${name} to the household.` : ''} I'll set aside recipes that don't fit, and tell you why.`
      : `Okay, I've removed that. ${name}'s meals no longer need to be ${need.replace('-', ' ')}.`;
    return env('diet_profile', speech, { diets: result.diets, changed: { member: name, need, action }, addedMember: result.added });
  }
});

// ---------------- per-person meal check ----------------

tool({
  name: 'meal_safety_check',
  title: 'Who can eat this?',
  description: 'Check one recipe against every household member: allergens, diet needs and dislikes. Returns a per-person verdict with reasons. Uses careful wording ("nothing on Leo\'s allergy list"), never "safe".',
  input: z.object({ recipe: z.string().min(1).describe('Recipe name or id') }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🛡️',
  handler: ({ recipe }) => {
    const r = RECIPE_BY_ID.get(recipe) ?? findRecipe(recipe);
    if (!r) return fail('meal_safety_check', `I couldn't find a recipe called ${recipe}.`, { verdicts: [] });
    const s = getState();
    const ids = r.ingredients.map(i => i.id);
    const d = diets(s);
    const verdicts = s.household.members.map(m => {
      const reasons: string[] = [];
      for (const hit of allergenHits({ ...s.household, members: [m] }, ids)) {
        reasons.push(`contains ${hit.ingredient} (allergic to ${allergenWord(normalizeAllergen(hit.allergen) ?? hit.allergen)})`);
      }
      const needs = Object.entries(d).find(([k]) => k.toLowerCase() === m.name.toLowerCase())?.[1] ?? [];
      for (const n of needs) if (breaksDiet(r, n)) reasons.push(`doesn't fit: ${dietPhrase(m.name, n).replace(`${m.name} `, '')}`);
      for (const dl of m.dislikes) {
        const key = dl.toLowerCase().replace(/s$/, '');
        if (ids.some(id => INGREDIENT_BY_ID.get(id)!.name.toLowerCase().includes(key) || id.includes(key))) reasons.push(`doesn't like ${dl}`);
      }
      return { member: m.name, ok: reasons.length === 0, reasons };
    });
    const blocked = verdicts.filter(v => !v.ok);
    const fine = verdicts.filter(v => v.ok).map(v => v.member);
    let speech: string;
    if (!blocked.length) speech = `${r.title} contains nothing on anyone's allergy or diet list here.`;
    else {
      speech = blocked.map(b => `Not for ${b.member}: it ${b.reasons[0].replace(/^contains/, 'contains')}.`).join(' ');
      if (fine.length) speech += ` Nothing on ${listPhrase(fine)}'s lists.`;
    }
    return env('meal_safety_check', speech, { recipeId: r.id, title: r.title, verdicts });
  }
});

// ---------------- cross-contact prep ----------------

export const CROSS_CONTACT_TIPS = [
  'Wash hands with soap and water before cooking. Hand sanitizer does not remove food allergens.',
  'Wash cutting boards, counters and pans with hot soapy water before you start.',
  'Use separate utensils, boards and serving spoons for the allergy-safe dish.',
  'Cook the allergy-safe meal first, then cover it and set it aside.',
  "Don't reuse frying oil or cooking water that the allergen has been in.",
  'Read every label every time, including "may contain" warnings, because recipes change.'
];

tool({
  name: 'cross_contact_tips',
  title: 'Cross-contact prep checklist',
  description: 'A fixed checklist for keeping an allergen out of someone\'s food while cooking for the whole family (hand washing, clean surfaces, separate utensils, cook the safe meal first, labels). Defaults to the household\'s saved allergies.',
  input: z.object({
    allergen: z.string().optional().describe('e.g. "peanuts"'),
    member: z.string().optional()
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🧼',
  handler: ({ allergen, member }) => {
    const h = getState().household;
    const person = member
      ? h.members.find(m => m.name.toLowerCase() === member.toLowerCase())
      : h.members.find(m => m.allergies.some(a => !allergen || normalizeAllergen(a) === normalizeAllergen(allergen)));
    const raw = allergen ?? person?.allergies[0];
    const word = raw ? allergenWord(normalizeAllergen(raw) ?? raw) : 'the allergen';
    const who = person?.name ?? member;
    const intro = who ? `To keep ${word} away from ${who}'s food:` : `To keep ${word} out of an allergy-safe meal:`;
    const short = ['wash hands with soap and water, because sanitizer doesn\'t remove allergens', 'use separate boards and utensils', 'and cook the safe meal first, then cover it'];
    return env('cross_contact_tips', `${intro} ${short.join(', ')}.`, { allergen: raw ?? null, member: who ?? null, tips: CROSS_CONTACT_TIPS });
  }
});

// ---------------- safe cooking temperatures ----------------

interface TempRule { category: string; re: RegExp; f: number; c: number; restMinutes?: number; label: string }

// USDA safe minimum internal temperatures. Order matters: the first match wins.
export const TEMPS: TempRule[] = [
  { category: 'leftovers', re: /\b(left ?overs?|casserole|reheat(?:ed|ing)?)\b/, f: 165, c: 74, label: 'leftovers and casseroles' },
  { category: 'poultry', re: /\b(chicken|turkey|duck|goose|poultry|wings?|thighs?|drumsticks?|breast)\b/, f: 165, c: 74, label: 'poultry' },
  { category: 'ground-meat', re: /\b(ground|mince[d]?|burgers?|meatballs?|meatloaf|sausages?|patties|patty)\b/, f: 160, c: 71, label: 'ground meat' },
  { category: 'fish', re: /\b(fish|salmon|tuna|cod|tilapia|trout|halibut|shrimp|prawns?|shellfish|scallops?|crab|lobster)\b/, f: 145, c: 63, label: 'fish and shellfish' },
  { category: 'egg-dish', re: /\b(eggs?|frittata|quiche|omelet(?:te)?|shakshuka|strata)\b/, f: 160, c: 71, label: 'egg dishes' },
  { category: 'whole-cut', re: /\b(steaks?|beef|pork|veal|lamb|chops?|roast|tenderloin|ham)\b/, f: 145, c: 63, restMinutes: 3, label: 'steaks, chops and roasts' }
];

export function tempFor(food: string): TempRule | null {
  const t = food.toLowerCase();
  return TEMPS.find(r => r.re.test(t)) ?? null;
}

tool({
  name: 'cooking_temp',
  title: 'Safe cooking temperature',
  description: 'USDA safe minimum internal temperature for a food (poultry, ground meat, steaks/chops/roasts with rest time, fish and shellfish, egg dishes, leftovers and casseroles), in Fahrenheit and Celsius.',
  input: z.object({ food: z.string().min(1).describe('e.g. "chicken thighs", "burgers", "salmon"') }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  icon: '🌡️',
  handler: ({ food }) => {
    const rule = tempFor(food);
    if (!rule) return fail('cooking_temp', 'I have safe temperatures for poultry, ground meat, steaks and roasts, fish, egg dishes and leftovers. Which one?', { food });
    const subject = food.trim().replace(/^(the|my|our|some)\s+/i, '');
    let speech = `Cook ${subject} to at least ${rule.f} degrees Fahrenheit, ${rule.c} Celsius, measured in the thickest part with a food thermometer.`;
    if (rule.restMinutes) speech += ` Then let it rest for ${rule.restMinutes} minutes.`;
    return env('cooking_temp', speech, { food: subject, category: rule.category, label: rule.label, minF: rule.f, minC: rule.c, restMinutes: rule.restMinutes ?? 0, source: 'USDA safe minimum internal temperatures' });
  }
});

// ---------------- voice routes (offline router) ----------------

const REACTION = /\b(allergic reaction|having a reaction|is reacting|reacting to|anaphyla\w*|epi-?pen)\b/;

registerRoute(t => {
  // Emergencies first: any severe sign, or explicit talk of a reaction.
  const signs = findSigns(t);
  if (signs.emergency.length || REACTION.test(t) || (signs.watch.length && /\b(after (?:eating|he ate|she ate|they ate)|ate|eating)\b/.test(t))) {
    return { tool: 'allergy_emergency', args: { description: t } };
  }
  return null;
});

registerRoute(t => {
  const m = t.match(/(?:check|scan|read)\s+(?:this|the|a)\s+label\s*:?\s*(.*)$/) || t.match(/(?:does|do)\s+(?:this|it|these)\s+(?:contain|have)\s+(.+)$/) || t.match(/(?:the\s+)?(?:label|ingredients?(?: list)?)\s+says?\s*:?\s*(.+)$/);
  if (!m) return null;
  return { tool: 'allergen_scan', args: { text: (m[1] || t).trim() || t } };
});

const DIET_PATTERNS: Array<[RegExp, Diet]> = [
  [/\b(?:is|has|became|has become) (?:a )?diabetic\b|\bhas (?:type \d )?diabetes\b|\bneeds? diabetes[- ]friendly\b/, 'diabetes-friendly'],
  [/\b(?:is|has gone|went|became|has become) (?:a )?vegetarian\b|\bdoesn'?t eat meat\b/, 'vegetarian'],
  [/\bneeds? (?:a )?low[- ](?:sodium|salt)\b|\b(?:is )?on a low[- ](?:sodium|salt) diet\b/, 'low-sodium'],
  [/\bneeds? soft foods?\b|\bcan only (?:eat|have) soft (?:foods?|things)\b|\btrouble chewing\b/, 'soft-foods'],
  [/\b(?:is|eats|went|has gone) dairy[- ]free\b|\b(?:is )?lactose intolerant\b/, 'dairy-free'],
  [/\b(?:is|eats|went|has gone) gluten[- ]free\b|\bhas (?:celiac|coeliac)\b/, 'gluten-free']
];
const NOT_NAMES = new Set(['this', 'that', 'it', 'which', 'what', 'who', 'he', 'she', 'they', 'it\'s', 'recipe', 'dinner', 'food']);

registerRoute(t => {
  if (/\b(what|which) (?:are (?:the|our) )?(?:diets?|dietary needs|diet needs)\b|\bdiet profiles?\b/.test(t)) return { tool: 'diet_profile', args: { action: 'get' } };
  for (const [re, need] of DIET_PATTERNS) {
    const m = t.match(re);
    if (!m) continue;
    const before = t.slice(0, m.index).trim().split(/\s+/).map(w => w.replace(/[^a-z'-]/g, ''));
    const remove = /\b(no longer|isn'?t|not|stopped being|doesn'?t need)\b/.test(t);
    const name = [...before].reverse().find(w => /^[a-z][a-z'-]+$/.test(w) && !NOT_NAMES.has(w) && !/^(is|has|on|a|my|our|the|now|no|longer|not|also)$/.test(w));
    if (!name) return null;
    const clean = name.replace(/'s$/, '');
    return { tool: 'diet_profile', args: { action: remove ? 'remove' : 'set', member: clean, need } };
  }
  return null;
});

registerRoute(t => {
  const m = t.match(/\b(?:is|are) (?:the |this |that )?(.+?) (?:safe|ok|okay|fine|alright) for (?:everyone|everybody|the kids|the family|all of us|\w+)\??$/) || t.match(/\bcan (?:\w+|everyone|the kids) (?:eat|have) (?:the |this |that )?(.+?)\??$/) || t.match(/\bwho can (?:eat|have) (?:the |this |that )?(.+?)\??$/);
  if (!m) return null;
  const r = findRecipe(m[1]);
  return r ? { tool: 'meal_safety_check', args: { recipe: r.id } } : null;
});

registerRoute(t => {
  if (!/\bcross[- ]?(?:contact|contamina\w*)\b|\bkeep (?:the )?\w+ (?:away from|out of)\b|\bprep (?:safely|separately)\b|\bcook(?:ing)? for (?:someone|a kid|a child|\w+) with (?:a |an )?\w* ?allerg/.test(t)) return null;
  const m = t.match(/\bkeep (?:the )?(\w+) (?:away from|out of) (\w+)/);
  const args: Record<string, unknown> = {};
  if (m && normalizeAllergen(m[1])) args.allergen = m[1];
  if (m && m[2] && !/^(the|my|our|food|his|her)$/.test(m[2])) args.member = m[2].replace(/'s$/, '');
  return { tool: 'cross_contact_tips', args };
});

registerRoute(t => {
  if (!/\b(?:what|which) temp(?:erature)?\b|\bhow hot\b|\binternal temp(?:erature)?\b|\bsafe temp(?:erature)?\b|\bcook(?:ed)? to what\b|\bdone temp(?:erature)?\b/.test(t)) return null;
  return tempFor(t) ? { tool: 'cooking_temp', args: { food: t.replace(/\b(what|which|how hot|internal|safe|temperature|temp|should|does|do|i|we|cook|cooked|be|is|to|the|it|for)\b/g, ' ').replace(/[?]/g, '').replace(/\s+/g, ' ').trim() || t } } : null;
});
