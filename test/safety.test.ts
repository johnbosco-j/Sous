import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SOUS_DATA_PATH = join(mkdtempSync(join(tmpdir(), 'sous-safety-')), 'kitchen.json');
process.env.SOUS_BEDROCK = 'off';

let callTool: typeof import('../src/mcp/server.js').callTool;
let resetState: typeof import('../src/domain/store.js').resetState;
let getState: typeof import('../src/domain/store.js').getState;
let route: typeof import('../src/agent/rules.js').route;
let tools: typeof import('../src/mcp/registry.js').tools;

beforeAll(async () => {
  ({ callTool } = await import('../src/mcp/server.js'));
  ({ resetState, getState } = await import('../src/domain/store.js'));
  ({ route } = await import('../src/agent/rules.js'));
  ({ tools } = await import('../src/mcp/registry.js'));
});

beforeEach(() => {
  resetState();
});

async function sc(name: string, args: Record<string, unknown>) {
  const res = await callTool(name, args);
  return { res, sc: res.structuredContent as any };
}

const NO_REASSURANCE = /you'?re fine|you are fine|nothing to worry|no need to worry|it'?s fine|it'?s safe|safe to eat|not serious|don'?t worry/i;

describe('allergy_emergency (red-flag engine)', () => {
  it('returns the fixed emergency text for swelling lips, naming the member from the description', async () => {
    const { sc: s } = await sc('allergy_emergency', { description: "Leo's lips are swelling after he ate a cookie" });
    expect(s.data.level).toBe('emergency');
    expect(s.speech).toBe("This could be a severe allergic reaction. Call 911 now. If Leo has a prescribed epinephrine auto-injector, use it as directed. Don't wait to see if it gets better.");
  });

  it('uses "they" when nobody is named', async () => {
    const { sc: s } = await sc('allergy_emergency', { description: 'she is having trouble breathing' });
    expect(s.data.level).toBe('emergency');
    expect(s.speech).toContain('If they have a prescribed epinephrine auto-injector');
  });

  it('respects an explicit member argument', async () => {
    const { sc: s } = await sc('allergy_emergency', { description: 'throat feels tight', member: 'Ava' });
    expect(s.data.member).toBe('Ava');
    expect(s.speech).toContain('If Ava has');
  });

  it.each([
    ['he is wheezing'],
    ['her throat is closing'],
    ['he fainted after lunch'],
    ['his face is turning blue'],
    ['we used the EpiPen already'],
    ['hives spreading all over his body'],
    ['she keeps vomiting again and again']
  ])('treats "%s" as an emergency', async (description) => {
    const { sc: s } = await sc('allergy_emergency', { description });
    expect(s.data.level).toBe('emergency');
    expect(s.data.call).toBe('911');
  });

  it('handles negation: "no trouble breathing, just an itchy mouth" is watch-level', async () => {
    const { sc: s } = await sc('allergy_emergency', { description: 'no trouble breathing, just an itchy mouth' });
    expect(s.data.level).toBe('watch');
    expect(s.speech).toBe("Watch closely. If there's any swelling, trouble breathing or the symptoms spread, call 911 right away.");
  });

  it('handles negation across several signs', async () => {
    const { sc: s } = await sc('allergy_emergency', { description: "he's not wheezing and there is no swelling, a few hives on his arm" });
    expect(s.data.level).toBe('watch');
    expect(s.data.signs.watch).toContain('hives');
  });

  it('never reassures, at either level', async () => {
    for (const description of ['mild itchy tongue', 'lips swelling and wheezing']) {
      const { sc: s } = await sc('allergy_emergency', { description });
      expect(s.speech).not.toMatch(NO_REASSURANCE);
    }
  });

  it('logs every incident with time, member and level', async () => {
    await sc('allergy_emergency', { description: "Leo's tongue is swollen" });
    await sc('allergy_emergency', { description: 'itchy mouth', member: 'Ava' });
    const incidents = getState().ext.safety.incidents;
    expect(incidents).toHaveLength(2);
    expect(incidents[0]).toMatchObject({ member: 'Leo', level: 'emergency' });
    expect(incidents[1]).toMatchObject({ member: 'Ava', level: 'watch' });
    expect(Date.parse(incidents[0].at)).not.toBeNaN();
  });
});

describe('allergen_scan', () => {
  it('flags a definite allergen and names who it affects', async () => {
    const { sc: s } = await sc('allergen_scan', { text: 'Ingredients: oats, honey, roasted peanuts, salt' });
    expect(s.data.verdict).toBe('contains');
    expect(s.speech).toMatch(/Leo is allergic to peanuts/);
  });

  it('flags precautionary "may contain" labels separately', async () => {
    const { sc: s } = await sc('allergen_scan', { text: 'Wheat flour, sugar, cocoa. May contain peanuts and tree nuts.' });
    expect(s.data.verdict).toBe('may-contain');
    expect(s.data.contains).toHaveLength(0);
    expect(s.speech).toMatch(/may contain peanut/);
  });

  it('ignores "peanut-free" claims', async () => {
    const { sc: s } = await sc('allergen_scan', { text: 'Peanut-free facility. Rice, sunflower oil, salt.' });
    expect(s.data.verdict).toBe('none-found');
  });

  it('uses careful wording when nothing is found', async () => {
    const { sc: s } = await sc('allergen_scan', { text: 'Rice, water, salt' });
    expect(s.speech).toMatch(/I don't see anything on Leo's allergy list/);
    expect(s.speech).not.toMatch(NO_REASSURANCE);
  });

  it('can check a single member and rejects unknown ones', async () => {
    const ava = await sc('allergen_scan', { text: 'peanuts', member: 'Ava' });
    expect(ava.sc.data.verdict).toBe('no-allergies-saved');
    const nobody = await sc('allergen_scan', { text: 'peanuts', member: 'Zed' });
    expect(nobody.res.isError).toBe(true);
  });
});

describe('diet_profile and the meal_suggest filter', () => {
  it('a vegetarian member removes chicken recipes from suggestions, with the reason', async () => {
    await sc('diet_profile', { action: 'set', member: 'Sam', need: 'vegetarian' });
    const { sc: s } = await sc('meal_suggest', { count: 6 });
    const ids = s.data.suggestions.map((x: any) => x.recipeId);
    expect(ids).not.toContain('chicken-tzatziki-bowls');
    expect(ids).not.toContain('chicken-quesadillas');
    expect(s.data.excluded).toContainEqual(expect.objectContaining({ reason: 'Sam is vegetarian' }));
  });

  it('adds a new member (Grandpa) and applies low sodium', async () => {
    const set = await sc('diet_profile', { action: 'set', member: 'grandpa', need: 'low-sodium' });
    expect(set.sc.data.addedMember).toBe(true);
    expect(getState().household.members.map(m => m.name)).toContain('Grandpa');
    const { sc: s } = await sc('meal_suggest', { count: 6 });
    expect(s.data.suggestions.map((x: any) => x.recipeId)).not.toContain('spinach-shakshuka');
    expect(s.data.excluded.some((e: any) => e.reason === 'Grandpa needs low sodium')).toBe(true);
  });

  it('get lists needs, and remove lifts the filter', async () => {
    await sc('diet_profile', { action: 'set', member: 'Sam', need: 'vegetarian' });
    const got = await sc('diet_profile', { action: 'get' });
    expect(got.sc.speech).toMatch(/Sam is vegetarian/);
    await sc('diet_profile', { action: 'remove', member: 'Sam', need: 'vegetarian' });
    const { sc: s } = await sc('meal_suggest', { count: 6 });
    expect(s.data.excluded.some((e: any) => e.reason === 'Sam is vegetarian')).toBe(false);
  });

  it('asks for details when set is incomplete', async () => {
    const { res } = await sc('diet_profile', { action: 'set', member: 'Sam' });
    expect(res.isError).toBe(true);
  });

  it('rejects unknown diet values at the schema level', async () => {
    const res = await callTool('diet_profile', { action: 'set', member: 'Sam', need: 'keto' });
    expect(res.isError).toBe(true);
  });
});

describe('meal_safety_check', () => {
  it('blocks Leo from Peanut Sesame Noodles and clears everyone else', async () => {
    const { sc: s } = await sc('meal_safety_check', { recipe: 'peanut-sesame-noodles' });
    const leo = s.data.verdicts.find((v: any) => v.member === 'Leo');
    expect(leo.ok).toBe(false);
    expect(leo.reasons[0]).toMatch(/peanut/);
    expect(s.speech).toMatch(/^Not for Leo/);
    expect(s.speech).toMatch(/Nothing on .*Maya.*lists/);
  });

  it('uses careful wording when nobody is affected', async () => {
    const { sc: s } = await sc('meal_safety_check', { recipe: 'the curry' });
    expect(s.speech).toMatch(/contains nothing on anyone's allergy or diet list/);
    expect(s.speech).not.toMatch(NO_REASSURANCE);
  });

  it('includes diet needs and dislikes in the verdict', async () => {
    await sc('diet_profile', { action: 'set', member: 'Sam', need: 'vegetarian' });
    await callTool('household_memory', { action: 'remember', member: 'Ava', kind: 'dislike', value: 'mushrooms' });
    const tzatziki = await sc('meal_safety_check', { recipe: 'chicken-tzatziki-bowls' });
    expect(tzatziki.sc.data.verdicts.find((v: any) => v.member === 'Sam').ok).toBe(false);
    const risotto = await sc('meal_safety_check', { recipe: 'mushroom-risotto' });
    expect(risotto.sc.data.verdicts.find((v: any) => v.member === 'Ava').reasons[0]).toMatch(/doesn't like mushrooms/);
  });

  it('fails cleanly for an unknown recipe', async () => {
    const { res } = await sc('meal_safety_check', { recipe: 'zzz qqq' });
    expect(res.isError).toBe(true);
  });
});

describe('cross_contact_tips', () => {
  it("defaults to the household allergy (Leo, peanuts) and leads with soap and water", async () => {
    const { sc: s } = await sc('cross_contact_tips', {});
    expect(s.data.member).toBe('Leo');
    expect(s.speech).toMatch(/keep peanuts away from Leo's food/);
    expect(s.speech).toMatch(/soap and water/);
    expect(s.data.tips.length).toBeGreaterThanOrEqual(5);
  });
});

describe('cooking_temp (USDA minimums)', () => {
  it.each([
    ['chicken thighs', 165, 74, 0],
    ['ground beef burgers', 160, 71, 0],
    ['pork chops', 145, 63, 3],
    ['salmon', 145, 63, 0],
    ['a frittata', 160, 71, 0],
    ['leftover curry', 165, 74, 0],
    ['ground turkey', 165, 74, 0]
  ])('%s -> %i°F / %i°C', async (food, f, c, rest) => {
    const { sc: s } = await sc('cooking_temp', { food });
    expect(s.data.minF).toBe(f);
    expect(s.data.minC).toBe(c);
    expect(s.data.restMinutes).toBe(rest);
    expect(s.speech).toContain(`${f} degrees Fahrenheit, ${c} Celsius`);
  });

  it('asks which food when it does not know', async () => {
    const { res } = await sc('cooking_temp', { food: 'tofu' });
    expect(res.isError).toBe(true);
  });
});

describe('voice routes', () => {
  const ctx = { cooking: false, lastSuggestions: [] };
  it.each([
    ["leo's lips are swelling after eating a cookie", 'allergy_emergency'],
    ['help he is having an allergic reaction', 'allergy_emergency'],
    ['check this label: wheat, may contain peanuts', 'allergen_scan'],
    ['does this contain milk powder and soy lecithin', 'allergen_scan'],
    ['grandpa needs low sodium', 'diet_profile'],
    ['sam is vegetarian', 'diet_profile'],
    ['is the curry safe for leo', 'meal_safety_check'],
    ['can ava eat the shakshuka', 'meal_safety_check'],
    ['how do i keep peanuts away from leo', 'cross_contact_tips'],
    ['what temperature should i cook chicken to', 'cooking_temp']
  ])('"%s" -> %s', (text, toolName) => {
    const r = route(text, ctx);
    expect('tool' in r && r.tool).toBe(toolName);
  });

  it('does not steal everyday kitchen requests', () => {
    expect(route('what should we cook tonight?', ctx)).toMatchObject({ tool: 'meal_suggest' });
    expect(route("what's about to expire?", ctx)).toMatchObject({ tool: 'pantry_check' });
  });

  it('parses diet routes into the right arguments', () => {
    expect(route('grandpa needs low sodium', ctx)).toEqual({ tool: 'diet_profile', args: { action: 'set', member: 'grandpa', need: 'low-sodium' } });
  });
});

describe('tool metadata', () => {
  it('registers six safety tools with annotations and icons', () => {
    const names = ['allergy_emergency', 'allergen_scan', 'diet_profile', 'meal_safety_check', 'cross_contact_tips', 'cooking_temp'];
    for (const n of names) {
      const t = tools.find(x => x.name === n);
      expect(t, n).toBeTruthy();
      expect(t!.icon).toBeTruthy();
      expect(typeof t!.annotations.readOnlyHint).toBe('boolean');
    }
  });
});

describe('emergency alert card (MCP Apps)', () => {
  it('links allergy_emergency to the ui://sous/alert.html view and marks the result with view "alert"', async () => {
    const { callTool } = await import('../src/mcp/server.js');
    const res = await callTool('allergy_emergency', { description: "Leo's lips are swelling after eating", member: 'Leo' });
    const sc = res.structuredContent as any;
    expect(sc.view).toBe('alert');
    expect(sc.data.level).toBe('emergency');
    const { toolViewMap, viewHtml } = await import('../src/mcp/server.js');
    expect(toolViewMap().allergy_emergency).toBe('ui://sous/alert.html');
    expect(viewHtml('alert' as any)).toMatch(/Call 911 now/);
  });
});
