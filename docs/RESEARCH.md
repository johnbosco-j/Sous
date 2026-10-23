# Sous research notes (23 Oct 2026)

## Corrections for main (read first)

1. **Send `ui/notifications/tool-input` before `tool-result` (host side).** The MCP Apps spec (stable 2026-01-26) says the host MUST send `ui/notifications/tool-input` with `params: { arguments }` once after the view's `ui/initialize` completes. That notification is required before `ui/notifications/tool-result`. The contract skips it. Order: view `ui/initialize` → host result → view `ui/notifications/initialized` → host `tool-input` → host `tool-result`. The host MUST NOT send anything to the view before `initialized`.
2. **Google Fonts in views are blocked by default.** With no `_meta.ui.csp` on the resource, the host must apply `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none'`. Two fixes, either works:
   - Declare the font origins on each `ui://` resource's `_meta.ui.csp`: `{ resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] }`.
   - Use system font stacks in the views.

   Views must never call `fetch`, because `connect-src` is `'none'`.
3. **Tool → UI link.** Use `_meta: { ui: { resourceUri: "ui://sous/<view>.html" } }`. The flat `_meta["ui/resourceUri"]` form is **deprecated** and "will be removed before GA". Adding it as a fallback is harmless. Optionally add `visibility: ["model","app"]`, the default. A tool that only buttons should call can use `["app"]`, which the host must hide from the model.
4. **Capability negotiation.** The extension id is `io.modelcontextprotocol/ui`. The host/client (the agent's MCP client) should send `capabilities.extensions["io.modelcontextprotocol/ui"] = { mimeTypes: ["text/html;profile=mcp-app"] }` in `initialize`. The mimeType `text/html;profile=mcp-app` in the contract is correct (MUST).
5. **The `ui/initialize` result shape is right.** It is `{ protocolVersion: "2026-01-26", hostInfo, hostCapabilities, hostContext: { theme, displayMode: "inline", containerDimensions? } }`. Advertise `hostCapabilities.serverTools: {}` so views know they may send `tools/call`.
6. **Alexa+ canvas size.** The official Alexa+ add-on visual foundations guide uses a **768×480 base canvas**. Echo Show 8 and 15 (1280×800) use a root scale of **1.667**, and type should be about **1.6×** typical web sizes, with low content density. Design views at 768×480 logical px and scale them up.
7. **Alexa+ composes its own speech.** The design guide says "you can't script what Alexa says, but you can design your data so Alexa's responses are rich". Our `speech` field and the text `content` are hints. Keep `structuredContent` self-explanatory, with short fields Alexa can read aloud.
8. **Prompts may be ignored by Alexa+.** The Alexa+ client-lifecycle sample `initialize` response advertises only `tools` and `resources`. Prompts are fine to ship, but don't rely on them for the demo. Tools plus MCP Apps resources are what Alexa+ registers.
10. **Certification-style quality bar.** Amazon's test guide says to test the server in isolation with the standard **MCP Inspector**:
    - check tool schemas;
    - call tools with valid *and invalid* inputs;
    - test **idempotency**;
    - export interaction traces.

    Its preliminary certification criteria also say there must be **no high-severity dead ends that Alexa can't recover from**. So every error path should return a short spoken recovery line plus `isError` rather than throwing, and checkout and pantry_update should be idempotent. Sources: [test add-ons](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-test-add-ons.html), [web simulator](https://developer.amazon.com/docs/alexaplus/add-ons/test-with-web-simulator.html). The web simulator has an "Isolation" mode that routes only to your add-on and a "Global" mode with full Alexa+ routing. Our `/device` is effectively Isolation mode, and the README can say so.
9. **Real Alexa+ needs OAuth.** Account linking requires OAuth 2.1 auth-code + PKCE (S256). The checklist also requires:
   - a 401 *without* a `WWW-Authenticate` header for unauthenticated requests;
   - RFC 9728 Protected Resource Metadata;
   - `/.well-known/oauth-authorization-server`.

   The demo can stay open, but the README should list this as the production path and not claim it is done.

## (a) Winning on Devpost: what judges reward

- Judging runs in two stages. Stage 1 is a pass/fail check that the project fits the track and uses the required tech. Stage 2 scores four **equal** criteria: Tech Implementation, Design, Potential Impact, Quality of the Idea. A friction log can add up to **+10%**. Ties are broken in criteria order, so Tech Implementation counts most in a tie.
- The rules say the "creative" signals for Alexa+ are: an agentic workflow across services, state across sessions, **purchasing**, **media support (cards, carousels)**, **MCP Apps**, and **Agent Skills**. "Obvious" ideas are single-turn Q&A and basic wrappers. Sous should name each creative signal explicitly in its description.
- Video: lead with the payoff in the first 15–20 s, frame the problem with one statistic, show the product working rather than slides, and keep it under 3:00. Judges are not required to watch past 3:00. Hard-wire the demo path and record a backup take. Tell a story, not a feature list. Sources: [dev.to: How to make your Devpost submissions not suck](https://dev.to/jacklyn/how-to-make-your-devpost-submissions-not-suck-37i0), [TRON forum: improving your Devpost judge score](https://forum.trondao.org/t/tron-grand-hackathon-improving-your-devpost-judge-score/9393), [Reskilll: pitch in 3 minutes](https://blogs.reskilll.com/hackathon-demo-presentation-tips-pitch-3-minutes-win-2026/), [RevenueCat: pitching your app](https://www.revenuecat.com/blog/engineering/how-to-win-shipaton-part-4-pitching-your-app).
- Organizer emails stress that product feedback "goes directly to the teams" and must be specific to a named tool. "The docs were confusing" is explicitly called unhelpful.
- **Competitive landscape.** Several community projects already ship Echo Show device frames and MCP Apps simulators for Alexa+, for example [alexa-addon-simulator](https://github.com/murthyroshan/alexa-addon-simulator), [mcp-voice-host](https://github.com/blanco1er/mcp-voice-host) and [alexa-ai-web-simulator](https://github.com/AlSayedGamal/alexa-ai-web-simulator). So **a simulator alone is not our differentiator**. The differentiators are the domain workflow: use-it-up planning, a deterministic allergen guard, confirm-before-buy and cook-along with state. Present the simulator as test infrastructure, not the product.
- Alexa+ already builds grocery lists conversationally with Amazon Fresh ([TechCrunch, Feb 2025](https://techcrunch.com/2025/02/26/amazon-alexa-can-do-your-grocery-shopping-too/)). Position Sous as the pantry-aware, waste-aware layer *upstream* of that cart, not a replacement for it.

## (b) What Alexa+ MCP add-ons expect (official docs)

- **Transport and spec.** Streamable HTTP is required, and the legacy HTTP+SSE transport must be migrated. Alexa+ for Builders supports MCP spec **2025-11-25**. The server needs a public HTTPS URL; cloudflared tunnels work for development. Sources: [MCP QuickStart](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html), [MCP Toolkit overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html).
- **Lifecycle.** On deploy, Alexa+ connects to the MCP server and registers all tools and resources ([client lifecycle](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html)). The CLI introspects tool schemas, descriptions and capabilities, so **tool descriptions are the product surface**.
- **Visuals.** Alexa+ supports the MCP Apps extension for interactive visuals on screen devices. Display modes are inline (the default), fullscreen and voice-only. Alexa renders per surface: Echo, Echo Show, Fire TV, the Alexa app and Alexa.com. Sources: [Design guide](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-design-guide.html), [Visual foundations](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-visual-foundations.html), [Glossary](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-addon-glossary.html).
- **Design.** Customers arrive by voice or touch, "often multitasking, in kitchens, living rooms, and cars". Kitchens are named explicitly, which validates the hands-free cook mode. Each turn produces a voice reply, a screen, or both, and the add-on participates one turn at a time. Use low content density and big type.
- **Access.** Development follows five stages: Discover, Build, Test, Submit, Maintain ([development stages](https://developer.amazon.com/docs/alexaplus/add-ons/alexa-plus-add-on-development-stages.html)). Discover begins with a **Private Preview request**. Approved developers get the `alexa-ai` CLI, an Add-on Agent Skill, the web simulator and the local inspector. Community READMEs describe the official simulator as partner-gated / private preview.
- **Auth.** Account linking needs OAuth 2.1 + PKCE S256, refresh tokens and the RFC 9728/8414 metadata ([account linking](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-account-linking)).

## (c) MCP 2025-11-25 features worth claiming

Source: the [2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog).

- **Icons on tools, resources and prompts** (SEP-973).
- **Tool-name guidance** (SEP-986). Use snake_case ASCII names under 64 characters.
- URL-mode elicitation (SEP-1036) and richer enum elicitation (SEP-1330).
- Sampling with tools (SEP-1577). Experimental **tasks**.
- OIDC discovery, incremental scope consent and Client ID Metadata Documents (SEP-991).
- Still claimable from 2025-06-18: tool `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), `outputSchema` + `structuredContent`, `title`, and the server `instructions` field.
- Note: a later spec revision (2026-07-28) exists and removes protocol-level sessions. Our claim "2025-11-25 over Streamable HTTP" exactly matches the hackathon minimum and the Alexa+ docs.

## (d) MCP Apps (SEP-1865), verified against the spec text

Source: [ext-apps spec 2026-01-26 apps.mdx](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx), status Stable.

- Extension id: `io.modelcontextprotocol/ui`. Resource mimeType: `text/html;profile=mcp-app` (MUST). URI scheme: `ui://`.
- Tool link: `_meta.ui.resourceUri`, optionally with `_meta.ui.visibility: ["model"|"app"]`.
- Resource `_meta.ui` fields: `csp { connectDomains, resourceDomains }`, `domain`, `prefersBorder`.
- View → host requests: `ui/initialize`, `tools/call`, `resources/read`, `ui/open-link`, `ui/message`, `ui/request-display-mode`, `ui/update-model-context`, `ping`.
- View → host notifications: `ui/notifications/initialized`, `ui/notifications/size-changed`.
- Host → view notifications: `ui/notifications/tool-input` (required, sent once), `ui/notifications/tool-input-partial`, `ui/notifications/tool-result` (params = a standard `CallToolResult`), `ui/notifications/tool-cancelled`, `ui/notifications/host-context-changed`. Host → view request: `ui/resource-teardown`.
- `ui/initialize` params: `{ appInfo, appCapabilities: { tools?, availableDisplayModes? }, protocolVersion: "2026-01-26" }`.

## Impact numbers (cite exactly as worded)

- USDA: food waste is estimated at **30–40% of the US food supply** ([USDA Food Loss and Waste](https://www.usda.gov/foodlossandwaste)).
- ReFED 2025 report: US consumers (uneaten groceries at home plus restaurant plate waste) waste **~35 million tons a year, costing $261 billion, nearly $800 per person** ([ReFED](https://refed.org/articles/food-waste-remains-stubbornly-high-despite-signs-of-progress-according-to-new-refed-report/)). For a family of four that is roughly **$3,000+ a year**. Say "roughly", because the figure includes restaurant plate waste.
- ReFED 2026 report: **70 million tons** of surplus food in 2024. Surplus food accounts for about **3.5–4% of US greenhouse-gas emissions** ([Sustainable America summary of the ReFED 2026 report](https://sustainableamerica.org/blog/the-state-of-food-waste-in-2026-key-takeaways-from-refeds-new-report/)).
- Avoid the "$1,500 per family of four" figure: it only appears in secondary citations.
