import { describe, expect, it } from 'vitest';
import { ARTIFACT_OWNER, artifactSchema } from './artifacts.js';

const departments = ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12', 'D13'] as const;

describe('DailyBriefing artifact', () => {
  it('captures the 7am executive briefing with all department heads', () => {
    const result = artifactSchema('DailyBriefing').parse({
      cadence: 'daily_0700',
      meeting_date: '2026-08-15',
      timezone: 'America/Los_Angeles',
      band_room: 'executive-briefing',
      lookback: {
        since: '2026-08-14T07:00:00.000-07:00',
        until: '2026-08-15T07:00:00.000-07:00',
        sources: ['events', 'artifacts', 'gates', 'budgets'],
      },
      executive_attendees: departments.map((department_id) => ({
        department_id,
        head_agent_id: `${department_id}.head`,
        role: `${department_id} head`,
        status: 'present',
      })),
      company_goals: [{
        id: 'G1',
        goal: 'Ship the next validated product increment',
        owner_department_id: 'D07',
        metric: 'qa_pass_rate',
        target: '100%',
        priority: 'p0',
        due_at: '2026-08-15T17:00:00.000-07:00',
      }],
      department_briefs: departments.map((department_id) => ({
        department_id,
        headline: `${department_id} operating focus`,
        goals: ['Complete the assigned daily goal'],
        blockers: [],
        asks_of_other_departments: [],
        work_orders: [{ intent: 'daily_goal', budget_usd: 0.1, params: {} }],
      })),
      decisions: [],
      risks: [],
      broadcasts: [{ room: 'executive-briefing', message: 'Daily goals are live.' }],
    });

    expect(result.executive_attendees).toHaveLength(13);
    expect(result.department_briefs).toHaveLength(13);
    expect(ARTIFACT_OWNER.DailyBriefing).toBe('D13');
  });
});
