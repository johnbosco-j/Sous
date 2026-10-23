---
name: sous-kitchen
description: Run a household kitchen with the Sous MCP server. Use when someone asks what to cook, what is about to expire, wants to cook hands-free step by step, needs groceries ordered, or wants allergies and food preferences remembered. Requires the Sous MCP server (Streamable HTTP at /mcp).
license: MIT
---

# Sous kitchen skill

Sous is a self-hosted MCP server (spec 2025-11-25, Streamable HTTP) that keeps a household's pantry, plans meals around food that is about to expire, guards allergies in code, builds grocery carts, and guides cooking hands-free. This skill tells an agent (Alexa+, Claude, Kiro or any MCP client) how to drive it well by voice.

## Connect

- Endpoint: `http://<host>:8787/mcp` (Streamable HTTP, `Mcp-Session-Id` sessions).
- On a screen device, render the `ui://sous/*.html` resource linked from each tool's `_meta.ui.resourceUri` (MCP Apps, `text/html;profile=mcp-app`).

## Voice rules

1. Speak the tool's `structuredContent.speech` (also the first text block). It is already one to three short sentences.
2. If `structuredContent.followUp` is present, ask its `prompt`. Only when the person clearly agrees on the next turn, call `followUp.tool` with `followUp.arguments` exactly. Do not rebuild the arguments from speech.
3. Never set `shopping_checkout.confirmed=true` unless the person explicitly said yes to that order in their latest turn.
4. Allergies are enforced by Sous in code. Do not filter or "fix" recipes yourself, and never suggest an excluded recipe.

## Workflows

| The person says | Call |
| --- | --- |
| "What should we cook tonight?" | `meal_suggest` (count 3). Read the top pick and the allergy exclusion if present. |
| "What's about to expire?" / "Do we have eggs?" | `pantry_check` (filter `expiring`, or `item`) |
| "Plan dinners for the next three nights" | `meal_suggest` count 3, then `meal_plan_set` with those recipeIds, then `shopping_cart_build` with no args. Ask before ordering. |
| "Add what we're missing to the cart" | `shopping_cart_build` |
| "Yes, place the order" | the pending `followUp` (`shopping_checkout` with `cartToken`, `confirmed: true`) |
| "Let's cook the first one" | `cook_start` with `pick: 1` |
| "Next" / "Back" / "Repeat" / "What do I need?" | `cook_step` with `next` / `back` / `repeat` / `ingredients` |
| "Set a timer" | `timer_set` (no duration while cooking uses the step's time) |
| "Leo is allergic to peanuts" / "Ava doesn't like mushrooms" | `household_memory` remember, kind `allergy` / `dislike` |
| "Surprise me" | `chef_improvise` (Amazon Bedrock, allergen-checked) |
| "How much food have we saved?" | `impact_report` |
| "We bought eggs" / "We're out of milk" | `pantry_update` add / remove |

## Resources and prompts

- `sous://household`, `sous://pantry`, `sous://impact`, `sous://recipe/{id}` (JSON)
- Prompts: `plan_tonight`, `use_it_up_week`
