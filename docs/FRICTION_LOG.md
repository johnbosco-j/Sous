# Sous: friction log

Every entry below happened while building Sous on 23 Oct 2026, or can be checked against the linked public docs. Severity scale: **Blocker / High / Medium / Low**.

---

### F1: Testing a self-hosted MCP server on a real Alexa+ surface
- **Task:** See Sous's tools and MCP Apps cards running inside Alexa+ on an Echo Show before submitting.
- **Steps:**
  1. Read the Alexa+ MCP QuickStart and the "Alexa+ add-on development stages" page.
  2. Found that the flow starts at *Discover* with a **Private Preview request**, after which the `alexa-ai` CLI, the web simulator and the local inspector become available.
- **Expected:** Hackathon participants in the Alexa+ track can connect a self-hosted MCP server to some Alexa+ test surface: a simulator, an inspector or a device.
- **Actual:** The official toolkit, simulator and inspector are gated behind the preview. The hackathon rules allow a "simulated Alexa+ experience" instead, so each team must build its own stand-in.
- **Severity:** High. We could not verify behavior on the real host.
- **Workaround:** Built an Echo Show-style MCP Apps host (`/device`) with an Amazon Bedrock agent loop that calls our server over Streamable HTTP, exactly as Alexa+ would.
- **Suggestion:** Give registered hackathon participants time-boxed preview access, or publish the local inspector (render-only, no certification) on npm for everyone.

### F2: Finding the Alexa+ MCP docs from the hackathon Resources page
- **Task:** Find the Alexa+-specific requirements for MCP add-ons: transport, auth, visual design.
- **Steps:** Opened the hackathon Resources page. The Alexa+ section links to "Build with Agent Skills" (modelcontextprotocol extensions site) and the MCP Streamable HTTP spec page. We then searched the web and found the Alexa+ MCP Toolkit QuickStart, the MCP add-on Design Guide and Visual Foundations on developer.amazon.com.
- **Expected:** The Alexa+ track resources link the Alexa+ MCP Toolkit and Design Guide directly.
- **Actual:** Only generic MCP spec links are listed for Alexa+. The Alexa+-specific pages, with the 768×480 canvas, the 1.667× Echo Show scale, the OAuth checklist and MCP Apps support, had to be found through search.
- **Severity:** Medium. These pages changed our design, and we found them late.
- **Workaround:** Web search.
- **Suggestion:** Add the MCP Toolkit QuickStart, Design Guide, Visual Foundations and Account Linking checklist to the Alexa+ section of the Resources page.

### F3: Knowing which MCP Apps features Alexa+ actually honors
- **Task:** Decide whether buttons inside our Echo Show cards ("Cook this", "Add to cart", "Next step") can call tools on a real Alexa+ device.
- **Steps:** Read the MCP Apps spec (stable 2026-01-26), the Alexa+ design guide and the glossary (inline, fullscreen and voice-only modes), and searched for an Alexa+ MCP Apps compatibility statement.
- **Expected:** A table of supported host capabilities: view-initiated `tools/call`, `ui/open-link`, `ui/request-display-mode`, CSP allowances and container size.
- **Actual:** We could not find one. The docs confirm MCP Apps are supported for visuals, but not which view → host requests are allowed.
- **Severity:** Medium.
- **Workaround:** Made every button action also reachable by voice, so a card works even if the host ignores `tools/call` from views.
- **Suggestion:** Publish an "MCP Apps on Alexa+" capability matrix per device class (Echo Show 5/8/15, Echo Hub, Fire TV).

### F4: Web fonts inside MCP Apps views blocked by the default CSP
- **Task:** Use a display font in the Echo Show cards.
- **Steps:**
  1. Our initial view design loaded Google Fonts.
  2. On reviewing the MCP Apps spec, we saw that when a resource omits `_meta.ui.csp`, hosts MUST apply `default-src 'none'` with only `'self'`/inline scripts and styles and `connect-src 'none'`.
- **Expected:** Guidance from Alexa+ on fonts and brand styling in views.
- **Actual:** External fonts load only if the resource declares `_meta.ui.csp.resourceDomains`, and it is not documented whether Alexa+ permits that.
- **Severity:** Low.
- **Workaround:** Declared the font origins in `_meta.ui.csp` and kept system-font fallbacks so views still look right if a host blocks them.
- **Suggestion:** Pass the Alexa type ramp and font through `hostContext.styles`, which the MCP Apps spec already supports, and document it in Visual Foundations.

### F5: MCP Apps host lifecycle ordering is easy to get wrong
- **Task:** Implement the host side of MCP Apps in our simulator.
- **Steps:** Wrote an internal contract: `ui/initialize` → `initialized` → `tool-result`. Then cross-checked it against the spec.
- **Expected:** `tool-result` alone is enough to render.
- **Actual:** The spec requires `ui/notifications/tool-input` (sent once, with the full arguments) **before** `tool-result`. It also says the host must not send anything before `initialized`. Our first contract missed the `tool-input` step.
- **Severity:** Low. It was caught in spec review, before any bug shipped.
- **Workaround:** Added `tool-input` to the host and made views tolerant of either order.
- **Suggestion:** Add a lifecycle conformance check to the MCP Inspector or the Alexa+ local inspector that flags out-of-order host messages.

### F6: Are MCP prompts used by Alexa+?
- **Task:** Decide whether to invest in MCP prompts (e.g. "plan the week") for the Alexa+ experience.
- **Steps:** Read the Alexa+ MCP client lifecycle page. Its sample `initialize` exchange advertises only `tools` and `resources`.
- **Expected:** A clear statement of whether prompts, elicitation and sampling are used.
- **Actual:** Not stated. We inferred that prompts are likely ignored.
- **Severity:** Low.
- **Workaround:** Put all behavior in tools and server `instructions`.
- **Suggestion:** Add a "supported MCP features" checklist to the Supported Capabilities page.

### F7: Which MCP spec version to target
- **Task:** Pick the protocol revision.
- **Steps:** The rules say 2025-11-25 "or a later version, once confirmed". The MCP changelog shows a newer 2026-07-28 revision that removes protocol-level sessions and the initialize handshake.
- **Expected:** A statement of which later revisions Alexa+ accepts.
- **Actual:** No confirmation was found, so it is unclear whether a sessionless server would work with Alexa+.
- **Severity:** Low.
- **Workaround:** Targeted exactly 2025-11-25 with Streamable HTTP sessions.
- **Suggestion:** Keep a version-support line on the Alexa+ MCP QuickStart page.

### F8: AWS credits for the AWS Builder mini challenge
- **Task:** Get AWS promotional credits for Amazon Bedrock usage.
- **Steps:** Read the Rules and Resources pages.
- **Expected:** Credits available until the Oct 21 request deadline stated in the rules.
- **Actual:** "October 7th Update: … we are out of credit codes and will no longer be accepting credit requests."
- **Severity:** Medium for late joiners.
- **Workaround:** Bedrock is optional in Sous. A deterministic router and template recipes keep the demo fully functional without AWS, and Bedrock turns on with your own key.
- **Suggestion:** Offer capped AWS Workshop Studio or sandbox accounts for hackathon builders instead of one-time credit codes.

### F9: Bedrock API keys + Converse tool use from JavaScript
- **Task:** Authenticate the Converse tool-use loop with a Bedrock API key from Node.js.
- **Steps:** Searched the AWS docs for API-key usage. They show the `AWS_BEARER_TOKEN_BEDROCK` environment variable with Python (boto3) and cURL examples.
- **Expected:** An official AWS SDK for JavaScript v3 example: `ConverseCommand` with `toolConfig`, authenticated by the API key.
- **Actual:** We found no official JS example combining the two.
- **Severity:** Low.
- **Workaround:** Relied on the SDK reading the environment variable, with the standard credential chain as a fallback.
- **Suggestion:** Add a JS/TS tab to the "Use an Amazon Bedrock API key" page and a Converse tool-use sample that loops over an MCP client.

### F10: Getting the code to GitHub from a cloud AI dev environment (non-Amazon tooling)
- **Task:** Create and push the public repository required for submission.
- **Steps:**
  1. The cloud coding session's GitHub token was invalid, so the repo could not be created from the session.
  2. Created `johnbosco-j/sous` manually on GitHub.
  3. Pushing returned HTTP 403 until the Claude GitHub App was installed on the new repository.
- **Expected:** Push works once the repo exists.
- **Actual:** An extra app installation was needed for the new repo.
- **Severity:** Medium on deadline day.
- **Workaround:** Installed the GitHub App on the repository.
- **Suggestion (for the hackathon checklist):** Remind builders who use AI coding agents to grant repo access *before* deadline day, alongside the existing "add collaborators" reminder.
