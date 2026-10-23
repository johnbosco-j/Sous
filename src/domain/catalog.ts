// Static kitchen knowledge: ingredients (with price, weight and allergens), recipes, and the demo household.
// All data is synthetic. Prices are illustrative US grocery prices, not live Amazon Fresh prices.

export type Allergen = 'peanut' | 'tree-nut' | 'dairy' | 'egg' | 'gluten' | 'soy' | 'sesame' | 'shellfish' | 'fish';

export interface Ingredient {
  id: string;
  name: string;
  emoji: string;
  unit: string;
  category: 'produce' | 'protein' | 'dairy' | 'grains' | 'pantry' | 'frozen' | 'bakery';
  priceUsd: number; // price of one unit
  kg: number; // weight of one unit, for impact math
  allergens: Allergen[];
  aliases: string[];
  packSize: number; // how many units a store pack contains
}

const ing = (
  id: string, name: string, emoji: string, unit: string, category: Ingredient['category'],
  priceUsd: number, kg: number, allergens: Allergen[] = [], aliases: string[] = [], packSize = 1
): Ingredient => ({ id, name, emoji, unit, category, priceUsd, kg, allergens, aliases, packSize });

export const INGREDIENTS: Ingredient[] = [
  ing('spinach', 'baby spinach', '🥬', 'bag', 'produce', 3.49, 0.2, [], ['spinach', 'greens']),
  ing('cooked-rice', 'cooked rice', '🍚', 'cup', 'grains', 0.6, 0.2, [], ['leftover rice', 'rice']),
  ing('banana', 'ripe bananas', '🍌', 'each', 'produce', 0.3, 0.12, [], ['banana', 'bananas'], 6),
  ing('chicken-thighs', 'chicken thighs', '🍗', 'piece', 'protein', 1.25, 0.15, [], ['chicken', 'chicken thigh'], 6),
  ing('greek-yogurt', 'Greek yogurt', '🥛', 'cup', 'dairy', 1.4, 0.24, ['dairy'], ['yogurt', 'yoghurt'], 4),
  ing('tomato', 'tomatoes', '🍅', 'each', 'produce', 0.75, 0.15, [], ['tomato'], 4),
  ing('bell-pepper', 'red bell pepper', '🫑', 'each', 'produce', 1.29, 0.17, [], ['pepper', 'peppers', 'bell pepper', 'capsicum']),
  ing('milk', 'milk', '🥛', 'cup', 'dairy', 0.28, 0.24, ['dairy'], ['whole milk'], 16),
  ing('egg', 'eggs', '🥚', 'each', 'protein', 0.33, 0.05, ['egg'], ['egg', 'eggs'], 12),
  ing('tortilla', 'flour tortillas', '🫓', 'each', 'bakery', 0.4, 0.05, ['gluten'], ['tortillas', 'wraps'], 8),
  ing('cheddar', 'cheddar', '🧀', 'cup', 'dairy', 1.6, 0.11, ['dairy'], ['cheese', 'cheddar cheese'], 2),
  ing('onion', 'onions', '🧅', 'each', 'produce', 0.6, 0.15, [], ['onion'], 3),
  ing('garlic', 'garlic', '🧄', 'clove', 'produce', 0.08, 0.005, [], ['garlic clove'], 10),
  ing('pasta', 'penne pasta', '🍝', 'box', 'grains', 1.79, 0.45, ['gluten'], ['pasta', 'penne', 'spaghetti']),
  ing('chickpeas', 'chickpeas', '🥫', 'can', 'pantry', 1.19, 0.4, [], ['garbanzo beans', 'chickpea']),
  ing('coconut-milk', 'coconut milk', '🥥', 'can', 'pantry', 2.29, 0.4, [], ['coconut cream']),
  ing('lemon', 'lemons', '🍋', 'each', 'produce', 0.69, 0.1, [], ['lemon'], 3),
  ing('potato', 'potatoes', '🥔', 'each', 'produce', 0.5, 0.2, [], ['potato'], 5),
  ing('butter', 'butter', '🧈', 'tbsp', 'dairy', 0.15, 0.014, ['dairy'], [], 32),
  ing('flour', 'flour', '🌾', 'cup', 'pantry', 0.25, 0.12, ['gluten'], ['all-purpose flour'], 16),
  ing('sugar', 'sugar', '🍬', 'cup', 'pantry', 0.35, 0.2, [], ['brown sugar'], 8),
  ing('soy-sauce', 'soy sauce', '🫙', 'tbsp', 'pantry', 0.1, 0.015, ['soy', 'gluten'], ['soy'], 30),
  ing('frozen-peas', 'frozen peas', '🫛', 'cup', 'frozen', 0.7, 0.15, [], ['peas'], 3),
  ing('cucumber', 'cucumber', '🥒', 'each', 'produce', 0.89, 0.3, [], ['cucumbers']),
  ing('parmesan', 'parmesan', '🧀', 'cup', 'dairy', 2.5, 0.1, ['dairy'], ['parmigiano'], 2),
  ing('peanut-butter', 'peanut butter', '🥜', 'tbsp', 'pantry', 0.12, 0.016, ['peanut'], ['peanuts', 'peanut'], 28),
  ing('rice-noodles', 'rice noodles', '🍜', 'pack', 'grains', 2.49, 0.4, [], ['noodles']),
  ing('mushrooms', 'mushrooms', '🍄', 'pack', 'produce', 2.99, 0.23, [], ['mushroom']),
  ing('arborio-rice', 'arborio rice', '🍚', 'cup', 'grains', 1.1, 0.2, [], ['risotto rice'], 4),
  ing('oats', 'rolled oats', '🥣', 'cup', 'grains', 0.3, 0.09, ['gluten'], ['oatmeal', 'oat'], 10),
  ing('sesame-oil', 'sesame oil', '🫙', 'tbsp', 'pantry', 0.2, 0.014, ['sesame'], [], 20),
  ing('cilantro', 'fresh cilantro', '🌿', 'bunch', 'produce', 1.29, 0.05, [], ['coriander', 'herbs']),
  ing('ginger', 'fresh ginger', '🫚', 'knob', 'produce', 0.99, 0.05, [], ['ginger root']),
  ing('feta', 'feta', '🧀', 'cup', 'dairy', 2.2, 0.15, ['dairy'], ['feta cheese'], 2),
  ing('bread', 'sourdough bread', '🍞', 'slice', 'bakery', 0.35, 0.04, ['gluten'], ['bread', 'toast'], 12)
];

export const INGREDIENT_BY_ID = new Map(INGREDIENTS.map(i => [i.id, i]));

/** Map free speech ("leftover rice", "Peppers") to an ingredient, or null. */
export function findIngredient(text: string): Ingredient | null {
  const q = text.toLowerCase().trim().replace(/^(some|the|a|an|our|my)\s+/, '');
  if (!q) return null;
  for (const i of INGREDIENTS) if (i.id === q || i.name.toLowerCase() === q || i.aliases.includes(q)) return i;
  for (const i of INGREDIENTS) {
    const words = [i.name.toLowerCase(), ...i.aliases];
    if (words.some(w => q.includes(w) || (w.length > 3 && w.includes(q)))) return i;
  }
  return null;
}

export interface RecipeIngredient { id: string; qty: number }
export interface RecipeStep { text: string; timerSeconds?: number; tip?: string }
export interface Recipe {
  id: string;
  title: string;
  emoji: string;
  gradient: [string, string];
  minutes: number;
  servings: number;
  meal: 'dinner' | 'breakfast' | 'snack';
  kidFriendly: boolean;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
}

export const RECIPES: Recipe[] = [
  {
    id: 'spinach-chickpea-curry', title: 'Spinach & Chickpea Coconut Curry', emoji: '🍛', gradient: ['#f59e0b', '#b45309'],
    minutes: 30, servings: 4, meal: 'dinner', kidFriendly: true,
    ingredients: [{ id: 'spinach', qty: 1 }, { id: 'chickpeas', qty: 1 }, { id: 'coconut-milk', qty: 1 }, { id: 'tomato', qty: 2 }, { id: 'onion', qty: 1 }, { id: 'garlic', qty: 3 }, { id: 'cooked-rice', qty: 3 }, { id: 'ginger', qty: 1 }, { id: 'cilantro', qty: 1 }],
    steps: [
      { text: 'Dice one onion and mince three cloves of garlic.' },
      { text: 'Warm a splash of oil in a deep pan over medium heat and cook the onion until soft and golden.', timerSeconds: 360 },
      { text: 'Add the garlic, grated ginger and one tablespoon of curry powder. Stir for one minute until it smells amazing.', timerSeconds: 60 },
      { text: 'Add two chopped tomatoes, the drained chickpeas and the coconut milk. Simmer gently.', timerSeconds: 600, tip: 'Mash a few chickpeas against the pan to thicken the sauce.' },
      { text: 'Stir in the spinach a handful at a time until it wilts. Season with salt and a squeeze of lemon.' },
      { text: 'Warm the leftover rice with a splash of water, serve the curry on top and scatter over the cilantro.' }
    ]
  },
  {
    id: 'rescue-fried-rice', title: 'Rescue Egg Fried Rice', emoji: '🍳', gradient: ['#facc15', '#ca8a04'],
    minutes: 15, servings: 4, meal: 'dinner', kidFriendly: true,
    ingredients: [{ id: 'cooked-rice', qty: 3 }, { id: 'egg', qty: 3 }, { id: 'bell-pepper', qty: 1 }, { id: 'onion', qty: 1 }, { id: 'soy-sauce', qty: 2 }, { id: 'frozen-peas', qty: 1 }],
    steps: [
      { text: 'Dice the bell pepper and the onion. Beat three eggs in a bowl.' },
      { text: 'Scramble the eggs in a hot oiled pan, then slide them onto a plate.', timerSeconds: 90 },
      { text: 'Stir-fry the onion, pepper and peas on high heat.', timerSeconds: 180 },
      { text: 'Add the cold leftover rice, press it flat and let it crisp before stirring.', timerSeconds: 240, tip: 'Day-old rice fries better than fresh rice.' },
      { text: 'Fold the eggs back in with two tablespoons of soy sauce and serve.' }
    ]
  },
  {
    id: 'lemon-chicken-traybake', title: 'Lemon Garlic Chicken Traybake', emoji: '🍋', gradient: ['#fde047', '#65a30d'],
    minutes: 50, servings: 4, meal: 'dinner', kidFriendly: true,
    ingredients: [{ id: 'chicken-thighs', qty: 6 }, { id: 'lemon', qty: 2 }, { id: 'garlic', qty: 4 }, { id: 'potato', qty: 4 }, { id: 'bell-pepper', qty: 1 }],
    steps: [
      { text: 'Heat the oven to 220 degrees Celsius, or 425 Fahrenheit.' },
      { text: 'Cut the potatoes into wedges and the pepper into strips. Spread them on a tray with the chicken thighs.' },
      { text: 'Squeeze over two lemons, add four smashed garlic cloves, olive oil, salt and pepper. Toss everything.' },
      { text: 'Roast until the chicken skin is crisp and golden.', timerSeconds: 2400, tip: 'Chicken is done at 74 degrees Celsius, or 165 Fahrenheit, inside.' },
      { text: 'Rest for five minutes, then serve with the pan juices.', timerSeconds: 300 }
    ]
  },
  {
    id: 'chicken-quesadillas', title: 'Chicken & Pepper Quesadillas', emoji: '🌮', gradient: ['#fb923c', '#dc2626'],
    minutes: 20, servings: 4, meal: 'dinner', kidFriendly: true,
    ingredients: [{ id: 'chicken-thighs', qty: 3 }, { id: 'tortilla', qty: 6 }, { id: 'cheddar', qty: 1.5 }, { id: 'bell-pepper', qty: 1 }, { id: 'greek-yogurt', qty: 1 }],
    steps: [
      { text: 'Slice the chicken thighs thinly and season with cumin, paprika and salt.' },
      { text: 'Cook the chicken and sliced pepper in a hot pan until browned.', timerSeconds: 480 },
      { text: 'Fill each tortilla with chicken, peppers and cheddar, then fold it in half.' },
      { text: 'Toast the quesadillas two minutes per side until the cheese melts.', timerSeconds: 240 },
      { text: 'Serve with the Greek yogurt as a cool dip.', tip: 'Greek yogurt is a great stand-in for sour cream.' }
    ]
  },
  {
    id: 'spinach-shakshuka', title: 'Spinach Shakshuka', emoji: '🍅', gradient: ['#ef4444', '#7f1d1d'],
    minutes: 25, servings: 4, meal: 'dinner', kidFriendly: false,
    ingredients: [{ id: 'egg', qty: 5 }, { id: 'tomato', qty: 4 }, { id: 'bell-pepper', qty: 1 }, { id: 'onion', qty: 1 }, { id: 'spinach', qty: 0.5 }, { id: 'garlic', qty: 2 }, { id: 'bread', qty: 4 }, { id: 'feta', qty: 0.5 }],
    steps: [
      { text: 'Soften the sliced onion and pepper in olive oil.', timerSeconds: 300 },
      { text: 'Add garlic, cumin and paprika, then the chopped tomatoes. Simmer into a thick sauce.', timerSeconds: 600 },
      { text: 'Wilt in the spinach, then make five wells and crack an egg into each.' },
      { text: 'Cover and cook until the whites set and the yolks are still soft.', timerSeconds: 360 },
      { text: 'Serve straight from the pan with toasted bread.' }
    ]
  },
  {
    id: 'tomato-spinach-pasta', title: 'Creamy Tomato Spinach Pasta', emoji: '🍝', gradient: ['#f87171', '#9a3412'],
    minutes: 20, servings: 4, meal: 'dinner', kidFriendly: true,
    ingredients: [{ id: 'pasta', qty: 1 }, { id: 'tomato', qty: 3 }, { id: 'spinach', qty: 0.5 }, { id: 'garlic', qty: 3 }, { id: 'milk', qty: 1 }, { id: 'parmesan', qty: 0.5 }],
    steps: [
      { text: 'Boil the pasta in well-salted water.', timerSeconds: 600 },
      { text: 'Meanwhile, cook the garlic in olive oil for a minute, then add the chopped tomatoes.', timerSeconds: 300 },
      { text: 'Pour in the milk and simmer until it thickens slightly.', timerSeconds: 180 },
      { text: 'Stir in the spinach and parmesan, then toss with the drained pasta.' }
    ]
  },
  {
    id: 'chicken-tzatziki-bowls', title: 'Chicken Tzatziki Rice Bowls', emoji: '🥙', gradient: ['#34d399', '#065f46'],
    minutes: 25, servings: 4, meal: 'dinner', kidFriendly: true,
    ingredients: [{ id: 'chicken-thighs', qty: 4 }, { id: 'greek-yogurt', qty: 1 }, { id: 'cucumber', qty: 1 }, { id: 'lemon', qty: 1 }, { id: 'cooked-rice', qty: 2 }, { id: 'garlic', qty: 1 }],
    steps: [
      { text: 'Season the chicken with oregano, lemon zest and salt, then pan-fry until cooked through.', timerSeconds: 720 },
      { text: 'Grate the cucumber, squeeze out the water and mix it with yogurt, garlic and lemon juice.' },
      { text: 'Warm the leftover rice.', timerSeconds: 120 },
      { text: 'Slice the chicken and build bowls: rice, chicken, a big spoon of tzatziki.' }
    ]
  },
  {
    id: 'banana-oat-pancakes', title: 'Banana Oat Pancakes', emoji: '🥞', gradient: ['#fcd34d', '#a16207'],
    minutes: 20, servings: 4, meal: 'breakfast', kidFriendly: true,
    ingredients: [{ id: 'banana', qty: 3 }, { id: 'egg', qty: 2 }, { id: 'flour', qty: 1 }, { id: 'milk', qty: 1 }, { id: 'oats', qty: 0.5 }],
    steps: [
      { text: 'Mash three ripe bananas in a big bowl.' },
      { text: 'Whisk in two eggs and a cup of milk, then fold in the flour, oats and a pinch of baking powder.' },
      { text: 'Cook small pancakes on a buttered pan until bubbles appear, then flip.', timerSeconds: 150 },
      { text: 'Serve warm with yogurt or a drizzle of honey.' }
    ]
  },
  {
    id: 'banana-bread', title: 'Brown-Butter Banana Bread', emoji: '🍞', gradient: ['#d97706', '#78350f'],
    minutes: 70, servings: 8, meal: 'snack', kidFriendly: true,
    ingredients: [{ id: 'banana', qty: 3 }, { id: 'flour', qty: 2 }, { id: 'sugar', qty: 0.75 }, { id: 'butter', qty: 8 }, { id: 'egg', qty: 2 }],
    steps: [
      { text: 'Heat the oven to 175 degrees Celsius, or 350 Fahrenheit, and line a loaf tin.' },
      { text: 'Melt the butter until it smells nutty and turns golden brown.', timerSeconds: 240 },
      { text: 'Mash the bananas, then mix in the butter, sugar, eggs, flour and a teaspoon of baking soda.' },
      { text: 'Bake until a skewer comes out clean.', timerSeconds: 3300 }
    ]
  },
  {
    id: 'banana-yogurt-smoothie', title: 'Banana Yogurt Smoothies', emoji: '🥤', gradient: ['#f9a8d4', '#be185d'],
    minutes: 5, servings: 4, meal: 'breakfast', kidFriendly: true,
    ingredients: [{ id: 'banana', qty: 2 }, { id: 'greek-yogurt', qty: 1 }, { id: 'milk', qty: 2 }, { id: 'oats', qty: 0.25 }],
    steps: [
      { text: 'Add the bananas, yogurt, milk and oats to a blender.' },
      { text: 'Blend until smooth and pour into four glasses.', timerSeconds: 45 }
    ]
  },
  {
    id: 'peanut-sesame-noodles', title: 'Peanut Sesame Noodles', emoji: '🥜', gradient: ['#a16207', '#422006'],
    minutes: 15, servings: 4, meal: 'dinner', kidFriendly: true,
    ingredients: [{ id: 'rice-noodles', qty: 1 }, { id: 'peanut-butter', qty: 4 }, { id: 'soy-sauce', qty: 2 }, { id: 'sesame-oil', qty: 1 }, { id: 'bell-pepper', qty: 1 }, { id: 'spinach', qty: 0.5 }],
    steps: [
      { text: 'Cook the noodles and rinse them in cold water.', timerSeconds: 300 },
      { text: 'Whisk peanut butter, soy sauce, sesame oil and warm water into a sauce.' },
      { text: 'Toss the noodles with the sauce, sliced pepper and spinach.' }
    ]
  },
  {
    id: 'mushroom-risotto', title: 'Mushroom Risotto', emoji: '🍄', gradient: ['#a8a29e', '#44403c'],
    minutes: 40, servings: 4, meal: 'dinner', kidFriendly: false,
    ingredients: [{ id: 'arborio-rice', qty: 1.5 }, { id: 'mushrooms', qty: 1 }, { id: 'onion', qty: 1 }, { id: 'parmesan', qty: 0.5 }, { id: 'butter', qty: 2 }],
    steps: [
      { text: 'Brown the mushrooms in butter and set them aside.', timerSeconds: 360 },
      { text: 'Soften the onion, toast the rice, then add hot stock a ladle at a time, stirring.', timerSeconds: 1080 },
      { text: 'Stir in the mushrooms, parmesan and a knob of butter.' }
    ]
  }
];

export const RECIPE_BY_ID = new Map(RECIPES.map(r => [r.id, r]));

export function findRecipe(text: string): Recipe | null {
  const q = text.toLowerCase().trim();
  if (!q) return null;
  const exact = RECIPE_BY_ID.get(q);
  if (exact) return exact;
  let best: Recipe | null = null;
  let bestHits = 0;
  for (const r of RECIPES) {
    const words = r.title.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length > 3);
    const hits = words.filter(w => q.includes(w)).length;
    if (hits > bestHits) { best = r; bestHits = hits; }
  }
  return best;
}

export interface Member { name: string; age?: number; allergies: string[]; dislikes: string[] }
export interface Household { name: string; members: Member[]; notes: string[] }

export const DEMO_HOUSEHOLD: Household = {
  name: 'The Rivera household',
  members: [
    { name: 'Maya', allergies: [], dislikes: [] },
    { name: 'Sam', allergies: [], dislikes: [] },
    { name: 'Leo', age: 8, allergies: ['peanut'], dislikes: [] },
    { name: 'Ava', age: 5, allergies: [], dislikes: [] }
  ],
  notes: ['Weeknight dinners should take under 45 minutes.']
};

// [ingredient id, qty, days until it expires (null = shelf stable)]
export const DEMO_PANTRY: Array<[string, number, number | null]> = [
  ['spinach', 1, 1],
  ['cooked-rice', 3, 1],
  ['banana', 4, 1],
  ['chicken-thighs', 6, 2],
  ['greek-yogurt', 2, 2],
  ['tomato', 5, 3],
  ['bell-pepper', 2, 3],
  ['milk', 6, 4],
  ['egg', 9, 12],
  ['tortilla', 8, 6],
  ['cheddar', 2, 14],
  ['onion', 3, 20],
  ['garlic', 10, 25],
  ['pasta', 1, null],
  ['chickpeas', 2, null],
  ['coconut-milk', 1, null],
  ['lemon', 3, 10],
  ['potato', 5, 18],
  ['butter', 16, 30],
  ['flour', 8, null],
  ['sugar', 4, null],
  ['soy-sauce', 20, null],
  ['oats', 6, null],
  ['bread', 6, 4]
];

/** Rough average used to translate food weight into avoided emissions (kg CO2e per kg of food not wasted). */
export const CO2E_PER_KG_FOOD = 2.5;
