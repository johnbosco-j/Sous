import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SOUS_DATA_PATH = join(mkdtempSync(join(tmpdir(), 'sous-household-')), 'kitchen.json');
process.env.SOUS_BEDROCK = 'off';

type Call = typeof import('../src/mcp/server.js').callTool;
let callTool: Call;
let store: typeof import('../src/domain/store.js');
let route: typeof import('../src/agent/rules.js').route;
let household: typeof import('../src/mcp/tools/household.js');

beforeAll(async () => {
  ({ callTool } = await import('../src/mcp/server.js'));
  store = await import('../src/domain/store.js');
  ({ route } = await import('../src/agent/rules.js'));
  household = await import('../src/mcp/tools/household.js');
});

beforeEach(() => {
  store.resetState();
});

const sc = (r: Awaited<ReturnType<Call>>) => r.structuredContent as any;
const call = async (name: string, args: Record<string, unknown> = {}) => sc(await callTool(name, args));

describe('household_members', () => {
  it('lists every member and their allergies', async () => {
    const out = await call('household_members', { action: 'list' });
    expect(out.ok).toBe(true);
    expect(out.speech).toMatch(/Maya.*Sam.*Leo.*Ava/);
    expect(out.speech).toMatch(/Leo \(8, allergic to peanuts\)/);
  });

  it('adds a member with an age and asks about allergies', async () => {
    const out = await call('household_members', { action: 'add', name: 'grandpa', age: 78 });
    expect(out.ok).toBe(true);
    expect(out.speech).toMatch(/Added Grandpa.*allergies/);
    expect(store.getState().household.members.find(m => m.name === 'Grandpa')?.age).toBe(78);
  });

  it('refuses to add a duplicate member', async () => {
    const out = await call('household_members', { action: 'add', name: 'maya' });
    expect(out.ok).toBe(false);
    expect(store.getState().household.members.filter(m => m.name === 'Maya')).toHaveLength(1);
  });

  it('never silently drops an allergy when removing someone', async () => {
    const out = await call('household_members', { action: 'remove', name: 'Leo' });
    expect(out.ok).toBe(true);
    expect(out.speech).toMatch(/Leo's peanuts allergy/);
    expect(out.data.removedAllergies).toEqual(['peanut']);
    expect(store.getState().household.members.some(m => m.name === 'Leo')).toBe(false);
  });

  it('fails clearly for an unknown member', async () => {
    const out = await call('household_members', { action: 'remove', name: 'Zed' });
    expect(out.ok).toBe(false);
    expect(out.speech).toMatch(/Zed/);
  });

  it('keeps at least one member', async () => {
    store.update(s => { s.household.members = [s.household.members[0]]; });
    const out = await call('household_members', { action: 'remove', name: 'Maya' });
    expect(out.ok).toBe(false);
    expect(store.getState().household.members).toHaveLength(1);
  });
});

describe('pantry_add_receipt', () => {
  const RECEIPT = ['2 x Baby Spinach 3.49', 'MILK 1GAL 4.29', 'Eggs dozen', 'Paper towels 5.99', 'SUBTOTAL 20.10', 'TAX 1.20'].join('\n');

  it('matches items, keeps unmatched lines and ignores totals', async () => {
    const out = await call('pantry_add_receipt', { text: RECEIPT });
    expect(out.ok).toBe(true);
    const byName = Object.fromEntries(out.data.matched.map((m: any) => [m.name, m.qty]));
    expect(byName).toEqual({ 'baby spinach': 2, milk: 16, eggs: 12 });
    expect(out.data.unmatched).toEqual(['Paper towels 5.99']);
    expect(out.data.ignored).toHaveLength(2);
    expect(out.speech).toMatch(/Added 3 items.*Paper towels/);
  });

  it('adds matched items to the pantry with a typical shelf life', async () => {
    const before = store.getState().pantry.length;
    await call('pantry_add_receipt', { text: RECEIPT });
    const s = store.getState();
    expect(s.pantry.length).toBe(before + 3);
    const lots = s.pantry.slice(-3);
    expect(store.daysUntil(lots.find(l => l.id === 'spinach')!.expiresOn)).toBe(6);
    expect(store.daysUntil(lots.find(l => l.id === 'milk')!.expiresOn)).toBe(10);
  });

  it('understands pack multipliers, dozens and plain counts', () => {
    expect(household.parseReceiptLine('Tortillas x2')).toMatchObject({ kind: 'matched', id: 'tortilla', qty: 16 });
    expect(household.parseReceiptLine('2 dozen eggs')).toMatchObject({ kind: 'matched', id: 'egg', qty: 24 });
    expect(household.parseReceiptLine('3 tomatoes')).toMatchObject({ kind: 'matched', id: 'tomato', qty: 3 });
    expect(household.parseReceiptLine('Chicken thighs 7.49')).toMatchObject({ kind: 'matched', id: 'chicken-thighs', qty: 6 });
  });

  it('splits a spoken, comma-separated receipt', async () => {
    const out = await call('pantry_add_receipt', { text: '2 x baby spinach, eggs dozen, lemons' });
    expect(out.data.matched.map((m: any) => m.name)).toEqual(['baby spinach', 'eggs', 'lemons']);
  });

  it('fails without changing the pantry when nothing matches', async () => {
    const before = store.getState().pantry.length;
    const res = await callTool('pantry_add_receipt', { text: 'Paper towels\nDish soap' });
    expect(res.isError).toBe(true);
    expect(sc(res).data.unmatched).toHaveLength(2);
    expect(store.getState().pantry.length).toBe(before);
  });
});

describe('daily_brief', () => {
  it('names what expires tomorrow and suggests a use-it-up dinner, in at most three sentences', async () => {
    const out = await call('daily_brief');
    expect(out.ok).toBe(true);
    expect(out.data.expiringTomorrow).toContain('baby spinach');
    expect(out.data.suggestion.recipeId).toBe('spinach-chickpea-curry');
    expect(out.speech).toMatch(/baby spinach.*tomorrow/);
    expect(out.speech.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
  });

  it("uses tonight's plan instead of a suggestion when one exists", async () => {
    await call('meal_plan_set', { recipeIds: ['rescue-fried-rice'] });
    const out = await call('daily_brief');
    expect(out.data.tonight).toBe('Rescue Egg Fried Rice');
    expect(out.data.suggestion).toBeNull();
    expect(out.speech).toMatch(/Tonight's plan is Rescue Egg Fried Rice/);
  });

  it('mentions an order arriving today and running timers', async () => {
    const cart = await call('shopping_cart_build', { recipeIds: ['chicken-tzatziki-bowls'] });
    await call('shopping_checkout', { cartToken: cart.data.cartToken, confirmed: true });
    await call('timer_set', { minutes: 10, label: 'rice' });
    const out = await call('daily_brief');
    expect(out.data.ordersArriving).toHaveLength(1);
    expect(out.data.timers).toHaveLength(1);
    expect(out.speech).toMatch(/order arrives.*1 timer is running/);
    expect(out.speech.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(3);
  });
});

describe('order_history', () => {
  it('says there are no orders yet', async () => {
    const out = await call('order_history');
    expect(out.ok).toBe(true);
    expect(out.data.orders).toEqual([]);
    expect(out.speech).toMatch(/No orders yet/);
  });

  it('lists a placed order with id, total and items, but not draft carts', async () => {
    const draft = await call('shopping_cart_build', { items: [{ name: 'lemons' }] });
    const cart = await call('shopping_cart_build', { recipeIds: ['chicken-tzatziki-bowls'] });
    const placed = await call('shopping_checkout', { cartToken: cart.data.cartToken, confirmed: true });
    const out = await call('order_history');
    expect(out.data.orders).toHaveLength(1);
    expect(out.data.orders[0].orderId).toBe(placed.data.orderId);
    expect(out.data.orders[0].items).toContain('cucumber');
    expect(out.data.orders[0].totalUsd).toBe(placed.data.totalUsd);
    expect(out.data.orders.some((o: any) => o.orderId === draft.data.orderId)).toBe(false);
  });
});

describe('reorder_staples', () => {
  it('builds nothing when the staples are stocked', async () => {
    const out = await call('reorder_staples');
    expect(out.ok).toBe(true);
    expect(out.data.low).toEqual([]);
    expect(out.followUp).toBeUndefined();
  });

  it('puts low staples in a draft cart and hands over to the purchase gate', async () => {
    store.update(s => { s.pantry = s.pantry.filter(p => p.id !== 'egg' && p.id !== 'butter'); });
    const out = await call('reorder_staples');
    expect(out.view).toBe('cart');
    expect(out.data.low.map((l: any) => l.name).sort()).toEqual(['butter', 'eggs']);
    expect(out.data.lines.map((l: any) => l.name).sort()).toEqual(['butter', 'eggs']);
    expect(out.data.status).toBe('draft');
    expect(out.followUp).toMatchObject({ tool: 'shopping_checkout', arguments: { cartToken: out.data.cartToken, confirmed: true } });
  });

  it('is ordered only through shopping_checkout, which then shows in order history', async () => {
    store.update(s => { s.pantry = s.pantry.filter(p => p.id !== 'milk'); });
    const out = await call('reorder_staples');
    expect((await call('order_history')).data.orders).toHaveLength(0);
    const unconfirmed = await call('shopping_checkout', { cartToken: out.data.cartToken });
    expect(unconfirmed.data.status).toBe('awaiting_confirmation');
    const placed = await call('shopping_checkout', out.followUp.arguments);
    expect(placed.data.status).toBe('placed');
    expect((await call('order_history')).data.orders[0].items).toEqual(['milk']);
  });
});

describe('delivery_slots', () => {
  it('lists five simulated windows, with tomorrow always open', async () => {
    const out = await call('delivery_slots');
    expect(out.data.slots).toHaveLength(5);
    expect(out.data.store).toMatch(/simulated/);
    expect(out.data.slots.filter((s: any) => s.day === 'tomorrow').every((s: any) => s.available)).toBe(true);
  });

  it("closes today's windows an hour before they start", () => {
    const late = household.deliverySlots(new Date(2026, 9, 23, 23, 0));
    expect(late.filter(s => s.day === 'today').every(s => !s.available)).toBe(true);
    const early = household.deliverySlots(new Date(2026, 9, 23, 9, 0));
    expect(early.find(s => s.id === 'today-18')!.available).toBe(true);
    expect(early.find(s => s.id === 'tomorrow-08')!.label).toBe('Tomorrow, 8 to 10AM');
  });

  it('saves a picked window by number or id', async () => {
    const out = await call('delivery_slots', { action: 'pick', slot: '3' });
    expect(out.ok).toBe(true);
    expect(store.getState().ext.household.deliveryWindow.id).toBe('tomorrow-08');
    const again = await call('delivery_slots', { action: 'pick', slot: 'tomorrow-12' });
    expect(again.speech).toMatch(/tomorrow, 12 to 2pm/i);
    expect(store.getState().ext.household.deliveryWindow.id).toBe('tomorrow-12');
  });

  it('understands words like "tomorrow morning"', async () => {
    const out = await call('delivery_slots', { action: 'pick', slot: 'tomorrow morning' });
    expect(out.data.preferred.id).toBe('tomorrow-08');
  });

  it('rejects an unknown window', async () => {
    const out = await call('delivery_slots', { action: 'pick', slot: 'next year' });
    expect(out.ok).toBe(false);
    expect(store.getState().ext.household?.deliveryWindow).toBeUndefined();
  });
});

describe('voice routes', () => {
  const ctx = { cooking: false, lastSuggestions: [] };
  it.each([
    ["who's in our household", 'household_members', { action: 'list' }],
    ['add grandpa to the household', 'household_members', { action: 'add', name: 'grandpa' }],
    ['remove ava from the family', 'household_members', { action: 'remove', name: 'ava' }],
    ['give me my kitchen brief', 'daily_brief', {}],
    ['what did we order last week', 'order_history', {}],
    ['reorder the staples', 'reorder_staples', {}],
    ['what delivery slots are there', 'delivery_slots', { action: 'list' }],
    ['pick the tomorrow morning delivery slot', 'delivery_slots', { action: 'pick', slot: 'tomorrow morning' }]
  ])('"%s" -> %s', (text, tool, args) => {
    expect(route(text, ctx)).toEqual({ tool, args });
  });

  it('routes a spoken receipt to the receipt parser', () => {
    expect(route("here's my receipt: 2 x baby spinach, eggs dozen", ctx)).toEqual({ tool: 'pantry_add_receipt', args: { text: '2 x baby spinach, eggs dozen' } });
  });

  it('does not steal existing intents', () => {
    expect(route("what's about to expire?", ctx)).toMatchObject({ tool: 'pantry_check' });
    expect(route('add milk to the cart', ctx)).toMatchObject({ tool: 'shopping_cart_build' });
    expect(route("add what we're missing to the cart", ctx)).toMatchObject({ tool: 'shopping_cart_build' });
  });
});
