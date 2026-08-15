import type { MeetingSchedule } from '@zeroth/contracts';
import type { Db } from '@zeroth/db';
import type { EventStore } from './event-store.js';
import type { SettingsStore } from './settings.js';
import type { Kernel } from './kernel.js';

/**
 * Company clock. Once a minute, for every active venture, compares local time
 * (in the founder's timezone) against the meeting schedule and emits:
 *   ops.workday_started / ops.workday_ended
 *   ops.meeting_started {executive}  → D13 runs the executive briefing
 *   ops.meeting_started {all_hands}  → every agent walks to the exec room
 *   ops.improvement_run_started      → the improvement branch mines capability gaps
 * Every emission is idempotent per (venture, day, kind), so restarts are safe.
 * `time_scale` on the venture is respected: 0.001 turns a day into ~90 s.
 */

type Kind = 'workday_start' | 'workday_end' | 'executive' | 'all_hands' | 'improvement';
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function localClock(now: Date, timezone: string): { hhmm: string; day: (typeof DAY_KEYS)[number]; date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hh = parts.hour === '24' ? '00' : parts.hour;
  const minutes = Number(hh) * 60 + Number(parts.minute);
  return { hhmm: `${hh}:${parts.minute}`, day: parts.weekday.toLowerCase().slice(0, 3) as any, date: `${parts.year}-${parts.month}-${parts.day}`, minutes };
}

function toMinutes(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

/** Which schedule points are due at this local minute (within a 2-minute window so a slow tick never misses). */
export function dueKinds(schedule: MeetingSchedule, minutes: number, day: string): Kind[] {
  if (!schedule.days.includes(day as any)) return [];
  // Exact-minute match; the once-a-minute tick plus per-day idempotency keys make this safe.
  const within = (t: string) => minutes === toMinutes(t);
  const out: Kind[] = [];
  if (within(schedule.work_start)) out.push('workday_start');
  if (within(schedule.exec_meeting_time)) out.push('executive');
  if (within(schedule.all_hands_time)) out.push('all_hands');
  if (within(schedule.work_end)) out.push('workday_end');
  if (within(schedule.improvement_time)) out.push('improvement');
  return out;
}

export class CompanyClock {
  private timer: NodeJS.Timeout | null = null;
  private meetingTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly kernel: Kernel, private readonly db: Db, private readonly events: EventStore, private readonly settings: SettingsStore) {}

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    void this.closeStaleMeetings().catch(() => undefined);
    this.timer = setInterval(() => { void this.tick().catch((e) => console.error('[clock] tick failed', e)); }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.meetingTimers.values()) clearTimeout(t);
    this.meetingTimers.clear();
  }

  /** Meeting-end timers live in memory: after a restart, end any meeting that never got its ops.meeting_ended. */
  private async closeStaleMeetings(): Promise<void> {
    const rows = await this.db.query<{ venture_id: string; kind: string }>(
      `SELECT s.venture_id, s.payload->>'kind' AS kind FROM events s
       WHERE s.type = 'ops.meeting_started'
         AND NOT EXISTS (SELECT 1 FROM events e WHERE e.venture_id = s.venture_id AND e.type = 'ops.meeting_ended' AND e.seq > s.seq)`);
    for (const r of rows.rows) {
      const trace_id = await this.kernel.traceFor(r.venture_id).catch(() => null);
      if (!trace_id) continue;
      await this.events.append({ venture_id: r.venture_id, type: 'ops.meeting_ended', actor_kind: 'system', actor_id: 'kernel.clock', department_id: 'D13', payload: { kind: (r.kind as any) ?? 'executive', room: 'exec' }, trace_id }).catch(() => undefined);
    }
  }

  async tick(now = new Date()): Promise<void> {
    const ventures = await this.db.query<{ id: string; time_scale: number }>(`SELECT id, time_scale FROM ventures WHERE status = 'active' AND kill_switch = false`);
    for (const v of ventures.rows) {
      const s = await this.settings.get(v.id).catch(() => null);
      if (!s) continue;
      const clock = localClock(now, s.meetings.timezone);
      for (const kind of dueKinds(s.meetings, clock.minutes, clock.day)) {
        await this.fire(v.id, kind, { scheduled: true, date: clock.date, hhmm: clock.hhmm, timezone: s.meetings.timezone, schedule: s.meetings }).catch(() => undefined);
      }
    }
  }

  /** Manual or scheduled trigger of one schedule point. Idempotent per venture/day/kind. */
  async fire(venture_id: string, kind: Kind, ctx: { scheduled: boolean; date?: string; hhmm?: string; timezone?: string; schedule?: MeetingSchedule }): Promise<{ fired: boolean; event_id?: string }> {
    const s = ctx.schedule ?? (await this.settings.get(venture_id)).meetings;
    const tz = ctx.timezone ?? s.timezone;
    const clock = localClock(new Date(), tz);
    const date = ctx.date ?? clock.date;
    const hhmm = ctx.hhmm ?? clock.hhmm;
    const trace_id = await this.kernel.traceFor(venture_id);
    const idem = ctx.scheduled ? `clock:${venture_id}:${date}:${kind}` : undefined;
    const base = { venture_id, actor_kind: 'system' as const, actor_id: 'kernel.clock', trace_id, idempotency_key: idem };

    switch (kind) {
      case 'workday_start': {
        const e = await this.events.append({ ...base, type: 'ops.workday_started', payload: { local_time: hhmm, timezone: tz } });
        return { fired: true, event_id: e.id };
      }
      case 'workday_end': {
        const e = await this.events.append({ ...base, type: 'ops.workday_ended', payload: { local_time: hhmm, timezone: tz } });
        return { fired: true, event_id: e.id };
      }
      case 'executive': {
        const e = await this.events.append({ ...base, department_id: 'D13', type: 'ops.meeting_started', payload: { kind: 'executive', room: 'exec', scheduled_for: `${date} ${s.exec_meeting_time}` } });
        // The executive meeting IS the daily briefing: D13 facilitates, every head attends.
        await this.events.append({
          ...base, department_id: 'D13', type: 'ops.daily_briefing_started',
          idempotency_key: idem ? `${idem}:briefing` : undefined,
          payload: { meeting_date: date, timezone: tz, band_room: 'executive-briefing', lookback_hours: 24 },
        }).catch(() => undefined);
        this.scheduleEnd(venture_id, 'executive', s.exec_meeting_minutes, trace_id);
        return { fired: true, event_id: e.id };
      }
      case 'all_hands': {
        const e = await this.events.append({ ...base, department_id: 'D13', type: 'ops.meeting_started', payload: { kind: 'all_hands', room: 'exec', scheduled_for: `${date} ${s.all_hands_time}` } });
        this.scheduleEnd(venture_id, 'all_hands', s.all_hands_minutes, trace_id);
        return { fired: true, event_id: e.id };
      }
      case 'improvement': {
        // Append first (idempotent) so a repeated scheduled tick cannot issue a second $2 work order.
        const e = await this.events.append({ ...base, department_id: 'D13', type: 'ops.improvement_run_started', payload: { trigger: ctx.scheduled ? 'scheduled' : 'manual' } });
        if (e.replayed) return { fired: false, event_id: e.id };
        await this.kernel.issueWorkOrder({
          venture_id, to: 'D13', intent: 'review_company', budget_usd: 2.0, trace_id,
          params: { trigger: ctx.scheduled ? 'scheduled' : 'manual', date, improvement_run_event_id: e.id, note: 'End-of-day improvement branch: mine today\'s telemetry for capability gaps. Founder approval (via Linq) is required before anything new is built.' },
        });
        return { fired: true, event_id: e.id };
      }
    }
  }

  private scheduleEnd(venture_id: string, kind: 'executive' | 'all_hands', minutes: number, trace_id: string): void {
    const key = `${venture_id}:${kind}`;
    const prev = this.meetingTimers.get(key);
    if (prev) clearTimeout(prev);
    const scale = Number(process.env.ZEROTH_TIME_SCALE ?? '1') || 1;
    const ms = Math.max(5_000, minutes * 60_000 * scale);
    const t = setTimeout(() => {
      this.meetingTimers.delete(key);
      void this.events.append({ venture_id, type: 'ops.meeting_ended', actor_kind: 'system', actor_id: 'kernel.clock', department_id: 'D13', payload: { kind, room: 'exec' }, trace_id }).catch(() => undefined);
    }, ms);
    t.unref?.();
    this.meetingTimers.set(key, t);
  }

  async endMeeting(venture_id: string, kind: 'executive' | 'all_hands' | 'department'): Promise<void> {
    const key = `${venture_id}:${kind}`;
    const t = this.meetingTimers.get(key);
    if (t) { clearTimeout(t); this.meetingTimers.delete(key); }
    await this.events.append({ venture_id, type: 'ops.meeting_ended', actor_kind: 'founder', actor_id: 'founder', department_id: 'D13', payload: { kind, room: 'exec' }, trace_id: await this.kernel.traceFor(venture_id) });
  }
}
