# Prompt: fill the Devpost submission for Sous

Paste the block below into a browser agent (Claude in Chrome, Comet, Atlas, or similar) while you are logged in to Devpost.
Before you paste, replace `<YOUTUBE_URL>` with your public YouTube link. Download the images from `docs/media/` first.

---

```
You are filling in my Devpost project submission for the "Build, Ship, Shape: Amazon Developer Hackathon"
(https://amazonappdev2026.devpost.com). I am logged in. Work carefully, field by field. Never invent content: every value
comes from this prompt or from the two source documents below. Open them in a new tab and copy text exactly:

  SOURCE A (all submission text): https://raw.githubusercontent.com/johnbosco-j/Sous/main/docs/SUBMISSION.md
  SOURCE B (friction log):        https://raw.githubusercontent.com/johnbosco-j/Sous/main/docs/FRICTION_LOG.md

Steps:
1. Go to https://amazonappdev2026.devpost.com, click "My projects" (or "Enter a submission" / "Start project"),
   and open my existing draft if there is one, otherwise create a new project.

2. PROJECT OVERVIEW
   - Project name: Sous
   - Elevator pitch (max 200 chars): Alexa+ kitchen agent that keeps everyone at the table safe and fed: dinner from food about to expire, allergy and diet risks blocked in code, groceries ordered only after a yes.
   - Thumbnail: I will upload thumbnail.jpg myself if you cannot upload files; tell me when to do it.

3. PROJECT DETAILS
   - "About the project" (Markdown allowed): paste everything in SOURCE A from the heading "### Inspiration" down to
     (and including) the end of "### What's next". Keep the Markdown headings, lists, bold text and the code block.
     If the form has separate boxes (Inspiration / What it does / How we built it / Challenges / Accomplishments /
     What we learned / What's next), put each matching SOURCE A section into its box. For "Accomplishments",
     use the "Safety and trust design" section. For "What we learned", use the "Potential impact" section.
   - "Built with" tags (add each): model-context-protocol, mcp-apps, streamable-http, alexa-plus, amazon-bedrock,
     aws-sdk-js-v3, typescript, node.js, express, zod, three.js, web-speech-api, vitest, vercel, food-safety, accessibility
   - "Try it out" links (add each):
       https://sous-alexa.vercel.app/device
       https://sous-alexa.vercel.app
       https://github.com/johnbosco-j/Sous
   - Video demo link: <YOUTUBE_URL>
   - Image gallery: I will upload gallery-0-hero.jpg and gallery-1.jpg to gallery-7.jpg myself if needed; tell me when.

4. ADDITIONAL INFO / HACKATHON QUESTIONS (match each question to the right SOURCE A section)
   - Code repository URL: https://github.com/johnbosco-j/Sous
   - Primary track: Alexa+
   - Mini challenge(s): AWS Builder, and Open Source (tick both if multiple are allowed; if only one, choose AWS Builder)
   - Text description / "what it does and how it works": SOURCE A "### What it does" + "### How it works (architecture)"
   - Product feedback (required, every tool): paste the whole SOURCE A section "## Product feedback (required, one block per tool)"
     (all five blocks: MCP spec + SDK, MCP Apps, Alexa+ developer resources, Amazon Bedrock, Web Speech API).
   - AWS Builder: which AWS services and how: paste SOURCE A "## AWS Builder: services used and how".
   - Open Source fields:
       Contribution URL: https://github.com/johnbosco-j/Sous/tree/main/web/device
       Project repository URL: https://github.com/johnbosco-j/Sous
       GitHub username: johnbosco-j
       Description: paste the "What we did" and "Why it matters" bullets from SOURCE A "## Open Source (optional entry)".
   - "Did your project exist before the hackathon / what did you build during the submission window": paste
     SOURCE A "### What we built during the submission window" (answer: it did not exist before; everything was
     built on 23 October 2026).
   - Feature requests (optional): paste the table from SOURCE A "## Feature requests" (convert it to a plain list if the
     field does not render tables: "1. <request>: <why>. Priority: <priority>").
   - Friction log (optional, worth up to a 10% bonus): paste ALL entries from SOURCE B.
   - Testing instructions / how judges can access it: paste SOURCE A "## Testing instructions (for judges)".
   - Any other question: answer only from SOURCE A; if nothing fits, ask me.

5. Team: I am a solo entrant (no teammates to add).
6. Accept the official rules / terms checkboxes only if they are simple confirmations of eligibility and rules.
7. Click "Save" after each page. At the end, show me a summary of every field you filled and anything left empty.
   Do NOT click the final "Submit" button until I reply "submit".
```
