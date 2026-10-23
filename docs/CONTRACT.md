# Sous: internal build contract (shared by all parallel workers)

Repo root: /home/user/sous   One package, `npm install && npm start` -> http://localhost:8787
- `/mcp`            MCP server, Streamable HTTP, protocol 2025-11-25 (owner: main)
- `/api/converse`   POST {text, sessionId} -> AgentResponse  (Alexa+ simulation agent; owner: main)
- `/api/tool`       POST {name, arguments, sessionId} -> AgentResponse (direct tool call, used by MCP App views via host)
- `/api/state`      GET -> { timers: Timer[], impact: ImpactData, household: Household, bedrock: boolean }
- `/api/reset`      POST -> reseeds demo data
- `/`               web/index.html  landing page (owner: fork "landing")
- `/device`         web/device.html Echo-Show-style Alexa+ simulator host (owner: fork "device")
- static: everything under web/ is served at `/`; ui/ files are NOT served statically, they are MCP resources.

Directory ownership (do not edit outside your area):
- main:    src/**, test/**, package.json, tsconfig.json, README.md, skills/**, data/**
- landing: web/index.html, web/landing/**
- device:  web/device.html, web/device/**, ui/*.html
- docs:    docs/SUBMISSION.md, docs/DEMO_SCRIPT.md, docs/FRICTION_LOG.md, docs/RESEARCH.md

## AgentResponse
{
  speech: string,                 // what Alexa says (speak with speechSynthesis)
  engine: "bedrock" | "rules",    // which brain routed the request
  toolCalls: { name: string, arguments: object, ms: number, ok: boolean }[],   // MCP trace, show in a dev panel
  ui: null | { resourceUri: string, html: string, toolResult: CallToolResult }, // MCP App to render (last tool with a UI)
  timers: Timer[]                 // all active kitchen timers
}
CallToolResult = { content: [{type:"text", text}], structuredContent: Envelope, isError?: boolean }

## Envelope (structuredContent of EVERY tool)
{ ok: boolean, tool: string, speech: string, view?: "meals"|"cook"|"cart"|"pantry"|"impact",
  data: object, followUp?: { prompt: string, tool: string, arguments: object } }

## MCP App views (ui/<view>.html -> resource ui://sous/<view>.html, mimeType text/html;profile=mcp-app)
Self-contained HTML (inline CSS/JS, no external fetches; Google Fonts ok). Dark, Echo-Show-15 landscape (~1280x800) friendly,
big type readable from 3 m. Protocol (subset of MCP Apps / SEP-1865) over window.parent.postMessage, JSON-RPC 2.0:
 1. view -> host  {jsonrpc:"2.0", id:1, method:"ui/initialize", params:{appInfo:{name:"sous-view",version:"1"}, appCapabilities:{}, protocolVersion:"2026-01-26"}}
 2. host -> view  {jsonrpc:"2.0", id:1, result:{protocolVersion:"2026-01-26", hostInfo:{name:"sous-echo-sim",version:"1"}, hostCapabilities:{}, hostContext:{theme:"dark", displayMode:"inline"}}}
 3. view -> host  {jsonrpc:"2.0", method:"ui/notifications/initialized"}
 4. host -> view  {jsonrpc:"2.0", method:"ui/notifications/tool-result", params: CallToolResult}   (may repeat when data refreshes)
 5. view -> host  {jsonrpc:"2.0", id:N, method:"tools/call", params:{name, arguments}}  (buttons, e.g. "Cook this")
    host -> view  {jsonrpc:"2.0", id:N, result: CallToolResult}  and host updates speech/UI from the AgentResponse of /api/tool
 Views must also render if the host sends tool-result without a handshake (be tolerant).

## data shapes per tool
PantryItem { id, name, emoji, qty, unit, category, expiresInDays: number|null, status: "fresh"|"soon"|"urgent"|"expired", valueUsd }
pantry_check  view=pantry  data { items: PantryItem[], expiringSoon: PantryItem[], totalValueUsd, atRiskValueUsd }
pantry_update              data { changed: {name, qty, unit, action:"added"|"used"|"removed"}[], items: PantryItem[] }
Suggestion { recipeId, title, emoji, gradient:[string,string], minutes, servings, kidFriendly: boolean, score,
             uses: {name, expiresInDays}[], missing: {name, qty, unit}[], reason: string, rescueValueUsd }
meal_suggest  view=meals   data { suggestions: Suggestion[], excluded: {title, reason}[], atRisk: {name, expiresInDays}[] }
chef_improvise view=meals  data { suggestions: [Suggestion & {steps: string[], engine: "bedrock"|"template"}], excluded: [], atRisk: [] }
meal_plan_set              data { plan: {day, recipeId, title, emoji}[] }
CartLine { sku, name, emoji, qty, unit, priceUsd, forRecipes: string[] }
shopping_cart_build view=cart data { cartToken, status:"draft", lines: CartLine[], subtotalUsd, deliveryFeeUsd, totalUsd, deliveryWindow, store: "Amazon Fresh (simulated)" }
shopping_checkout   view=cart data { ...same, status:"placed"|"awaiting_confirmation", orderId?, eta? }
CookState { recipeId, title, emoji, gradient, stepIndex, totalSteps, step: {text, timerSeconds?: number, tip?: string},
            ingredients: {name, qty, unit, have: boolean}[], done: boolean, rescued?: {name, valueUsd}[] }
cook_start / cook_step view=cook data CookState
Timer { id, label, endsAt (ISO string), seconds }
timer_set                  data { timers: Timer[] }
household_memory           data { household: Household, changed?: string }
Household { name, members: {name, age?: number, allergies: string[], dislikes: string[]}[], notes: string[] }
ImpactData { rescuedUsd, rescuedKg, co2eKg, mealsCooked, itemsRescued: {name, valueUsd, date}[], week: {day, usd}[], projectionYearUsd }
impact_report view=impact  data ImpactData

## Demo household (synthetic): "The Rivera household"
Maya (parent), Sam (parent), Leo (8, PEANUT allergy), Ava (5, dislikes mushrooms).
Expiring: spinach (1d), cooked rice (1d), ripe bananas (1d), chicken thighs (2d), Greek yogurt (2d), tomatoes (3d), red bell pepper (3d), milk (4d).
Peanut Noodles is always excluded ("Leo is allergic to peanuts"); Mushroom Risotto deprioritized (Ava dislikes mushrooms).
