import { runHead, createLlmClient, type LlmClient } from '@zeroth/agent-kit';
import type { ArtifactType, DepartmentManifest } from '@zeroth/contracts';
import { getManifest, loadManifests } from '@zeroth/manifests';
import { ToolPlane, type Tool, type ToolCtx } from '@zeroth/tool-plane';
import { sendLinqText, type Kernel } from '@zeroth/kernel';

export interface WorkerOptions {
  kernel: Kernel;
  llm?: LlmClient;
  toolDriver?: 'mock' | 'real';
  /** Poll interval when the queue is empty. */
  idleMs?: number;
  manifests?: Map<string, DepartmentManifest>;
}

/**
 * The Orchestrator consumes WorkOrders and runs the owning department's Head
 * loop. It is the only place agents are actually invoked, so budget reservation,
 * gate routing and event emission all funnel through here.
 */
export class Orchestrator {
  private manifests!: Map<string, DepartmentManifest>;
  private llm: LlmClient;
  private tools: ToolPlane;
  private running = false;
  /** vendors we've already asked the founder about, per venture — one text per missing key. */
  private askedForKey = new Set<string>();

  constructor(private opts: WorkerOptions) {
    this.llm = opts.llm ?? createLlmClient();
    this.tools = new ToolPlane({
      driver: opts.toolDriver ?? (process.env.ZEROTH_TOOLS === 'real' ? 'real' : 'mock'),
      onCall: (ev) => { if (ev.type === 'degraded') void this.onDegraded(ev.tool_name, ev.reason); },
    });
  }

  private currentWo: any = null;

  /**
   * A department reached for an integration the founder hasn't connected yet
   * (e.g. Composio for Gmail, Render for deploys). The mock keeps the work
   * moving; the founder gets ONE Linq text per venture+vendor asking for the key,
   * and the Boardroom sees a human.notified event.
   */
  private async onDegraded(tool_name: string, reason: string): Promise<void> {
    const wo = this.currentWo; if (!wo) return;
    const vendor = tool_name.split('.')[0];
    const key = `${wo.venture_id}:${vendor}`;
    if (this.askedForKey.has(key)) return;
    this.askedForKey.add(key);
    const kernel = this.opts.kernel;
    const text = `${wo.to_dept} needs ${vendor} for "${wo.intent}" (${reason}). Add the key in the Boardroom → keys, and the next run will use it for real. Until then it runs on the mock.`;
    const r = process.env.FOUNDER_PHONE ? await sendLinqText(process.env.FOUNDER_PHONE, text, { kind: 'integration_needed', vendor, venture_id: wo.venture_id }) : { ok: false, detail: 'no FOUNDER_PHONE', degraded: 'missing FOUNDER_PHONE' as string | undefined };
    await kernel.events.append({
      venture_id: wo.venture_id, type: 'human.notified', actor_kind: 'system', actor_id: 'orchestrator.integrations', department_id: wo.to_dept,
      payload: { channel: 'linq', kind: 'integration_needed', vendor, tool_name, reason, delivered: r.ok, degraded: r.degraded, text },
      trace_id: wo.trace_id, correlation_id: wo.id, idempotency_key: `integration_needed:${key}`,
    }).catch(() => undefined);
    await this.chat(wo, `${wo.to_dept}.head`, `Heads up: we don't have ${vendor} connected yet — running on the mock and asked the founder for the key.`);
  }

  async init(): Promise<void> {
    if (this.opts.manifests) {
      this.manifests = this.opts.manifests;
      return;
    }
    const loaded = await loadManifests();
    const list = Array.isArray(loaded) ? loaded : [...(loaded as Map<string, DepartmentManifest>).values()];
    this.manifests = new Map(list.map((m) => [m.id, m]));
  }

  /** Process a single work order. Returns false when the queue is empty. */
  async tick(dept?: string): Promise<boolean> {
    const wo = await this.opts.kernel.claimNextWorkOrder(dept);
    if (!wo) return false;
    await this.execute(wo);
    return true;
  }

  async execute(wo: any): Promise<void> {
    const kernel = this.opts.kernel;
    const manifest = this.manifests.get(wo.to_dept);
    this.currentWo = wo;

    if (await kernel.isHalted(wo.venture_id)) {
      await kernel.db.query(`UPDATE work_orders SET status='cancelled' WHERE id=$1`, [wo.id]);
      return;
    }
    if (!manifest) {
      await this.fail(wo, `no manifest for department ${wo.to_dept}`);
      return;
    }

    await kernel.events.append({
      venture_id: wo.venture_id,
      type: 'dept.work_started',
      actor_kind: 'agent',
      actor_id: `${wo.to_dept}.head`,
      department_id: wo.to_dept,
      payload: { work_order_id: wo.id },
      trace_id: wo.trace_id,
      correlation_id: wo.id,
    });

    // Reserve budget before any tokens are spent.
    let reservation: string | null = null;
    try {
      reservation = await kernel.meter.reserve(
        wo.venture_id, wo.to_dept, Number(wo.budget_usd), wo.id,
      );
    } catch (e) {
      await this.escalate(wo, 'needs_budget', e instanceof Error ? e.message : String(e));
      await this.fail(wo, 'budget reservation failed');
      return;
    }

    try {
      const inputs = await this.loadInputs(wo);
      const settings = await kernel.settings.get(wo.venture_id).catch(() => null);
      const workspace_root: string | undefined = wo.params?.workspace_root ?? settings?.workspace.workspace_root ?? undefined;
      await this.chat(wo, `${wo.to_dept}.head`, `Picking up "${wo.intent}" (budget $${Number(wo.budget_usd).toFixed(2)}). ${manifest.workers.length} teammates on it.`);
      const toolCtx: ToolCtx = {
        venture_id: wo.venture_id,
        department_id: wo.to_dept,
        agent_id: `${wo.to_dept}.head`,
        work_order_id: wo.id,
        workspace_root,
        budget: {
          record: (cost_usd, unit, resource) => {
            void kernel.meter.record({
              venture_id: wo.venture_id, department_id: wo.to_dept, work_order_id: wo.id,
              unit: 'tool_call', resource, quantity: 1, unit_cost_usd: cost_usd,
            }).catch(() => undefined);
          },
        },
        // A side-effecting tool opens a real gate and waits for a real decision.
        requestGate: async (req) => {
          const gate = await kernel.gates.open({
            venture_id: wo.venture_id,
            gate_type: req.gate as any,
            requested_by: req.agent_id,
            department_id: wo.to_dept as any,
            action: { tool: req.tool_name, args: (req.args ?? {}) as Record<string, unknown> },
            preview: { summary: `${req.agent_id} wants to call ${req.tool_name}` },
            options: [
              { id: 'approve', label: 'Approve', consequence: `${req.tool_name} runs for real` },
              { id: 'reject', label: 'Reject', consequence: 'the action is skipped' },
            ],
            suggested_option_id: 'approve',
            risk: req.gate === 'money_out' ? 'high' : 'medium',
            reversible: req.gate === 'deploy',
            idempotency_key: `${wo.id}:${req.tool_name}:${JSON.stringify(req.args ?? {}).slice(0, 120)}`,
            work_order_id: wo.id,
            trace_id: wo.trace_id,
          } as any);
          return gate.status === 'approved' || gate.status === 'auto_approved';
        },
      };

      const outcome = await runHead({
        manifest,
        buildTools: (names: string[], agent_id: string): Tool[] => this.tools.build(names, { ...toolCtx, agent_id }),
        preflight: async (type, body, sources) => {
          const v = await kernel.artifacts.checkEvidence(type, body, sources, wo.venture_id);
          return v.map((x) => `${x.json_pointer}: ${x.reason}`);
        },
        ctx: {
          venture_id: wo.venture_id,
          department_id: wo.to_dept,
          work_order_id: wo.id,
          trace_id: wo.trace_id,
          llm: this.llm,
          toolCtx,
          vars: {
            task: wo.intent,
            intent: wo.intent,
            inputs: JSON.stringify(inputs).slice(0, 20_000),
            success_criteria: (wo.success_criteria ?? []).join('; '),
            params: JSON.stringify(wo.params ?? {}),
          },
          resolveTier: (requested) => kernel.meter.effectiveTier(wo.venture_id, wo.to_dept, requested),
          onUsage: async (u) => {
            await kernel.meter.recordTokens({
              venture_id: wo.venture_id, department_id: wo.to_dept, work_order_id: wo.id,
              tier: u.tier, resource: u.model,
              tokens_in: u.tokens_in, tokens_out: u.tokens_out, tokens_cached_read: u.tokens_cached_read,
            });
          },
          onEvent: async (type, payload) => {
            await kernel.events.append({
              venture_id: wo.venture_id, type, actor_kind: 'agent',
              actor_id: String(payload.agent_id ?? wo.to_dept), department_id: wo.to_dept,
              payload, trace_id: wo.trace_id, correlation_id: wo.id,
            }).catch(() => undefined);
          },
        },
      });

      if (outcome.outputs.length === 0) {
        await this.escalate(wo, 'needs_capability', outcome.gaps.join('; ') || 'no output produced');
        await this.chat(wo, `${wo.to_dept}.head`, `Blocked on "${wo.intent}": ${(outcome.gaps[0] ?? 'no output').slice(0, 140)}. Filing this with the improvement branch.`);
        await this.fail(wo, 'department produced no artifact');
        return;
      }
      await this.chat(wo, `${wo.to_dept}.head`, `Finished "${wo.intent}" → ${outcome.outputs.length} ${outcome.type} (${outcome.quality}).${outcome.gaps.length ? ` Gaps: ${outcome.gaps.slice(0, 2).join('; ').slice(0, 160)}` : ''}`);

      // Persist every output; sign only what passed evidence checks.
      let lastRef: any = null;
      for (const out of outcome.outputs) {
        try {
          const artifact = await kernel.artifacts.create({
            venture_id: wo.venture_id,
            type: outcome.type as ArtifactType,
            body: out.body,
            sources: out.sources,
            produced_by: manifest.head.agent_id,
            department_id: wo.to_dept,
            work_order_id: wo.id,
            quality: outcome.quality === 'signed' ? 'signed' : outcome.quality,
            gaps: outcome.gaps,
          });
          lastRef = { type: artifact.type, id: artifact.id, version: artifact.version, hash: artifact.body_hash };
          await kernel.events.append({
            venture_id: wo.venture_id,
            type: artifact.quality === 'signed' ? 'artifact.signed' : 'artifact.contested',
            actor_kind: 'agent',
            actor_id: manifest.head.agent_id,
            department_id: wo.to_dept,
            payload:
              artifact.quality === 'signed'
                ? { artifact: lastRef, quality: artifact.quality, cost_usd: artifact.cost_usd }
                : { artifact: lastRef, defects: outcome.gaps },
            trace_id: wo.trace_id,
            correlation_id: wo.id,
          });
        } catch (e) {
          // An artifact that cannot be signed is recorded as contested, not lost.
          const msg = e instanceof Error ? e.message : String(e);
          const fallback = await kernel.artifacts.create({
            venture_id: wo.venture_id, type: outcome.type as ArtifactType, body: out.body,
            sources: out.sources, produced_by: manifest.head.agent_id, department_id: wo.to_dept,
            work_order_id: wo.id, quality: 'contested', gaps: [...outcome.gaps, msg],
          }).catch(() => null);
          if (fallback) {
            lastRef = { type: fallback.type, id: fallback.id, version: fallback.version, hash: fallback.body_hash };
            await kernel.events.append({
              venture_id: wo.venture_id, type: 'artifact.contested', actor_kind: 'agent',
              actor_id: manifest.head.agent_id, department_id: wo.to_dept,
              payload: { artifact: lastRef, defects: [msg] },
              trace_id: wo.trace_id, correlation_id: wo.id,
            });
          }
        }
      }

      await kernel.events.append({
        venture_id: wo.venture_id,
        type: 'dept.work_completed',
        actor_kind: 'agent',
        actor_id: manifest.head.agent_id,
        department_id: wo.to_dept,
        payload: { work_order_id: wo.id, artifact: lastRef ?? undefined },
        trace_id: wo.trace_id,
        correlation_id: wo.id,
      });
    } catch (e) {
      await this.fail(wo, e instanceof Error ? e.message : String(e));
    } finally {
      if (reservation) await this.opts.kernel.meter.release(reservation).catch(() => undefined);
    }
  }

  /**
   * Department group chat: every department has a room where the head narrates
   * plans and outcomes. Delivered to Band when BAND_API_KEY exists (best effort),
   * always recorded as a dept.chat_posted event so the Boardroom shows the thread.
   */
  private async chat(wo: any, author: string, text: string): Promise<void> {
    const kernel = this.opts.kernel;
    const room = `dept-${String(wo.to_dept).toLowerCase()}`;
    let transport: 'band' | 'local' = 'local';
    let message_id: string | undefined;
    if (process.env.BAND_API_KEY && process.env.ZEROTH_TOOLS === 'real') {
      try {
        const [tool] = this.tools.build(['band.publish'], { venture_id: wo.venture_id, department_id: wo.to_dept, agent_id: author, work_order_id: wo.id, budget: { record() {} }, requestGate: async () => true });
        const r = (await tool.run({ room, text, author }, { venture_id: wo.venture_id, department_id: wo.to_dept, agent_id: author, work_order_id: wo.id, budget: { record() {} }, requestGate: async () => true })) as any;
        transport = 'band'; message_id = r?.message_id ?? r?.id;
      } catch { transport = 'local'; }
    }
    await kernel.events.append({
      venture_id: wo.venture_id, type: 'dept.chat_posted', actor_kind: 'agent', actor_id: author, department_id: wo.to_dept,
      payload: { room, author, text: text.slice(0, 1000), transport, message_id }, trace_id: wo.trace_id, correlation_id: wo.id,
    }).catch(() => undefined);
  }

  private async loadInputs(wo: any): Promise<unknown[]> {
    const refs: any[] = Array.isArray(wo.input_artifacts) ? wo.input_artifacts : [];
    const out: unknown[] = [];
    for (const ref of refs) {
      const a = await this.opts.kernel.artifacts.get(ref.id);
      if (a) out.push({ type: a.type, version: a.version, body: a.body });
    }
    return out;
  }

  private async fail(wo: any, error: string): Promise<void> {
    await this.opts.kernel.events.append({
      venture_id: wo.venture_id,
      type: 'dept.work_failed',
      actor_kind: 'agent',
      actor_id: `${wo.to_dept}.head`,
      department_id: wo.to_dept,
      payload: { work_order_id: wo.id, error, attempt: Number(wo.attempt ?? 0) },
      trace_id: wo.trace_id,
      correlation_id: wo.id,
    }).catch(() => undefined);
  }

  private async escalate(wo: any, reason: string, detail: string): Promise<void> {
    const kernel = this.opts.kernel;
    await kernel.db.query(
      `INSERT INTO escalations (id, venture_id, from_dept, reason, severity, summary, detail,
                                options, blocks_work_order_id, trace_id)
       VALUES (gen_random_uuid(),$1,$2,$3,'blocking',$4,$5,'[]',$6,$7)`,
      [wo.venture_id, wo.to_dept, reason, `${wo.to_dept} is blocked: ${reason}`, detail, wo.id, wo.trace_id],
    ).catch(() => undefined);
  }

  /** Long-running loop for `pnpm dev:orchestrator`. */
  async start(): Promise<void> {
    this.running = true;
    const idle = this.opts.idleMs ?? 1000;
    while (this.running) {
      const did = await this.tick().catch((e) => {
        console.error('[orchestrator] tick failed', e);
        return false;
      });
      if (!did) await new Promise((r) => setTimeout(r, idle));
    }
  }

  stop(): void {
    this.running = false;
  }
}

export { getManifest };
