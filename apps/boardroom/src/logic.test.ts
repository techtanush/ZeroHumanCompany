import { describe, expect, it } from 'vitest';
import { summarize } from './components/TimelinePanel';
import { DEPT_NAMES, EXEC, ROOMS, ROOM_BY_ID, humanizeAgent, roomForDept } from './hq/departments';
import { toE164 } from './lib/phone';

const ALL_DEPTS = Array.from({ length: 13 }, (_, i) => `D${String(i + 1).padStart(2, '0')}`);

describe('summarize (timeline one-liners)', () => {
  it('returns empty for a missing payload', () => {
    expect(summarize('dept.work_order_issued', null)).toBe('');
    expect(summarize('anything', undefined)).toBe('');
  });
  it('formats work orders, completions and failures', () => {
    expect(summarize('dept.work_order_issued', { intent: 'normalize_idea', to_dept: 'D01', budget_usd: 5 })).toBe('normalize_idea → D01 ($5)');
    expect(summarize('dept.work_completed', { artifact: { type: 'IdeaSeed' } })).toBe('done · IdeaSeed');
    expect(summarize('dept.work_completed', {})).toBe('done');
    expect(summarize('dept.work_failed', { error: 'boom' })).toBe('failed: boom');
  });
  it('formats gates and money', () => {
    expect(summarize('gate.opened', { gate_type: 'money_out', amount_usd: 20 })).toBe('money_out $20');
    expect(summarize('gate.opened', { gate_type: 'deploy' })).toBe('deploy');
    expect(summarize('gate.approved', { option_id: 'approve', decided_by: 'founder' })).toBe('approve by founder');
    expect(summarize('money.metered', { department_id: 'D07', resource: 'llm', cost_usd: 0.012345 })).toBe('D07 llm $0.0123');
    expect(summarize('money.wallet_funded', { amount_usd: 100, rail: 'stripe' })).toBe('$100 via stripe');
  });
  it('formats tools, meetings, workday and artifacts', () => {
    expect(summarize('agent.tool_used', { agent_id: 'build.frontend-engineer', tool_name: 'workspace.write_file', driver: 'real' })).toBe('build.frontend-engineer used workspace.write_file (real)');
    expect(summarize('agent.tool_used', { tool_name: 'workspace.list' })).toBe(' used workspace.list');
    expect(summarize('ops.meeting_started', { kind: 'all_hands', room: 'exec' })).toBe('all_hands in exec');
    expect(summarize('ops.workday_ended', { local_time: '17:00', timezone: 'UTC' })).toBe('17:00 UTC');
    expect(summarize('artifact.signed', { artifact: { type: 'Spec', version: 2 } })).toBe('Spec v2');
    expect(summarize('artifact.contested', { artifact: { type: 'Spec', version: 2 }, defects: ['a', 'b'] })).toBe('Spec v2 — a; b');
    expect(summarize('venture.milestone_reached', { milestone: 'first_customer' })).toBe('first_customer');
    expect(summarize('build.deployed', { url: 'https://x.dev' })).toBe('https://x.dev');
  });
  it('falls back to the first three non-meta keys', () => {
    const s = summarize('custom.thing', { actor_id: 'a', ts: 't', department_id: 'D01', foo: 1, bar: 'two', baz: true, qux: 'dropped' });
    expect(s).toBe('foo=1 bar="two" baz=true');
  });
});

describe('departments floor plan', () => {
  it('maps every kernel department to at least one room', () => {
    for (const d of ALL_DEPTS) expect(roomForDept(d), d).toBeDefined();
  });
  it('lists all 13 departments in the exec room', () => {
    expect(EXEC.depts).toEqual(ALL_DEPTS);
    expect(ROOM_BY_ID.exec).toBe(EXEC);
  });
  it('has unique room ids and every room dept is a real department', () => {
    const ids = ROOMS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of ROOMS) for (const d of r.depts) expect(DEPT_NAMES[d], `${r.id}:${d}`).toBeDefined();
  });
  it('roomForDept returns the first matching room and undefined for unknown', () => {
    expect(roomForDept('D11')?.id).toBe('finance');
    expect(roomForDept('D13')?.id).toBe('recruitment');
    expect(roomForDept('D07')?.id).toBe('engineering');
    expect(roomForDept('D99')).toBeUndefined();
  });
});

describe('humanizeAgent', () => {
  it('title-cases the role after the department prefix', () => {
    expect(humanizeAgent('build.frontend-engineer')).toEqual({ name: 'Frontend Engineer', role: 'build · Frontend Engineer' });
    expect(humanizeAgent('sales.sdr_lead')).toEqual({ name: 'Sdr Lead', role: 'sales · Sdr Lead' });
  });
  it('falls back to the prefix when there is no dot', () => {
    expect(humanizeAgent('cos')).toEqual({ name: 'Cos', role: 'cos · Cos' });
  });
  it('keeps nested segments', () => {
    expect(humanizeAgent('D07.build.head').name).toBe('Build.Head');
  });
});

describe('toE164', () => {
  it('passes through numbers that already carry a plus', () => {
    expect(toE164('+1 650 555 0123')).toBe('+16505550123');
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958');
  });
  it('assumes +1 for ten digits and prefixes + for eleven starting with 1', () => {
    expect(toE164('(650) 555-0123')).toBe('+16505550123');
    expect(toE164('1-650-555-0123')).toBe('+16505550123');
  });
  it('prefixes + for anything else and returns empty for no digits', () => {
    expect(toE164('442079460958')).toBe('+442079460958');
    expect(toE164('12345')).toBe('+12345');
    expect(toE164('')).toBe('');
    expect(toE164('abc')).toBe('');
  });
});
