# 05 — External Research Notes

A research digest for everything Zeroth borrows from outside: the simit repo we port for D05, the
gstack office-hours method D02 ports, and the open-source landscape for browser automation,
outreach, agent skills, and customer discovery. Every entry lists what it is, its license, and
what we would use it for — or why we decided not to.

**Verification key:** ✅ = verified directly (repo read on disk, or page fetched 2026-08-15).
⚠️ = from memory / secondary sources, **unverified — confirm before relying on it**.
House rule (P1 in [`01-product-principles.md`](01-product-principles.md)) applies to our own
research notes too: unverified stays labeled, never silently promoted.

---

## 1. The `simit` repo (✅ read at `/tmp/zhc_research/simit`)

Upstream: [`github.com/Mahin2076/simit`](https://github.com/Mahin2076/simit) — the checkout on
disk is a full import of `tejasprabhune/simfrancisco` (per its `AGENTS.md`), snapshot 2026-07-18.
Live app `simfrancisco.org`; live API `sf-digital-twin-tp.fly.dev`. No LICENSE file at the repo
root in our checkout (⚠️ confirm licensing with the authors before shipping ported code; the
sprite assets are separately CC BY-SA 3.0, credited in `assets/SPRITES-LICENSE.txt`).

### Architecture (Rust workspace, axum, SQLite)

```
crates/
  sim-core/    persona, pums, predict, aggregate, rubric, sim   ← the part we port
  sim-maps/    OSM/DEM → pixel-tile map pipeline                ← aesthetic inspiration only
data/sf_pums.csv   committed ACS PUMS subset for SF's 8 PUMAs
rubric.yaml        machine-checkable "done": validate binary exits 0 iff weighted score ≥ gate
tiles.db           pre-rendered city tiles
```

Two engines over one persona layer, deliberately decoupled:

1. **Prediction engine** (the scored core): `persona + as-of-date + event/question → weighted
   opinion / vote share / probability`. Runs without the life-sim. This is what `validate` grades.
2. **Life simulation** (the visual demo): schedule-driven movement on the SF grid, deterministic
   A\* pathfinding, collocated chatter, reactions, birth/death, streamed over SSE.

### The five ideas we reuse in D05

| simit mechanism | How it works there | What Zeroth does with it |
|---|---|---|
| **PUMS joint-sample personas** | Agents sampled from real ACS PUMS person microdata (SF County's 8 PUMAs), so the joint distribution over age/sex/race/education/income/occupation/citizenship/marital status is real, not reconstructed from marginals. Each agent carries person weight `PWGTP`. | `simpop.sampler` — identical approach, region-parameterized (any US PUMA set, not just SF) |
| **Post-stratified estimates** | Every population estimate is `p_hat(k) = Σ w_i·a_i(k) / Σ w_i` over PUMS weights | `SyntheticPanelResult.questions[].estimate` — same formula, business questions instead of ballots |
| **Archetype clustering for cost** | Agents clustered into ~12 demographic archetypes; **one batched LLM call answers the whole population**; per-archetype YES probability post-stratified back | `simpop.archetyper` + `pollster` — this is why a panel costs ~$1.10, not $500 |
| **Deterministic seeding + SQLite response cache** | Personas/value vectors seeded (`hash(simulation_seed, agent_index)`); cache keyed `(model, exact prompt)` makes clean runs **byte-reproducible** | Our VC-7 reproducibility KPI and the demo's replay safety come straight from this |
| **Rubric-gated validation** | `cargo run --bin validate` scores `rubric.yaml` against real, fixed ground truth; exits 0 iff headline ≥ gate (~0.85 headline; weighted min 0.70 in the committed rubric). Targets are frozen; tuning may touch personas/prompts/aggregation only. | D05's acceptance harness: a `rubric.yaml` of backtestable questions; also the general "machine-checkable done" pattern our build order uses |

### The credibility result (why we trust the method)

Leakage-free backtest with GPT-4o (knowledge cutoff Oct 2023, predates the outcomes):

| Event | Actual | Predicted |
|---|---|---|
| 2024 Presidential, SF (Dem share) | 83.8% | 81.3% |
| March 2024 Prop A (yes) | 70.38% | 70% |

Ground truth is the SF Dept of Elections certified canvass (cited in the repo's `rubric.yaml`).
Religion is layered from Pew SF-metro figures conditioned on demographics, since census lacks it.

### What we change

- **Questions:** willingness-to-pay, message testing, ICP sizing — not ballots. New prompt
  templates, same aggregation math.
- **Regions:** parameterize PUMA sets per venture ICP geography; pre-bake extracts into
  `fixtures/pums/` (never download on demo day).
- **Contract:** wrap output in the `SyntheticPanelResult` Zod artifact with the forced
  `honesty_note` — simit's honesty-about-being-a-model stance, made schema.
- **Drop:** the life-sim (except the pixel-art aesthetic, which the Boardroom borrows), maps
  pipeline, election/market rubric entries.

### `sim-core` module map (✅ from the checkout)

The port surface, module by module, so the D05 builder knows exactly what to lift:

| Module (`crates/sim-core/src/`) | Does | Port verdict |
|---|---|---|
| `pums.rs` | PUMS CSV ingest, person-weight carrying, PUMA filtering | **Port** — parameterize region |
| `persona.rs` | Seeded deterministic backstory + value vector per agent | **Port** — swap political value axes for buyer axes (budget authority, tool fatigue, risk posture) |
| `predict.rs` | `persona + as-of-date + question → per-archetype probability` (the batched LLM call) | **Port** — new prompt templates for WTP/message/ICP framings |
| `aggregate.rs` | Post-stratification `Σ w_i·a_i / Σ w_i`, CI via weighted bootstrap, per-demographic breakdowns | **Port as-is** |
| `rubric.rs` + `bin/validate` | Machine-checkable scoring vs frozen targets | **Port the harness**, replace entries with business backtests |
| `store.rs` | SQLite response cache keyed `(model, exact prompt)` — byte-reproducibility | **Port as-is** |
| `religion.rs` | Pew-conditioned attribute layering | Port the *pattern* (layering non-census attributes from public priors) |
| `sim.rs`, `pathfind.rs`, `city.rs`, `geo.rs`, `lifestyle.rs` | Life-sim: schedules, A\*, map grid | **Drop** (aesthetic only) |
| `news.rs`, `insforge.rs`, `rocketride.rs`, `hydra.rs` | News refresh, persistence, question-router integrations | **Drop** — our kernel owns these concerns |

### simit's iteration lessons (✅ from its `NOTES.md`) that transfer to D05

The repo keeps a failures→fixes→rules log; three rules transfer directly to business polling:

1. **Confident realism beats hedging.** Their baseline underestimated known-lopsided outcomes
   because per-archetype probabilities hedged toward 0.5–0.7. Rule for our WTP prompts: license
   archetypes to express strong, realistic positions; hedged mush post-stratifies into mush.
2. **Context, not answers.** They improved accuracy by giving agents true, public, pre-cutoff
   *balanced* context — never the outcome. Our analog: give archetypes the niche's real public
   context (pricing norms, incumbent complaints) without leading the WTP question.
3. **Analytical frame for mechanism questions.** Partisan/wishful framing failed on
   market-mechanics questions; a forecaster frame fixed it. Our analog: "would this segment's
   *budget process* approve $X" is a mechanics question, not an opinion question — frame it so.

Also load-bearing for us: their tuning discipline — **targets frozen, only personas / prompts /
aggregation may change** — is exactly the anti-overfit stance D05's rubric harness must keep,
enforced by their verifier + adversarial-critic completion gate (an independent agent re-runs
`validate`; a second agent tries to prove the gain is spurious: overfit, leakage, weight-gaming).

---

## 2. The gstack office-hours method (D02's provenance)

Source: local skill `~/.claude/skills/gstack/office-hours/` — a YC-partner-style interrogation
skill, private/local, not on public GitHub (⚠️ no public URL; treat as founder-provided IP).
[`../02-departments/D02-office-hours.md`](../02-departments/D02-office-hours.md) documents the
port in detail; summary of the method itself:

- **Anti-sycophancy as an operating principle.** The partner never praises; an idea leaves the
  room smaller and sharper or dead. The Zeroth critic enforces "nothing got praised" mechanically.
- **The Six Forcing Questions** (who exactly is the user; what do they do today instead; what
  would have to be true; what's the smallest version; why now; why you) — these become the
  `SharpenedIdea` schema fields, so dodging a question is a validation error, not a vibe.
- **Premise Challenge:** state the idea's load-bearing premises back to the founder for explicit
  agree/disagree/revise — becomes the `premises[]` field + Linq `multi_approve` card.
- **Alternatives phase:** ≥2 seriously-considered alternatives with pros/cons before committing —
  becomes `alternatives_considered[]` (min 2, chosen + rejection reasons).
- **Push once, then push again:** the skill's discipline of not accepting the first answer;
  ported verbatim into the partner prompt.
- **One concrete assignment** at the end, in the skill's tradition — the `assignment` field.

Related public method (⚠️ book, not software): *The Mom Test* (Rob Fitzpatrick) — past behavior
over stated intent. Encoded as `claims.evidence_class` with `past_behavior > current_practice >
stated_intent > opinion`, and KPI VC-4.

---

## 3. Browser automation & computer use (for Solari fallbacks and D03/D09 scraping)

Zeroth's primary "hands" are Solari (sponsor, [`../03-integrations/04-solari.md`](../03-integrations/04-solari.md));
the tool-plane driver interface (`BrowserTask`) exists so these OSS options are swap-ins.

| Repo | License | Verified | What it is | What we'd use it for |
|---|---|---|---|---|
| [`microsoft/playwright`](https://github.com/microsoft/playwright) | Apache-2.0 ⚠️ (license from memory) | partially | The baseline browser driver | Already in D07 QA (`browser.playwright`) and the Solari-fallback driver |
| [`browser-use/browser-use`](https://github.com/browser-use/browser-use) | MIT ✅ | ✅ fetched | Python library + CLI skill giving an LLM full autonomy over a browser; ~109k stars; own benchmark suite; cloud offering for stealth/proxies | Candidate fallback driver for `AccountCeremony` and JS-heavy scraping if Solari is unavailable; its "skill install" pattern is also prior art for D13-installable tools |
| [`browserbase/stagehand`](https://github.com/browserbase/stagehand) | MIT ✅ | ✅ fetched | TS/Python/Go SDK: Playwright-style APIs + `act`/`observe`/`extract` self-healing primitives, deterministic-first | Best-fit OSS fallback for our TS tool plane: deterministic where possible, AI where selectors break — matches our "gates over vibes" taste |
| [`Skyvern-AI/skyvern`](https://github.com/Skyvern-AI/skyvern) | AGPL-3.0 ✅ | ✅ fetched | Vision-LLM browser agent + workflow builder, Playwright-compatible SDK, 2FA/credential integrations | Reference for ceremony patterns (TOTP, credential vaults); AGPL means we treat it as a separately-deployed service if ever used, not vendored code |
| [`bytedance/UI-TARS`](https://github.com/bytedance/UI-TARS) | Apache-2.0 ✅ | ✅ fetched | Open multimodal GUI-agent models (1.5 series, 7B open weights); SOTA-competitive OSWorld results vs OpenAI CUA / Claude computer use; desktop app + Midscene.js for web | Landscape awareness + potential local grounding model if we ever need offline computer use; not in MVP |
| [`bytedance/UI-TARS-desktop`](https://github.com/bytedance/UI-TARS-desktop) | ⚠️ Apache-2.0 assumed | ⚠️ | Desktop computer-use app for the UI-TARS models | Not used; noted for completeness |
| [`web-infra-dev/midscene`](https://github.com/web-infra-dev/midscene) | ⚠️ MIT assumed | ⚠️ (linked from UI-TARS README) | JS browser automation with natural-language APIs | Alternative TS fallback; evaluate only if Stagehand disappoints |
| [`xlang-ai/OSWorld`](https://github.com/xlang-ai/OSWorld) | ⚠️ Apache-2.0 assumed | ⚠️ | The standard computer-use benchmark (real OS tasks) | Reading list only — how we sanity-check vendor computer-use claims |

### Computer-use landscape notes (⚠️ market observations, not load-bearing)

- Hosted "operator-style" agents (OpenAI CUA, Anthropic computer use, Google/Microsoft
  equivalents) trade generality for cost and latency; benchmark ordering shifts quarterly —
  browser-use's README currently claims the top Odysseys score, UI-TARS claims OSWorld wins over
  CUA/Claude at 100 steps. Treat all vendor-reported numbers as ⚠️ marketing until reproduced.
- The stable engineering lesson across all of them: **deterministic where you can, model where
  you must** (Stagehand's thesis), and **cache/replay everything** (our replay + simit cache
  inheritance). Our `BrowserTask` interface encodes that: scripted steps with AI-assisted
  recovery, every session recorded.
- CAPTCHA/anti-bot is the universal wall; every OSS project punts to a paid stealth cloud.
  Zeroth's answer is architectural instead: the `AccountCeremony` pauses and texts the founder
  over Linq at exactly the human-required step ([`../01-platform/07-identity-and-accounts.md`](../01-platform/07-identity-and-accounts.md)).
  We never automate around a CAPTCHA; we route it to a human with consent and context.

---

## 4. Outreach & email infrastructure (D04/D09/D10 fallbacks)

Primary path is Composio-managed Gmail/LinkedIn + Linq. OSS below is for self-hosted fallback or
pattern reference. Compliance posture (consent states, suppression, DNC) is ours regardless of
tool — none of these enforce it for us.

| Repo | License | Verified | What it is | What we'd use it for |
|---|---|---|---|---|
| [`knadh/listmonk`](https://github.com/knadh/listmonk) | AGPL-3.0 ✅ | ✅ fetched | Self-hosted newsletter/mailing-list manager, single Go binary, Postgres-backed, 22.9k stars | If a venture needs bulk *opted-in* email (newsletters, product updates) without a paid ESP: deploy as its own service, drive via its API. Not for cold outreach. |
| [`mikee-ai/outreach-os`](https://github.com/mikee-ai/outreach-os) | ⚠️ unverified license | ⚠️ search result only | Self-hosted cold-email + sequence engine on Amazon SES (Next.js + Postgres worker) | Pattern reference for sequence state machines; too young to depend on |
| [`PaulleDemon/Email-automation`](https://github.com/PaulleDemon/Email-automation) | ⚠️ unverified | ⚠️ | OSS cold-outreach scheduler/personalizer | Reference only |
| [`mautic/mautic`](https://github.com/mautic/mautic) | ⚠️ GPL-3.0 from memory | ⚠️ | Mature self-hosted marketing automation (segments, campaigns, tracking) | Heavyweight; only relevant if a *venture Zeroth builds* needs marketing automation as product infrastructure |
| [`n8n-io/n8n`](https://github.com/n8n-io/n8n) | ⚠️ Sustainable-Use (fair-code, **not OSI**) from memory | ⚠️ | Workflow automation with hundreds of connectors; commonly used for DIY outreach pipelines | We deliberately do not build on it: license is not open source and its orchestration overlaps our kernel. Noted because judges may ask "why not n8n." |
| SMTP/deliverability primitives: `postal` (⚠️ MIT from memory), `haraka` (⚠️ MIT from memory) | ⚠️ | ⚠️ | Self-hosted MTA options | Only if a venture must own sending infra; default remains provider SMTP + warm domains |

**Decision:** MVP sends through Composio-connected Gmail (venture's own mailbox) at interview/sales
volume (tens/day), where deliverability infrastructure is unnecessary and consent gates are the
bottleneck by design. OSS senders become relevant only at volumes Zeroth's compliance posture
(≤50 cold/day auto-approve cap) intentionally avoids.

---

## 5. Agent skills & customer discovery tooling

| Repo | License | Verified | What it is | What we'd use it for |
|---|---|---|---|---|
| [`anthropics/skills`](https://github.com/anthropics/skills) | Apache-2.0 for most example skills; document skills (docx/pdf/pptx/xlsx) are **source-available, not open source** ✅ | ✅ fetched | Anthropic's public Agent Skills repo: `SKILL.md` format (YAML frontmatter + instructions), spec in `./spec`, template in `./template`; installable as Claude Code plugin marketplace | Two uses: (1) the `SKILL.md` pattern is prior art for our prompt-file organization (`packages/prompts`, files-not-literals so D13 can write them); (2) the document skills are the reference for D01's parser handling founder-uploaded docx/pdf — reference, not vendored, given source-available terms |
| agentskills.io spec | ⚠️ open spec, terms unverified | ⚠️ (referenced from anthropics/skills README) | The Agent Skills standard | Watch item: if D13-generated capabilities should be portable, emitting SKILL.md-compatible folders is cheap insurance |
| gstack `office-hours` | private ⚠️ | local | See §2 | D02, ported |
| `@anthropic-ai/claude-agent-sdk` | ⚠️ Anthropic SDK terms (not OSI) | ⚠️ | The agent runtime all departments run on | Already the stack (`packages/agent-kit`); noted here because its license is commercial-SDK, not OSS — fine for our use, but we cannot fork it |
| [`browser-use` skills dir](https://github.com/browser-use/browser-use) | MIT ✅ | ✅ | `browser-use skill install` registers a browser skill into coding agents | Concrete precedent for D13 "new tool" capability delivery: a capability as an installable skill folder |
| Customer discovery: *The Mom Test*, *Talking to Humans* | books ⚠️ | n/a | Interview methodology | Method source for D04's script (`script_version`), not software |
| Interview analysis OSS (e.g. `dovetail`-alikes) | — | ⚠️ | We found no maintained OSS claim-extraction/interview-repository tool worth adopting in a quick survey | Gap noted deliberately: our `Claim`/`ClaimLedger` pipeline (verbatim + polarity + strength + evidence_class, pgvector-clustered) *is* the tool; nothing off the shelf enforces evidence classes, which is the part we care about |

---

## 6. Cross-cutting takeaways for the build

1. **Port the math, not the codebase.** From simit we need `pums → archetypes → batched poll →
   post-stratify → rubric-validate`, which is a few hundred lines of `sim-core` — cleaner to port
   into `services/simpop` against our contracts than to fork the whole twin-city monorepo.
2. **License hygiene:** MIT/Apache (browser-use, Stagehand, UI-TARS, most anthropics/skills) are
   safe to vendor or depend on. AGPL (Skyvern, listmonk) = deploy-as-service only, never vendor.
   Source-available (Anthropic document skills) and fair-code (n8n) = reference only. simit's own
   license is **unresolved in our checkout — resolve before the hackathon submission**.
3. **Every external tool goes behind the tool plane.** The research above changes *drivers*, never
   department contracts — that is P7 doing its job.
4. **The pattern that repeats across all four domains:** deterministic core + model-assisted edges
   + aggressive caching + machine-checkable validation. simit does it for populations, Stagehand
   for browsers, our kernel does it for the company.

## Assumptions & open questions

- The simit backtest numbers were read from its README/rubric/NOTES, not re-run by us — ⚠️ re-run
  `cargo run --bin validate` once `services/simpop` boots; the harness is committed in the repo.

- ⚠️ items above (≈10) each need a 2-minute license/README check before any code depends on them;
  batch this into the T+0 scaffold hour.
- simit checkout licensing: the import provenance (`tejasprabhune/simfrancisco` → hackathon fork)
  suggests hackathon-authored code; get explicit permission or a LICENSE from the authors —
  the D05 port is load-bearing.
- Solari's actual API surface (vs our `BrowserTask` interface guess) is a booth-day verification
  item, already flagged in [`../03-integrations/04-solari.md`](../03-integrations/04-solari.md).
- Whether Terac exposes panel-demographic filters rich enough to replace the "interview analysis
  OSS gap" for screening is a booth question for the host.
