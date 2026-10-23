# Sous: demo voiceover (read over the auto-recorded video)

The video is a captioned run of the Echo Show simulator, with chapter labels **1–9** and an end card. Read each block when its chapter label appears. Timings are targets: if a chapter on screen runs shorter or longer, pause or trim rather than rush. The whole thing must stay **under 2:50**, so judges see everything before the 3:00 cut-off. About 370 words, a calm pace.


---

The timestamps below are from the final auto-recorded video (`sous-demo.mp4`, 2:31). Each block is sized to fit its segment at a calm pace, about 2.5 words per second. This take ran on the deterministic engine because no Bedrock key was available, so the lines say "the agent", not "Bedrock", where it matters.

**Intro: landing page (0:00–0:21)**
> This is Sous, a zero-waste kitchen agent for Alexa+. Americans waste thirty to forty percent of their food supply, and most of it dies quietly in the fridge, because "what's for dinner?" gets answered from habit instead of from what's about to expire.

**1 · Planning (0:21–0:37)**
> So we ask Alexa: "What should we cook tonight?" Sous ranks every recipe by how much expiring food it rescues. Peanut Sesame Noodles never appears: Leo is allergic, and that rule lives in code, not in a prompt.

**2 · Pantry (0:37–0:46)**
> "What's about to expire?" The pantry, sorted by urgency, with twenty-three dollars of food at risk.

**3 · Memory (0:46–0:54)**
> Tell it once that Ava doesn't like mushrooms, and Sous remembers it on the server.

**4 · Agentic chain + MCP trace (0:54–1:08)**
> "Plan dinners for the next three nights." One sentence, three MCP tool calls: suggest, save the plan, build the cart. You can see each one in the live trace, over Streamable HTTP, spec 2025-11-25.

**5 · Purchase gate (1:08–1:17)**
> Nothing is bought until I say yes. The cart has a one-time token, and the order goes through exactly once.

**6 · Cook mode: voice + touch (1:17–1:55)**
> Now we cook, hands-free. Alexa reads each step on the Echo Show card. When a step needs time, Sous offers a timer, and I just say yes. My hands are busy, so I tap Next on the card instead: voice and touch call the same MCP tools. When dinner's ready, Sous records exactly what we rescued: spinach, tomatoes and leftover rice, six seventy-nine that would have gone in the bin.

**7 · Improvise (1:55–2:04)**
> Out of ideas? "Surprise me" invents a dish from what's expiring, using Amazon Bedrock when it's configured, and the allergen guard checks it either way.

**8 · Impact (2:04–2:17)**
> And it adds up: twenty-two dollars of food rescued this week, nine kilograms of emissions avoided, over a thousand dollars a year for one family.

**9 · New session, same memory (2:17–2:26)**
> Start a brand-new session, and Sous still knows Leo's allergy and Ava's mushrooms. That's state across sessions.

**End card (2:26–2:31)**
> Sous. Less waste, better dinners. Open source on GitHub.

---

### How to record it (about 10 minutes)
1. Open the auto-recorded MP4 in **iMovie** (Mac: drag it onto the timeline, then click the microphone icon under the viewer for "Record Voiceover"). CapCut or Clipchamp work the same way on any OS.
2. Use a quiet room and earbuds with a mic. Read each block as its chapter label appears. Re-record a single chapter if you stumble; don't redo the whole take.
3. Keep the video's captions on screen. Use no background music, or only a track from the YouTube Audio Library.
4. Export at **1080p** and confirm the length is **under 2:50**.
5. Upload to YouTube with visibility **Public**, title "Sous: the zero-waste kitchen agent for Alexa+ (Amazon Developer Hackathon)", and the repo link in the description.
6. Open the link in a private window to confirm it plays, then paste it into Devpost and into `docs/SUBMISSION.md`.
