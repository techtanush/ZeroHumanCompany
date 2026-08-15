# 04 — Data Model

Postgres 16 + `pgvector`. Drizzle ORM for schema + migrations. One database, one schema (`public`),
`venture_id` on nearly everything.

**The rule that shapes everything below:** `events` is the truth. Every other table is either
(a) a **projection** rebuildable by replaying events, or (b) a **content store** for immutable blobs
(artifacts, transcripts, embeddings) that events *point at*. If you ever need to ask "is this table
authoritative?", the answer is no — unless it's `events` or `artifacts`.

```
                writes                     rebuilds
agents ──emit──► events ──► reducers ──► projections ──► Boardroom reads
                   │                         (ventures, deals, budgets, gates…)
                   └──► artifacts (immutable, hashed, signed) ◄── content-addressed refs
```

---

## Conventions

| Convention | Value |
|---|---|
| Primary keys | `uuid` (`gen_random_uuid()`), except `events.seq bigserial` |
| Timestamps | `timestamptz`, `now()` default, column named `*_at` |
| Money | `numeric(14,6)` USD. Never floats. Sub-cent precision because token costs are tiny. |
| Enums | Postgres `text` + `CHECK` constraint, not native enums (migrations are cheaper) |
| Department id | `text` matching `^D(0[1-9]|1[0-3])$` |
| Soft delete | Does not exist. Nothing is deleted; state changes are events. |
| JSON | `jsonb`, always with a Zod schema in `packages/contracts` as the authority |

---

## Core: tenancy

```sql
CREATE TABLE founders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  phone_e164      text UNIQUE,              -- Linq destination
  display_name    text,
  timezone        text NOT NULL DEFAULT 'America/Los_Angeles',
  quiet_hours     jsonb NOT NULL DEFAULT '{"start":"22:00","end":"07:00"}',
  spend_cap_usd   numeric(14,6) NOT NULL DEFAULT 50.00,   -- hard ceiling, founder-set
  terac_cap_usd   numeric(14,6) NOT NULL DEFAULT 200.00,  -- human-hire ceiling
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ventures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  founder_id      uuid NOT NULL REFERENCES founders(id),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  mode            text NOT NULL CHECK (mode IN ('founder_led','autonomous_origination')),
  autonomy_level  text NOT NULL DEFAULT 'supervised'
                    CHECK (autonomy_level IN ('copilot','supervised','autonomous')),
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','killed','graduated')),
  time_scale      numeric NOT NULL DEFAULT 1.0,   -- 0.001 in demo: compresses all crons
  trace_id        text NOT NULL,                  -- spans the whole venture; see 10-observability
  liveness        jsonb NOT NULL DEFAULT
    '{"idea_locked":false,"market_validated":false,"product_live":false,
      "pipeline_active":false,"revenue_real":false}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  killed_at       timestamptz
);
CREATE INDEX ON ventures (founder_id, status);
```

`ventures.liveness` is the five-segment ring in the Boardroom. It is a **projection** —
recomputed by the `liveness` reducer from `artifact.signed`, `build.deployed`,
`sales.lead_created`, and `money.revenue_received`.

---

## Core: the event log

```sql
CREATE TABLE events (
  seq             bigserial,
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  ts              timestamptz NOT NULL DEFAULT now(),
  type            text NOT NULL,          -- 'artifact.signed', 'gate.opened', …
  actor_kind      text NOT NULL CHECK (actor_kind IN ('agent','founder','system','webhook','human_hire')),
  actor_id        text NOT NULL,          -- 'market.head' | founder uuid | 'stripe' | terac worker id
  department_id   text,
  payload         jsonb NOT NULL,
  trace_id        text NOT NULL,
  causation_id    uuid,                   -- the event that caused this one
  correlation_id  uuid,                   -- the work order / gate / call this belongs to
  bus_transport   text CHECK (bus_transport IN ('band','pg_notify','none')),
  PRIMARY KEY (venture_id, seq)
) PARTITION BY HASH (venture_id);

-- 8 partitions. Demo needs 1; the shape is what matters.
CREATE TABLE events_p0 PARTITION OF events FOR VALUES WITH (MODULUS 8, REMAINDER 0);
-- … p1..p7

CREATE INDEX ON events (venture_id, type, ts DESC);
CREATE INDEX ON events (trace_id);
CREATE INDEX ON events (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX ON events USING gin (payload jsonb_path_ops);

-- Append-only, enforced:
CREATE RULE events_no_update AS ON UPDATE TO events DO INSTEAD NOTHING;
CREATE RULE events_no_delete AS ON DELETE TO events DO INSTEAD NOTHING;
```

Partitioning by `venture_id` (hash) rather than by time, because every read is venture-scoped —
the Boardroom never asks "what happened globally at 3pm", it asks "what has this company done".

```sql
CREATE TABLE processed_messages (   -- exactly-once effect over at-least-once delivery
  consumer      text NOT NULL,      -- 'D06.head'
  message_id    uuid NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, message_id)
);
```

---

## Core: artifacts

```sql
CREATE TABLE artifacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL REFERENCES ventures(id),
  type            text NOT NULL,          -- 'NicheDossier' | 'ProductSpec' | …
  version         int  NOT NULL DEFAULT 1,
  lineage_id      uuid NOT NULL,          -- stable across versions; v1 sets it to its own id
  body            jsonb NOT NULL,         -- validated against the Zod schema for `type`
  body_hash       text NOT NULL,          -- sha256(canonical_json(body))
  schema_version  text NOT NULL,          -- 'NicheDossier@1.2.0'
  quality         text NOT NULL CHECK (quality IN ('draft','signed','partial','contested','superseded')),
  gaps            text[] NOT NULL DEFAULT '{}',
  produced_by     text NOT NULL,          -- agent_id
  department_id   text NOT NULL,
  work_order_id   uuid,
  signature       text,                   -- HMAC(body_hash, kernel_signing_key); NULL until signed
  signed_at       timestamptz,
  cost_usd        numeric(14,6) NOT NULL DEFAULT 0,
  superseded_by   uuid REFERENCES artifacts(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lineage_id, version)
);
CREATE INDEX ON artifacts (venture_id, type, version DESC);
CREATE INDEX ON artifacts (venture_id, quality) WHERE quality = 'signed';
CREATE INDEX ON artifacts USING gin (body jsonb_path_ops);
```

**Artifacts are immutable.** A "change" is a new row with `version+1` and the same `lineage_id`;
the old row gets `quality='superseded'` and `superseded_by`. `ArtifactRef` in
[`03-event-bus.md`](03-event-bus.md) is `{type, id, version, hash}` — the hash makes every reference
tamper-evident.

### Sources & evidence (the anti-hallucination spine — see [`11-evidence-and-truth.md`](11-evidence-and-truth.md))

```sql
CREATE TABLE sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN
                    ('web_page','api_response','census_pums','interview','stripe_object',
                     'repo_file','support_ticket','synthetic_panel','human_hire_output','model_estimate')),
  uri             text,                 -- URL, s3://…, pums://ca/2022, interview:<uuid>
  title           text,
  retrieved_at    timestamptz NOT NULL DEFAULT now(),
  content_hash    text,                 -- sha256 of the snapshot
  snapshot_uri    text,                 -- object storage; we keep what we read
  publisher       text,
  reliability     numeric CHECK (reliability BETWEEN 0 AND 1),  -- tier prior, see 11-
  fetched_by      text                  -- agent_id
);
CREATE INDEX ON sources (venture_id, kind);
CREATE UNIQUE INDEX ON sources (venture_id, content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE artifact_sources (        -- claim-level, not artifact-level
  artifact_id     uuid NOT NULL REFERENCES artifacts(id),
  source_id       uuid NOT NULL REFERENCES sources(id),
  json_pointer    text NOT NULL,       -- '/tam_usd' — which field this source backs
  excerpt         text NOT NULL,       -- the exact supporting span
  confidence      numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  method          text NOT NULL CHECK (method IN ('measured','derived','estimated','asserted')),
  PRIMARY KEY (artifact_id, source_id, json_pointer)
);
CREATE INDEX ON artifact_sources (source_id);
```

---

## Departments, runs, work

```sql
CREATE TABLE departments (            -- instantiated per venture from a manifest
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL REFERENCES ventures(id),
  department_id   text NOT NULL,      -- 'D03'
  manifest_yaml   text NOT NULL,      -- frozen copy; D13-generated depts store theirs here
  manifest_hash   text NOT NULL,
  cluster         text NOT NULL,      -- discovery|validation|build|gtm|ops
  state           text NOT NULL DEFAULT 'idle'
                    CHECK (state IN ('idle','working','blocked','frozen','retired')),
  origin          text NOT NULL DEFAULT 'seed' CHECK (origin IN ('seed','cos_generated')),
  room_x          int, room_y int,    -- Boardroom floor-plan slot
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venture_id, department_id)
);

CREATE TABLE work_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  from_dept       text NOT NULL,
  to_dept         text NOT NULL,
  intent          text NOT NULL,
  input_artifacts jsonb NOT NULL DEFAULT '[]',   -- ArtifactRef[]
  params          jsonb NOT NULL DEFAULT '{}',
  budget_usd      numeric(14,6) NOT NULL,
  success_criteria text[] NOT NULL DEFAULT '{}',
  soft_deadline_at timestamptz,
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','admitted','running','partial','done','failed','cancelled')),
  attempt         int NOT NULL DEFAULT 0,
  output_artifact_id uuid REFERENCES artifacts(id),
  trace_id        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz, finished_at timestamptz
);
CREATE INDEX ON work_orders (venture_id, status, created_at);
CREATE INDEX ON work_orders (to_dept, status) WHERE status IN ('queued','running');

CREATE TABLE agent_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  work_order_id   uuid REFERENCES work_orders(id),
  department_id   text NOT NULL,
  agent_id        text NOT NULL,           -- 'market.demand'
  role            text NOT NULL CHECK (role IN ('head','worker','critic')),
  replica_index   int NOT NULL DEFAULT 0,
  model           text NOT NULL,           -- resolved: 'claude-opus-4-6' | 'pioneer:lead-scorer-v3'
  model_tier      text NOT NULL CHECK (model_tier IN ('opus','sonnet','haiku','pioneer')),
  sandbox_id      text,
  prompt_hash     text NOT NULL,
  input_refs      jsonb NOT NULL DEFAULT '[]',
  output_artifact_id uuid REFERENCES artifacts(id),
  status          text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','ok','failed','timeout','aborted','budget_exceeded')),
  tokens_in       bigint NOT NULL DEFAULT 0,
  tokens_out      bigint NOT NULL DEFAULT 0,
  tokens_cached   bigint NOT NULL DEFAULT 0,
  cost_usd        numeric(14,6) NOT NULL DEFAULT 0,
  decisions       jsonb NOT NULL DEFAULT '[]',   -- [{options[], chosen, rationale, cost_usd}]
  error           jsonb,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX ON agent_runs (venture_id, department_id, started_at DESC);
CREATE INDEX ON agent_runs (work_order_id);

CREATE TABLE escalations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  from_dept       text NOT NULL,
  reason          text NOT NULL CHECK (reason IN
                    ('needs_human','needs_budget','needs_capability','needs_credential','needs_approval')),
  severity        text NOT NULL CHECK (severity IN ('blocking','degrading','informational')),
  summary         text NOT NULL,
  detail          text NOT NULL DEFAULT '',
  options         jsonb NOT NULL DEFAULT '[]',
  suggested_option_id text,
  rung            text NOT NULL DEFAULT 'department_head'   -- see 06-human-in-the-loop
                    CHECK (rung IN ('agent_retry','sibling_worker','department_head',
                                    'chief_of_staff','founder','terac_hire')),
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','resolved','expired','cancelled')),
  resolved_option_id text,
  resolved_by     text,
  blocks_work_order_id uuid REFERENCES work_orders(id),
  trace_id        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);
CREATE INDEX ON escalations (venture_id, status, severity);
```

---

## Gates (approval protocol — see [`06-human-in-the-loop.md`](06-human-in-the-loop.md))

```sql
CREATE TABLE gates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  gate_type       text NOT NULL CHECK (gate_type IN
                    ('money_out','public_content','outbound_to_real_person','account_creation',
                     'pivot_approval','deploy','refund','new_department')),
  requested_by    text NOT NULL,               -- agent_id
  department_id   text NOT NULL,
  action          jsonb NOT NULL,              -- the exact side effect, replayable on approve
  preview         jsonb NOT NULL,              -- what the founder sees (card payload)
  options         jsonb NOT NULL,              -- [{id,label,consequence}]
  suggested_option_id text,
  amount_usd      numeric(14,6),               -- money_out / refund only
  risk            text NOT NULL DEFAULT 'medium' CHECK (risk IN ('low','medium','high')),
  reversible      boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN
                    ('pending','auto_approved','approved','rejected','redirected','timed_out','expired','cancelled')),
  batch_id        uuid,                        -- gates delivered in one Linq card
  channel         text CHECK (channel IN ('linq','boardroom','auto')),
  decided_by      text,
  decided_option_id text,
  decision_note   text,                        -- founder's free-text redirect
  timeout_s       int NOT NULL DEFAULT 900,
  on_timeout      text NOT NULL DEFAULT 'hold'
                    CHECK (on_timeout IN ('auto_approve','auto_reject','hold','escalate_terac')),
  idempotency_key text NOT NULL,
  work_order_id   uuid REFERENCES work_orders(id),
  trace_id        text NOT NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  decided_at      timestamptz,
  UNIQUE (venture_id, idempotency_key)
);
CREATE INDEX ON gates (venture_id, status, opened_at DESC);
CREATE INDEX ON gates (expires_at) WHERE status = 'pending';
```

---

## Money (see [`08-money-and-metering.md`](08-money-and-metering.md))

```sql
CREATE TABLE meters (               -- append-only consumption facts
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  department_id   text NOT NULL,
  agent_run_id    uuid REFERENCES agent_runs(id),
  work_order_id   uuid REFERENCES work_orders(id),
  unit            text NOT NULL CHECK (unit IN
                    ('tokens_in','tokens_out','tokens_cached_write','tokens_cached_read',
                     'sandbox_seconds','tool_call','voice_minute','terac_hire','storage_gb_hour','egress_gb')),
  resource        text NOT NULL,     -- 'claude-sonnet-4-6' | 'composio.gmail.send' | 'solari.session'
  quantity        numeric(20,6) NOT NULL,
  unit_cost_usd   numeric(20,10) NOT NULL,
  cost_usd        numeric(14,6) NOT NULL,
  cycle_id        uuid NOT NULL,
  ts              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON meters (venture_id, cycle_id, department_id);
CREATE INDEX ON meters (venture_id, ts DESC);

CREATE TABLE budgets (              -- one row per (venture, cycle)
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  cycle_id        uuid NOT NULL UNIQUE,
  cycle_index     int NOT NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closes_at       timestamptz NOT NULL,
  total_usd       numeric(14,6) NOT NULL,
  runway_usd      numeric(14,6) NOT NULL,      -- founder float + realized revenue − committed
  policy          jsonb NOT NULL DEFAULT '{}'  -- {downgrade_at:0.8, freeze_at:1.0}
);

CREATE TABLE budget_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  cycle_id        uuid NOT NULL,
  department_id   text NOT NULL,
  envelope_usd    numeric(14,6) NOT NULL,
  hard_cap_usd    numeric(14,6) NOT NULL,
  reserved_usd    numeric(14,6) NOT NULL DEFAULT 0,   -- committed but not yet spent
  spent_usd       numeric(14,6) NOT NULL DEFAULT 0,   -- materialized from meters
  state           text NOT NULL DEFAULT 'active'
                    CHECK (state IN ('active','degraded','frozen','thawed')),
  rationale       text,                                -- Treasury's reasoning, shown in the UI
  allocated_by    text NOT NULL DEFAULT 'finance.treasurer',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, department_id)
);

CREATE TABLE reservations (         -- two-phase spend: reserve → commit | release
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  cycle_id        uuid NOT NULL,
  department_id   text NOT NULL,
  work_order_id   uuid REFERENCES work_orders(id),
  amount_usd      numeric(14,6) NOT NULL,
  state           text NOT NULL DEFAULT 'held' CHECK (state IN ('held','committed','released','expired')),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON reservations (cycle_id, department_id, state);
```

---

## Humans: requisitions and Terac hires

```sql
CREATE TABLE human_requisitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  from_dept       text NOT NULL,
  role_title      text NOT NULL,                -- 'Verified ER nurse, 3+ yrs, US'
  why_agent_cannot text NOT NULL,               -- required. Blocks approval if empty.
  deliverable     text NOT NULL,
  qualifications  jsonb NOT NULL DEFAULT '[]',
  headcount       int NOT NULL DEFAULT 1,
  max_cost_usd    numeric(14,6) NOT NULL,
  needed_by       timestamptz,
  expected_value_usd numeric(14,6),             -- HR's ROI estimate
  status          text NOT NULL DEFAULT 'filed' CHECK (status IN
                    ('filed','hr_review','approved','sourcing','fulfilled','rejected','expired')),
  gate_id         uuid REFERENCES gates(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE terac_hires (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  requisition_id  uuid NOT NULL REFERENCES human_requisitions(id),
  terac_job_id    text NOT NULL,
  terac_worker_id text,
  worker_alias    text,                         -- never store the worker's real PII
  status          text NOT NULL CHECK (status IN
                    ('posted','matched','screening','working','delivered','accepted','disputed','paid','cancelled')),
  agreed_cost_usd numeric(14,6),
  paid_usd        numeric(14,6),
  output_artifact_id uuid REFERENCES artifacts(id),   -- human output enters the SAME pipeline
  output_source_id uuid REFERENCES sources(id),
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz, paid_at timestamptz
);
CREATE INDEX ON terac_hires (venture_id, status);
```

---

## Identity & accounts (see [`07-identity-and-accounts.md`](07-identity-and-accounts.md))

```sql
CREATE TABLE accounts (             -- an account the COMPANY owns
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  provider        text NOT NULL,    -- 'github' | 'google' | 'render' | 'stripe' | 'x' | 'namecheap'
  handle          text,             -- org name, email address, domain
  purpose         text NOT NULL,
  acquisition     text NOT NULL CHECK (acquisition IN ('api','composio_oauth','solari_ceremony','founder_provided')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN
                    ('pending','awaiting_human','active','suspended','revoked','failed')),
  ceremony_id     uuid,
  owner_email_account_id uuid REFERENCES accounts(id),  -- which mailbox receives its verifications
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venture_id, provider, handle)
);

CREATE TABLE credentials (          -- envelope-encrypted; agents NEVER read this table
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id),
  venture_id      uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('oauth_token','api_key','cookie_jar','totp_seed','password')),
  dek_wrapped     bytea NOT NULL,   -- data key wrapped by the KMS master key
  ciphertext      bytea NOT NULL,   -- AES-256-GCM over the secret
  iv              bytea NOT NULL,
  scopes          text[] NOT NULL DEFAULT '{}',
  composio_connection_id text,      -- when Composio holds the token, we store only the handle
  rotates_at      timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credential_grants (    -- short-lived scoped handles issued to agent runs
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id   uuid NOT NULL REFERENCES credentials(id),
  agent_run_id    uuid NOT NULL REFERENCES agent_runs(id),
  scopes          text[] NOT NULL,
  handle          text NOT NULL UNIQUE,   -- opaque; resolved only inside the tool plane
  expires_at      timestamptz NOT NULL,
  used_count      int NOT NULL DEFAULT 0,
  revoked_at      timestamptz
);
CREATE INDEX ON credential_grants (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE account_ceremonies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  account_id      uuid NOT NULL REFERENCES accounts(id),
  strategy        text NOT NULL CHECK (strategy IN ('api','composio','solari')),
  step            text NOT NULL,   -- 'navigate' | 'fill_form' | 'await_2fa' | 'await_tos' | 'done'
  human_required  text CHECK (human_required IN
                    ('none','2fa_code','phone_verification','tos_acceptance','payment_method','captcha','id_check')),
  solari_session_id text,
  gate_id         uuid REFERENCES gates(id),
  transcript      jsonb NOT NULL DEFAULT '[]',   -- redacted step log + screenshot refs
  status          text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','paused_for_human','succeeded','failed','abandoned')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

---

## Memory (see [`05-memory-and-context.md`](05-memory-and-context.md))

```sql
CREATE TABLE memory_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid,                        -- NULL ⇒ cross-venture institutional memory
  tier            text NOT NULL CHECK (tier IN ('working','department','venture','institutional')),
  department_id   text,
  kind            text NOT NULL,               -- 'interview_span'|'decision'|'artifact_summary'|'lesson'|'source_excerpt'
  title           text,
  content         text NOT NULL,
  embedding       vector(1536),
  source_id       uuid REFERENCES sources(id),
  artifact_id     uuid REFERENCES artifacts(id),
  salience        numeric NOT NULL DEFAULT 0.5,   -- 0..1, decays; boosted on retrieval-and-use
  confidence      numeric NOT NULL DEFAULT 0.5,
  token_count     int NOT NULL,
  supersedes      uuid REFERENCES memory_chunks(id),
  expires_at      timestamptz,                  -- working memory TTL
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz
);
CREATE INDEX ON memory_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON memory_chunks (venture_id, tier, department_id);
CREATE INDEX ON memory_chunks (tier, salience DESC) WHERE venture_id IS NULL;
```

---

## Discovery & validation domain

```sql
CREATE TABLE niches (              -- projection of NicheDossier artifacts, for fast ranking
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  artifact_id     uuid NOT NULL REFERENCES artifacts(id),
  label           text NOT NULL,
  tam_usd         numeric(18,2), sam_usd numeric(18,2), som_usd numeric(18,2),
  mrr_12mo_usd    numeric(14,2),
  price_point_usd numeric(12,2),
  confidence      numeric NOT NULL,
  rank            int,
  selected        boolean NOT NULL DEFAULT false
);

CREATE TABLE interviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  subject_kind    text NOT NULL CHECK (subject_kind IN ('network','terac_panel','inbound','customer')),
  subject_ref     text,                       -- lead_id or terac_hire_id; no raw PII in the clear
  channel         text NOT NULL CHECK (channel IN ('voice','video','email','linq','form')),
  consent         jsonb NOT NULL,             -- {disclosed_ai:true, recording:'granted', jurisdiction:'CA', at:…}
  scheduled_at    timestamptz, started_at timestamptz, ended_at timestamptz,
  duration_s      int,
  recording_uri   text, transcript_uri text,
  transcript      text,
  elevenlabs_voice_id text,
  outcome         text CHECK (outcome IN ('completed','no_show','refused','dropped','opted_out')),
  source_id       uuid REFERENCES sources(id),
  cost_usd        numeric(14,6) NOT NULL DEFAULT 0
);
CREATE INDEX ON interviews (venture_id, outcome);

CREATE TABLE claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  interview_id    uuid REFERENCES interviews(id),
  speaker_alias   text NOT NULL,             -- 'P3 — ops lead, 40-person dental group'
  ts_offset_s     int,
  verbatim        text NOT NULL,
  normalized      text NOT NULL,
  theme           text,
  polarity        text NOT NULL CHECK (polarity IN ('supports','contradicts','neutral')),
  strength        numeric NOT NULL CHECK (strength BETWEEN 0 AND 1),
  evidence_class  text NOT NULL CHECK (evidence_class IN ('past_behavior','current_practice','stated_intent','opinion')),
  source_id       uuid REFERENCES sources(id),
  embedding       vector(1536)
);
CREATE INDEX ON claims (venture_id, theme, polarity);
CREATE INDEX ON claims USING hnsw (embedding vector_cosine_ops);

CREATE TABLE archetypes (          -- from simpop / Census PUMS
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  region          text NOT NULL,             -- 'CA-PUMA-07507'
  cluster_index   int NOT NULL,
  label           text NOT NULL,
  attributes      jsonb NOT NULL,            -- age band, income, occupation, household…
  population_weight numeric NOT NULL,        -- sum of PWGTP
  seed            bigint NOT NULL,           -- deterministic reproducibility
  UNIQUE (venture_id, region, cluster_index)
);

CREATE TABLE panel_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  artifact_id     uuid REFERENCES artifacts(id),
  question        text NOT NULL,
  estimate        numeric NOT NULL,          -- post-stratified proportion
  ci_low          numeric, ci_high numeric,
  per_archetype   jsonb NOT NULL,            -- [{archetype_id, response, weight}]
  calibration_delta numeric,                 -- vs real interviews; never hidden
  seed            bigint NOT NULL
);

CREATE TABLE personas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  name            text NOT NULL,
  derived_from    text NOT NULL CHECK (derived_from IN ('interviews','synthetic','blended')),
  archetype_id    uuid REFERENCES archetypes(id),
  jtbd            text, pains jsonb, objections jsonb,
  willingness_to_pay_usd numeric(12,2),
  confidence      numeric NOT NULL
);
```

---

## GTM, revenue, support

```sql
CREATE TABLE leads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('warm','cold','inbound')),
  person_name     text, company text, title text, domain text,
  email           text, phone_e164 text, linkedin_url text,
  icp_score       numeric CHECK (icp_score BETWEEN 0 AND 1),
  score_model     text,                       -- 'pioneer:lead-scorer-v3' | 'haiku-heuristic'
  provenance      jsonb NOT NULL,             -- {source_id, how_found, first_seen}
  consent_state   text NOT NULL DEFAULT 'unknown'
                    CHECK (consent_state IN ('unknown','legitimate_interest','opted_in','opted_out','dnc')),
  interviewed_id  uuid REFERENCES interviews(id),   -- the warm-list superpower
  suppressed      boolean NOT NULL DEFAULT false,
  suppression_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venture_id, email)
);
CREATE INDEX ON leads (venture_id, kind, icp_score DESC);
CREATE INDEX ON leads (venture_id, consent_state);

CREATE TABLE deals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  lead_id         uuid NOT NULL REFERENCES leads(id),
  stage           text NOT NULL DEFAULT 'new' CHECK (stage IN
                    ('new','contacted','replied','meeting_booked','proposal','won','lost')),
  value_usd       numeric(14,2),
  next_action     text, next_action_at timestamptz,
  lost_reason     text, lost_reason_cluster text,
  owner_agent     text NOT NULL DEFAULT 'sales.head',
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON deals (venture_id, stage);

CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  deal_id         uuid REFERENCES deals(id),
  rail            text NOT NULL CHECK (rail IN ('stripe','whop','dodo')),
  external_id     text NOT NULL,              -- Stripe checkout/subscription id, Whop membership id
  amount_usd      numeric(14,2) NOT NULL,
  currency        text NOT NULL DEFAULT 'usd',
  status          text NOT NULL CHECK (status IN ('pending','paid','failed','refunded','disputed')),
  is_test_mode    boolean NOT NULL DEFAULT true,   -- labeled in the UI, always
  paid_at         timestamptz,
  UNIQUE (rail, external_id)
);

CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  order_id        uuid REFERENCES orders(id),
  rail            text NOT NULL, external_id text,
  amount_usd      numeric(14,2) NOT NULL,
  due_at          timestamptz,
  status          text NOT NULL CHECK (status IN ('draft','open','paid','void','uncollectible')),
  dunning_stage   int NOT NULL DEFAULT 0
);

CREATE TABLE tickets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  customer_ref    text,
  order_id        uuid REFERENCES orders(id),
  channel         text NOT NULL CHECK (channel IN ('email','linq','in_app','stripe_dispute')),
  subject         text, body text,
  severity        text NOT NULL DEFAULT 'normal' CHECK (severity IN ('low','normal','high','urgent')),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','escalated')),
  resolution      text, resolved_by text,
  created_at      timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);

CREATE TABLE product_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  origin          text NOT NULL CHECK (origin IN ('support','sales','qa','analytics')),
  ticket_id       uuid REFERENCES tickets(id),
  deal_id         uuid REFERENCES deals(id),
  summary         text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  frequency       int NOT NULL DEFAULT 1,
  revenue_at_risk_usd numeric(14,2),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','routed','addressed','dismissed')),
  routed_to       text
);
```

---

## Build, QA, self-improvement

```sql
CREATE TABLE deployments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  target          text NOT NULL CHECK (target IN ('render','lovable','vercel')),
  service_id      text, url text,
  repo_url        text, commit_sha text, branch text,
  product_spec_artifact_id uuid REFERENCES artifacts(id),
  status          text NOT NULL CHECK (status IN ('building','live','failed','rolled_back')),
  health          text CHECK (health IN ('healthy','degraded','down')),
  deployed_at     timestamptz, rolled_back_at timestamptz
);

CREATE TABLE qa_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  deployment_id   uuid REFERENCES deployments(id),
  scenario        text NOT NULL,
  status          text NOT NULL CHECK (status IN ('passed','failed','flaky','skipped')),
  replay_recording_url text,                  -- Replay: the founder-shareable bug
  failure_summary text,
  filed_signal_id uuid REFERENCES product_signals(id),
  duration_ms     int,
  ran_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE capability_gaps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venture_id      uuid NOT NULL,
  title           text NOT NULL,
  evidence        jsonb NOT NULL,             -- [{event_id|deal_id|ticket_id, note}]
  cost_of_absence_usd numeric(14,2),
  frequency       int NOT NULL DEFAULT 1,
  proposed_manifest_yaml text,
  shadow_result   jsonb,                      -- {cases:n, would_have_won:m, delta_usd:…}
  status          text NOT NULL DEFAULT 'detected' CHECK (status IN
                    ('detected','designed','shadow_tested','approved','deployed','rejected')),
  deployed_department_id text,
  gate_id         uuid REFERENCES gates(id),
  detected_at     timestamptz NOT NULL DEFAULT now()
);
```

---

## Projection / read-model strategy

Three classes of read model, all rebuildable:

| Class | How built | Rebuild cost | Examples |
|---|---|---|---|
| **Reducer projections** | Node reducers in `apps/kernel/src/projections/*.ts` subscribe to the event stream, apply `(state, event) => state`, upsert into the table | Full replay: `pnpm kernel rebuild --venture <id>` | `ventures.liveness`, `departments.state`, `deals.stage`, `budget_allocations.spent_usd` |
| **Materialized rollups** | `MATERIALIZED VIEW`, refreshed on a 5s tick (1s in demo) | `REFRESH MATERIALIZED VIEW CONCURRENTLY` | `mv_department_spend`, `mv_venture_pnl` |
| **Content stores** | Written once, never derived | N/A — these are inputs, not projections | `artifacts`, `sources`, `interviews.transcript`, `memory_chunks` |

```ts
// apps/kernel/src/projections/registry.ts
export const projections = [
  { name: 'liveness',      version: 3, handles: ['artifact.signed','build.deployed','money.revenue_received','sales.lead_created'] },
  { name: 'dept_state',    version: 2, handles: ['dept.*','agent.*'] },
  { name: 'pipeline',      version: 1, handles: ['sales.*'] },
  { name: 'budget_spend',  version: 4, handles: ['money.metered','money.budget_allocated'] },
  { name: 'gate_inbox',    version: 2, handles: ['gate.*'] },
] as const;

CREATE TABLE projection_offsets (
  projection  text PRIMARY KEY,
  version     int  NOT NULL,
  venture_id  uuid NOT NULL,
  last_seq    bigint NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

**Rebuild protocol:** bump `version` → the kernel notices `projection_offsets.version` mismatch →
truncates that projection's rows for the venture → replays from `seq 0` → serves reads again.
Replay of a full demo venture (~20k events) is ~4s. This is also what powers `?replay=demo-1`
in the Boardroom ([`09-boardroom-ui.md`](09-boardroom-ui.md)).

```sql
CREATE MATERIALIZED VIEW mv_department_spend AS
SELECT venture_id, cycle_id, department_id,
       sum(cost_usd)                                        AS spent_usd,
       sum(cost_usd) FILTER (WHERE unit LIKE 'tokens%')      AS token_usd,
       sum(cost_usd) FILTER (WHERE unit = 'sandbox_seconds') AS sandbox_usd,
       sum(cost_usd) FILTER (WHERE unit = 'tool_call')       AS tool_usd,
       sum(cost_usd) FILTER (WHERE unit = 'terac_hire')      AS human_usd
FROM meters GROUP BY 1,2,3;
CREATE UNIQUE INDEX ON mv_department_spend (venture_id, cycle_id, department_id);
```

---

## Migrations (Drizzle)

```
packages/db/
  schema/                # drizzle table definitions, one file per domain
    core.ts  events.ts  artifacts.ts  money.ts  identity.ts  memory.ts  gtm.ts  build.ts
  migrations/            # generated SQL, checked in, never edited by hand
  seed/
    demo-1.ts            # the fallback venture; see 04-execution/04-demo-seed.md
  index.ts
```

| Rule | Why |
|---|---|
| `drizzle-kit generate` → commit SQL → `drizzle-kit migrate` on boot | Kernel migrates itself at startup; Render deploy needs no manual step |
| **Never write a data migration that mutates `events`** | The log is immutable. Change the reducer and bump the projection version instead. |
| Adding a field to an artifact type = new `schema_version`, old rows keep the old one | Zod parses by `schema_version`; no backfill |
| `pgvector` + `hnsw` created in migration `0002`; embeddings backfilled by a job, not a migration | Migrations must run in seconds |
| Extensions: `pgcrypto`, `vector`, `pg_trgm` | uuid gen, embeddings, fuzzy lead dedup |

---

## Four queries the Boardroom actually runs

**1. Floor plan tick** — every room's state + spend + current agents, one round trip.

```sql
SELECT d.department_id, d.state, d.room_x, d.room_y,
       COALESCE(s.spent_usd,0) AS spent_usd,
       ba.envelope_usd,
       COALESCE(ar.active, 0)  AS active_agents,
       COALESCE(e.blocked, 0)  AS open_escalations
FROM departments d
LEFT JOIN mv_department_spend s
       ON s.venture_id=d.venture_id AND s.department_id=d.department_id AND s.cycle_id=$2
LEFT JOIN budget_allocations ba
       ON ba.cycle_id=$2 AND ba.department_id=d.department_id
LEFT JOIN LATERAL (SELECT count(*) active FROM agent_runs r
                   WHERE r.venture_id=d.venture_id AND r.department_id=d.department_id
                     AND r.status='running') ar ON true
LEFT JOIN LATERAL (SELECT count(*) blocked FROM escalations x
                   WHERE x.venture_id=d.venture_id AND x.from_dept=d.department_id
                     AND x.status='open' AND x.severity='blocking') e ON true
WHERE d.venture_id=$1;
```

**2. Approval inbox** — pending gates, batched, newest first, with time remaining.

```sql
SELECT g.id, g.gate_type, g.preview, g.options, g.suggested_option_id, g.amount_usd,
       g.risk, g.batch_id, g.department_id,
       EXTRACT(EPOCH FROM (g.expires_at - now()))::int AS seconds_left
FROM gates g
WHERE g.venture_id=$1 AND g.status='pending'
ORDER BY (g.risk='high') DESC, g.opened_at ASC;
```

**3. "Explain this"** — the causal chain behind any artifact field, for the evidence drawer
([`11-evidence-and-truth.md`](11-evidence-and-truth.md), [`10-observability.md`](10-observability.md)).

```sql
WITH RECURSIVE chain AS (
  SELECT e.* FROM events e
   WHERE e.venture_id=$1 AND e.payload->>'artifact_id' = $2::text
  UNION ALL
  SELECT p.* FROM events p JOIN chain c ON p.id = c.causation_id AND p.venture_id = c.venture_id
)
SELECT c.seq, c.ts, c.type, c.actor_id, c.department_id, c.payload,
       s.uri, s.title, s.publisher, asrc.excerpt, asrc.confidence, asrc.method
FROM chain c
LEFT JOIN artifact_sources asrc ON asrc.artifact_id = $2
LEFT JOIN sources s ON s.id = asrc.source_id
ORDER BY c.seq ASC;
```

**4. Warm-lead outreach list** — interviewed humans, with the quote Sales will cite back at them.

```sql
SELECT l.id, l.person_name, l.company, l.email, l.icp_score,
       c.verbatim, c.theme, i.started_at AS interviewed_at
FROM leads l
JOIN interviews i ON i.id = l.interviewed_id AND i.outcome='completed'
JOIN LATERAL (SELECT verbatim, theme FROM claims
               WHERE interview_id=i.id AND polarity='supports'
               ORDER BY strength DESC LIMIT 1) c ON true
WHERE l.venture_id=$1
  AND l.consent_state IN ('opted_in','legitimate_interest')
  AND l.suppressed = false
ORDER BY l.icp_score DESC NULLS LAST
LIMIT 50;
```

---

## Artifact type definitions (`packages/contracts`)

These are **the** contracts. Every department's I/O in `02-departments/*` refers to these names.
Zod is the runtime validator; the inferred TS types are what agents' outputs are parsed into.

```ts
// packages/contracts/src/primitives.ts
import { z } from 'zod';

export const DepartmentId = z.enum(['D01','D02','D03','D04','D05','D06','D07',
                                    'D08','D09','D10','D11','D12','D13']);

export const SourceRef = z.object({
  source_id: z.string().uuid(),
  excerpt:   z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  method:    z.enum(['measured','derived','estimated','asserted']),
});

/** Any number the company states publicly must be a Cited, not a raw number. */
export const Cited = <T extends z.ZodTypeAny>(inner: T) => z.object({
  value: inner,
  unit: z.string().optional(),
  sources: z.array(SourceRef).min(1),          // ← the anti-hallucination invariant
  as_of: z.string().datetime().optional(),
  label: z.enum(['measured','estimated']).default('estimated'),
});

export const Money = z.number().nonnegative();
export const Confidence = z.number().min(0).max(1);

export const ArtifactRef = z.object({
  type: z.string(), id: z.string().uuid(), version: z.number().int(), hash: z.string(),
});

export const ArtifactBase = z.object({
  artifact_type: z.string(),
  schema_version: z.string(),        // 'NicheDossier@1.2.0'
  venture_id: z.string().uuid(),
  produced_by: z.string(),           // agent_id
  derived_from: z.array(ArtifactRef).default([]),
  assumptions: z.array(z.object({
    text: z.string(), verified: z.boolean().default(false),
  })).default([]),
});
```

```ts
// packages/contracts/src/artifacts/discovery.ts

export const IdeaSeed = ArtifactBase.extend({
  artifact_type: z.literal('IdeaSeed'),
  mode: z.enum(['founder_led','autonomous_origination']),
  raw_text: z.string().default(''),
  voice_transcripts: z.array(z.object({
    uri: z.string(), text: z.string(), duration_s: z.number(),
  })).default([]),
  files: z.array(z.object({
    uri: z.string(), mime: z.string(), extracted_text: z.string(), title: z.string().optional(),
  })).default([]),
  links: z.array(z.object({ url: z.string().url(), summary: z.string() })).default([]),
  founder_profile: z.object({
    unfair_advantages: z.array(z.string()).default([]),
    domain_experience: z.array(z.string()).default([]),
    network_signals: z.array(z.string()).default([]),   // from Composio LinkedIn/Gmail
    constraints: z.array(z.string()).default([]),       // time, capital, geography
  }),
  normalized_summary: z.string(),
});

export const OpportunityCandidate = ArtifactBase.extend({
  artifact_type: z.literal('OpportunityCandidate'),
  title: z.string(),
  thesis: z.string(),
  pain_evidence: z.array(SourceRef).min(2),     // Reddit clusters, G2 1-stars, job posts
  who_hurts: z.string(),
  why_now: z.string(),
  incumbent_weakness: z.string(),
  scores: z.object({
    pain_intensity: Confidence, market_pull: Confidence, buildability: Confidence,
    founder_fit: Confidence, time_to_revenue: Confidence,
  }),
  composite_score: Confidence,
  kill_risks: z.array(z.string()),
});

export const SharpenedIdea = ArtifactBase.extend({
  artifact_type: z.literal('SharpenedIdea'),
  one_liner: z.string().max(200),
  icp: z.object({
    who: z.string(),
    firmographics: z.record(z.string()).default({}),   // size, industry, geo
    trigger_event: z.string().optional(),
    buyer_vs_user: z.string(),
  }),
  pain: z.object({
    statement: z.string(),
    today_workaround: z.string(),          // Mom Test: what they do NOW
    cost_of_pain: z.string(),
    frequency: z.enum(['daily','weekly','monthly','quarterly','rare']),
  }),
  wedge: z.string(),                        // the smallest shippable version
  what_must_be_true: z.array(z.object({
    claim: z.string(),
    testable_by: z.enum(['interview','market_data','synthetic_panel','build_and_measure']),
    status: z.enum(['unverified','supported','contradicted']).default('unverified'),
  })).min(3),
  kill_criteria: z.array(z.object({
    condition: z.string(), measured_by: z.string(),
  })).min(2),
  founder_present: z.boolean(),
  open_questions: z.array(z.string()).default([]),
});

export const NicheDossier = ArtifactBase.extend({
  artifact_type: z.literal('NicheDossier'),
  label: z.string(),                       // 'Multi-location dental groups, 5-25 chairs, US Southwest'
  slice: z.object({
    industry: z.string(), company_size: z.string(),
    geography: z.string(), trigger_event: z.string().optional(),
  }),
  tam: Cited(Money), sam: Cited(Money), som: Cited(Money),
  mrr_12mo: Cited(Money),
  pricing_hypothesis: z.object({
    model: z.enum(['seat','usage','flat','tiered','marketplace_fee']),
    price_point: Cited(Money),
    anchor_comparables: z.array(SourceRef),
  }),
  competitors: z.array(z.object({
    name: z.string(), url: z.string().optional(),
    pricing: Cited(Money).optional(), weakness: z.string(), sources: z.array(SourceRef).min(1),
  })).min(1),
  wedge: z.string(),
  pros: z.array(z.string()), cons: z.array(z.string()),
  reachability: z.object({
    channels: z.array(z.string()), estimated_cac: Cited(Money).optional(),
  }),
  confidence: Confidence,
  rank_rationale: z.string(),
});
```

```ts
// packages/contracts/src/artifacts/validation.ts

export const Interview = ArtifactBase.extend({
  artifact_type: z.literal('Interview'),
  interview_id: z.string().uuid(),
  subject: z.object({
    alias: z.string(),                       // 'P3 — ops lead, 40-person dental group'
    kind: z.enum(['network','terac_panel','inbound','customer']),
    icp_match: Confidence,
    terac_hire_id: z.string().uuid().optional(),
  }),
  channel: z.enum(['voice','video','email','linq','form']),
  consent: z.object({
    ai_disclosed: z.literal(true),           // non-negotiable; see 12-safety-and-compliance
    disclosure_text: z.string(),
    recording: z.enum(['granted','denied','not_required']),
    jurisdiction: z.string(),
    captured_at: z.string().datetime(),
  }),
  duration_s: z.number().int(),
  transcript_uri: z.string(),
  recording_uri: z.string().optional(),
  script_version: z.string(),
  claims: z.array(z.string().uuid()),        // Claim ids
  surprises: z.array(z.string()).default([]),
  interviewer_voice_id: z.string().optional(),   // ElevenLabs clone used
  cost_usd: Money,
});

export const Claim = ArtifactBase.extend({
  artifact_type: z.literal('Claim'),
  claim_id: z.string().uuid(),
  interview_id: z.string().uuid(),
  speaker_alias: z.string(),
  ts_offset_s: z.number().int().nonnegative(),
  verbatim: z.string().min(1),               // exact words. Never paraphrased here.
  normalized: z.string(),
  theme: z.string(),
  polarity: z.enum(['supports','contradicts','neutral']),
  strength: Confidence,
  evidence_class: z.enum(['past_behavior','current_practice','stated_intent','opinion']),
  targets: z.array(z.object({
    what_must_be_true: z.string(),           // links back to SharpenedIdea
  })).default([]),
});

export const ClaimLedger = ArtifactBase.extend({
  artifact_type: z.literal('ClaimLedger'),
  interview_count: z.number().int(),
  themes: z.array(z.object({
    theme: z.string(),
    supports: z.number().int(), contradicts: z.number().int(), neutral: z.number().int(),
    net_strength: z.number(),                 // Σ(strength·polarity)/n
    representative_quotes: z.array(z.object({
      claim_id: z.string().uuid(), verbatim: z.string(), speaker_alias: z.string(),
    })).min(1),
    verdict: z.enum(['confirmed','contradicted','contested','insufficient_data']),
  })),
  what_must_be_true_status: z.array(z.object({
    claim: z.string(),
    status: z.enum(['supported','contradicted','untested']),
    n: z.number().int(),
  })),
  contradictions_with_synthetic: z.array(z.object({
    theme: z.string(), real: z.number(), synthetic: z.number(), delta: z.number(),
    note: z.string(),
  })).default([]),
});

export const SyntheticPanelResult = ArtifactBase.extend({
  artifact_type: z.literal('SyntheticPanelResult'),
  region: z.string(),                        // 'CA-PUMA-07507'
  pums_vintage: z.string(),                  // 'ACS 2022 5-year'
  seed: z.number().int(),                    // deterministic; simit inheritance
  archetypes: z.array(z.object({
    cluster_index: z.number().int(), label: z.string(),
    attributes: z.record(z.union([z.string(), z.number()])),
    population_weight: z.number(),           // Σ PWGTP
  })).min(4),
  questions: z.array(z.object({
    question: z.string(),
    estimate: z.number().min(0).max(1),
    ci: z.tuple([z.number(), z.number()]),
    per_archetype: z.array(z.object({
      cluster_index: z.number().int(), response: z.union([z.string(), z.number()]),
      weight: z.number(),
    })),
  })),
  calibration: z.object({
    against_interviews: z.number().int(),
    delta: z.number(),                       // reported, never silently applied
    method: z.string(),
  }).optional(),
  honesty_note: z.literal('Model-based estimate from Census PUMS microdata, not a survey of real respondents.'),
});

export const IdeaDiff = ArtifactBase.extend({
  artifact_type: z.literal('IdeaDiff'),
  op: z.enum(['ADD','CUT','NARROW','REPRICE','PIVOT']),
  target: z.string(),                        // 'feature: bulk approvals' | 'icp' | 'price'
  before: z.string(), after: z.string(),
  evidence: z.array(z.object({
    kind: z.enum(['claim','panel','market','support_signal','sales_loss']),
    ref_id: z.string().uuid(),
    verbatim: z.string().optional(),
    weight: Confidence,
  })).min(1),
  expected_effect: z.string(),
  cost: z.object({ eng_hours: z.number(), usd: Money }),
  reversibility: z.enum(['reversible','costly','one_way_door']),
  what_would_reject_this: z.string(),
  recommended: z.boolean(),
});

export const ProductSpec = ArtifactBase.extend({
  artifact_type: z.literal('ProductSpec'),
  version_label: z.string(),                 // 'v2 — post-pivot'
  one_liner: z.string(),
  icp: z.string(),
  jobs_to_be_done: z.array(z.string()).min(1),
  features: z.array(z.object({
    id: z.string(), title: z.string(), user_story: z.string(),
    acceptance_criteria: z.array(z.string()).min(1),
    priority: z.enum(['p0','p1','p2']),
    justified_by: z.array(z.string().uuid()).default([]),   // Claim / IdeaDiff ids
  })).min(1),
  non_goals: z.array(z.string()).default([]),
  data_model_sketch: z.string(),
  stack: z.object({
    framework: z.string(), db: z.string(), hosting: z.literal('render'),
    auth: z.string(), payments: z.enum(['stripe','whop','dodo','none']),
  }),
  qa_scenarios: z.array(z.object({
    id: z.string(), steps: z.array(z.string()), expected: z.string(),
  })).min(3),
  pricing: z.object({ model: z.string(), price_usd: Money, trial: z.string().optional() }),
  applied_diffs: z.array(z.string().uuid()).default([]),
});
```

```ts
// packages/contracts/src/artifacts/gtm.ts

export const GTMPlan = ArtifactBase.extend({
  artifact_type: z.literal('GTMPlan'),
  positioning: z.object({
    for_whom: z.string(), category: z.string(),
    unlike: z.string(), we: z.string(), proof: z.array(SourceRef),
  }),
  icp_tiers: z.array(z.object({
    tier: z.enum(['A','B','C']), definition: z.string(),
    est_count: Cited(z.number()), why: z.string(),
  })),
  channels: z.array(z.object({
    name: z.string(),
    expected_cac: Cited(Money),
    expected_volume_per_week: z.number(),
    effort: z.enum(['low','medium','high']),
    rank: z.number().int(),
    first_action: z.string(),
  })).min(2),
  pricing_and_packaging: z.object({
    tiers: z.array(z.object({ name: z.string(), price_usd: Money, includes: z.array(z.string()) })),
    rationale: z.string(),
  }),
  objection_matrix: z.array(z.object({
    objection: z.string(), response: z.string(),
    evidence: z.array(SourceRef).default([]),
  })).min(3),
  messaging_matrix: z.array(z.object({
    persona: z.string(), hook: z.string(), proof_point: z.string(), cta: z.string(),
  })),
  ninety_day_plan: z.array(z.object({
    week: z.number().int(), goal: z.string(), owner_department: DepartmentId,
    metric: z.string(),
  })),
});

export const Lead = ArtifactBase.extend({
  artifact_type: z.literal('Lead'),
  lead_id: z.string().uuid(),
  kind: z.enum(['warm','cold','inbound']),
  person: z.object({
    name: z.string().optional(), title: z.string().optional(),
    email: z.string().email().optional(), phone_e164: z.string().optional(),
    linkedin_url: z.string().url().optional(),
  }),
  company: z.object({
    name: z.string().optional(), domain: z.string().optional(),
    size: z.string().optional(), industry: z.string().optional(),
  }),
  icp_fit: z.object({ score: Confidence, tier: z.enum(['A','B','C']), reasons: z.array(z.string()) }),
  trigger_event: z.object({ what: z.string(), source: SourceRef }).optional(),
  provenance: z.object({
    how_found: z.string(), source: SourceRef, first_seen: z.string().datetime(),
  }),
  consent_state: z.enum(['unknown','legitimate_interest','opted_in','opted_out','dnc']),
  warm_context: z.object({                  // present iff kind==='warm'
    interview_id: z.string().uuid(),
    quote: z.string(), quoted_at: z.string().datetime(),
  }).optional(),
  suppressed: z.boolean().default(false),
});

export const Deal = ArtifactBase.extend({
  artifact_type: z.literal('Deal'),
  deal_id: z.string().uuid(), lead_id: z.string().uuid(),
  stage: z.enum(['new','contacted','replied','meeting_booked','proposal','won','lost']),
  value_usd: Money,
  interactions: z.array(z.object({
    at: z.string().datetime(),
    channel: z.enum(['email','linq','voice','meeting','in_app']),
    direction: z.enum(['out','in']),
    summary: z.string(), gate_id: z.string().uuid().optional(),
  })),
  objections: z.array(z.object({ text: z.string(), handled: z.boolean() })).default([]),
  next_action: z.object({ what: z.string(), at: z.string().datetime() }).optional(),
  lost_reason: z.string().optional(),
  lost_reason_cluster: z.string().optional(),
});

export const Order = ArtifactBase.extend({
  artifact_type: z.literal('Order'),
  order_id: z.string().uuid(), deal_id: z.string().uuid().optional(),
  rail: z.enum(['stripe','whop','dodo']),
  external_id: z.string(),
  amount_usd: Money, currency: z.string().default('usd'),
  status: z.enum(['pending','paid','failed','refunded','disputed']),
  is_test_mode: z.boolean(),
  line_items: z.array(z.object({ label: z.string(), qty: z.number(), unit_usd: Money })),
  paid_at: z.string().datetime().optional(),
});

export const Ticket = ArtifactBase.extend({
  artifact_type: z.literal('Ticket'),
  ticket_id: z.string().uuid(),
  channel: z.enum(['email','linq','in_app','stripe_dispute']),
  customer_ref: z.string(),
  subject: z.string(), body: z.string(),
  severity: z.enum(['low','normal','high','urgent']),
  status: z.enum(['open','pending','resolved','escalated']),
  diagnosis: z.object({
    root_cause: z.string(),
    code_refs: z.array(z.object({ path: z.string(), line: z.number().optional() })).default([]),
    confidence: Confidence,
  }).optional(),
  resolution: z.string().optional(),
  signal_filed: z.string().uuid().optional(),
});

export const ProductSignal = ArtifactBase.extend({
  artifact_type: z.literal('ProductSignal'),
  signal_id: z.string().uuid(),
  origin: z.enum(['support','sales','qa','analytics']),
  summary: z.string(),
  evidence: z.array(z.object({
    kind: z.enum(['ticket','deal_lost','qa_failure','metric']),
    ref_id: z.string().uuid(), quote: z.string().optional(),
  })).min(1),
  frequency: z.number().int().min(1),
  severity: z.enum(['low','medium','high','critical']),
  revenue_at_risk_usd: Money.optional(),
  proposed_action: z.enum(['fix','feature','doc','price_change','no_action']),
  route_to: DepartmentId,
});

export const CapabilityGap = ArtifactBase.extend({
  artifact_type: z.literal('CapabilityGap'),
  title: z.string(),                          // 'No agent can complete a security questionnaire'
  detected_from: z.array(z.object({
    kind: z.enum(['deal_lost','ticket','escalation','budget_overrun','qa_failure']),
    ref_id: z.string().uuid(), note: z.string(),
  })).min(2),                                 // one anecdote is not a gap
  frequency: z.number().int(),
  cost_of_absence_usd: Money,
  proposed_solution: z.enum(['new_department','new_worker_role','new_tool','terac_standing_panel']),
  proposed_manifest: z.string().optional(),   // YAML — a full DepartmentManifest
  shadow_test: z.object({
    cases: z.number().int(),
    would_have_changed_outcome: z.number().int(),
    estimated_delta_usd: z.number(),
    method: z.string(),
  }).optional(),
  recommendation: z.enum(['deploy','iterate','reject']),
});
```

```ts
// packages/contracts/src/manifest.ts — the shape D13 must generate to grow the company

export const AgentSpec = z.object({
  agent_id: z.string(),                       // 'security.questionnaire'
  model: z.string(),                          // 'opus'|'sonnet'|'haiku'|'pioneer:<model>'
  replicas: z.number().int().min(1).default(1),
  system_prompt_ref: z.string(),              // path under packages/prompts
  tools: z.array(z.string()).default([]),     // hard allowlist — no ambient access
  max_tokens_per_run: z.number().int(),
  output_schema: z.string().optional(),       // artifact type name
});

export const DepartmentManifest = z.object({
  id: z.string().regex(/^D\d{2}$/),
  name: z.string(),
  cluster: z.enum(['discovery','validation','build','gtm','ops']),
  origin: z.enum(['seed','cos_generated']).default('seed'),
  head: AgentSpec,
  critic: AgentSpec.extend({ rubric_ref: z.string() }),
  workers: z.array(AgentSpec).min(1),
  concurrency: z.number().int().min(1),
  budget: z.object({
    default_envelope_usd: Money, hard_cap_usd: Money,
  }),
  io: z.object({
    input: z.string(),                        // artifact type name
    output: z.string(),
    min_outputs: z.number().int().default(1),
  }),
  gates: z.array(z.enum(['money_out','public_content','outbound_to_real_person',
                         'account_creation','pivot_approval','deploy','refund','new_department'])).default([]),
  sandbox: z.object({
    image: z.string(), cpu: z.number().int(), mem_mb: z.number().int(),
    egress_allowlist: z.array(z.string()).default([]),
    pause_between_cycles: z.boolean().default(true),
  }),
  memory: z.object({                          // see 05-memory-and-context.md
    read_tiers: z.array(z.enum(['working','department','venture','institutional'])),
    write_tiers: z.array(z.enum(['working','department','venture','institutional'])),
    retrieval_k: z.number().int().default(12),
  }),
  sla: z.object({
    soft_deadline_s: z.number().int(),
    on_timeout: z.enum(['return_partial','fail','extend_once']),
  }),
});
export type DepartmentManifest = z.infer<typeof DepartmentManifest>;
```

**The union that the artifact registry validates against:**

```ts
export const AnyArtifact = z.discriminatedUnion('artifact_type', [
  IdeaSeed, OpportunityCandidate, SharpenedIdea, NicheDossier,
  Interview, Claim, ClaimLedger, SyntheticPanelResult,
  IdeaDiff, ProductSpec, GTMPlan, Lead, Deal, Order, Ticket,
  ProductSignal, CapabilityGap,
]);
```

`artifacts.body` is only ever written through `registry.sign(artifact)`, which (1) parses with
`AnyArtifact`, (2) runs the evidence validator from
[`11-evidence-and-truth.md`](11-evidence-and-truth.md), (3) hashes, (4) HMAC-signs, (5) emits
`artifact.signed`. There is no other write path.
