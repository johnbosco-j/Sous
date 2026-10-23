# Prompt: update the existing Devpost project for Sous (v2)

Paste the block below into a browser agent (Claude in Chrome, Comet, Atlas, or similar) while you are logged in to Devpost.
Before you paste, replace `<NEW_YOUTUBE_URL>` with the public YouTube link of the v2 video (2:53).
Download `Sous_Gallery_v2.zip` first (or the `docs/media/v2-*.jpg` images from the repo).

---

```
You are EDITING my existing Devpost project "Sous" for the "Build, Ship, Shape: Amazon Developer Hackathon"
(https://amazonappdev2026.devpost.com). I am logged in. The project already exists; update it in place.
Do not create a new project and do not change the team. Never invent content: every value comes from this
prompt or from the two source documents below. Open them in a new tab, reload them so you get the latest
version, and copy the text exactly:

  SOURCE A (all submission text): https://raw.githubusercontent.com/johnbosco-j/Sous/main/docs/SUBMISSION.md
  SOURCE B (friction log):        https://raw.githubusercontent.com/johnbosco-j/Sous/main/docs/FRICTION_LOG.md

SOURCE A must mention "44" tools and "254" tests and "allergy_emergency". If it still shows older numbers,
wait 1 minute, hard-reload it, and check again before continuing.

Steps:
1. Go to https://amazonappdev2026.devpost.com, click "My projects", open "Sous", and click "Edit project"
   (or "Edit submission").

2. PROJECT OVERVIEW: replace these fields:
   - Project name: Sous
   - Elevator pitch (max 200 chars): Alexa+ kitchen agent that keeps everyone at the table safe and fed: dinner from food about to expire, allergy and diet risks blocked in code, groceries ordered only after a yes.
   - Thumbnail: keep the current one (or I will upload 00-devpost-thumbnail-3x2.jpg if it is missing).

3. PROJECT DETAILS: replace these fields:
   - "About the project": delete the old text completely, then paste everything in SOURCE A from the heading
     "### Inspiration" down to the end of "### What's next" (keep headings, lists, bold text, code blocks).
     If the form has separate boxes, map: Inspiration → Inspiration; What it does (including every sub-block) →
     What it does; How it works + How we built it → How we built it; Challenges → Challenges we ran into;
     Safety and trust design → Accomplishments that we're proud of; Potential impact → What we learned;
     What's next → What's next.
   - "Built with": make sure these tags are present (add missing ones, keep existing ones):
     model-context-protocol, mcp-apps, streamable-http, alexa-plus, amazon-bedrock, aws-sdk-js-v3, typescript,
     node.js, express, zod, three.js, web-speech-api, vitest, vercel, food-safety, accessibility
   - "Try it out" links (keep exactly these three):
       https://sous-alexa.vercel.app/device
       https://sous-alexa.vercel.app
       https://github.com/johnbosco-j/Sous
   - Video demo link: replace the old link with <NEW_YOUTUBE_URL>
   - Image gallery: remove the old screenshots, then I will upload the new ones in this order
     (tell me when the upload box is ready): 00-landing-hero, 01-diet-and-allergy-aware-planning,
     02-allergy-emergency-alert, 03-agentic-chain-mcp-trace, 04-confirm-before-buy-order,
     05-cook-mode-dinner-ready, 06-budget-cheapest-dinners, 07-community-fridge-donation,
     08-impact-dashboard, 09-allergy-safe-substitutes, 10-summary-end-card.

4. ADDITIONAL INFO / HACKATHON QUESTIONS: update every answer from the latest SOURCE A:
   - Code repository URL: https://github.com/johnbosco-j/Sous
   - Primary track: Alexa+
   - Mini challenges: AWS Builder, and Open Source (both if allowed; if only one, AWS Builder)
   - Text description / "what it does and how it works": SOURCE A "### What it does" + "### How it works (architecture)"
   - Product feedback: the whole SOURCE A section "## Product feedback (required, one block per tool)"
   - AWS Builder (services used and how): SOURCE A "## AWS Builder: services used and how"
   - Open Source: Contribution URL https://github.com/johnbosco-j/Sous/tree/main/web/device ;
     Repository URL https://github.com/johnbosco-j/Sous ; GitHub username johnbosco-j ;
     description = the "What we did" and "Why it matters" bullets from SOURCE A "## Open Source (optional entry)"
   - Existed before the hackathon / what was built in the window: SOURCE A "### What we built during the submission window"
   - Feature requests: SOURCE A "## Feature requests" (convert the table to a numbered list if tables don't render)
   - Friction log: ALL entries from SOURCE B (it now has 11 entries)
   - Testing instructions: SOURCE A "## Testing instructions (for judges)"
   - Anything else: answer only from SOURCE A; if nothing fits, ask me.

5. Save each page. Then open the public project page in a new tab and check that:
   - the video plays, the description mentions 44 tools and the allergy emergency alert,
   - the three "Try it out" links open,
   - the gallery shows the new images.
6. Show me a summary of every field you changed and anything you could not change.
   Make sure the project still shows as "Submitted" for the hackathon. If Devpost asks me to re-submit after
   editing, STOP and tell me; do not click Submit until I reply "submit".
```
