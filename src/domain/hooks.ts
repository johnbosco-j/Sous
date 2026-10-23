// Extension points for tool modules that change how recipes are ranked (e.g. diet needs).
import type { Household, Recipe } from './catalog.js';
import type { KitchenState } from './store.js';

/** Return a human reason to set the recipe aside (e.g. "Grandpa needs low sodium"), or null to keep it. */
export type RecipeFilter = (recipe: Recipe, household: Household, state: KitchenState) => string | null;
export const recipeFilters: RecipeFilter[] = [];
export function registerRecipeFilter(fn: RecipeFilter) {
  recipeFilters.push(fn);
}
