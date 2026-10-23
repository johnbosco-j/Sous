# Sous: demo video script (target 2:45, hard limit under 3:00)

**Rules recap:** public on YouTube, in English, shows the project working, no copyrighted music or third-party footage. Judges may stop watching at 3:00, so the best moment comes first.

**Setup before you hit record**
1. `npm start`, then open **Chrome** (not Brave, which has no speech recognition) at `http://localhost:8787/device`. Use full screen (F11 or ⌃⌘F) and zoom the browser until the device fills a 1920×1080 frame.
2. Click **Reset demo** so the pantry, expiry dates and impact counters start fresh.
3. If you have Bedrock set up (`.env`), confirm the trace drawer badge says **bedrock**. That is your AWS Builder proof on camera. If it says **rules**, the demo still works; just don't claim Bedrock in that shot.
4. Open a second tab at `http://localhost:8787/` (the landing page) for the title shot.
5. Turn system volume up so Alexa's voice is recorded. On macOS, OBS with "macOS Screen Capture (Application audio)" works; QuickTime alone does not capture system audio.

---

| Time | Shot (what's on screen) | Action | Voiceover / on-screen text |
|---|---|---|---|
| **0:00–0:14** | Echo Show simulator, ambient clock screen | Click the mic and say, or click the chip, **"What should we cook tonight?"** The meal carousel slides in: recipe cards with "expires tomorrow" chips and a **Peanut Noodles: excluded, Leo is allergic to peanuts** strip. | Let Alexa's spoken answer play. Caption: *"Alexa+ · powered by Sous"* |
| 0:14–0:26 | Landing page hero (3D scene) | Slow scroll to the stats section | VO: "Americans waste 30 to 40 percent of their food supply. That's nearly 800 dollars per person, every year. Most of it isn't carelessness. Nobody remembers what's about to expire. So we built **Sous**, the zero-waste kitchen agent for Alexa+." |
| 0:26–0:42 | Back to device | Chip **"What's about to expire?"** The pantry grid appears, sorted by urgency with red and amber badges and an "at risk $X" headline. | VO: "Sous is a self-hosted MCP server. Alexa+ calls its tools, and on an Echo Show it answers with interactive MCP Apps cards like this one." |
| 0:42–0:55 | Device | Chip **"Remember Ava doesn't like mushrooms."** | VO: "It remembers the household (allergies, dislikes) across sessions. Allergies are enforced in deterministic code, never left to the model." |
| 0:55–1:20 | Device, cook card | Chip **"Let's cook the first one"**: a giant step card appears. **Tap the on-screen Next button** (touch) and then say **"Next step"** (voice). | VO: "Your hands are covered in flour, so cooking is hands-free. Touch and voice call the same MCP tools." |
| 1:20–1:30 | Device, timer chip counting down | Chip **"Set a timer for 10 minutes"** | VO: "Timers run right on the card." |
| 1:30–1:55 | Device, cart card | Chip **"Add what we're missing to the cart"**: an itemized Amazon Fresh (simulated) cart with a total and a "say yes to confirm" banner. Then chip **"Yes, place the order"**: an order confirmation with order ID and ETA. | VO: "Sous buys only what you're missing, and nothing gets ordered until you say yes. Checkout requires a one-time cart token and an explicit confirmation, so the model can't buy anything on its own." |
| 1:55–2:10 | Device, impact card | Chip **"How much food have we saved?"**: dollars rescued, kilograms, CO2e, a 7-day bar chart and a yearly projection. | VO: "And it shows what that's worth: money saved, food rescued, emissions avoided." |
| **2:10–2:32** | Press **`t`**: the MCP trace drawer slides open | Scroll the drawer slowly: `meal_suggest`, `household_memory`, `cook_start`, `shopping_checkout` with `cartToken` and `confirmed: true`, the ms timings, and the **bedrock** badge. Optionally cut for 3 s to MCP Inspector showing `tools/list` at `http://localhost:8787/mcp`. | VO: "Under the hood: MCP spec 2025-11-25 over Streamable HTTP, tool annotations and structured output, and MCP Apps views served as ui:// resources. The agent loop runs on Amazon Bedrock's Converse API, calling Sous's tools over MCP." |
| 2:32–2:45 | Landing page final section / GitHub repo page | Hold on the logo and URL | VO: "One integration works for Echo Show, Fire TV and the Alexa app, and with any MCP host. **Sous. Cook what you have.**" Text: `github.com/johnbosco-j/sous · MIT` |

---

### Backup plan
- If voice recognition misfires, click the chips. They send the same utterance.
- If Bedrock is slow or fails during a take, unset the key and record with the `rules` engine. Cut the "Amazon Bedrock" sentence or show it only in the trace shot of a working take.
- Record the 0:00–0:14 cold open twice and keep the cleanest one.

### Upload checklist
- Export 1080p MP4 and check the length is **under 3:00** (aim for 2:45).
- YouTube: Visibility **Public**, title "Sous: the zero-waste kitchen agent for Alexa+ (Amazon Developer Hackathon)". Put the repo link in the description.
- No background music, or only music from the YouTube Audio Library.
- Paste the URL into Devpost and into `docs/SUBMISSION.md`. Open the video in a private window to confirm it plays.
