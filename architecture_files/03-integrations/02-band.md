# 02 — Band

> **Tier 1.** The company's nervous system. Ambient for the whole demo; decisive at 3:30.

---

## What it is

Band is **interaction infrastructure for distributed multi-agent systems**, built on two layers:

| Layer | What it provides |
|---|---|
| **Agentic Mesh** | Agent **discovery**, structured **delegation**, **shared context** exchange, and cross-framework interoperability — agents built in different frameworks, languages, and runtimes coordinate without manual wiring. |
| **Agent Interaction Control Plane** | Runtime **visibility**, **authority enforcement**, and **policy-driven governance** over those interactions, with full auditability. |

It is framework-agnostic by design — LangChain, CrewAI, Claude Code, Codex, and custom agents appear
as peers on one mesh. It captures the observability "atoms" of multi-agent work: inter-agent messages,
the reasoning behind decisions, tool calls and results, tasks, errors, and **handoff points where
control transfers**.

---

## Our creative angle

Most teams will use Band as a message bus with nicer logging. Three things make our usage structural:

**1. Departments are peers, not function calls.** Each of D01–D13 registers as a Band agent identity
with a declared capability set. Nothing in Zeroth imports another department's code — the constraint
in [`../00-START-HERE/03-org-chart.md`](../00-START-HERE/03-org-chart.md) ("departments never call each
other's functions") is *enforced by the transport*, not by convention.

**2. Persistent rooms are where the company argues.** Five long-lived rooms carry shared context
across the whole venture lifetime. Sales and Finance don't exchange RPCs; they hold a running
conversation about a late invoice. HR and every department hold a running conversation about
requisitions and their ROI. **The Terac renegotiation at 1:50 happens in `hr↔all`** — the single most
"this is a company" moment in the demo happens inside a Band room, on purpose.

**3. Agent discovery is how D13's new department becomes reachable without a redeploy.**
This is the payoff. At 3:30 the Chief of Staff detects a capability gap, writes a
`DepartmentManifest`, shadow-tests it in a forked sandbox, and deploys it. That new department
**registers itself on the mesh and announces its capabilities**, and D10 Sales — which has been
running for three minutes and was never restarted — discovers it and routes the next security-review
objection to it. Without discovery, "the company grew an organ" is a redeploy. With it, it's a live
capability appearing in a running system.

> The difference between *"we hardcoded 13 departments"* and *"the company can grow"* is one Band API.

---

## Which departments use it

All of them — Band is the default transport for `WorkOrder` / `ArtifactReady` / `Escalation`. Room
membership is what's interesting:

| Room | Members | Purpose | Demo beat |
|---|---|---|---|
| `executive-briefing` | D01-D13 heads, D13 facilitator | Daily 7:00 AM goals meeting; publishes the `DailyBriefing` operating plan | first screen / daily reset |
| `sales↔finance` | D10, D11 | Collections, invoice aging, discount authority, rail choice | 2:55, 3:15 |
| `support↔build` | D12, D07 | Bug triage, repro handoff, severity negotiation, Replay recording links | ambient (2:25) |
| `market↔pivot` | D03, D06 | Evidence exchange, contested claims, confidence disputes | 1:00 → 2:10 |
| `hr↔all` | D11/HR + all 13 | `HumanWorkRequisition` filing, ROI negotiation, hire announcements | **1:50** |
| `cos↔all` | D13 (read-only observer) + all 13 | Telemetry observation; D13 never speaks here, it *listens* | **3:30** |

`cos↔all` being read-only is a governance policy, not politeness — see below.

---

## Integration spec

> **ASSUMPTION:** Band launched recently and the SDK surface below is our *design* against its
> published architecture (mesh + control plane; discovery, delegation, shared context, governance
> policy, cross-framework peers). Names and call shapes are ours; the concepts are Band's.
>
> **VERIFY AT HACKATHON (Band booth, day one):**
> 1. SDK package name and language support (we need Node/TS; a REST surface is acceptable).
> 2. Registration: is agent identity issued by the control plane, or self-asserted with a key?
> 3. **Rooms:** are persistent multi-peer rooms with shared context a first-class primitive, or do we
>    compose them from topics/channels? This changes `BandRoom` from a thin wrapper to a real adapter.
> 4. **Discovery:** query shape for "who can do X" — capability tags, semantic match, or registry lookup?
>    And is a newly-registered agent immediately discoverable (this is the 3:30 beat).
> 5. **Governance policies:** are policies declared per-agent, per-room, or centrally? Can a policy deny
>    a *tool call* or only a *message*? We assume message-level enforcement and keep tool allowlists
>    enforced locally too — belt and braces.
> 6. Delivery semantics (at-least-once assumed) and whether Band supplies a message id we can dedupe on.
> 7. Observability export: can we pull the control plane's trace view, or link out to it from the Boardroom?

### Registration

Every department registers at venture start, and D13-spawned departments register at deploy time
through the exact same code path.

```ts
// packages/bus/src/drivers/band.ts
const identity = await band.agents.register({
  agent_id: 'zeroth.D03.market',
  display_name: 'Market Research',
  framework: 'claude-agent-sdk',
  version: manifest.version,
  capabilities: [
    { name: 'research_niches',  input: 'SharpenedIdea',  output: 'NicheDossier[]' },
    { name: 'verify_claim',     input: 'Claim',          output: 'ClaimVerdict'   },
    { name: 'pricing_scan',     input: 'CompetitorSet',  output: 'PricingTable'   },
  ],
  metadata: { venture_id, cluster: 'discovery', department_id: 'D03' },
});
```

**The capability list is generated from the manifest's `io` block** — the same YAML the runtime uses
to build the agent ([`../01-platform/02-agent-runtime.md`](../01-platform/02-agent-runtime.md)). One
source of truth means D13 gets discovery for free: it writes a manifest, the manifest declares
capabilities, registration publishes them.

### Discovery — the 3:30 mechanism

```ts
// D10 Sales, mid-run, has lost three deals to security review.
const peers = await band.discover({
  capability: 'security_questionnaire_response',
  venture_id,
});

if (peers.length === 0) {
  await bus.publish(Escalation.parse({
    from: 'D10', reason: 'needs_capability', severity: 'degrading',
    summary: 'Lost 3 deals at security review; no department can answer a security questionnaire.',
    options: [
      { id: 'spawn',  label: 'Design a new department', consequence: '~$2 and 90s of D13 time' },
      { id: 'human', label: 'Hire a security consultant via Terac', consequence: '~$120' },
      { id: 'skip',  label: 'Disqualify enterprise leads', consequence: 'pipeline −40%' },
    ],
    suggested_option_id: 'spawn',
  }));
}
// …D13 designs, shadow-tests, deploys D14. D14 registers.
// D10's next cycle calls band.discover() again — no redeploy, no restart, no config change.
```

`band.discover()` is called by Heads at the top of the loop whenever they need a capability they
don't own. That is *why* the 3:30 beat works: discovery is on the hot path already, so a new peer is
picked up on the very next cycle.

### Rooms

```ts
const room = await band.rooms.ensure({
  room_id: `${venture_id}:hr↔all`,
  members: ['zeroth.D11.hr', ...ALL_DEPARTMENT_AGENT_IDS],
  persistence: 'durable',            // survives sandbox pause/resume
  shared_context: {
    schema_ref: 'HrRoomContext',
    initial: { hr_envelope_usd: 40, founder_human_spend_cap_usd: 50, open_requisitions: [] },
  },
  policy_ids: ['spend-authority-hr', 'no-pii-in-rooms'],
});

await room.send({
  type: 'Escalation',
  body: escalation,                  // Zod-validated before send AND after receive
  idempotency_key: hash(work_order_id, 'escalation', escalation.id),
});
```

The `executive-briefing` room is created at venture start and reused every morning. D13 posts one
final internal broadcast after the heads converge on the day's goals; raw debate, speculative
changes, and unresolved budget fights stay out of the all-company broadcast.

**Shared context** is the room's small mutable blob — the aging invoice list in `sales↔finance`, the
open-requisition list and remaining envelope in `hr↔all`. It lets two departments hold a *running
negotiation* instead of re-establishing state on every message. It is a cache with the event store
behind it: **if the shared context and the event store disagree, the event store wins**, always.

| Room lifecycle | Trigger |
|---|---|
| `ensure` | Venture creation, or first time a member department is instantiated |
| `join` | A D13-spawned department joins `hr↔all` and `cos↔all` on deploy |
| `snapshot` | Before every sandbox pause; shared context persisted to Postgres |
| `restore` | On resume — room rehydrates from Band if available, from the event store if not |
| `archive` | Venture killed or completed; room becomes read-only, retained for audit |

### Message mapping

Our three contracts from [`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md) map onto
Band primitives:

| Zeroth message | Band primitive | Notes |
|---|---|---|
| `WorkOrder` | **Delegation** — structured task handoff with a declared expected output | Band's handoff/control-transfer atom is exactly our semantics; the control plane's trace shows the DAG for free |
| `ArtifactReady` | **Message** in the originating room, or direct to subscribers of the routing rule | Body carries an `ArtifactRef` (`{type,id,version,hash}`), never the artifact bytes. Artifacts live in the registry; the mesh carries pointers |
| `Escalation` | **Message**, plus a control-plane **authority check** | An escalation with `reason='needs_budget'` is routed to D11 by governance policy, not by application code |
| Cost report | Message metadata | Attached to `ArtifactReady`; also mirrored to the meter |

**Invariant preserved:** `agent.emit()` writes to the event store *first*, then publishes to the bus.
Band is a delivery mechanism; the event store is the record. `bus.transport ∈ {'band','pg'}` is
stamped on every event so we can answer "which path did this take?" on stage.

```
agent.emit(msg) ──► EventStore.append(event)          ── always, first
                        │
                        ├──► Band.rooms.send(...)     ── if healthy
                        └──► pg_notify(...)           ── fallback / mirror
```

### Governance policies

Declared in `packages/manifests/band-policies.yaml`, applied at the control plane. These are the
*same* constraints as the org chart's "who can spend money" / "who can talk to the outside world"
tables — enforced twice, once locally by the runtime's tool allowlist and once centrally by Band.
Defense in depth, and the central one is what a judge can actually *see*.

```yaml
# packages/manifests/band-policies.yaml
- id: spend-authority-hr
  description: Only HR may commit money to human labor, up to the founder cap.
  applies_to: [zeroth.D11.hr]
  allow:
    - action: delegate
      capability: terac.hire
      constraints:
        max_usd_per_delegation: 50
        requires_context_key: founder_human_spend_cap_usd
  deny_all_others: true

- id: money-out-is-d11-only
  description: No department except Finance may emit a money-out delegation.
  applies_to: ["zeroth.D*"]
  except: [zeroth.D11.finance, zeroth.D11.hr]
  deny:
    - action: delegate
      capability_matches: ["stripe.*", "whop.*", "dodo.*", "terac.hire", "render.create_service"]
  on_violation: reject_and_emit    # → Escalation(needs_budget) to D11, automatically

- id: public-content-gated
  description: Publishing requires an approved gate id in the message envelope.
  applies_to: [zeroth.D08.strategy, zeroth.D10.sales, zeroth.D07.build]
  allow:
    - action: delegate
      capability_matches: ["lovable.publish", "solari.post_public", "composio.linkedin.post"]
      constraints: { requires_envelope_field: approved_gate_id }
  on_violation: reject_and_emit

- id: cos-is-read-only
  description: Chief of Staff observes; it does not direct departments mid-cycle.
  applies_to: [zeroth.D13.cos]
  rooms: ["*:cos↔all"]
  allow: [{ action: subscribe }]
  deny:  [{ action: send }]
  # D13 acts by writing manifests + routing rules, never by messaging a running department.

- id: no-pii-in-rooms
  description: Worker/lead PII never transits the mesh.
  applies_to: ["zeroth.*"]
  deny:
    - action: send
      body_matches_any: [email_regex, phone_regex, ssn_regex]
  on_violation: redact_and_warn     # message passes with PII replaced by a vault handle

- id: worker-cannot-cross-departments
  description: Only Heads talk across departments.
  applies_to: ["zeroth.*.worker.*"]
  deny: [{ action: send, scope: cross_agent }]
```

`on_violation: reject_and_emit` is the elegant part: a department that tries to spend money it isn't
allowed to spend doesn't crash — the control plane rejects the delegation and the rejection *becomes*
an `Escalation(needs_budget)` to Treasury. **The governance layer generates correct organizational
behavior out of a policy denial.**

---

## The fallback bus

Per the hackathon brief and our own invariants, Band is primary but never load-bearing for
*correctness*. Both drivers implement one interface; the kernel cannot tell them apart.

```ts
// packages/bus/src/index.ts — THE interface. Two drivers, zero semantic difference.
export interface Bus {
  register(spec: AgentRegistration): Promise<AgentIdentity>;
  discover(q: { capability: string; venture_id: string }): Promise<AgentIdentity[]>;

  ensureRoom(spec: RoomSpec): Promise<Room>;
  join(room_id: string, agent_id: string): Promise<void>;

  publish(msg: WorkOrder | ArtifactReady | Escalation, opts: {
    room_id?: string;
    to?: DepartmentId;
    idempotency_key: string;
  }): Promise<{ message_id: string; transport: 'band' | 'pg' }>;

  subscribe(
    filter: { room_id?: string; to?: DepartmentId; types?: MessageType[] },
    handler: (msg: BusMessage, ack: () => Promise<void>) => Promise<void>,
  ): Unsubscribe;

  health(): Promise<{ ok: boolean; latency_ms: number; transport: 'band' | 'pg' }>;
}

export interface Room {
  id: string;
  send(m: OutboundMessage): Promise<{ message_id: string }>;
  context(): Promise<Record<string, unknown>>;
  patchContext(p: Record<string, unknown>): Promise<void>;   // CAS on a version int
  snapshot(): Promise<RoomSnapshot>;
}
```

### Driver B — Postgres `LISTEN/NOTIFY` + BullMQ

| Band concept | Postgres implementation |
|---|---|
| Agent registration | `INSERT INTO mesh_agents (agent_id, capabilities jsonb, venture_id, registered_at)` |
| Discovery | `SELECT … WHERE capabilities @> '[{"name":"$cap"}]' AND venture_id = $v` — a GIN index on `capabilities`. **D13's new department is discoverable the moment its row lands.** The 3:30 beat works on the fallback too; it just has no pretty trace view. |
| Room | `mesh_rooms` row + `mesh_room_members`; `shared_context jsonb` with an optimistic-concurrency `version int` |
| Publish | `INSERT INTO bus_messages` → `pg_notify('bus_' || channel, message_id)` → BullMQ job enqueued for durable retry |
| Subscribe | One `LISTEN` per orchestrator process, fanned to in-process handlers; BullMQ is the durable path for anything not delivered live |
| Delegation semantics | Same `bus_messages` row with `kind='WorkOrder'`; the orchestrator's queue consumer *is* the delegation runtime |
| Governance policy | Same `band-policies.yaml`, evaluated in-process by `packages/bus/src/policy.ts` before publish. **The policy file is the source of truth in both drivers** — Band enforces it centrally, the fallback enforces it locally |
| Observability | The event store already has every atom Band collects (messages, tool calls, errors, handoffs). The Boardroom renders it; we just lose Band's cross-framework trace UI |

### Failover

```ts
health check every 5s
  ├─ band.health() ok        → transport = 'band'
  └─ 3 consecutive failures  → emit('bus.degraded', {reason})
                             → transport = 'pg'
                             → Boardroom shows an amber "degraded mesh" chip
                             → retry band.health() every 30s
                                └─ recovered → emit('bus.recovered'), transport = 'band'
```

**No message is lost across a failover**, because `EventStore.append()` already happened. On recovery
the Band driver replays any `bus_messages` rows with `transport='pg' AND delivered_to_band=false`
that are still within their `trace_id`'s active window. Duplicate delivery is safe: every consumer
dedupes on `idempotency_key` via `processed_messages`.

---

## Failure modes and fallback

| Failure | Detection | Behavior |
|---|---|---|
| Band API unreachable | `health()` ×3 | Failover to PG driver, `bus.degraded` event, amber chip. Demo continues; we point at the chip and say "the mesh just went down and nothing stopped." That's a *better* beat than a green light. |
| Rooms aren't a first-class primitive | Discovered at the booth | `BandRoom` becomes a composite over topics + a Postgres-held shared context. The `Room` interface is unchanged; only the driver internals move. |
| Discovery is eventually-consistent (new agent not immediately visible) | 3:30 beat stalls | D13's deploy step **blocks on a discovery read-your-write check** (`register → discover → assert present`, 5s timeout) before emitting `cos.department_deployed`. If it times out, we fall through to the PG registry for that one query and log it. |
| Governance policy can't express a constraint | Policy load-time validation | The runtime's local tool allowlist is unchanged and still enforces it. Band-side enforcement is *additional*, never sole. |
| Message ordering across rooms | Never assumed | Ordering is per-`trace_id` only, as stated in the event-bus spec. Both drivers honor that and nothing more. |
| Rate limits on mesh publish | 429s | Token-bucket per department in `packages/bus`; over-limit messages queue in BullMQ rather than drop. Heads see backpressure as latency, not errors. |

---

## Demo beats

**Ambient, 1:00 onward.** The Boardroom floor plan draws **live message arcs between rooms**. When
D03 and D06 argue about a contested claim, the arc between Market and Pivot pulses. The
`transport: band` chip is green in the corner. This is set dressing that happens to be true.

**1:50 — the negotiation.** The Terac ROI renegotiation is a visible thread in the `hr↔all` room
panel: D04 asks, HR refuses with numbers, D04 narrows the ICP, HR approves. Three messages, one
room, real money at the end.

**3:30 — the finale.** In order, on screen:
1. D10's `band.discover({capability: 'security_questionnaire_response'})` returns `[]` — shown as a
   grey "no peer" result.
2. `Escalation(needs_capability)` travels to `cos↔all`.
3. D13 writes `D14-security-review.yaml`, forks a sandbox, shadow-tests it against the three lost deals.
4. `band.agents.register('zeroth.D14.security', capabilities:[…])` — **a new sprite walks into a new room.**
5. D10's next cycle calls `discover()` again and this time gets a hit. The arc from Sales to the new
   room lights up.
6. **Nothing was redeployed.** Say that sentence out loud while the arc is drawing.

---

## Track-winning pitch sentence

> **"Band isn't our message bus — it's our org chart at runtime. Departments discover each other,
> negotiate budget in persistent rooms, and are held to spend authority by control-plane policy. When
> the company invented a fourteenth department on stage, Sales found it through mesh discovery on the
> next cycle, with no redeploy."**

---

**See also:** [`00-sponsor-strategy.md`](00-sponsor-strategy.md) ·
[`../01-platform/03-event-bus.md`](../01-platform/03-event-bus.md) (message contracts, routing) ·
[`../01-platform/02-agent-runtime.md`](../01-platform/02-agent-runtime.md) (manifests → capabilities) ·
[`01-terac.md`](01-terac.md) (the `hr↔all` negotiation) ·
[`05-superserve.md`](05-superserve.md) (pause/resume vs room persistence)
