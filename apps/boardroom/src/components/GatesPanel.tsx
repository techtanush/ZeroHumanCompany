import { useState } from 'react';
import { api, type Gate } from '../api';
import { ago, useStore } from '../store';
import { Empty, Panel } from './Panel';

/** Decisions waiting on the founder. Linq-channel gates were also texted to their phone. */
export function GatesPanel({ onClose }: { onClose: () => void }) {
  const { gates, refreshGates, toast } = useStore();
  const [showAll, setShowAll] = useState(false);
  const pending = gates.filter((g) => g.status === 'pending');
  const list = showAll ? gates : pending;
  return (
    <Panel title="Decisions" sub={`${pending.length} waiting · money, outreach, deploys and new capabilities never run without you`} onClose={onClose}
      foot={<><button className="btn sm" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Pending only' : `History (${gates.length})`}</button><button className="btn sm" onClick={() => refreshGates()}>Refresh</button></>}>
      {list.length === 0 && <Empty>Nothing waiting on you. Gates open here (and on your phone via Linq) when an agent wants to spend money, contact a real person, deploy, create an account, clone a voice, or build something new.</Empty>}
      {list.map((g) => <GateCard key={g.id} g={g} onDone={() => { void refreshGates(); }} toast={toast} />)}
    </Panel>
  );
}

const GATE_HELP: Record<string, string> = {
  money_out: 'Real money would leave the company.', outbound_to_real_person: 'A real human would be contacted (email, text, or a call in your voice).', public_content: 'Something would be published publicly.',
  account_creation: 'Solari (browser hands) wants to create an account or passed a wall it cannot cross alone (2FA / CAPTCHA / ToS / payment).', pivot_approval: 'The company wants to change the idea based on evidence.',
  deploy: 'Code would ship to production.', refund: 'A refund would be issued.', new_department: 'The improvement branch wants to build a new capability. Nothing is built until you approve.',
  niche_selection: 'Pick the niche to validate.', voice_clone_consent: 'Your voice would be cloned.',
};

function GateCard({ g, onDone, toast }: { g: Gate; onDone: () => void; toast: (m: string, t?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const decide = async (decision: 'approve' | 'reject' | 'redirect', option_id: string) => {
    setBusy(true);
    try { await api.decide(g.id, { option_id, decided_by: 'founder', decision, note }); toast(`${decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'Redirected'}: ${g.gate_type}`, 'gate'); onDone(); }
    catch (e: any) { toast(`Gate: ${e.message}`, 'error'); }
    finally { setBusy(false); }
  };
  const preview = g.preview ?? {};
  const isPending = g.status === 'pending';
  const secondsLeft = Math.max(0, Math.round((new Date(g.expires_at).getTime() - Date.now()) / 1000));
  return (
    <div className={`card gate ${g.channel === 'linq' ? 'linq' : ''}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="row wrap" style={{ gap: 6 }}>
            <b>{g.gate_type.replace(/_/g, ' ')}</b>
            <span className="chip">{g.department_id}</span>
            {g.channel === 'linq' && <span className="chip info">📱 sent to your phone via Linq</span>}
            {g.channel === 'auto' && <span className="chip">auto</span>}
            <span className={`chip ${g.status === 'pending' ? 'warn' : g.status.includes('approved') ? 'ok' : ''}`}>{g.status}</span>
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>{GATE_HELP[g.gate_type] ?? ''}</div>
        </div>
        {g.amount_usd != null && <div className="amount">${Number(g.amount_usd).toFixed(2)}</div>}
      </div>
      <div className="small" style={{ marginTop: 8 }}>
        <div><b>{String(preview.title ?? preview.summary ?? `${g.requested_by} wants to run ${g.action.tool}`)}</b></div>
        {preview.summary && preview.title && <div className="muted">{String(preview.summary)}</div>}
        <div className="mono muted" style={{ marginTop: 4 }}>{g.action.tool}({Object.entries(g.action.args ?? {}).slice(0, 4).map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 40)}`).join(', ')})</div>
      </div>
      <div className="row wrap small" style={{ gap: 10, marginTop: 8 }}>
        <span className={`risk-${g.risk}`}>risk {g.risk}</span><span>{g.reversible ? '↺ reversible' : '⚠ irreversible'}</span>
        <span className="muted">by {g.requested_by}</span><span className="muted">opened {ago(g.opened_at)}</span>
        {isPending && <span className="muted">⏱ {secondsLeft > 3600 ? `${Math.round(secondsLeft / 3600)}h` : `${Math.round(secondsLeft / 60)}m`} left → {g.on_timeout.replace(/_/g, ' ')}</span>}
      </div>
      {isPending ? (
        <>
          <div className="col" style={{ gap: 6, marginTop: 10 }}>
            {g.options.map((o) => (
              <div key={o.id} className="row small" style={{ gap: 8 }}>
                <button className={`btn sm ${o.id === g.suggested_option_id ? 'primary' : ''}`} disabled={busy} onClick={() => decide(o.id === 'reject' ? 'reject' : 'approve', o.id)}>{o.label}</button>
                <span className="muted">{o.consequence}</span>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input className="input" style={{ padding: '6px 8px' }} placeholder="Note or redirect instruction (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn sm" disabled={busy || !note.trim()} onClick={() => decide('redirect', g.options[0]?.id ?? 'redirect')}>Redirect</button>
            <button className="btn sm danger" disabled={busy} onClick={() => decide('reject', g.options.find((o) => o.id === 'reject')?.id ?? g.options[0]?.id ?? 'reject')}>Reject</button>
          </div>
        </>
      ) : (
        <div className="small muted" style={{ marginTop: 6 }}>{g.decided_by ? `${g.decided_by} → ${g.decided_option_id}` : ''}{g.decision_note ? ` · "${g.decision_note}"` : ''}</div>
      )}
    </div>
  );
}
