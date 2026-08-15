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
  'composio.gmail_send': { to: 'founder@example.com', subject: 'Hi', body: 'Body' },
  'stripe.create_payment_link': { name: 'Plan', amount_cents: 1000, currency: 'usd' },
  'whop.create_checkout': { product_id: 'prod_1' },
  'dodo.create_checkout': { product_id: 'prod_1' },
  'terac.post_requisition': { kind: 'expert_verification' },
  'elevenlabs.tts': { text: 'Hello world', voice_id: 'voice_1' },
  'render.deploy': { service_id: 'srv_1' },
  'replay.run_suite': { suite_id: 'suite_1' },
  'linq.send_card': { to: '+15555555555', message: { parts: [{ text: 'Approve?' }] } },
  'band.publish': { room: 'hr-all', text: 'hello' },
  'pioneer.classify': { text: 'lead' },
  'simpop.build_panel': { region: 'CA', seed: 7, archetypes: 6 },
  'simpop.poll': { region: 'CA', questions: ['Would you try it?'], seed: 7, archetypes: 6 },
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
  'composio.gmail_send': z.object({ message_id: z.string(), thread_id: z.string(), sent_at: z.string().datetime() }),
  'stripe.create_payment_link': z.object({ id: z.string().startsWith('plink_'), url: z.string().startsWith('https://buy.stripe.com/test_'), livemode: z.literal(false) }),
  'render.deploy': z.object({ service_id: z.string(), deploy_id: z.string(), url: z.string().url(), status: z.string() }),
  'replay.run_suite': z.object({ passed: z.number(), total: z.number(), failed: z.number(), recording_url: z.string().url() }),
  'elevenlabs.tts': z.object({ audio_uri: z.string(), duration_s: z.number(), voice_id: z.string() }),
  'terac.post_requisition': z.object({ requisition_id: z.string(), status: z.string() }),
  'linq.send_card': z.object({ message_id: z.string(), delivered: z.boolean() }),
  'pioneer.classify': z.object({ label: z.string(), confidence: z.number() }),
  'simpop.build_panel': z.object({ region: z.string(), seed: z.number(), pums_vintage: z.string(), archetypes: z.array(z.object({ label: z.string(), attributes: z.record(z.unknown()), population_weight: z.number() })).min(4) }),
  'simpop.poll': z.object({ region: z.string(), seed: z.number(), honesty_note: z.string(), questions: z.array(z.object({ question: z.string(), estimate: z.number(), ci: z.tuple([z.number(), z.number()]), n_eff: z.number(), design_effect: z.number() })).min(1) }),
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

  it.each(toolNames)('mock output for %s is deterministic and shaped', async (name) => {
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
