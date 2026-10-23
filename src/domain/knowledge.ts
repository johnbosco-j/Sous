// Deterministic kitchen knowledge: allergy-aware substitutions and conservative food-storage rules.
// Storage windows follow general US guidance (USDA FoodKeeper / FoodSafety.gov charts) and are deliberately conservative.

import { Allergen } from './catalog.js';

export interface Substitute { use: string; ratio: string; allergens: Allergen[]; note?: string }

export const SUBSTITUTES: Record<string, Substitute[]> = {
  egg: [
    { use: 'ground flaxseed with water', ratio: '1 tablespoon flaxseed plus 3 tablespoons water per egg, rested 5 minutes', allergens: [] },
    { use: 'unsweetened applesauce', ratio: 'a quarter cup per egg', allergens: [], note: 'best in baking' },
    { use: 'Greek yogurt', ratio: 'a quarter cup per egg', allergens: ['dairy'] }
  ],
  milk: [
    { use: 'oat milk', ratio: 'one to one', allergens: ['gluten'], note: 'choose certified gluten-free oats if needed' },
    { use: 'soy milk', ratio: 'one to one', allergens: ['soy'] },
    { use: 'coconut milk thinned with water', ratio: 'half and half', allergens: [] }
  ],
  butter: [
    { use: 'olive oil', ratio: 'three quarters of the amount', allergens: [] },
    { use: 'coconut oil', ratio: 'one to one', allergens: [] }
  ],
  'greek-yogurt': [
    { use: 'sour cream', ratio: 'one to one', allergens: ['dairy'] },
    { use: 'coconut yogurt', ratio: 'one to one', allergens: [] }
  ],
  cheddar: [{ use: 'nutritional yeast', ratio: '2 tablespoons per quarter cup of cheese', allergens: [] }],
  parmesan: [{ use: 'nutritional yeast', ratio: '2 tablespoons per quarter cup of cheese', allergens: [] }],
  feta: [
    { use: 'goat cheese', ratio: 'one to one', allergens: ['dairy'] },
    { use: 'crumbled firm tofu with lemon and salt', ratio: 'one to one', allergens: ['soy'] }
  ],
  'peanut-butter': [
    { use: 'sunflower seed butter', ratio: 'one to one', allergens: [] },
    { use: 'tahini', ratio: 'one to one', allergens: ['sesame'] }
  ],
  'soy-sauce': [{ use: 'coconut aminos', ratio: 'one to one, plus a pinch of salt', allergens: [] }],
  flour: [
    { use: 'gluten-free flour blend', ratio: 'one to one', allergens: [] },
    { use: 'oat flour', ratio: 'one and a quarter cups per cup', allergens: ['gluten'] }
  ],
  pasta: [
    { use: 'rice noodles', ratio: 'same weight', allergens: [] },
    { use: 'gluten-free pasta', ratio: 'same weight', allergens: [] }
  ],
  tortilla: [{ use: 'corn tortillas', ratio: 'one to one', allergens: [] }],
  bread: [{ use: 'gluten-free bread', ratio: 'one to one', allergens: [] }],
  cilantro: [{ use: 'flat-leaf parsley', ratio: 'one to one', allergens: [], note: 'add a squeeze of lime' }],
  'chicken-thighs': [
    { use: 'chickpeas', ratio: 'one can per 3 thighs', allergens: [] },
    { use: 'firm tofu', ratio: 'about 400 grams per 4 thighs', allergens: ['soy'] }
  ],
  lemon: [
    { use: 'lime', ratio: 'one to one', allergens: [] },
    { use: 'white wine vinegar', ratio: 'half the amount', allergens: [] }
  ],
  ginger: [{ use: 'ground ginger', ratio: 'a quarter teaspoon per tablespoon of fresh', allergens: [] }],
  cucumber: [{ use: 'zucchini', ratio: 'one to one', allergens: [] }],
  mushrooms: [{ use: 'eggplant', ratio: 'same weight', allergens: [] }],
  'sesame-oil': [{ use: 'olive oil with toasted cumin', ratio: 'one to one', allergens: [] }]
};

/** Fridge storage windows (days) for opened or fresh items, used when no label date is known. */
export interface StorageRule { fridgeDays: [number, number]; kind: 'raw-protein' | 'dairy' | 'produce' | 'cooked' | 'egg' | 'bakery' | 'shelf'; tip: string }

export const STORAGE: Record<string, StorageRule> = {
  'chicken-thighs': { fridgeDays: [1, 2], kind: 'raw-protein', tip: 'Keep raw chicken on the lowest shelf and cook it to 74 degrees Celsius, or 165 Fahrenheit.' },
  'cooked-rice': { fridgeDays: [3, 4], kind: 'cooked', tip: 'Cooked food should go in the fridge within 2 hours of cooking.' },
  egg: { fridgeDays: [21, 35], kind: 'egg', tip: 'Keep eggs in their carton in the main part of the fridge, not the door.' },
  milk: { fridgeDays: [5, 7], kind: 'dairy', tip: 'Milk lasts about a week once opened.' },
  'greek-yogurt': { fridgeDays: [7, 14], kind: 'dairy', tip: 'Throw yogurt out if you see mold anywhere in the tub.' },
  cheddar: { fridgeDays: [21, 28], kind: 'dairy', tip: 'For hard cheese, mold can be cut away with an inch around it.' },
  parmesan: { fridgeDays: [21, 28], kind: 'dairy', tip: 'Hard cheese keeps for weeks when well wrapped.' },
  feta: { fridgeDays: [5, 7], kind: 'dairy', tip: 'Keep feta in its brine.' },
  spinach: { fridgeDays: [3, 7], kind: 'produce', tip: 'Slimy or dark leaves mean it has gone off.' },
  tomato: { fridgeDays: [3, 5], kind: 'produce', tip: 'Soft spots are fine to cut away; mold or leaking juice is not.' },
  'bell-pepper': { fridgeDays: [7, 10], kind: 'produce', tip: 'Wrinkly is fine for cooking; slimy is not.' },
  banana: { fridgeDays: [2, 5], kind: 'produce', tip: 'Brown bananas are perfect for baking.' },
  cilantro: { fridgeDays: [5, 7], kind: 'produce', tip: 'Stand it in a glass of water like flowers.' },
  cucumber: { fridgeDays: [5, 7], kind: 'produce', tip: 'Soft or slimy ends mean it is past its best.' },
  bread: { fridgeDays: [3, 5], kind: 'bakery', tip: 'Freeze sliced bread and toast it straight from frozen.' },
  tortilla: { fridgeDays: [7, 14], kind: 'bakery', tip: 'Any visible mold means the whole pack goes.' }
};

/** Leftovers: refrigerate within 2 hours, eat within 3 to 4 days (USDA general guidance). */
export const LEFTOVER_DAYS = 4;
