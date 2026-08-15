import { describe, expect, it, vi } from 'vitest';
import { GateRequiredError, ToolPlane, type ToolCtx } from './index.js';

function ctx(overrides: Partial<ToolCtx> = {}): ToolCtx {
  return { venture_id: 'v1', department_id: 'd1', agent_id: 'a1', budget: { record: vi.fn() }, ...overrides };
}

describe('ToolPlane', () => {
  it('builds only named tools and rejects unknown names', () => {
    const plane = new ToolPlane({ driver: 'mock' });
    expect(plane.build(['calc'], ctx()).map((t) => t.name)).toEqual(['calc']);
    expect(() => plane.build(['missing'], ctx())).toThrow('Unknown tool');
  });

  it('enforces gates before side effects', async () => {
    const tool = new ToolPlane({ driver: 'mock' }).build(['stripe.create_payment_link'], ctx({ requestGate: async () => false }))[0]!;
    await expect(tool.run({ name: 'Plan', amount_cents: 1000 }, ctx({ requestGate: async () => false }))).rejects.toBeInstanceOf(GateRequiredError);
  });

  it('records budget and emits agent.tool_used events', async () => {
    const events: unknown[] = [];
    const budget = { record: vi.fn() };
    const tool = new ToolPlane({ driver: 'mock', onCall: (ev) => events.push(ev) }).build(['web_search'], ctx({ budget }))[0]!;
    await tool.run({ query: 'x' }, ctx({ budget }));
    expect(budget.record).toHaveBeenCalledWith(0.001, 'call', 'web_search');
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent.tool_used', tool_name: 'web_search' }));
  });

  it('calculates arithmetic without JavaScript eval', async () => {
    const tool = new ToolPlane({ driver: 'mock' }).build(['calc'], ctx())[0]!;
    await expect(tool.run({ expression: '2 + 3 * (4 - 1)^2' }, ctx())).resolves.toEqual({ result: 29 });
    await expect(tool.run({ expression: 'process.exit()' }, ctx())).rejects.toThrow();
  });

  it('returns deterministic mock output', async () => {
    const tool = new ToolPlane({ driver: 'mock' }).build(['web_fetch'], ctx())[0]!;
    const a = await tool.run({ url: 'https://example.com' }, ctx());
    const b = await tool.run({ url: 'https://example.com' }, ctx());
    expect(a).toEqual(b);
  });

  it('falls back from real to mock when env key is missing', async () => {
    const old = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const events: unknown[] = [];
    const tool = new ToolPlane({ driver: 'real', onCall: (ev) => events.push(ev) }).build(['stripe.create_payment_link'], ctx({ requestGate: async () => true }))[0]!;
    const out = await tool.run({ name: 'Plan', amount_cents: 1000 }, ctx({ requestGate: async () => true }));
    expect(out).toMatchObject({ provider: 'mock', tool_name: 'stripe.create_payment_link' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'degraded', tool_name: 'stripe.create_payment_link' }));
    process.env.STRIPE_SECRET_KEY = old;
  });
});
