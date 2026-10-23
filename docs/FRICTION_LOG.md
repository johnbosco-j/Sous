# Sous: friction log

Every entry below happened while building Sous on 23 Oct 2026, or can be checked against the linked public docs. Severity scale: **Blocker / High / Medium / Low**.

---

### F1: Testing a self-hosted MCP server on a real Alexa+ surface
- **Task:** See Sous's tools and MCP Apps cards running inside Alexa+ on an Echo Show before submitting.
- **Steps:**
  1. Read the Alexa+ MCP QuickStart and the "Alexa+ add-on development stages" page.
  2. Found that the flow starts at *Discover* with a **Private Preview request**, after which the `alexa-ai` CLI, the web simulator and the local inspector become available.
- **Expected:** Hackathon participants in the Alexa+ track can connect a self-hosted MCP server to some Alexa+ test surface: a simulator, an inspector or a device.
- **Actual:** No public Alexa+ simulator was available to us. The official toolkit is gated behind the preview, and the rules allow a "simulated Alexa+ experience" instead, so each team builds its own stand-in.
- **Severity:** High. We could not verify behavior on the real host.
- **Workaround:** Built a local Echo Show-style MCP Apps host (`/device`). Its Amazon Bedrock agent loop calls our server as an MCP client over Streamable HTTP, the way Alexa+ would.
- **Suggestion:** Give registered hackathon participants time-boxed preview access, or publish the local inspector (render-only, no certification) on npm for everyone.

### F2: Finding the Alexa+ MCP docs from the hackathon Resources page
- **Task:** Find the Alexa+-specific requirements for MCP add-ons: transport, auth, visual design.
- **Steps:** Opened the hackathon Resources page. The Alexa+ section links to "Build with Agent Skills" (modelcontextprotocol extensions site) and the MCP Streamable HTTP spec page. We then searched the web and found the Alexa+ MCP Toolkit QuickStart, the MCP add-on Design Guide and Visual Foundations on developer.amazon.com.
- **Expected:** The Alexa+ track resources link the Alexa+ MCP Toolkit and Design Guide directly.
- **Actual:** Only generic MCP spec links are listed for Alexa+. The Alexa+-specific pages had to be found through search. They contain the 768×480 base canvas, the 1.667× Echo Show scale, the OAuth checklist and the statement that MCP Apps are supported.
- **Severity:** Medium. These pages changed our design, and we found them late.
- **Workaround:** Web search.
- **Suggestion:** Add the MCP Toolkit QuickStart, Design Guide, Visual Foundations and Account Linking checklist to the Alexa+ section of the Resources page.

### F3: Knowing which MCP Apps features Alexa+ actually honors
- **Task:** Decide whether buttons inside our Echo Show cards ("Cook this", "Add to cart", "Next step") can call tools on a real Alexa+ device.
- **Steps:** Read the MCP Apps spec (stable 2026-01-26), the Alexa+ design guide and the glossary (inline, fullscreen and voice-only modes), and searched for an Alexa+ MCP Apps compatibility statement.
- **Expected:** A table of supported host capabilities: view-initiated `tools/call`, `ui/open-link`, `ui/request-display-mode`, CSP allowances and container size.
- **Actual:** We could not find one. The docs confirm MCP Apps are supported for visuals, but not which view → host requests are allowed.
- **Severity:** Medium.
- **Workaround:** Every button action is also reachable by voice, so a card still works if the host ignores `tools/call` from views.
- **Suggestion:** Publish an "MCP Apps on Alexa+" capability matrix per device class (Echo Show 5/8/15, Echo Hub, Fire TV).

### F4: The MCP Apps host details live only in the ext-apps spec
- **Task:** Implement the host side of MCP Apps in our simulator and make our views render on a spec-compliant host.
- **Steps:**
  1. Wrote an internal contract: `ui/initialize` → `initialized` → `tool-result`, with Google Fonts in the views.
  2. Cross-checked it against the ext-apps spec text.
- **Expected:** The Alexa+ docs (or a short MCP Apps quickstart) list the host rules a view depends on.
- **Actual:** Two rules we had missed exist only in the ext-apps spec:
  - The host MUST send `ui/notifications/tool-input` (once, with the full arguments) **before** `tool-result`, and must send nothing before `initialized`.
  - A resource without `_meta.ui.csp` gets `default-src 'none'`, so web fonts are blocked unless `resourceDomains` declares them.
- **Severity:** Low. It was caught before shipping.
- **Workaround:** Added `tool-input` to the host. Declared the font origins in `_meta.ui.csp` and kept system-font fallbacks. Made views tolerant of message order.
- **Suggestion:** Add a "host rules your view relies on" box to the Alexa+ Visual Foundations page, and a lifecycle conformance check to the inspector.

### F5: Which MCP features and spec versions Alexa+ uses
- **Task:** Decide whether to invest in MCP prompts, and which protocol revision to target.
- **Steps:** Read the Alexa+ MCP client lifecycle page, whose sample `initialize` exchange advertises only `tools` and `resources`. The hackathon rules say 2025-11-25 "or a later version, once confirmed", and the MCP changelog shows a newer 2026-07-28 revision that removes protocol-level sessions.
- **Expected:** A "supported MCP features and versions" statement.
- **Actual:** Not stated, so we inferred that prompts are likely ignored. It is unclear whether a sessionless (2026-07-28) server would work.
- **Severity:** Low.
- **Workaround:** All behavior lives in tools and server `instructions` (prompts are a bonus). We targeted exactly 2025-11-25 with Streamable HTTP sessions.
- **Suggestion:** Add a features-and-versions checklist to the Supported Capabilities page.

### F6: Invalid AWS credentials made every Bedrock voice turn pay a failed round-trip
- **Task:** Run the Alexa+ stand-in agent on Amazon Bedrock (Converse with tool use) from our cloud dev container.
- **Steps:** Started the server with `SOUS_BEDROCK=auto`. The container already had AWS keys in its environment, so the SDK picked them up.
- **Expected:** Either the call works, or it fails once with a clear message about which credential source was used.
- **Actual:** Every turn failed with `UnrecognizedClientException: The security token included in the request is invalid`. The error doesn't say whether it came from environment keys, a profile, or a Bedrock API key. Each voice turn waited on the failed call before falling back.
- **Severity:** Medium.
- **Workaround:** Added a circuit breaker. After an auth, access or model error, Bedrock is skipped for 5 minutes and the deterministic engine answers immediately.
- **Suggestion:** Include the resolved credential source in SDK auth errors, and document the precedence between `AWS_BEARER_TOKEN_BEDROCK` and SigV4 credentials on the API-keys page.

### F7: JSON Schema portability for Converse `toolSpec`
- **Task:** Expose every MCP tool (`tools/list`) to Bedrock as a Converse `toolSpec`.
- **Steps:** Passed the MCP `inputSchema` (JSON Schema generated by Zod 4) as `toolSpec.inputSchema.json`.
- **Expected:** One documented, portable JSON Schema subset that every Converse tool-use model accepts.
- **Actual:** Bedrock models accept different subsets of JSON Schema, and we found no single portable list in the docs.
- **Severity:** Medium.
- **Workaround:** Strip each schema to `type`, `properties`, `required`, `description`, `enum` and `items` before sending.
- **Suggestion:** Document the supported keyword subset per model family in the Converse tool-use guide, or have Converse normalize schemas server-side. An "MCP tools → Converse" helper in the SDK would remove this step for every Alexa+ and AWS Builder team.

### F8: AWS credits for the AWS Builder mini challenge
- **Task:** Get AWS promotional credits for Amazon Bedrock usage.
- **Steps:** Read the Rules and Resources pages.
- **Expected:** Credits available until the Oct 21 request deadline stated in the rules.
- **Actual:** "October 7th Update: … we are out of credit codes and will no longer be accepting credit requests."
- **Severity:** Medium for late joiners.
- **Workaround:** Bedrock is optional in Sous. A deterministic router and template recipes keep the demo fully functional without AWS.
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
