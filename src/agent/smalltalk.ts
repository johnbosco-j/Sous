// Conversational turns that need no tool: greetings, thanks, help, time, goodbyes.
// Answers are built from live kitchen state so even small talk nudges toward using food before it expires.

export interface TalkContext {
  hour: number;
  atRisk: { name: string; expiresInDays: number }[];
  cooking: { title: string; step: number; total: number } | null;
  pendingPrompt: string | null;
  plan: string[];
  cart: { items: number; totalUsd: number; placed: boolean } | null;
  householdName: string;
}

const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

function when(d: number) {
  return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
}

/** One short, useful nudge based on what is happening right now. */
export function nextHint(ctx: TalkContext): string {
  if (ctx.pendingPrompt) return ctx.pendingPrompt;
  if (ctx.cooking) return `We're on step ${ctx.cooking.step} of ${ctx.cooking.total} of ${ctx.cooking.title}. Say "next", "repeat" or "set a timer".`;
  if (ctx.cart && !ctx.cart.placed) return `Your cart has ${ctx.cart.items} item${ctx.cart.items === 1 ? '' : 's'} for $${ctx.cart.totalUsd.toFixed(2)}. Say "place the order" when you're ready.`;
  const first = ctx.atRisk[0];
  if (first) {
    const plural = /s$/.test(first.name) && !/ss$/.test(first.name);
    return `Your ${first.name} ${plural ? 'expire' : 'expires'} ${when(first.expiresInDays)}. Want dinner ideas that use ${plural ? 'them' : 'it'} up?`;
  }
  return 'Ask me "what should we cook tonight?"';
}

/** Mirror the person's own greeting; the server clock may be in another time zone (UTC on Vercel). */
function greeting(text: string) {
  const m = text.match(/good (morning|afternoon|evening)/);
  return m ? `Good ${m[1]}` : pick(['Hi there', 'Hello', 'Hey']);
}

export function smallTalk(text: string, ctx: TalkContext): string | null {
  const t = text.toLowerCase().replace(/^(alexa|hey alexa|ok alexa)[,!. ]*/i, '').replace(/[!?.]+$/g, '').trim();
  if (!t) return `${greeting(t)}! ${nextHint(ctx)}`;

  if (/^(hi|hello|hey|hiya|yo|howdy|good (morning|afternoon|evening)|hi there|hello there|namaste|vanakkam)\b/.test(t) && t.split(/\s+/).length <= 4) {
    return `${greeting(t)}! I'm Sous, your kitchen helper. ${nextHint(ctx)}`;
  }
  if (/\bhow (are|r) (you|u)\b|how'?s it going|how are things|what'?s up\b/.test(t)) {
    return `${pick(['Doing great, and hungry to help.', "I'm good, thanks for asking.", 'All good here in the kitchen.'])} ${nextHint(ctx)}`;
  }
  if (/^(thanks|thank you|thank u|cheers|great|awesome|perfect|nice|cool|love it|good job|well done)\b/.test(t)) {
    return `${pick(["You're welcome!", 'Happy to help!', 'Anytime!'])} ${ctx.cooking ? `Say "next" when you're ready for the next step of ${ctx.cooking.title}.` : 'Enjoy your cooking.'}`;
  }
  if (/^(bye|goodbye|good night|goodnight|see you|later|that'?s all|that is all|i'?m done|stop|cancel|never ?mind)\b/.test(t)) {
    return ctx.cooking ? `Okay. I'll keep your place in ${ctx.cooking.title} for when you're back.` : pick(['Okay. Enjoy your dinner!', 'Bye for now. Happy cooking!']);
  }
  if (/\b(who are you|what are you|your name|what can you do|help me|^help$|how does this work|what do you do)\b/.test(t)) {
    return "I'm Sous. I plan meals around food that's about to expire, keep allergies out of every recipe, build your grocery cart and only order after you say yes, and cook with you step by step. Try: what should we cook tonight?";
  }
  if (/\bwhat time is it\b|\bthe time\b/.test(t)) {
    const d = new Date();
    return `It's ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. ${nextHint(ctx)}`;
  }
  if (/\b(joke|make me laugh|something funny)\b/.test(t)) {
    return pick([
      "Why did the tomato blush? It saw the salad dressing. Speaking of tomatoes, yours are best used in the next few days.",
      "I'd tell you a joke about leftover rice, but it's a little stale. Unlike yours, which expires tomorrow, so let's fry it.",
      'What do you call cheese that is not yours? Nacho cheese.'
    ]);
  }
  if (/\bwhat'?s in (my|the) cart\b|\bmy cart\b|\border status\b/.test(t)) {
    if (!ctx.cart) return 'Your cart is empty. Say "add what we\'re missing to the cart".';
    return ctx.cart.placed ? `Your order of $${ctx.cart.totalUsd.toFixed(2)} is placed and arrives today between 6 and 8.` : `Your cart has ${ctx.cart.items} items for $${ctx.cart.totalUsd.toFixed(2)}. Say "place the order" to confirm.`;
  }
  if (/\b(i love you|you'?re (the best|great|awesome|smart))\b/.test(t)) {
    return `That's sweet. I love a fridge with nothing wasted. ${nextHint(ctx)}`;
  }
  return null;
}

/** Fallback for anything the offline router can't place: say what was heard, then a useful next step. */
export function fallback(text: string, ctx: TalkContext): string {
  const heard = text.replace(/^(alexa|hey alexa)[, ]*/i, '').trim().slice(0, 60);
  return `${pick(["I'm not sure how to help with", "I can't do", "I don't know about"])} "${heard}" yet. ${nextHint(ctx)}`;
}
