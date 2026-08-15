# ZEROTH — backend

The kernel, agent runtime, and orchestrator for an autonomous company.
**Backend only.** The Boardroom frontend is being designed separately; do not add
`apps/boardroom` here yet.

Architecture lives in [`architecture_files/`](architecture_files/); start with
[`BUILD-TUTORIAL.md`](architecture_files/BUILD-TUTORIAL.md).

## Run it right now (zero API keys)

```bash
pnpm install
pnpm demo          # boots the kernel, drives a venture end to end, prints the timeline
pnpm test          # every package
```

With no keys set, the system runs on an embedded Postgres (PGlite, no docker),
a deterministic `MockLlmClient`, and mock tool drivers. Everything is real code
on the real code path; only the outside world is simulated.

```bash
pnpm dev:kernel        # http://localhost:4000
pnpm dev:simpop        # http://localhost:8080, optional for real simpop tools
pnpm dev:orchestrator  # consumes work orders
```

## What exists

| Package | Purpose |
|---|---|
| `packages/contracts` | Zod schemas for every artifact, event, message, manifest, API DTO. **Frozen.** |
| `packages/db` | Schema + dual driver: PGlite (dev) or real Postgres via `DATABASE_URL`. |
| `apps/kernel` | Event store, artifact registry + evidence enforcement, gates, budget meter, router, vault, REST/SSE/webhooks. |
| `packages/agent-kit` | Head → workers → critic → one revision loop. Anthropic client + deterministic mock. |
| `packages/manifests` | 13 department manifests + `routing.yaml`, both schema-validated. |
| `packages/prompts` | Per-agent prompt files with shared evidence/safety preamble. |
| `packages/tool-plane` | Every external tool behind one interface; mock and real drivers. |
| `packages/sandbox` | `lease/pause/resume/fork/exec` with local and Superserve drivers. |
| `services/simpop` | Local synthetic population service using PUMS-style weights, personas, archetypes, and bootstrap CIs. |
| `apps/orchestrator` | Consumes work orders, runs departments, meters spend, opens gates. |

## Invariants (each has a test)

1. `events` is append-only and is the only source of truth; the DB rejects UPDATE/DELETE.
2. An artifact with an uncited number **cannot be signed**.
3. A load-bearing number backed only by synthetic evidence **cannot be signed**.
4. `money_out` and `outbound_to_real_person` are **never** auto-approved, at any autonomy level.
5. An approved gate's side effect runs **exactly once**.
6. An agent can only call tools its manifest lists.
7. The kill switch halts all routing and execution.
8. Budgets degrade the model tier at 80% and freeze the department at the cap.

## When the API keys arrive

Paste them into `.env`, then flip:

```bash
ZEROTH_TOOLS=real     # vendor drivers instead of mocks
ZEROTH_LLM=real       # requires ANTHROPIC_API_KEY
```

Any vendor whose key is still missing falls back to its mock automatically and
emits a `degraded` notice, so a missing sponsor key never blocks the demo.
For real `simpop.*` tools, run `pnpm dev:simpop` and keep `SIMPOP_URL=http://localhost:8080`.
For real `leadgen.*`, `crm.upsert`, `support.upsert_ticket`, and `metrics.record_signal`,
point `BUSINESS_TOOLS_URL` at an internal gateway; otherwise they use deterministic mocks.

Founder phone approvals are ready through Linq: set `LINQ_API_KEY`, optional `LINQ_BASE_URL`,
`LINQ_WEBHOOK_SECRET`, and `FOUNDER_PHONE`, then use gates with `channel:"linq"`. The kernel texts
the founder when the gate opens and Linq webhooks can approve/reject by reply.

Solari/computer-use is ready behind `solari.browse`, `solari.act`, `solari.extract`, and
`solari.screenshot`. Set `SOLARI_API_KEY` and `SOLARI_BASE_URL` once Pinetree/Solari gives the
hosted endpoint; without them the same guarded task interface uses mocks.

ElevenLabs voice is ready behind `elevenlabs.clone_voice`, `elevenlabs.create_agent`,
`elevenlabs.place_call`, `elevenlabs.transcribe`, `elevenlabs.tts`, and `elevenlabs.delete_voice`.
Set `ELEVENLABS_API_KEY`; add `ELEVENLABS_VOICE_ID` after founder consent/clone, plus
`ELEVENLABS_AGENT_ID` and `ELEVENLABS_PHONE_NUMBER_ID` for outbound calling.

## Database

Local dev uses PGlite and needs nothing installed. For real Postgres:

```bash
DATABASE_URL=postgres://user:pass@host:5432/zeroth pnpm dev:kernel
```

The schema is applied on boot and is identical across both drivers.
