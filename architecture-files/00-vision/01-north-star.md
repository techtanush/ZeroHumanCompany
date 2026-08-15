# 01 — North Star

## The thesis

In 2026 the bottleneck of starting a company is no longer *building*. Models build well.
The bottleneck is everything a founder does **around** the code:

- knowing which idea is actually worth building,
- finding the specific niche where the money is,
- talking to enough real humans to know you're not hallucinating a market,
- having the discipline to kill features the evidence doesn't support,
- doing outbound when you hate outbound,
- collecting money, tracking money, and deciding where money goes,
- and noticing — six weeks in — that you're bad at something and hiring for it.

**Zeroth is an agency staffed entirely by agents that does all of it.** The founder's job shrinks
to a handful of `approve / reject / redirect` decisions delivered to their phone.

## What "zero-human" actually means here

Not "no humans exist." It means **no human is on the critical path by default.** The company runs.
Humans appear at exactly three points:

| Human | When they appear | Channel |
|---|---|---|
| **The founder** | Irreversible decisions, pivots, spend above threshold, identity/credential ceremonies | Linq (iMessage) → Boardroom |
| **The customer / interviewee** | Discovery calls, sales calls, support | ElevenLabs voice clone, email, Linq |
| **A hired human (Terac)** | Anything an agent provably cannot do: notarization, in-person tasks, licensed advice, human-verified panels | Terac API, requisitioned by HR |

The third one is the philosophical punchline of the event, and it's the host's product:
**when the AI company needs a human, it hires one — through an API, with its own money.**

## What we are optimizing for

1. **Believability over breadth.** One venture that goes idea → paying customer end-to-end beats
   twelve departments that each demo a toast notification.
2. **Evidence chains.** Every recommendation the company makes must be traceable to a source:
   a Census weight, a scraped listing, a call transcript, a Stripe charge.
3. **Self-modification as the finale.** Department 12 writing, testing, and deploying a *new
   department* live on stage is the moment that wins the general prize.

## Non-goals (say these out loud so nobody builds them)

- Not a general-purpose agent framework. Zeroth is opinionated about being a *company*.
- Not a chatbot. The Boardroom is a dashboard with approval cards, not a chat window.
- Not multi-tenant SaaS-grade. One founder, N ventures, single-region, demo-hardened.
- No fine-tuning our own foundation models (except the narrow Pioneer classifiers — see
  [`../03-integrations/12-pioneer-fastino.md`](../03-integrations/12-pioneer-fastino.md)).

## The two entry modes

```
MODE A — FOUNDER-LED           MODE B — AUTONOMOUS ORIGINATION
user brings an idea            company finds its own idea
(text / voice / files /        (trend swarm → gap detection →
 a half-dead Notion doc)        opportunity scoring → proposal)
        │                                  │
        └──────────────┬───────────────────┘
                       ▼
              Department 02: Office Hours
```

Mode B is the flex: with no input at all, Zeroth picks a business and starts running it.
The demo should *start* in Mode B for ten seconds ("it found this on its own") and then switch to
Mode A with the judge's own idea.

## The measurable definition of success

A venture is "alive" when all five are true, and the Boardroom shows it as a five-segment ring:

| Signal | Source of truth |
|---|---|
| `idea_locked` | Office Hours produced a signed `SharpenedIdea` artifact |
| `market_validated` | ≥ 1 niche with cited TAM/SAM/SOM + ≥ 5 real human conversations logged |
| `product_live` | Deployed URL responds 200, QA suite green in Replay |
| `pipeline_active` | ≥ 25 qualified leads, ≥ 1 booked call |
| `revenue_real` | ≥ 1 successful Stripe charge (test mode is fine; label it) |

## Tone and aesthetic

Borrowed deliberately from `simit` / sim-francisco: **pixel-art isometric, 16×16 sprites,
readable-at-a-glance**. The Boardroom is an *office floor plan*. Each department is a room.
Agents are sprites that walk between rooms when they hand off work. A blocked department turns
amber; an escalation pops a speech bubble. It is a Sim-game UI over a real company.

This is not decoration — it is the demo's legibility layer. A judge should understand the entire
system in four seconds of looking at it. See [`../01-platform/09-boardroom-ui.md`](../01-platform/09-boardroom-ui.md).
