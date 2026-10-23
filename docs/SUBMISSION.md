# Sous: Devpost submission (paste-ready)

> Fill in the two `<...>` placeholders (video URL, and the contribution URL if you enter Open Source). Everything else is ready to paste.

---

## Project name
**Sous**

## Tagline / elevator pitch (Devpost limit: 200 chars)
Alexa+ kitchen agent that keeps everyone at the table safe and fed: dinner from food about to expire, allergy and diet risks blocked in code, groceries ordered only after a yes.

## Short summary (use where a longer summary is allowed)
Sous is a self-hosted MCP server (spec 2025-11-25, Streamable HTTP) that turns Alexa+ on an Echo Show into a kitchen agent for the whole family, built on one promise: **everyone at the table is safe and fed, and good food doesn't go in the bin.** It plans dinner around food that's about to expire. It removes recipes that clash with a child's food allergy or a grandparent's low-sodium diet, in deterministic code. If someone describes a severe allergic reaction, it gives a fixed emergency script. It keeps the weekly grocery budget and orders only after an explicit "yes". It cooks with you hands-free on interactive MCP Apps cards, and it shows the dollars and CO2e you rescued. 44 MCP tools, 254 automated tests, live at https://sous-alexa.vercel.app.

---

## About the project (full description)

### Inspiration
Dinner is a safety decision, a money decision and a waste decision, made every day around 6 p.m. with your hands full.

- **Food allergies.** More than **33 million people in the US live with a food allergy, about 1 in 13 children** ([FARE National Indicator Report](https://www.foodallergy.org/resources/national-indicator-report-food-allergy)), and FARE reports that a food allergy reaction sends someone to the emergency room **every 10 seconds** ([FARE](https://www.foodallergy.org/)). For those families, one wrong ingredient can mean an emergency room visit.
- **Older family members' diets.** **47.7% of US adults have high blood pressure, rising to 71.6% of adults 60 and older** ([CDC NCHS Data Brief 511](https://www.cdc.gov/nchs/products/databriefs/db511.htm)). In multigenerational homes, the same pot has to work for a grandparent on a low-sodium diet and a kid who only eats pasta.
- **Tight budgets, wasted food.** **13.5% of US households, about 18 million, were food insecure at some point in 2023** ([USDA ERS, ERR-337](https://ers.usda.gov/sites/default/files/_laserfiche/publications/109896/ERR-337.pdf)). Meanwhile the USDA estimates that **30–40% of the US food supply is wasted**. ReFED's 2025 report puts consumer food waste at **~35 million tons and $261 billion a year, nearly $800 per person**, and surplus food drives roughly **4% of US greenhouse-gas emissions**.

These are often the same families at the same moment. Nobody can hold in their head what's expiring, who can't eat what, and what's left in the budget while a toddler pulls at their sleeve. That is a coordination failure, not a moral one. Coordination is exactly what an agent with memory and tools is good at.

The kitchen is where voice belongs. Amazon's own Alexa+ add-on design guide names kitchens as a core context, with customers "often multitasking, in kitchens, living rooms, and cars." So we built Sous: the agent between your fridge, your family's needs and Alexa+.

### What it does
Sous is an **Alexa+ add-on implemented as a self-hosted MCP server**. Alexa+ (or any MCP client) calls its tools. On screen devices, Sous renders **MCP Apps** views: interactive cards and carousels on the Echo Show.

A typical evening with the demo household, the Riveras (Leo, 8, is allergic to peanuts; Ava, 5, won't eat mushrooms):

1. **"Alexa, what should we cook tonight?"** `meal_suggest` ranks recipes by a *use-it-up score*:
   - each ingredient is weighted by how close it is to expiry (today 6, tomorrow 5, two days 3, three days 2, four days 1), scaled by how much of that at-risk stock the recipe clears;
   - every missing ingredient costs points, and long recipes cost a little too;
   - a recipe that contains a member's allergen or dislike is **set aside, with the reason shown**.

   The Echo Show shows a carousel of cards like *"Spinach & Chickpea Coconut Curry: uses baby spinach and cooked rice (expire tomorrow)"*, each with the dollar value it rescues. Peanut Sesame Noodles is **removed**, and the card says why: "Leo is allergic to peanuts."
2. **"Remember Ava doesn't like mushrooms."** `household_memory` stores it, and it persists across sessions and restarts.
3. **"Add what we're missing to the cart."** (or **"Plan dinners for the next three nights"**, which chains `meal_suggest` → `meal_plan_set` → `shopping_cart_build`). `shopping_cart_build` compares the recipes with the pantry and rounds each item up to a whole pack. It returns an itemized cart from a simulated Amazon Fresh catalog and a `cartToken`.
4. **"Yes, place the order."** `shopping_checkout` will **only** place an order with that token *and* `confirmed=true`. Without confirmation, it returns a `followUp` asking for it. Carts expire after 30 minutes, so prices can't go stale. Replaying a placed cart returns the same order and never a second one. The purchased groceries go straight into the pantry. The model cannot buy anything on its own.
5. **"Let's cook the first one." / "Next step." / "Set a timer for 10 minutes."** `cook_start`, `cook_step` and `timer_set` run a hands-free cook mode. Each step gets a giant-type card, with step dots, an ingredient checklist and live timers.
6. When you finish, the ingredients you used are deducted from the pantry. `impact_report` then shows **dollars rescued, kilograms of food saved, kg CO2e avoided** and a yearly projection.
7. **"What can I make with yogurt, peppers and tortillas?"** `chef_improvise` asks **Amazon Bedrock** for a new recipe. A *deterministic* allergen guard checks the generated recipe before it is shown. If it contains an allergen, it is rejected.

**Safety for every person at the table**
- **"Leo's lips are swelling after dinner."** `allergy_emergency` recognizes signs of a severe allergic reaction: swelling of the lips, tongue or throat, trouble breathing, wheezing, or hives after eating. It handles negations such as "no trouble breathing". It answers with a **fixed script written in code, never by a model**: call 911 now, and use the prescribed epinephrine auto-injector as directed. Milder signs get a fixed "watch closely; if there's any swelling or trouble breathing, call 911" line. Sous does not diagnose or reassure, and every incident is logged for the family.
- **"Does this granola have anything Leo can't eat?"** `allergen_scan` reads a product's ingredient label, including "may contain" and shared-facility warnings, and names the household member it affects.
- **"Grandpa needs low-sodium meals."** `diet_profile` stores per-member diet needs (low-sodium, diabetes-friendly, vegetarian, soft-foods, dairy-free, gluten-free) across sessions. From then on `meal_suggest` sets aside recipes that clash, with the reason shown.
- **Other safety tools:**
  - `meal_safety_check` gives a per-person verdict for any recipe, covering allergens, diet and dislikes.
  - `cross_contact_tips` explains how to keep a meal allergy-safe: separate boards and utensils, cook the allergy-safe dish first, and re-read labels.
  - `cooking_temp` gives USDA safe minimum internal temperatures, for example poultry at 165°F (74°C).
  - `food_safety_check` gives conservative storage windows and never declares food "safe".
  - `substitute_ingredient` only offers swaps that avoid every household allergen.

**Budget and community**
- `budget_set` and `budget_status` track a weekly grocery budget against placed orders. `budget_meal_plan` picks use-it-up dinners that fit it, and `price_check` answers "how much is feta?".
- `leftovers_log` tracks cooked leftovers against the USDA 3–4 day window, and `leftovers_ideas` turns them into tomorrow's lunch.
- `donate_surplus` finds food you won't get to before it expires and prepares a hand-off to a community fridge (simulated listings in this build), so it feeds a neighbor instead of the bin.
- `waste_log` and `waste_insights` keep the impact numbers honest: what still went in the bin, and which categories you waste most.

**Planning and household helpers**
- **Recipes and plans:** `recipe_search`, `recipe_details` (scaled servings plus an allergen check), `meal_plan_get` and `meal_plan_clear`.
- **Cooking:** `unit_convert`, `timer_list`, `timer_cancel` and `cook_status`.
- **Shopping:** `shopping_list` (it feeds the cart), `order_history`, `reorder_staples` (through the same purchase gate) and `delivery_slots`.
- **Household:** `household_members`, `pantry_add_receipt` (paste a receipt and the pantry updates) and `daily_brief` (what to use today).

### How it works (architecture)
```
 Voice / touch
     │
 Alexa+ (or the Sous Echo Show simulator)  ← agent: Amazon Bedrock Converse API with tool use
     │  MCP 2025-11-25 over Streamable HTTP (POST/GET/DELETE /mcp, Mcp-Session-Id)
     ▼
 Sous MCP server (Node.js + TypeScript, @modelcontextprotocol/sdk)
   ├─ 44 tools in modules: core kitchen · safety (allergy emergency, labels, diets, temps) · budget & community · planning · household
   ├─ ui:// resources (MCP Apps, text/html;profile=mcp-app) → Echo Show cards & carousels
   ├─ deterministic guards: allergen filter, purchase confirmation token, quantity/unit sanity
   └─ household state persisted to disk (state across sessions)
```

**MCP implementation details**
- **Protocol 2025-11-25** over **Streamable HTTP**, with session management through `Mcp-Session-Id`.
- All 44 tools declare a `title`, a Zod-generated `inputSchema`, an **`outputSchema`**, **icons** (new in 2025-11-25, SEP-973), and behavior **annotations**:
  - `pantry_check`, `meal_suggest` and `impact_report` are `readOnlyHint`;
  - `shopping_checkout` is `openWorldHint` + `idempotentHint`, because replaying a token never orders twice;
  - `chef_improvise` is `openWorldHint`, because it calls Bedrock.
- Resources `sous://household`, `sous://pantry` and `sous://impact`, a resource template `sous://recipe/{id}`, and prompts `plan_tonight` and `use_it_up_week`.
- Every result carries a short voice-safe `text` block **and** `structuredContent`. The structured envelope is `{ ok, tool, speech, view, data, followUp }`. `followUp` hands the agent the *exact* next call for confirmations, so "yes" on the next turn never depends on the model reconstructing arguments from speech.
- **MCP Apps.** UI-bearing tools link a `ui://sous/<view>.html` resource through `_meta.ui.resourceUri`. There are six views: pantry, meals carousel, cook mode, cart/checkout, impact, and a full-screen allergy emergency alert. They speak the MCP Apps postMessage protocol: `ui/initialize` → `ui/notifications/initialized` → `ui/notifications/tool-input` / `tool-result`. Buttons inside a card ("Cook this", "Add to cart", "Next") send `tools/call` back through the host, so touch and voice drive the same tools.
- **Server `instructions`** tell the agent how to behave: speak the tool's text, ask the follow-up prompt, and never place an order without an explicit yes.
- An **Agent Skill** (`skills/sous-kitchen/SKILL.md`) packages the same conversation contract for any agent that supports Agent Skills.

**The Alexa+ simulation.** Real Alexa+ add-on testing (the MCP Toolkit's web simulator and inspector) is in Private Preview. We therefore built an **Echo Show-style simulator** (`/device`) that acts as an MCP Apps host and runs the agent loop:
- Voice in (Web Speech API), voice out (speech synthesis), the Alexa light bar, and a sandboxed iframe for MCP Apps views.
- A live **MCP trace drawer** shows every `tools/call` with its arguments and latency, so judges can see the protocol working.
- The agent's brain is **Amazon Bedrock**, using the Converse API with tool use. Sous's MCP tool list is mapped to Bedrock `toolSpec`s. The loop runs `converse` → `toolUse` → MCP `tools/call` → `toolResult` → final spoken answer.
- With no AWS credentials, a deterministic intent router takes over, so the demo runs anywhere.

### Safety and trust design
These rules live in deterministic, tested code, not in a prompt. A model can phrase things, but it cannot override them.
- **Allergy-emergency red flag.** `allergy_emergency` matches the signs of a severe reaction, with negation handling. It returns a fixed escalation script: call 911, and use the prescribed epinephrine auto-injector as directed. The text is a constant in code, so no model writes it, and the server `instructions` tell Alexa to speak it as written.
- **Allergen guard everywhere.** Recipes containing a household member's allergen are excluded before ranking, and the reason is shown ("Leo is allergic to peanuts"). The same guard runs on:
  - LLM-generated recipes from `chef_improvise`;
  - substitutes;
  - scanned product labels (`allergen_scan`), including "may contain" warnings.
- **Diet needs as hard filters.** `diet_profile` plugs into the planner through a recipe-filter hook, so a grandparent's low-sodium need removes recipes exactly as an allergy does, and says why.
- **Food safety without false reassurance.**
  - `food_safety_check` never says food is safe. It gives the date on record, the general fridge window and "when in doubt, throw it out", and raw meat past its date is always a discard.
  - `cooking_temp` returns USDA safe minimum internal temperatures.
  - `cross_contact_tips` covers the prep steps that keep an allergy-safe meal safe.
- **Confirm-before-buy, enforced twice.** Every purchase path (`shopping_checkout`, and `reorder_staples` through it) goes through the same gate.
  - The server requires the `cartToken` from the cart the user just saw plus `confirmed=true`, and it rejects stale (over 30 minutes) or unknown carts.
  - The agent host adds a second gate. If the model calls `shopping_checkout` with `confirmed=true` but the user's latest turn contained no explicit consent, the host downgrades the call to `confirmed=false`. Sous then asks instead of buying. A test proves this.
  - Orders are clearly labeled *simulated*.
- **Grounded answers.** Expiry dates, prices and quantities come from the pantry and catalog, never from the model. Impact uses a fixed, documented factor of 2.5 kg CO2e per kg of food rescued, and it reports food that still went to waste.

### Potential impact
- **Who it serves first:**
  - the **33M+ Americans with food allergies** and their families (FARE);
  - **multigenerational households** cooking for a grandparent with high blood pressure, which affects 71.6% of adults 60 and older (CDC);
  - the **~18 million food-insecure households** for whom every wasted dollar matters (USDA ERS).

  These overlap with almost every household that wastes food, which ReFED puts at nearly **$800 per person a year**.
- **Safety value.** The family's allergy and diet rules are applied to every suggestion, substitute, improvised recipe and scanned label. A description of a severe reaction gets an immediate emergency script instead of a chatty answer.
- **Money and waste.** Rescuing even a quarter of a family of four's waste is worth hundreds of dollars a year. Sous measures it in-app: dollars and kilograms rescued and CO2e avoided, plus the food that still went to waste, so the number can go down as well as up.
- **Community.** Surplus food is routed to a neighbor or community fridge before it expires (simulated listings in this build).
- **Why Alexa+:** it fits naturally upstream of Alexa+'s existing Amazon Fresh shopping. Sous decides *what* to buy, and *whether it's safe for everyone*, based on what you already have. It also fits the kitchen, where voice-first and glanceable screens matter most. The same MCP server works with any MCP client (Claude, ChatGPT, VS Code), so it isn't locked to one host.
- **Path beyond the hackathon:**
  - OAuth 2.1 + PKCE account linking (the Alexa+ checklist);
  - real grocery catalogs, and real food-bank and community-fridge directories;
  - dietitian-reviewed diet rules;
  - receipt and barcode pantry import;
  - Fire TV and Echo Hub layouts, which the MCP Apps views already scale to.

### Quality of the idea: the judges' creative signals, one by one
| Alexa+ creative signal (from the rules) | How Sous does it |
| --- | --- |
| Agentic workflow that orchestrates across services | "Plan dinners for the next three nights" chains planner → plan → grocery cart in one turn. `budget_meal_plan` and `reorder_staples` combine pantry, budget and store. With Bedrock, the model picks the chain itself. |
| Context-aware, state across sessions | Allergies, diets, dislikes, pantry, plan, budget, leftovers, shopping list and cook progress all persist. A brand-new session still knows Leo's allergy. |
| Purchasing | Token-bound cart, explicit "yes", idempotent replay, a host-side consent gate and budget awareness |
| Media support (cards, carousels) | Five MCP Apps views on Echo Show: recipe carousel, cook-along, cart/receipt, pantry and impact chart |
| MCP Apps | `ui://sous/*.html` (`text/html;profile=mcp-app`) linked from tools; cards call tools back on tap, so voice and touch share one path |
| Agent Skills | `skills/sous-kitchen/SKILL.md` packages the voice contract and workflows for any agent |
| Not a wrapper or single-turn bot | 44 tools over a deterministic domain core (planner, allergen and diet guards, emergency red flag, purchase gate) with 254 automated tests |

### What we built during the submission window
Everything in this repository was built on **23 October 2026**, within the submission window: the MCP server and all tools, the planner and guards, the MCP Apps views, the Echo Show simulator host, the Bedrock agent, the landing page, the tests and the docs. Nothing predates the hackathon.

### How we built it
- Node.js 20+, TypeScript, Express 5, `@modelcontextprotocol/sdk` 1.32 for the server and the agent's client, and Zod 4 for schemas.
- Amazon Bedrock Converse API via `@aws-sdk/client-bedrock-runtime`.
- Vanilla HTML/CSS/JS for MCP Apps views, so each view is a single self-contained file. Three.js for the landing hero.
- **254 Vitest tests**, covering:
  - planner ranking, and allergen, dislike and diet exclusion;
  - the allergy-emergency red flag, including negations, and label scanning with "may contain";
  - cart and checkout: token, expiry, idempotent replay;
  - budget, leftovers, donations, planning and household tools;
  - MCP over real Streamable HTTP;
  - the Bedrock tool loop against a scripted Converse mock;
  - the consent gate that blocks a model-initiated purchase;
  - offline small talk.
- A small **tool registry**, so each module (core, safety, budget, planning, household) registers its tools and voice routes independently. That let us build the modules in parallel.
- AI pair-programming with Claude Code for scaffolding and parallel workstreams.

### Challenges
- **Testing without the real Alexa+ toolkit.** The official web simulator and inspector are behind the Private Preview, so we implemented the MCP Apps host side ourselves, following the spec (stable 2026-01-26).
- **Safety text that helps without diagnosing.** The allergy-emergency script and the food-safety answers are fixed, conservative strings in code. Sous never declares food "safe", and it always errs toward "call 911" or "throw it out".
- **Voice-first purchasing.** We had to make "yes" safe: a token-bound confirmation, plus a `followUp` contract so the agent re-issues the exact call.
- **Serverless MCP.** Streamable HTTP sessions don't survive serverless instances, so the Vercel deployment runs the stateless mode and the simulator's agent uses the SDK's in-memory transport.
- **Designing for a 768×480 base canvas** that scales 1.667× on an Echo Show 15. We had to fit huge type and low content density into it.

### What's next
- Account linking (OAuth 2.1 + PKCE) and a real Amazon Fresh cart handoff.
- Real community-fridge and food-bank directories, and dietitian-reviewed diet rules.
- Receipt and photo pantry capture.
- Shared household plans and allergy profiles across Echo devices and the Alexa app, so a babysitter or grandparent's Echo knows Leo's allergy too.

---

## Built with
`model-context-protocol` · `mcp-apps` · `streamable-http` · `alexa-plus` · `amazon-bedrock` · `aws-sdk-js-v3` · `typescript` · `node.js` · `express` · `zod` · `three.js` · `web-speech-api` · `vitest`

## Tracks and mini challenges
- **Primary track: Alexa+.** Self-hosted MCP server, spec 2025-11-25, Streamable HTTP, plus a simulated Alexa+ experience on an Echo Show (the simulator source is in the repo).
- **Mini challenge: AWS Builder.** Amazon Bedrock (details below and in Product Feedback).
- **Mini challenge: Open Source** (optional, see below).

## AWS Builder: services used and how
1. **Amazon Bedrock Converse API with tool use** is the Alexa+ simulation agent (`src/agent/`). The flow:
   1. The server lists its own MCP tools over Streamable HTTP and converts each `inputSchema` into a Bedrock `toolSpec`.
   2. It calls `ConverseCommand` with the household context and the server instructions as the system prompt.
   3. It executes each `toolUse` as an MCP `tools/call` and feeds back `toolResult` blocks until the model returns the final spoken answer.

   Every call is visible in the MCP trace drawer.

   A **circuit breaker** pauses Bedrock for 5 minutes after an auth, access or model error, and the deterministic engine answers instead. A misconfigured key therefore never makes a voice turn hang.
2. **Amazon Bedrock inside a tool.** `chef_improvise` asks a Bedrock model to invent a recipe from the at-risk ingredients. The output is parsed to JSON and then passes the **deterministic allergen guard** before Sous will show or speak it. If Bedrock is unconfigured or times out, a template recipe is used instead. `structuredContent.data.suggestions[0].engine` records which path ran.
3. **Auth and config.** Configure via `.env`: either a Bedrock API key (`AWS_BEARER_TOKEN_BEDROCK`) or the standard AWS credential chain, plus `AWS_REGION` and `BEDROCK_MODEL_ID` (default: the Amazon Nova Pro inference profile `us.amazon.nova-pro-v1:0`). `SOUS_BEDROCK=auto|off` sets the mode. Each Bedrock call has a hard time budget (`BEDROCK_TIMEOUT_MS`, default 8 s), because a voice turn can't hang. The agent allows at most 4 tool rounds per turn.

## Open Source (optional entry)
- **Repository URL:** https://github.com/johnbosco-j/sous (public, MIT license visible in the About section).
- **GitHub username:** johnbosco-j
- **Contribution URL:** `<https://github.com/johnbosco-j/sous/tree/main/web/device>`. Replace this if you publish the simulator as its own repo.
- **What we did:** we open-sourced a reusable **Echo Show-style MCP Apps host** for Alexa+ add-on developers. It renders any `ui://` view in a sandboxed iframe and implements the host side of the MCP Apps protocol (`ui/initialize`, `tool-input`, `tool-result`, proxied `tools/call`). It adds an Alexa light bar, voice I/O and an MCP trace drawer.
- **Why it matters:** the official Alexa+ simulator is in Private Preview, so most developers have no way to see their add-on's MCP Apps cards on an Echo Show-sized screen. This host lets anyone iterate on views locally.

---

## Product feedback (required, one block per tool)

### 1. Model Context Protocol spec 2025-11-25 + TypeScript SDK (`@modelcontextprotocol/sdk` 1.32)
- **Used for:** the Sous server (tools, resources, `outputSchema`/`structuredContent`, annotations, server `instructions`) and the agent's client, which connects to the server over Streamable HTTP.
- **What worked well:**
  - `StreamableHTTPServerTransport` plus Express gave us sessions (`Mcp-Session-Id`) with very little code.
  - `structuredContent` + `outputSchema` are exactly what a voice agent needs: short speech plus machine-readable data.
  - Tool annotations (`openWorldHint` + `idempotentHint` on checkout, `readOnlyHint` on queries) map naturally to "ask before buying".
- **What needs work:**
  - The spec has moved past 2025-11-25: the 2026-07-28 revision removes protocol sessions. The hackathon says "2025-11-25 or later, once confirmed", and it is unclear which later revisions Alexa+ accepts.
  - Tool input schemas generated from Zod are valid JSON Schema, but they are not directly portable to LLM tool APIs (see Bedrock below). A "portable schema" profile in the spec would help every agent host.
- **Onboarding:** smooth. We used the low-level `Server` API so one tool table emits `inputSchema`, `outputSchema`, annotations, icons and `_meta.ui` uniformly. The SDK's shared types (`Tool`, `CallToolResult`) let our server and our in-process Alexa+ stand-in client share one contract.
- **Would we build with it again?** Yes. It is the cleanest way to make one backend work with Alexa+ and every other agent host.

### 2. MCP Apps extension (`io.modelcontextprotocol/ui`, spec 2026-01-26)
- **Used for:** five Echo Show views (pantry grid, meal carousel, cook mode, cart/checkout, impact chart) linked from tools through `_meta.ui.resourceUri`, served as `text/html;profile=mcp-app`.
- **What worked well:**
  - A single self-contained HTML file per view.
  - Tool results arrive as standard `CallToolResult`s, so the view code is the same data the model sees.
  - `tools/call` from the view lets touch and voice share one code path.
- **What needs work:**
  - Easy-to-miss host rules: `tool-input` must precede `tool-result`, and nothing may be sent before `initialized`.
  - The restrictive default CSP blocks web fonts unless you declare `_meta.ui.csp.resourceDomains`.
  - The deprecated flat `_meta["ui/resourceUri"]` still appears in samples.
- **Onboarding:** the spec is thorough, but there is no tiny "hello view" with no SDK.
- **Would we build with it again?** Yes. Cards and carousels on Echo Show are the difference between a voice bot and a product.

### 3. Alexa+ developer resources (MCP Toolkit docs, MCP add-on design guide, visual foundations)
- **Used for:** design constraints (768×480 base canvas, 1.667× scale on Echo Show 15, low density, inline vs. fullscreen modes), the transport requirement (Streamable HTTP, spec 2025-11-25), and the account-linking checklist we documented as our production path.
- **What worked well:**
  - The design guide is concrete: the canvas size, a 1.6× type scale, and "you can't script what Alexa says, design your data".
  - The checklist for OAuth (401 without `WWW-Authenticate`, RFC 9728 metadata, S256 PKCE) is precise.
- **What needs work:**
  - The MCP Toolkit web simulator and local inspector require Private Preview access, so hackathon builders cannot see their add-on on a real Alexa+ surface.
  - We could not find a statement of which MCP Apps host capabilities Alexa+ supports (view-initiated `tools/call`, `ui/open-link`, display-mode requests) or whether MCP prompts are surfaced.
- **Onboarding:** the docs were easy to read, but the "hello world on a real device" step was not available to us.
- **Would we build with it again?** Yes, especially once the toolkit is open to everyone.

### 4. Amazon Bedrock: Converse API with tool use (`@aws-sdk/client-bedrock-runtime`, AWS SDK for JavaScript v3)
- **Used for:** the Alexa+ simulation agent loop (tool use over MCP tools) and the `chef_improvise` recipe generator.
- **What worked well:**
  - The Converse API's model-agnostic `toolSpec`/`toolUse`/`toolResult` shape maps almost 1:1 onto MCP `tools/list` and `tools/call`. We switch models by changing `BEDROCK_MODEL_ID`.
  - Bedrock API keys (`AWS_BEARER_TOKEN_BEDROCK`) are much simpler for hackathon setups than IAM users.
- **What needs work:**
  - **Schema portability.** Different Bedrock models accept different subsets of JSON Schema in `toolSpec.inputSchema.json`, and we found no single documented portable subset. We strip MCP/Zod schemas down to `type`, `properties`, `required`, `description`, `enum` and `items` before sending them.
  - **Credential errors.** Our cloud dev container had AWS keys in its environment that Bedrock rejected: `UnrecognizedClientException: The security token included in the request is invalid`. The error doesn't say which credential source the SDK used (env keys, profile, or a Bedrock API key). Every voice turn paid a failed round-trip until we added a circuit breaker.
  - **Docs.** We found Python and cURL examples for API-key auth, but no official JavaScript v3 example combining a bearer token with Converse tool use.
  - **Credits.** The hackathon's AWS credit codes ran out on Oct 7, so late joiners had to use their own account or the free tier.
- **Onboarding:** good. Converse is the right abstraction.
- **Would we build with it again?** Yes. Bedrock with MCP is a natural pair for Alexa+ add-ons.

### 5. Web Speech API (simulator voice I/O)
- **Used for:** push-to-talk recognition and spoken replies in the Echo Show simulator.
- **What worked well:** zero-dependency TTS and ASR in Chrome.
- **What needs work:** not available in every Chromium browser (Brave does not expose recognition), so we added a text box and suggestion chips.
- **Would we build with it again?** Yes, for prototyping only. Real Alexa+ replaces it.

---

## Feature requests

| # | Request | Why it matters for Sous | Priority |
|---|---------|------------------------|----------|
| 1 | Open the Alexa+ MCP Toolkit web simulator and local inspector to all hackathon and registered developers, at least in a read-only "render my MCP Apps views" mode | We had to build our own Echo Show host to see our cards; every team is duplicating this | **Critical** |
| 2 | Publish an "MCP Apps on Alexa+" compatibility table: supported host capabilities, display modes, view-initiated `tools/call`, CSP allowances, max view size, prompts support | We could not confirm whether buttons in our cards can call tools on real devices | **Critical** |
| 3 | A purchasing hand-off for add-ons: let an MCP add-on propose a cart that Alexa+ checks out through the customer's Amazon Fresh/Whole Foods account with Alexa's own confirmation UX | Sous decides *what* to buy, and Alexa+ should own *how* to pay. Today we can only simulate checkout | **Important** |
| 4 | Official JS/TS sample: Bedrock Converse tool-use loop over an MCP client (with API-key auth) | It is the glue every Alexa+ and AWS Builder team writes by hand | **Important** |
| 5 | Kitchen-timer and list primitives exposed to add-ons (start an Alexa timer, add to an Alexa shopping list) | Our cook mode re-implements timers that Alexa already has natively | **Important** |
| 6 | Clarify which MCP spec versions after 2025-11-25 Alexa+ accepts (e.g. 2026-07-28 sessionless) | Avoids building against a transport behavior Alexa+ may not support | **Nice-to-have** |
| 7 | Bedrock Converse: publish the portable JSON Schema subset for `toolSpec` (or normalize schemas server-side) | Every MCP → Bedrock bridge must currently guess which keywords each model accepts | **Important** |
| 8 | Bedrock auth errors that name the credential source used (env keys / profile / API key) | We lost time to an `UnrecognizedClientException` from invalid credentials in the environment, with no hint which source the SDK had picked | **Nice-to-have** |

---

## Testing instructions (for judges)

**Try it live, no install:** https://sous-alexa.vercel.app/device (Echo Show simulator; type or tap the suggestion chips, press T for the MCP trace). Landing page: https://sous-alexa.vercel.app. Public MCP endpoint (stateless Streamable HTTP, spec 2025-11-25): `https://sous-alexa.vercel.app/mcp`. Try it with `npx @modelcontextprotocol/inspector`.

```bash
git clone https://github.com/johnbosco-j/sous && cd sous
npm install
npm start                      # http://localhost:8787
```
- **Echo Show simulator:** http://localhost:8787/device. Click the suggestion chips in order, or type or speak (Chrome). Press `t` for the MCP trace drawer.
- **Landing page:** http://localhost:8787/
- **Raw MCP endpoint:** http://localhost:8787/mcp (Streamable HTTP). Try `npx @modelcontextprotocol/inspector`, choose transport "Streamable HTTP", URL `http://localhost:8787/mcp`.
- **Optional Bedrock:** copy `.env.example` to `.env`, then set `AWS_REGION`, `BEDROCK_MODEL_ID`, and either `AWS_BEARER_TOKEN_BEDROCK` or AWS credentials. Without them, the deterministic router and template recipes are used, and the badge in the trace drawer shows `rules`.
- **Health check:** `GET /healthz` reports the protocol version, transport, tool count and Bedrock status.
- **Reset demo data:** the "Reset demo" control in the simulator, or `POST /api/reset`.
- **Tests:** `npm test`
- All demo data is synthetic. Orders are simulated, and nothing is purchased.

## Links
- Repo: https://github.com/johnbosco-j/sous (MIT)
- Live demo: https://sous-alexa.vercel.app/device
- Demo video: `<YouTube URL>`
