import { describe, expect, it } from 'vitest';
import { EventType, eventPayloadSchema } from './events.js';

describe('daily briefing events', () => {
  it('validates the scheduled 7am briefing trigger', () => {
    expect(EventType.parse('ops.daily_briefing_started')).toBe('ops.daily_briefing_started');
    const payload = eventPayloadSchema('ops.daily_briefing_started').parse({
      meeting_date: '2026-08-15',
    });
    expect(payload).toMatchObject({
      meeting_date: '2026-08-15',
      timezone: 'America/Los_Angeles',
      band_room: 'executive-briefing',
      lookback_hours: 24,
    });
  });
});
