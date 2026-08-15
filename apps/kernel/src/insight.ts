import { createLlmClient, type LlmClient } from '@zeroth/agent-kit';
import { DEPARTMENT_NAMES, type DepartmentId } from '@zeroth/contracts';
import type { Db } from '@zeroth/db';
import type { EventStore, StoredEvent } from './event-store.js';
import type { ArtifactRegistry } from './artifacts.js';

/**
 * Insight: the read-side that powers "ask the department", the per-agent live
 * report, and the goals/roadmap view. Everything is derived from the event log,
 * work orders, artifacts and the latest DailyBriefing — no second source of truth.
 * The LLM only narrates the facts; with no key it answers from the facts directly.
 */

const DEPTS = Object.keys(DEPARTMENT_NAMES) as DepartmentId[];

/** Frontend room ids ↔ department ids (the HQ floor plan uses friendly room names). */
export const ROOM_TO_DEPT: Record<string, DepartmentId[]> = {
  research: ['D01', 'D02', 'D03'],
  outreach: ['D04', 'D05'],
  strategy: ['D06', 'D08'],
  engineering: ['D07'],
  leadintel: ['D09'],
  sales: ['D10'],
  finance: ['D11'],
  hr: ['D11'],
  recruitment: ['D13'],
  support: ['D12'],
  improvement: ['D13'],
  exec: DEPTS,
};

export function resolveDepartments(key: string): DepartmentId[] {
  if (key === 'all' || key === 'company' || key === 'exec') return DEPTS;
  if ((DEPTS as string[]).includes(key)) return [key as DepartmentId];
  return ROOM_TO_DEPT[key] ?? [];
}

export interface DeptFacts {
  department_ids: DepartmentId[];
  now: { work_orders: any[]; recent_events: any[] };
  done: { completed_work_orders: any[]; signed_artifacts: any[] };
  goals: { company: any[]; department: any[]; blockers: string[]; asks: any[] };
  pending_gates: any[];
  budget: any[];
  chat: any[];
}

export class Insight {
  private llm: LlmClient | null = null;

  constructor(private readonly db: Db, private readonly events: EventStore, private readonly artifacts: ArtifactRegistry, llm?: LlmClient) {
    if (llm) this.llm = llm;
  }

  private getLlm(): LlmClient {
    if (!this.llm) this.llm = createLlmClient();
    return this.llm;
  }

  /* ── Facts ─────────────────────────────────────────────────────────────── */

  async latestBriefing(venture_id: string): Promise<any | null> {
    const list = await this.artifacts.list(venture_id, { type: 'DailyBriefing' });
    if (!list.length) return null;
    const signed = list.filter((a: any) => a.quality === 'signed');
    const pick = (signed.length ? signed : list).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    return this.artifacts.get(pick.id);
  }

  async facts(venture_id: string, depts: DepartmentId[]): Promise<DeptFacts> {
    const inList = depts.length ? depts : DEPTS;
    const wo = await this.db.query<any>(
      `SELECT id, to_dept, from_dept, intent, status, budget_usd, params, created_at FROM work_orders
       WHERE venture_id = $1 AND to_dept = ANY($2::text[]) ORDER BY created_at DESC LIMIT 60`,
      [venture_id, inList],
    );
    const workOrders = wo.rows.map((r) => ({ ...r, params: typeof r.params === 'string' ? JSON.parse(r.params) : r.params }));
    const evRows = await this.db.query<any>(
      `SELECT seq, ts, type, actor_id, department_id, payload FROM events
       WHERE venture_id = $1 AND (department_id = ANY($2::text[]) OR department_id IS NULL)
       ORDER BY seq DESC LIMIT 80`,
      [venture_id, inList],
    );
    const recent = evRows.rows.map((r) => ({ ...r, payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload })).reverse();
    const arts = await this.db.query<any>(
      `SELECT id, type, quality, department_id, produced_by, created_at, cost_usd FROM artifacts
       WHERE venture_id = $1 AND department_id = ANY($2::text[]) ORDER BY created_at DESC LIMIT 40`,
      [venture_id, inList],
    );
    const gates = await this.db.query<any>(
      `SELECT id, gate_type, department_id, channel, amount_usd, risk, status, opened_at, expires_at FROM gates
       WHERE venture_id = $1 AND status = 'pending' AND department_id = ANY($2::text[]) ORDER BY opened_at DESC`,
      [venture_id, inList],
    );
    const budget = await this.db.query<any>(
      `SELECT ba.department_id, ba.envelope_usd, ba.reserved_usd, ba.spent_usd, ba.state
       FROM budget_allocations ba
       WHERE ba.venture_id = $1 AND ba.department_id = ANY($2::text[])
         AND ba.cycle_id = (SELECT cycle_id FROM budgets WHERE venture_id = $1 ORDER BY cycle_index DESC LIMIT 1)
       ORDER BY ba.department_id`,
      [venture_id, inList],
    ).catch(() => ({ rows: [] as any[] }));

    const briefing = await this.latestBriefing(venture_id);
    const body = briefing?.body ?? {};
    const deptBriefs = (body.department_briefs ?? []).filter((d: any) => inList.includes(d.department_id));
    const chat = recent.filter((e) => e.type === 'dept.chat_posted').slice(-15);

    return {
      department_ids: inList,
      now: {
        work_orders: workOrders.filter((w) => ['queued', 'admitted', 'running', 'partial'].includes(w.status)),
        recent_events: recent.slice(-30),
      },
      done: {
        completed_work_orders: workOrders.filter((w) => w.status === 'done'),
        signed_artifacts: arts.rows.filter((a) => a.quality === 'signed'),
      },
      goals: {
        company: body.company_goals ?? [],
        department: deptBriefs.flatMap((d: any) => (d.goals ?? []).map((g: string) => ({ department_id: d.department_id, goal: g, headline: d.headline }))),
        blockers: deptBriefs.flatMap((d: any) => d.blockers ?? []),
        asks: deptBriefs.flatMap((d: any) => (d.asks_of_other_departments ?? []).map((a: any) => ({ from: d.department_id, ...a }))),
      },
      pending_gates: gates.rows,
      budget: budget.rows,
      chat,
    };
  }

  /* ── Q&A ───────────────────────────────────────────────────────────────── */

  async ask(venture_id: string, deptKey: string, question: string, opts: { trace_id: string; actor?: string }): Promise<{ answer: string; source: 'llm' | 'facts'; facts: DeptFacts; department_ids: DepartmentId[] }> {
    const depts = resolveDepartments(deptKey);
    const facts = await this.facts(venture_id, depts);
    const label = depts.length === DEPTS.length ? 'the whole company (CEO / executive team)' : depts.map((d) => `${d} ${DEPARTMENT_NAMES[d]}`).join(', ');
    const llm = this.getLlm();
    let answer: string;
    let source: 'llm' | 'facts' = 'facts';
    if (llm.kind === 'anthropic') {
      const model = process.env.ANTHROPIC_MODEL_SONNET ?? 'claude-sonnet-4-6';
      const res = await llm.complete({
        model,
        max_tokens: 700,
        system: [
          `You are the head of ${label} inside Zeroth, an AI-run company. Answer the founder's question in first person plural ("we"), concretely and briefly (<= 180 words).`,
          'Use ONLY the facts below. If something is not in the facts, say so plainly rather than inventing it. Numbers must come from the facts.',
          'Structure: what we are doing right now → what we have done → what we are trying to do next → our goals/blockers, but only the parts the question asks about.',
          `FACTS (JSON): ${JSON.stringify(compact(facts)).slice(0, 14_000)}`,
        ].join('\n\n'),
        messages: [{ role: 'user', content: question }],
        temperature: 0,
      } as any);
      answer = res.text.trim() || factsAnswer(facts, question);
      source = 'llm';
    } else {
      answer = factsAnswer(facts, question);
    }
    await this.events.append({
      venture_id,
      type: 'dept.question_answered',
      actor_kind: 'founder',
      actor_id: opts.actor ?? 'founder',
      department_id: depts.length === 1 ? depts[0] : undefined,
      payload: { department_id: deptKey, question: question.slice(0, 500), answer: answer.slice(0, 2000), source },
      trace_id: opts.trace_id,
    }).catch(() => undefined);
    return { answer, source, facts, department_ids: depts };
  }

  /* ── Agents ─────────────────────────────────────────────────────────────── */

  async agents(venture_id: string, deptKey?: string): Promise<any[]> {
    const depts = deptKey ? resolveDepartments(deptKey) : DEPTS;
    const evs = await this.db.query<any>(
      `SELECT seq, ts, type, actor_id, department_id, payload, correlation_id FROM events
       WHERE venture_id = $1 AND actor_kind = 'agent' AND department_id = ANY($2::text[])
       ORDER BY seq DESC LIMIT 600`,
      [venture_id, depts],
    );
    const runs = await this.db.query<any>(
      `SELECT agent_id, department_id, role, model, status, started_at, finished_at, work_order_id, tokens_in, tokens_out
       FROM agent_runs WHERE venture_id = $1 AND department_id = ANY($2::text[]) ORDER BY started_at DESC LIMIT 400`,
      [venture_id, depts],
    ).catch(() => ({ rows: [] as any[] }));
    const woRows = await this.db.query<any>(`SELECT id, intent, status FROM work_orders WHERE venture_id = $1`, [venture_id]);
    const woIntent = new Map<string, any>(woRows.rows.map((w) => [w.id, w]));

    const byAgent = new Map<string, any>();
    const ensure = (id: string, dept: string) => {
      let a = byAgent.get(id);
      if (!a) { a = { agent_id: id, department_id: dept, current: null, history: [], tools: {}, last_seen: null, status: 'idle', runs: 0 }; byAgent.set(id, a); }
      return a;
    };
    for (const r of evs.rows.reverse()) {
      const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
      const id = String(p.agent_id ?? r.actor_id);
      const a = ensure(id, r.department_id);
      a.last_seen = r.ts;
      const wo = r.correlation_id ? woIntent.get(r.correlation_id) : null;
      const task = wo?.intent ?? p.intent ?? p.tool_name ?? r.type;
      if (r.type === 'agent.started' || r.type === 'dept.work_started') { a.current = { task, since: r.ts, work_order_id: r.correlation_id }; a.status = 'working'; }
      else if (r.type === 'agent.tool_used') { a.tools[p.tool_name] = (a.tools[p.tool_name] ?? 0) + 1; if (!a.current) { a.current = { task, since: r.ts, work_order_id: r.correlation_id }; a.status = 'working'; } }
      else if (r.type === 'agent.finished' || r.type === 'dept.work_completed' || r.type === 'artifact.signed') {
        if (a.current) { a.history.unshift({ ...a.current, until: r.ts, outcome: r.type === 'artifact.signed' ? `signed ${p.artifact?.type ?? ''}` : 'done' }); }
        a.current = null; a.status = 'idle'; a.runs += 1;
      } else if (r.type === 'dept.work_failed' || r.type === 'agent.tool_failed') {
        if (a.current) a.history.unshift({ ...a.current, until: r.ts, outcome: `failed: ${String(p.error ?? p.reason ?? '').slice(0, 80)}` });
        a.current = null; a.status = 'idle';
      }
      a.history = a.history.slice(0, 12);
    }
    for (const r of runs.rows) {
      const a = ensure(r.agent_id, r.department_id);
      a.role = r.role; a.model = r.model;
      if (r.status === 'running' && !a.current) { a.current = { task: woIntent.get(r.work_order_id)?.intent ?? 'running', since: r.started_at, work_order_id: r.work_order_id }; a.status = 'working'; }
    }
    return [...byAgent.values()].sort((x, y) => String(y.last_seen ?? '').localeCompare(String(x.last_seen ?? '')));
  }

  /* ── Goals & roadmap ───────────────────────────────────────────────────── */

  async goals(venture_id: string): Promise<any> {
    const v = await this.db.query<any>('SELECT liveness, spend_usd, created_at, status FROM ventures WHERE id = $1', [venture_id]);
    const liveness = v.rows[0]?.liveness ?? {};
    const live = typeof liveness === 'string' ? JSON.parse(liveness) : liveness;
    const briefing = await this.latestBriefing(venture_id);
    const body = briefing?.body ?? {};
    const milestones = ['idea_locked', 'market_validated', 'product_live', 'pipeline_active', 'revenue_real'].map((m) => ({ id: m, done: Boolean(live?.[m]) }));
    const arts = await this.db.query<any>(`SELECT id, type, quality, department_id, created_at FROM artifacts WHERE venture_id = $1 AND quality = 'signed' ORDER BY created_at ASC`, [venture_id]);
    const wo = await this.db.query<any>(`SELECT to_dept, intent, status, created_at FROM work_orders WHERE venture_id = $1 ORDER BY created_at ASC`, [venture_id]);
    const gaps = await this.db.query<any>(`SELECT id, body, quality, created_at FROM artifacts WHERE venture_id = $1 AND type = 'CapabilityGap' ORDER BY created_at DESC LIMIT 20`, [venture_id]);
    const milestoneEvents = await this.events.readStream(venture_id, { after_seq: 0, limit: 500, types: ['venture.milestone_reached', 'money.revenue_received', 'build.deployed', 'sales.deal_won', 'terac.hire_posted'] }).catch(() => [] as StoredEvent[]);
    return {
      milestones,
      company_goals: body.company_goals ?? [],
      department_goals: (body.department_briefs ?? []).map((d: any) => ({ department_id: d.department_id, name: DEPARTMENT_NAMES[d.department_id as DepartmentId], headline: d.headline, goals: d.goals, blockers: d.blockers, asks: d.asks_of_other_departments })),
      risks: body.risks ?? [],
      decisions: body.decisions ?? [],
      achievements: [
        ...milestoneEvents.map((e) => ({ kind: e.type, at: e.ts, detail: e.payload })),
        ...arts.rows.map((a) => ({ kind: 'artifact.signed', at: a.created_at, detail: { type: a.type, department_id: a.department_id, id: a.id } })),
      ].sort((a, b) => String(a.at).localeCompare(String(b.at))),
      roadmap: DEPTS.map((d) => ({
        department_id: d,
        name: DEPARTMENT_NAMES[d],
        work: wo.rows.filter((w) => w.to_dept === d).map((w) => ({ intent: w.intent, status: w.status, at: w.created_at })),
      })),
      improvement: gaps.rows.map((g) => ({ id: g.id, quality: g.quality, at: g.created_at, ...(typeof g.body === 'string' ? JSON.parse(g.body) : g.body) })),
      briefing_at: briefing?.created_at ?? null,
    };
  }
}

function compact(f: DeptFacts) {
  return {
    departments: f.department_ids,
    working_on_now: f.now.work_orders.map((w) => ({ intent: w.intent, status: w.status, budget_usd: w.budget_usd, params: w.params })),
    recent_activity: f.now.recent_events.slice(-20).map((e) => ({ t: e.type, who: e.actor_id, at: e.ts, p: trimPayload(e.payload) })),
    completed: f.done.completed_work_orders.map((w) => w.intent),
    signed_artifacts: f.done.signed_artifacts.map((a) => ({ type: a.type, by: a.produced_by, at: a.created_at })),
    company_goals: f.goals.company,
    department_goals: f.goals.department,
    blockers: f.goals.blockers,
    asks: f.goals.asks,
    pending_gates: f.pending_gates.map((g) => ({ type: g.gate_type, channel: g.channel, amount_usd: g.amount_usd, risk: g.risk })),
    budget: f.budget,
    chat: f.chat.map((c) => ({ author: c.payload?.author, text: c.payload?.text })),
  };
}

function trimPayload(p: any) {
  if (!p || typeof p !== 'object') return p;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (['tool_name', 'intent', 'work_order_id', 'artifact', 'gate_type', 'amount_usd', 'error', 'reason', 'milestone', 'text', 'author'].includes(k)) out[k] = v;
  return out;
}

/** Deterministic answer straight from the facts (used when no Anthropic key). */
export function factsAnswer(f: DeptFacts, question: string): string {
  const q = question.toLowerCase();
  const parts: string[] = [];
  const now = f.now.work_orders.map((w) => `${w.intent} (${w.status})`);
  const done = f.done.completed_work_orders.map((w) => w.intent);
  const signed = f.done.signed_artifacts.map((a) => a.type);
  const wantsAll = !/(right now|doing|done|did|goal|trying|next|block)/.test(q);
  if (wantsAll || /right now|doing|current/.test(q)) parts.push(now.length ? `Right now we're working on: ${uniq(now).join('; ')}.` : "Right now we're idle — no open work orders.");
  if (wantsAll || /done|did|achiev|so far/.test(q)) parts.push(done.length || signed.length ? `So far we've completed ${uniq(done).join(', ') || 'no work orders'}${signed.length ? ` and signed ${uniq(signed).join(', ')}` : ''}.` : "We haven't completed anything yet.");
  if (wantsAll || /goal|trying|next|plan|vision/.test(q)) {
    const goals = f.goals.department.map((g) => g.goal).concat(f.goals.company.map((g: any) => g.goal));
    parts.push(goals.length ? `Our goals: ${uniq(goals).slice(0, 6).join('; ')}.` : 'Goals will be set at the next executive briefing.');
  }
  if (wantsAll || /block|stuck|risk|need/.test(q)) {
    if (f.goals.blockers.length) parts.push(`Blockers: ${uniq(f.goals.blockers).join('; ')}.`);
    if (f.pending_gates.length) parts.push(`${f.pending_gates.length} decision(s) are waiting on the founder.`);
  }
  return parts.join(' ') || 'Nothing to report yet.';
}

function uniq<T>(xs: T[]): T[] { return [...new Set(xs)]; }
