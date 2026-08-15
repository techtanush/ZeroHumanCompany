import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Panel } from './Panel';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TZS = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];

/** When the company works and meets. Also the manual triggers ("start now"). */
export function MeetingsPanel({ onClose }: { onClose: () => void }) {
  const { ventureId, settings, refreshSettings, meeting, workday, toast } = useStore();
  const [m, setM] = useState<any>(settings?.meetings ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (settings) setM(settings.meetings); }, [settings]);
  if (!m) return <Panel title="Company clock" onClose={onClose}>…</Panel>;
  const save = async () => { if (!ventureId) return; setBusy(true); try { await api.updateSettings(ventureId, { meetings: m }); await refreshSettings(); toast('Schedule saved', 'ok'); } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); } };
  const fire = async (kind: string) => { if (!ventureId) return; try { await api.startMeeting(ventureId, kind); toast(`${kind.replace('_', ' ')} started`, 'meeting'); } catch (e: any) { toast(e.message, 'error'); } };
  const T = ({ k, label }: { k: string; label: string }) => (<label className="field"><span className="spec muted">{label}</span><input className="input" type="time" value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} /></label>);
  return (
    <Panel title="Company clock" size="wide" onClose={onClose} sub={<span>{workday === 'night' ? 'After hours' : workday === 'day' ? 'Workday' : 'Waiting for the first tick'} · {meeting ? `${meeting} meeting running` : 'no meeting running'}</span>}
      foot={<><button className="btn primary" onClick={save} disabled={busy}>Save schedule</button><span className="muted small">Times are in {m.timezone}. The kernel checks every minute.</span></>}>
      <div className="card small">
        <b>How a day works.</b> At <b>{m.exec_meeting_time}</b> the department heads meet the CEO in the boardroom (the daily briefing: goals, blockers, asks). At <b>{m.all_hands_time}</b> the leads address the whole company — every agent leaves their room and gathers in the exec room; if you enter then, that's where everyone is. Agents work <b>{m.work_start}–{m.work_end}</b>. At <b>{m.improvement_time}</b> the improvement branch reviews the day and, if it finds something worth building, texts you for approval.
      </div>
      <div className="grid2">
        <label className="field"><span className="spec muted">Timezone</span><select className="select" value={m.timezone} onChange={(e) => setM({ ...m, timezone: e.target.value })}>{[m.timezone, ...TZS.filter((t) => t !== m.timezone)].map((t) => <option key={t}>{t}</option>)}</select></label>
        <div className="field"><span className="spec muted">Days</span><div className="row wrap" style={{ gap: 6 }}>{DAYS.map((d) => <button key={d} className={`btn sm ${m.days.includes(d) ? 'primary' : ''}`} onClick={() => setM({ ...m, days: m.days.includes(d) ? m.days.filter((x: string) => x !== d) : [...m.days, d] })}>{d}</button>)}</div></div>
        <T k="work_start" label="Workday starts" /><T k="work_end" label="Workday ends" />
        <T k="exec_meeting_time" label="Executive meeting (heads + CEO)" /><label className="field"><span className="spec muted">Exec meeting length (min)</span><input className="input" type="number" min={5} max={180} value={m.exec_meeting_minutes} onChange={(e) => setM({ ...m, exec_meeting_minutes: Number(e.target.value) })} /></label>
        <T k="all_hands_time" label="All-hands (whole company)" /><label className="field"><span className="spec muted">All-hands length (min)</span><input className="input" type="number" min={5} max={120} value={m.all_hands_minutes} onChange={(e) => setM({ ...m, all_hands_minutes: Number(e.target.value) })} /></label>
        <T k="improvement_time" label="Improvement branch runs" />
      </div>
      <div className="spec muted">Run now</div>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn" onClick={() => fire('executive')}>▶ Executive briefing</button>
        <button className="btn" onClick={() => fire('all_hands')}>▶ All-hands</button>
        <button className="btn" onClick={() => fire('improvement')}>▶ Improvement branch</button>
        <button className="btn ghost" onClick={() => fire('workday_start')}>Open the office</button>
        <button className="btn ghost" onClick={() => fire('workday_end')}>Close for the day</button>
        {meeting && <button className="btn danger" onClick={() => ventureId && api.endMeeting(ventureId, meeting)}>End {meeting}</button>}
      </div>
    </Panel>
  );
}
