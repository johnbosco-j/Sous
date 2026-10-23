// Deterministic intent router: the no-credentials stand-in for the Alexa+ LLM, so the demo always works offline.

export interface RouteContext { cooking: boolean; lastSuggestions: string[] }
export type Route = { tool: string; args: Record<string, unknown> } | { speech: string };

/** Pseudo-tool: the router's multi-step chain (suggest -> save plan -> build cart). */
export const PLAN_WEEK = '__plan_week';

export const YES = /\b(yes|yeah|yep|yup|sure|ok(ay)?|please do|go ahead|do it|place (it|the order|my order)|confirm|sounds good|let'?s do it)\b/i;
export const NO = /\b(no|nope|cancel|don'?t|do not|stop|never ?mind|not now)\b/i;

const ORDINALS: Record<string, number> = { first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3, last: 3 };
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, sixty: 60, half: 0.5 };

function num(word: string): number | null {
  if (/^\d+(\.\d+)?$/.test(word)) return Number(word);
  return NUMBER_WORDS[word.toLowerCase()] ?? null;
}

export function parseDuration(text: string): { seconds?: number; minutes?: number } | null {
  const t = text.toLowerCase();
  const m = t.match(/(\d+(?:\.\d+)?|[a-z-]+)\s*(?:and a half\s*)?(minutes?|mins?|seconds?|secs?|hours?|hrs?)\b/);
  if (!m) return null;
  let n = num(m[1]);
  if (n === null) return null;
  if (/and a half/.test(m[0])) n += 0.5;
  if (/^s/.test(m[2])) return { seconds: Math.round(n) };
  if (/^h/.test(m[2])) return { minutes: n * 60 };
  return { minutes: n };
}

function memory(text: string): Route | null {
  const t = text.trim();
  let m = t.match(/(?:remember(?: that)?\s+)?([A-Z][a-z]+|i|we)\s+(?:is|am|are)\s+allergic to\s+([a-z\s-]+)/i);
  if (m) return { tool: 'household_memory', args: { action: 'remember', member: cap(m[1]), kind: 'allergy', value: clean(m[2]) } };
  m = t.match(/(?:remember(?: that)?\s+)?([A-Z][a-z]+|i|we)\s+(?:doesn'?t|does not|don'?t|do not|hates?|can'?t stand)\s+(?:like|eat|want)?\s*([a-z\s-]+)/i);
  if (m) return { tool: 'household_memory', args: { action: 'remember', member: cap(m[1]), kind: 'dislike', value: clean(m[2]) } };
  m = t.match(/forget (?:that )?([A-Z][a-z]+)\s+(?:is allergic to|doesn'?t like|does not like)\s+([a-z\s-]+)/i);
  if (m) return { tool: 'household_memory', args: { action: 'forget', member: cap(m[1]), kind: /allergic/i.test(t) ? 'allergy' : 'dislike', value: clean(m[2]) } };
  if (/what do you (remember|know)|who('?s| is) allergic|our allergies|household profile/i.test(t)) return { tool: 'household_memory', args: { action: 'get' } };
  return null;
}

function cap(s: string) {
  if (/^(i|we)$/i.test(s)) return 'Everyone';
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}
function clean(s: string) {
  return s.replace(/\b(anymore|any more|please|at all|so|okay)\b/gi, '').replace(/[.!?]+$/, '').trim();
}

function pantryChange(text: string): Route | null {
  const t = text.toLowerCase();
  let m = t.match(/(?:we'?re|we are|i'?m|i am) out of ([a-z\s]+)|(?:we|i) ran out of ([a-z\s]+)|(?:threw|throw) (?:out|away) (?:the )?([a-z\s]+)/);
  if (m) return { tool: 'pantry_update', args: { items: splitItems(m[1] ?? m[2] ?? m[3]).map(name => ({ name, action: 'remove' })) } };
  m = t.match(/(?:we|i) (?:just )?(?:bought|got|picked up)\s+(.+)/);
  if (m) {
    return {
      tool: 'pantry_update',
      args: { items: splitItems(m[1]).map(chunk => {
        const q = chunk.match(/^(a dozen|\d+|[a-z]+)\s+(.+)$/);
        const qty = q ? (q[1] === 'a dozen' ? 12 : num(q[1])) : null;
        return { name: qty ? q![2] : chunk, action: 'add', ...(qty && qty >= 1 ? { qty } : {}) };
      }) }
    };
  }
  m = t.match(/(?:i|we) used (?:up )?(?:the )?(.+)/);
  if (m) return { tool: 'pantry_update', args: { items: splitItems(m[1]).map(name => ({ name, action: 'use' })) } };
  return null;
}

function splitItems(s: string): string[] {
  return s.replace(/[.!?]/g, '').split(/,|\band\b/).map(x => x.trim()).filter(Boolean).slice(0, 6);
}

export function route(text: string, ctx: RouteContext): Route {
  const t = text.toLowerCase().replace(/^(alexa|hey alexa|ok alexa)[, ]*/i, '').trim();

  const mem = memory(text.replace(/^(alexa|hey alexa)[, ]*/i, ''));
  if (mem) return mem;

  if (/\btimer\b/.test(t)) return { tool: 'timer_set', args: { ...(parseDuration(t) ?? {}) } };

  if (ctx.cooking) {
    if (/^(next|next step|ok next|okay next|done|continue|what'?s next|go on)\b/.test(t) || /\bnext step\b/.test(t)) return { tool: 'cook_step', args: { action: 'next' } };
    if (/\b(go back|previous|back a step|last step)\b/.test(t)) return { tool: 'cook_step', args: { action: 'back' } };
    if (/\b(repeat|say (that|it) again|what was that|come again)\b/.test(t)) return { tool: 'cook_step', args: { action: 'repeat' } };
    if (/\b(what do i need|ingredients|what goes in)\b/.test(t)) return { tool: 'cook_step', args: { action: 'ingredients' } };
    if (/\b(we'?re done|finished|dinner is ready|all done|finish)\b/.test(t)) return { tool: 'cook_step', args: { action: 'finish' } };
  }

  const startCook = t.match(/\b(?:let'?s|start|begin|i want to|can we)\s+(?:cook|make)(?:ing)?\s*(?:the\s+)?(.*)$/) || t.match(/^(?:cook|make)\s+(?:the\s+)?(.*)$/);
  if (startCook) {
    const rest = startCook[1] ?? '';
    const ord = rest.match(/\b(first|second|third|last|1st|2nd|3rd|one|two|three)\b/);
    if (ord && /\b(one|option|recipe|idea)\b|^(first|second|third|last)$/.test(rest.trim()) ) return { tool: 'cook_start', args: { pick: ORDINALS[ord[1]] } };
    if (/^(it|that|this|that one|this one)?$/.test(rest.trim())) return { tool: 'cook_start', args: {} };
    return { tool: 'cook_start', args: { recipe: rest } };
  }

  if (/\bplan\b.*\b(week|meals|dinners|nights|days)\b/.test(t)) return { tool: PLAN_WEEK, args: { count: 3 } };

  if (/\b(cart|grocer|shopping|order|buy|missing)\b/.test(t)) {
    const add = t.match(/\badd\s+(.+?)\s+to (?:the |my )?(?:cart|order|list)/);
    if (add && !/what we'?re missing|missing/.test(add[1])) return { tool: 'shopping_cart_build', args: { items: splitItems(add[1]).map(name => ({ name })) } };
    return { tool: 'shopping_cart_build', args: {} };
  }

  if (/\b(saved|rescued|impact|how much food|food waste|wasted|co2|carbon)\b/.test(t)) return { tool: 'impact_report', args: {} };

  const change = pantryChange(t);
  if (change) return change;

  if (/\b(expir\w*|go(ing)? (bad|off)|use up|about to turn|pantry|fridge|what do (we|i) have)\b/.test(t)) return { tool: 'pantry_check', args: { filter: 'expiring', withinDays: 3 } };
  const doWeHave = t.match(/\bdo (?:we|i) have (?:any )?([a-z\s]+)\??$/);
  if (doWeHave) return { tool: 'pantry_check', args: { item: doWeHave[1].trim() } };

  if (/\b(improvise|invent|something new|surprise me|creative|chef)\b/.test(t)) return { tool: 'chef_improvise', args: { request: text } };

  if (/\bplan\b.*\b(week|meals|dinners|nights|days)\b/.test(t)) return { tool: PLAN_WEEK, args: { count: 3 } };

  if (/\b(cook|make|eat|dinner|lunch|breakfast|supper|hungry|meal|recipe|what'?s for)\b/.test(t)) {
    const meal = /breakfast/.test(t) ? 'breakfast' : 'dinner';
    const quick = t.match(/(?:under|in|less than)\s+(\d+)\s*min/);
    return { tool: 'meal_suggest', args: { count: 3, meal, ...(quick ? { maxMinutes: Number(quick[1]) } : {}), ...(/\bkids?\b/.test(t) ? { kidFriendly: true } : {}) } };
  }

  return { speech: "I can plan dinner around what's about to expire, cook with you step by step, and order what you're missing. Try: what should we cook tonight?" };
}
