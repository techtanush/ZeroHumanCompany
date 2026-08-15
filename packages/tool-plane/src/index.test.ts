import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { GateRequiredError, ToolPlane, type ToolCtx } from './index.js';
import { toolNames } from './definitions.js';
import { encodeForm } from './drivers/real/common.js';

function ctx(overrides: Partial<ToolCtx> = {}): ToolCtx {
  return { venture_id: 'v1', department_id: 'd1', agent_id: 'a1', budget: { record: vi.fn() }, ...overrides };
}

const sampleArgs: Record<string, unknown> = {
  web_search: { query: 'nurse staffing software' },
  web_fetch: { url: 'https://example.com/pricing' },
  calc: { expression: '2 + 3 * (4 - 1)^2' },
  memory_read: { query: 'customer interviews' },
  memory_write: { key: 'k', value: { a: 1 } },
  'apify.run_actor': { actor_id: 'user/actor', input: { q: 'x' } },
  'solari.browse': { task: 'inspect pricing', url: 'https://example.com' },
  'solari.act': { task: 'create account until 2FA', url: 'https://example.com/signup', guards: { stop_on: ['2fa'] } },
  'solari.extract': { task: 'extract pricing', url: 'https://example.com/pricing', schema: { tiers: 'array' } },
  'solari.screenshot': { session_id: 'sess_1', full_page: true },
  'composio.gmail_send': { to: 'founder@example.com', subject: 'Hi', body: 'Body' },
  'stripe.create_payment_link': { name: 'Plan', amount_cents: 1000, currency: 'usd' },
  'whop.create_checkout': { product_id: 'prod_1' },
  'dodo.create_checkout': { product_id: 'prod_1' },
  'terac.post_requisition': { role: 'Sales development rep', task: 'Book 5 discovery calls with dental clinic owners', count: 1 },
  'terac.request_feasibility': { task: 'Interview 5 dental office managers', panel: 'US dental office managers', count: 5 },
  'terac.get_feasibility': { request_id: 'feas_1' },
  'terac.list_opportunities': { status: 'active' },
  'terac.get_submissions': { opportunity_id: 'opp_1' },
  'terac.launch_opportunity': { opportunity_id: 'opp_1' },
  'terac.approve_submission': { submission_id: 'sub_1' },
  'terac.mcp_call': { tool: 'terac_get_context', args: {} },
  'elevenlabs.tts': { text: 'Hello world', voice_id: 'voice_1' },
  'elevenlabs.clone_voice': { name: 'Founder voice', consent_event_id: 'consent_1', audio_base64: Buffer.from('fake audio').toString('base64') },
  'elevenlabs.create_agent': { name: 'Discovery caller', voice_id: 'voice_1', system_prompt: 'Disclose AI and ask questions.', first_message: 'Hi, this is an AI assistant.' },
  'elevenlabs.place_call': { agent_id: 'agent_1', to_e164: '+15555555555', disclosure: true },
  'elevenlabs.transcribe': { audio_url: 'https://example.com/audio.mp3' },
  'elevenlabs.delete_voice': { voice_id: 'voice_1', revocation_event_id: 'revoked_1' },
  'render.deploy': { service_id: 'srv_1' },
  'replay.run_suite': { suite_id: 'suite_1' },
  'linq.send_card': { to: '+15555555555', message: { parts: [{ text: 'Approve?' }] } },
  'linq.await_reply': { gate_id: 'gate_1', timeout_s: 60 },
  'band.publish': { room: 'hr-all', text: 'hello' },
  'pioneer.classify': { text: 'lead' },
  'simpop.build_panel': { region: 'CA', seed: 7, archetypes: 6 },
  'simpop.poll': { region: 'CA', questions: ['Would you try it?'], seed: 7, archetypes: 6 },
  'leadgen.search': { query: 'dental clinics hiring office managers', region: 'CA', limit: 5 },
  'leadgen.enrich': { leads: [{ company: 'Acme Dental', role: 'Owner' }] },
  'crm.upsert': { object_type: 'lead', records: [{ company: 'Acme Dental' }] },
  'support.upsert_ticket': { customer_alias: 'cust-1', subject: 'Cannot log in', body: 'Login link failed', severity: 'high' },
  'metrics.record_signal': { source: 'sales', theme: 'price objection', severity: 'medium', evidence_refs: ['deal-1'] },
  'github.push': { branch: 'main' },
};

const outputShapes: Record<string, z.ZodTypeAny> = {
  web_search: z.object({ results: z.array(z.object({ title: z.string(), url: z.string().url(), snippet: z.string(), published_at: z.string().datetime() })).min(3).max(5) }),
  web_fetch: z.object({ url: z.string().url(), status: z.number(), title: z.string(), text: z.string(), content_hash: z.string(), retrieved_at: z.string().datetime() }),
  calc: z.object({ result: z.number() }),
  memory_read: z.object({ entries: z.array(z.unknown()) }),
  memory_write: z.object({ stored: z.boolean(), key: z.string() }),
  'apify.run_actor': z.object({ items: z.array(z.unknown()) }),
  'solari.browse': z.object({ steps: z.array(z.unknown()), final_url: z.string(), screenshot_uri: z.string() }),
  'solari.act': z.object({ status: z.string(), session_id: z.string(), steps: z.array(z.unknown()), final_url: z.string(), screenshot_uri: z.string() }),
  'solari.extract': z.object({ status: z.string(), extracted: z.record(z.unknown()), final_url: z.string(), screenshot_uri: z.string() }),
  'solari.screenshot': z.object({ session_id: z.string(), screenshot_uri: z.string() }),
  'composio.gmail_send': z.object({ message_id: z.string(), thread_id: z.string(), sent_at: z.string().datetime() }),
  'stripe.create_payment_link': z.object({ id: z.string().startsWith('plink_'), url: z.string().startsWith('https://buy.stripe.com/test_'), livemode: z.literal(false) }),
  'render.deploy': z.object({ service_id: z.string(), deploy_id: z.string(), url: z.string().url(), status: z.string() }),
  'replay.run_suite': z.object({ passed: z.number(), total: z.number(), failed: z.number(), recording_url: z.string().url() }),
  'elevenlabs.tts': z.object({ audio_uri: z.string(), duration_s: z.number(), voice_id: z.string() }),
  'elevenlabs.clone_voice': z.object({ voice_id: z.string(), consent_event_id: z.string(), status: z.string() }),
  'elevenlabs.create_agent': z.object({ agent_id: z.string(), status: z.string() }),
  'elevenlabs.place_call': z.object({ call_id: z.string(), status: z.string(), disclosure: z.literal(true) }),
  'elevenlabs.transcribe': z.object({ transcript_id: z.string(), text: z.string(), language_code: z.string() }),
  'elevenlabs.delete_voice': z.object({ voice_id: z.string(), deleted: z.boolean() }),
  'terac.post_requisition': z.object({ surface: z.string(), requisition_id: z.string(), launched: z.literal(false) }),
  'terac.request_feasibility': z.object({ requestId: z.string(), status: z.string() }),
  'terac.get_feasibility': z.object({ requestId: z.string(), status: z.string(), costPerParticipant: z.number() }),
  'terac.list_opportunities': z.object({ data: z.array(z.object({ id: z.string(), status: z.string() })) }),
  'terac.get_submissions': z.object({ data: z.array(z.object({ id: z.string(), status: z.string() })) }),
  'terac.launch_opportunity': z.object({ id: z.string(), launched: z.literal(true) }),
  'terac.approve_submission': z.object({ id: z.string(), status: z.literal('approved') }),
  'terac.mcp_call': z.object({ tool: z.string(), result: z.record(z.unknown()) }),
  'linq.send_card': z.object({ message_id: z.string(), delivered: z.boolean() }),
  'linq.await_reply': z.object({ gate_id: z.string().optional(), status: z.string(), replies: z.array(z.unknown()) }),
  'pioneer.classify': z.object({ label: z.string(), confidence: z.number() }),
  'simpop.build_panel': z.object({ region: z.string(), seed: z.number(), pums_vintage: z.string(), archetypes: z.array(z.object({ label: z.string(), attributes: z.record(z.unknown()), population_weight: z.number() })).min(4) }),
  'simpop.poll': z.object({ region: z.string(), seed: z.number(), honesty_note: z.string(), questions: z.array(z.object({ question: z.string(), estimate: z.number(), ci: z.tuple([z.number(), z.number()]), n_eff: z.number(), design_effect: z.number() })).min(1) }),
  'leadgen.search': z.object({ provider: z.string(), query: z.string(), leads: z.array(z.object({ alias: z.string(), company: z.string(), role: z.string(), region: z.string(), source_url: z.string().url(), trigger: z.string() })).min(1) }),
  'leadgen.enrich': z.object({ provider: z.string(), leads: z.array(z.object({ email: z.string().email(), confidence: z.number(), suppression: z.object({ dnc: z.boolean(), suppressed: z.boolean(), basis: z.string() }) })).min(1) }),
  'crm.upsert': z.object({ object_type: z.string(), upserted: z.number(), batch_id: z.string() }),
  'support.upsert_ticket': z.object({ ticket_id: z.string(), status: z.string(), severity: z.string() }),
  'metrics.record_signal': z.object({ signal_id: z.string(), recorded: z.boolean(), severity: z.string() }),
  'github.push': z.object({ commit_sha: z.string(), branch: z.string(), url: z.string().url() }),
  'band.publish': z.object({ message_id: z.string(), room: z.string() }),
  'whop.create_checkout': z.object({ id: z.string(), checkout_url: z.string().url() }),
  'dodo.create_checkout': z.object({ id: z.string(), checkout_url: z.string().url() }),
};

describe('ToolPlane', () => {
  it('builds only named tools and rejects unknown names', () => {
    const plane = new ToolPlane({ driver: 'mock' });
    expect(plane.build(['calc'], ctx()).map((t) => t.name)).toEqual(['calc']);
    expect(() => plane.build(['missing'], ctx())).toThrow('Unknown tool');
  });

  it('enforces gates before side effects and allows approved gated calls', async () => {
    const blocked = new ToolPlane({ driver: 'mock' }).build(['stripe.create_payment_link'], ctx({ requestGate: async () => false }))[0]!;
    await expect(blocked.run(sampleArgs['stripe.create_payment_link'], ctx({ requestGate: async () => false }))).rejects.toBeInstanceOf(GateRequiredError);

    const allowed = new ToolPlane({ driver: 'mock' }).build(['stripe.create_payment_link'], ctx({ requestGate: async () => true }))[0]!;
    await expect(allowed.run(sampleArgs['stripe.create_payment_link'], ctx({ requestGate: async () => true }))).resolves.toMatchObject({ livemode: false });
  });

  it('records budget and emits agent.tool_used events', async () => {
    const events: unknown[] = [];
    const budget = { record: vi.fn() };
    const tool = new ToolPlane({ driver: 'mock', onCall: (ev) => events.push(ev) }).build(['web_search'], ctx({ budget }))[0]!;
    await tool.run({ query: 'x' }, ctx({ budget }));
    expect(budget.record).toHaveBeenCalledWith(0.001, 'call', 'web_search');
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent.tool_used', tool_name: 'web_search' }));
  });

  it('calculates precedence, parentheses, and errors without JavaScript eval', async () => {
    const tool = new ToolPlane({ driver: 'mock' }).build(['calc'], ctx())[0]!;
    await expect(tool.run({ expression: '2 + 3 * (4 - 1)^2' }, ctx())).resolves.toEqual({ result: 29 });
    await expect(tool.run({ expression: '(2 + 3' }, ctx())).rejects.toThrow('Mismatched');
    await expect(tool.run({ expression: 'process.exit()' }, ctx())).rejects.toThrow();
  });

  it.each(toolNames.filter((n) => !n.startsWith('workspace.')))('mock output for %s is deterministic and shaped', async (name) => {
    const tool = new ToolPlane({ driver: 'mock' }).build([name], ctx({ requestGate: async () => true }))[0]!;
    const a = await tool.run(sampleArgs[name], ctx({ requestGate: async () => true }));
    const b = await tool.run(sampleArgs[name], ctx({ requestGate: async () => true }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    outputShapes[name].parse(a);
  });

  it('falls back from real to mock when env key is missing', async () => {
    const old = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const events: unknown[] = [];
    const tool = new ToolPlane({ driver: 'real', onCall: (ev) => events.push(ev) }).build(['stripe.create_payment_link'], ctx({ requestGate: async () => true }))[0]!;
    const out = await tool.run(sampleArgs['stripe.create_payment_link'], ctx({ requestGate: async () => true }));
    expect(out).toMatchObject({ livemode: false });
    expect(events).toContainEqual(expect.objectContaining({ type: 'degraded', tool_name: 'stripe.create_payment_link' }));
    process.env.STRIPE_SECRET_KEY = old;
  });

  it('form-encodes Stripe bracket notation exactly', () => {
    expect(encodeForm({ line_items: [{ price: 'price_123', quantity: 1 }] })).toBe('line_items%5B0%5D%5Bprice%5D=price_123&line_items%5B0%5D%5Bquantity%5D=1');
  });
});
