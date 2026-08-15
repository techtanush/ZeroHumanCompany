import { useMemo, useState } from 'react';
import { fmtTime, useStore } from '../store';
import { Empty, Panel } from './Panel';

const GROUPS: Record<string, string> = { all: 'All', dept: 'Departments', agent: 'Agents', gate: 'Gates', money: 'Money', build: 'Build', ops: 'Meetings & ops', human: 'Humans', artifact: 'Artifacts' };

export function TimelinePanel({ onClose }: { onClose: () => void }) {
  const { events, sse, ventureId } = useStore();
  const [group, setGroup] = useState('all');
  const list = useMemo(() => (group === 'all' ? events : events.filter((e) => e.type.startsWith(group + '.'))).slice(-250).reverse(), [events, group]);
  return (
    <Panel title="Live" sub={<span><span className={`dot ${sse === 'live' ? 'live' : 'off'}`} /> {sse} · {events.length} events · <span className="mono">{ventureId?.slice(0, 8)}</span></span>} onClose={onClose}
      tabs={<div className="tabs" style={{ flexWrap: 'wrap' }}>{Object.entries(GROUPS).map(([k, v]) => <button key={k} className={group === k ? 'active' : ''} onClick={() => setGroup(k)}>{v}</button>)}</div>}>
      {list.length === 0 && <Empty>Waiting for events…</Empty>}
      {list.map((e) => (
        <div key={e.seq} className="event-row">
          <div className="t">{fmtTime(e.ts)}<br /><span style={{ opacity: .6 }}>#{e.seq}</span></div>
          <div>
            <span className="type">{e.type}</span> <span className="who">{e.department_id ?? ''} {e.actor_id}</span>
            <div className="small">{summarize(e.type, e.payload)}</div>
          </div>
        </div>
      ))}
    </Panel>
  );
}

export function summarize(type: string, p: any): string {
  if (!p) return '';
  switch (type) {
    case 'dept.work_order_issued': return `${p.intent} → ${p.to_dept} ($${p.budget_usd})`;
    case 'dept.work_completed': return `done${p.artifact ? ` · ${p.artifact.type}` : ''}`;
    case 'dept.work_failed': return `failed: ${p.error}`;
    case 'dept.chat_posted': return `${p.author}: ${p.text}`;
    case 'agent.tool_used': return `${p.agent_id ?? ''} used ${p.tool_name}${p.driver ? ` (${p.driver})` : ''}`;
    case 'artifact.signed': case 'artifact.created': case 'artifact.contested': return `${p.artifact?.type} v${p.artifact?.version}${p.defects ? ` — ${p.defects.join('; ')}` : ''}`;
    case 'gate.opened': return `${p.gate_type}${p.amount_usd ? ` $${p.amount_usd}` : ''}`;
    case 'gate.approved': return `${p.option_id} by ${p.decided_by}`;
    case 'money.metered': return `${p.department_id} ${p.resource} $${Number(p.cost_usd).toFixed(4)}`;
    case 'money.revenue_received': case 'money.wallet_funded': return `$${p.amount_usd} via ${p.rail}`;
    case 'venture.milestone_reached': return p.milestone;
    case 'ops.meeting_started': case 'ops.meeting_ended': return `${p.kind} in ${p.room}`;
    case 'ops.workday_started': case 'ops.workday_ended': return `${p.local_time} ${p.timezone}`;
    case 'human.notified': return `${p.channel ?? p.vendor ?? ''} ${p.kind ?? ''} ${p.delivered === false ? `(degraded: ${p.degraded})` : ''}`;
    case 'dept.question_answered': return `Q: ${p.question}`;
    case 'build.deployed': return p.url;
    case 'cos.gap_detected': return `${p.taxonomy}: ${p.summary}`;
    default: { const keys = Object.keys(p).filter((k) => !['actor_id', 'department_id', 'ts'].includes(k)).slice(0, 3); return keys.map((k) => `${k}=${JSON.stringify(p[k]).slice(0, 50)}`).join(' '); }
  }
}
