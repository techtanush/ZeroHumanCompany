/**
 * The full Postgres schema. Written to work on both real Postgres 16 and PGlite
 * (embedded) so the whole backend runs with no docker on a laptop.
 *
 * Deliberate deviations from 01-platform/04-data-model.md, and why:
 *  - `events` is NOT partitioned: PGlite does not support hash partitioning, and
 *    partitioning is a scale concern, not a correctness one. Indexes are identical.
 *  - append-only is enforced with a trigger instead of a RULE (works in both).
 *  - pgvector is optional: `memory.embedding` is `jsonb` unless PGVECTOR=1.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS founders (
  id              uuid PRIMARY KEY,
  email           text NOT NULL UNIQUE,
  phone_e164      text,
  display_name    text,
  timezone        text NOT NULL DEFAULT 'America/Los_Angeles',
  quiet_hours     jsonb NOT NULL DEFAULT '{"start":"22:00","end":"07:00"}',
  spend_cap_usd   numeric(14,6) NOT NULL DEFAULT 50.00,
  terac_cap_usd   numeric(14,6) NOT NULL DEFAULT 200.00,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ventures (
  id              uuid PRIMARY KEY,
  founder_id      uuid NOT NULL REFERENCES founders(id),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  mode            text NOT NULL CHECK (mode IN ('founder_led','autonomous_origination')),
  autonomy_level  text NOT NULL DEFAULT 'supervised'
                    CHECK (autonomy_level IN ('copilot','supervised','autonomous')),
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','killed','graduated')),
  time_scale      numeric NOT NULL DEFAULT 1.0,
  trace_id        text NOT NULL,
  kill_switch     boolean NOT NULL DEFAULT false,
  spend_usd       numeric(14,6) NOT NULL DEFAULT 0,
  liveness        jsonb NOT NULL DEFAULT '{"idea_locked":false,"market_validated":false,"product_live":false,"pipeline_active":false,"revenue_real":false}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  killed_at       timestamptz
);
CREATE INDEX IF NOT EXISTS ventures_founder_status_idx ON ventures (founder_id, status);

CREATE TABLE IF NOT EXISTS events (
  seq             bigserial PRIMARY KEY,
  id              uuid NOT NULL UNIQUE,
  venture_id      uuid NOT NULL,
  ts              timestamptz NOT NULL DEFAULT now(),
  type            text NOT NULL,
  actor_kind      text NOT NULL CHECK (actor_kind IN ('agent','founder','system','webhook','human_hire')),
  actor_id        text NOT NULL,
  department_id   text,
  payload         jsonb NOT NULL DEFAULT '{}',
  trace_id        text NOT NULL,
  causation_id    uuid,
  correlation_id  uuid,
  bus_transport   text CHECK (bus_transport IN ('band','pg_notify','none'))
);
CREATE INDEX IF NOT EXISTS events_venture_type_ts_idx ON events (venture_id, type, ts DESC);
CREATE INDEX IF NOT EXISTS events_venture_seq_idx ON events (venture_id, seq);
CREATE INDEX IF NOT EXISTS events_trace_idx ON events (trace_id);
CREATE INDEX IF NOT EXISTS events_correlation_idx ON events (correlation_id);

CREATE OR REPLACE FUNCTION events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_no_mutate ON events;
CREATE TRIGGER events_no_mutate BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_append_only();

CREATE TABLE IF NOT EXISTS processed_messages (
  consumer      text NOT NULL,
  message_id    text NOT NULL,
  result_ref    text,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, message_id)
);

CREATE TABLE IF NOT EXISTS sources (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN
                    ('web_page','api_response','census_pums','interview','stripe_object',
                     'repo_file','support_ticket','synthetic_panel','human_hire_output','model_estimate')),
  uri             text,
  title           text,
  retrieved_at    timestamptz NOT NULL DEFAULT now(),
  content_hash    text,
  snapshot_uri    text,
  publisher       text,
  reliability     numeric,
  fetched_by      text
);
CREATE INDEX IF NOT EXISTS sources_venture_kind_idx ON sources (venture_id, kind);

CREATE TABLE IF NOT EXISTS artifacts (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL REFERENCES ventures(id),
  type            text NOT NULL,
  version         int  NOT NULL DEFAULT 1,
  lineage_id      uuid NOT NULL,
  body            jsonb NOT NULL,
  body_hash       text NOT NULL,
  schema_version  text NOT NULL,
  quality         text NOT NULL CHECK (quality IN ('draft','signed','partial','contested','superseded')),
  gaps            jsonb NOT NULL DEFAULT '[]',
  produced_by     text NOT NULL,
  department_id   text NOT NULL,
  work_order_id   uuid,
  signature       text,
  signed_at       timestamptz,
  cost_usd        numeric(14,6) NOT NULL DEFAULT 0,
  superseded_by   uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lineage_id, version)
);
CREATE INDEX IF NOT EXISTS artifacts_venture_type_idx ON artifacts (venture_id, type, version DESC);

CREATE TABLE IF NOT EXISTS artifact_sources (
  artifact_id     uuid NOT NULL REFERENCES artifacts(id),
  source_id       uuid NOT NULL,
  json_pointer    text NOT NULL,
  excerpt         text NOT NULL,
  confidence      numeric NOT NULL,
  method          text NOT NULL CHECK (method IN ('measured','derived','estimated','asserted')),
  PRIMARY KEY (artifact_id, source_id, json_pointer)
);

CREATE TABLE IF NOT EXISTS departments (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL REFERENCES ventures(id),
  department_id   text NOT NULL,
  manifest_yaml   text NOT NULL,
  manifest_hash   text NOT NULL,
  cluster         text NOT NULL,
  state           text NOT NULL DEFAULT 'idle'
                    CHECK (state IN ('idle','working','blocked','frozen','retired')),
  origin          text NOT NULL DEFAULT 'seed' CHECK (origin IN ('seed','cos_generated')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venture_id, department_id)
);

CREATE TABLE IF NOT EXISTS work_orders (
  id               uuid PRIMARY KEY,
  venture_id       uuid NOT NULL,
  from_dept        text NOT NULL,
  to_dept          text NOT NULL,
  intent           text NOT NULL,
  input_artifacts  jsonb NOT NULL DEFAULT '[]',
  params           jsonb NOT NULL DEFAULT '{}',
  budget_usd       numeric(14,6) NOT NULL,
  success_criteria jsonb NOT NULL DEFAULT '[]',
  soft_deadline_at timestamptz,
  status           text NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','admitted','running','partial','done','failed','cancelled')),
  attempt          int NOT NULL DEFAULT 0,
  output_artifact_id uuid,
  error            text,
  trace_id         text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz
);
CREATE INDEX IF NOT EXISTS work_orders_venture_status_idx ON work_orders (venture_id, status, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL,
  work_order_id   uuid,
  department_id   text NOT NULL,
  agent_id        text NOT NULL,
  role            text NOT NULL CHECK (role IN ('head','worker','critic')),
  replica_index   int NOT NULL DEFAULT 0,
  model           text NOT NULL,
  model_tier      text NOT NULL,
  sandbox_id      text,
  prompt_hash     text NOT NULL,
  input_refs      jsonb NOT NULL DEFAULT '[]',
  output_artifact_id uuid,
  status          text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','ok','failed','timeout','aborted','budget_exceeded')),
  tokens_in       bigint NOT NULL DEFAULT 0,
  tokens_out      bigint NOT NULL DEFAULT 0,
  tokens_cached   bigint NOT NULL DEFAULT 0,
  cost_usd        numeric(14,6) NOT NULL DEFAULT 0,
  decisions       jsonb NOT NULL DEFAULT '[]',
  error           jsonb,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX IF NOT EXISTS agent_runs_wo_idx ON agent_runs (work_order_id);

CREATE TABLE IF NOT EXISTS escalations (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL,
  from_dept       text NOT NULL,
  reason          text NOT NULL,
  severity        text NOT NULL,
  summary         text NOT NULL,
  detail          text NOT NULL DEFAULT '',
  options         jsonb NOT NULL DEFAULT '[]',
  suggested_option_id text,
  rung            text NOT NULL DEFAULT 'department_head',
  status          text NOT NULL DEFAULT 'open',
  resolved_option_id text,
  resolved_by     text,
  blocks_work_order_id uuid,
  trace_id        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);

CREATE TABLE IF NOT EXISTS gates (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL,
  gate_type       text NOT NULL,
  requested_by    text NOT NULL,
  department_id   text NOT NULL,
  action          jsonb NOT NULL,
  preview         jsonb NOT NULL DEFAULT '{}',
  options         jsonb NOT NULL DEFAULT '[]',
  suggested_option_id text,
  amount_usd      numeric(14,6),
  risk            text NOT NULL DEFAULT 'medium',
  reversible      boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN
                    ('pending','auto_approved','approved','rejected','redirected','timed_out','expired','cancelled')),
  batch_id        uuid,
  channel         text,
  decided_by      text,
  decided_option_id text,
  decision_note   text,
  timeout_s       int NOT NULL DEFAULT 900,
  on_timeout      text NOT NULL DEFAULT 'hold',
  idempotency_key text NOT NULL,
  work_order_id   uuid,
  trace_id        text NOT NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  decided_at      timestamptz,
  UNIQUE (venture_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS gates_venture_status_idx ON gates (venture_id, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS meters (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL,
  department_id   text NOT NULL,
  agent_run_id    uuid,
  work_order_id   uuid,
  unit            text NOT NULL,
  resource        text NOT NULL,
  quantity        numeric(20,6) NOT NULL,
  unit_cost_usd   numeric(20,10) NOT NULL,
  cost_usd        numeric(14,6) NOT NULL,
  cycle_id        uuid NOT NULL,
  ts              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meters_cycle_idx ON meters (venture_id, cycle_id, department_id);

CREATE TABLE IF NOT EXISTS budgets (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL,
  cycle_id        uuid NOT NULL UNIQUE,
  cycle_index     int NOT NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closes_at       timestamptz NOT NULL,
  total_usd       numeric(14,6) NOT NULL,
  runway_usd      numeric(14,6) NOT NULL,
  policy          jsonb NOT NULL DEFAULT '{"downgrade_at":0.8,"freeze_at":1.0}'
);

CREATE TABLE IF NOT EXISTS budget_allocations (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL,
  cycle_id        uuid NOT NULL,
  department_id   text NOT NULL,
  envelope_usd    numeric(14,6) NOT NULL,
  hard_cap_usd    numeric(14,6) NOT NULL,
  reserved_usd    numeric(14,6) NOT NULL DEFAULT 0,
  spent_usd       numeric(14,6) NOT NULL DEFAULT 0,
  state           text NOT NULL DEFAULT 'active' CHECK (state IN ('active','degraded','frozen','thawed')),
  rationale       text,
  allocated_by    text NOT NULL DEFAULT 'finance.treasurer',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, department_id)
);

CREATE TABLE IF NOT EXISTS reservations (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL,
  cycle_id        uuid NOT NULL,
  department_id   text NOT NULL,
  work_order_id   uuid,
  amount_usd      numeric(14,6) NOT NULL,
  state           text NOT NULL DEFAULT 'held' CHECK (state IN ('held','committed','released','expired')),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credentials (
  id              uuid PRIMARY KEY,
  venture_id      uuid,
  vendor          text NOT NULL,
  label           text NOT NULL,
  ciphertext      text NOT NULL,
  iv              text NOT NULL,
  auth_tag        text NOT NULL,
  scopes          jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venture_id, vendor, label)
);

CREATE TABLE IF NOT EXISTS memory (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL,
  department_id   text,
  kind            text NOT NULL,
  content         text NOT NULL,
  embedding       jsonb,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memory_venture_idx ON memory (venture_id, department_id);

CREATE TABLE IF NOT EXISTS leads (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL,
  alias           text NOT NULL,
  company         text,
  role            text,
  contact         jsonb NOT NULL DEFAULT '{}',
  icp_score       numeric NOT NULL DEFAULT 0,
  warm            boolean NOT NULL DEFAULT false,
  suppressed      boolean NOT NULL DEFAULT false,
  artifact_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deals (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL,
  lead_id         uuid,
  stage           text NOT NULL,
  amount_usd      numeric(14,6) NOT NULL DEFAULT 0,
  probability     numeric NOT NULL DEFAULT 0,
  lost_reason     text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id              uuid PRIMARY KEY,
  venture_id      uuid NOT NULL,
  subject         text NOT NULL,
  severity        text NOT NULL,
  status          text NOT NULL,
  artifact_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
`;
