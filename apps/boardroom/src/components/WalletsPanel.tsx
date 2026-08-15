import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Empty, Panel } from './Panel';

/** Every department has a wallet (its budget envelope). Stripe funds the pool; per-agent spend is metered. */
export function WalletsPanel({ onClose }: { onClose: () => void }) {
  const { ventureId, events, toast } = useStore();
  const [w, setW] = useState<any | null>(null);
  const [amount, setAmount] = useState(25);
  const [busy, setBusy] = useState(false);
  const tick = useMemo(() => events.filter((e) => e.type.startsWith('money.')).length, [events]);
  useEffect(() => { if (ventureId) api.wallets(ventureId).then(setW).catch(() => undefined); }, [ventureId, tick]);
  const topup = async () => {
    if (!ventureId) return; setBusy(true);
    try { const r = await api.topup(ventureId, amount); if (r.driver === 'stripe') { window.open(r.url, '_blank'); toast('Stripe Checkout opened in a new tab (test mode)', 'money'); } else { toast(`Funded $${amount} (mock — no Stripe key)`, 'money'); const nw = await api.wallets(ventureId); setW(nw); } }
    catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  if (!w) return <Panel title="Wallets" onClose={onClose}><Empty>Loading…</Empty></Panel>;
  const total = w.wallets.reduce((s: number, x: any) => s + x.envelope_usd, 0);
  const spent = w.wallets.reduce((s: number, x: any) => s + x.spent_usd, 0);
  return (
    <Panel title="Agent wallets" size="wide" onClose={onClose} sub={<span>${spent.toFixed(2)} spent of ${total.toFixed(2)} across 13 departments · cap ${w.spend_cap_usd} · Terac cap ${w.terac_cap_usd}</span>}
      foot={<><input className="input" type="number" min={1} max={10000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ width: 110 }} /><button className="btn primary" onClick={topup} disabled={busy}>Fund ${amount} via Stripe</button><span className={`chip ${w.stripe.configured ? (w.stripe.test_mode ? 'ok' : 'warn') : ''}`}>{w.stripe.configured ? (w.stripe.test_mode ? 'Stripe test key ready · Checkout opens in test mode' : 'Stripe live key detected · real Checkout will open') : 'Stripe not configured · mock top-up only'}</span></>}>
      <div className="card small"><b>How money moves.</b> The founder funds the company (spend cap + Stripe top-ups); Treasury splits it into a wallet per department; every token, tool call and human hire is metered against that wallet. At 80% a department downgrades to cheaper models; at 100% it freezes and asks Treasury. Revenue from Stripe re-enters the pool. <span className="muted">Per-agent physical cards: {w.stripe.issuing.ask}</span></div>
      {w.wallets.map((x: any) => {
        const used = x.envelope_usd > 0 ? Math.min(1, (x.spent_usd + x.reserved_usd) / x.envelope_usd) : 0;
        return (
          <div key={x.department_id} className="wallet">
            <div><b className="small">{x.department_id} {x.name}</b> <span className={`chip ${x.state === 'frozen' ? 'err' : x.state === 'degraded' ? 'warn' : ''}`}>{x.state}</span></div>
            <div className="bal">${x.available_usd.toFixed(2)}</div>
            <div className="progress"><i style={{ width: `${used * 100}%`, background: used > 0.99 ? 'var(--err)' : used > 0.8 ? 'var(--warn)' : 'var(--filament)' }} /></div>
            <div className="small muted" style={{ gridColumn: '1 / -1' }}>spent ${x.spent_usd.toFixed(3)} · reserved ${x.reserved_usd.toFixed(3)} · envelope ${x.envelope_usd.toFixed(2)} · hard cap ${x.hard_cap_usd.toFixed(2)}{x.agents.length ? ` · agents: ${x.agents.map((a: any) => `${a.agent_id.split('.').pop()} $${a.spent_usd.toFixed(3)}`).join(', ')}` : ''}</div>
          </div>
        );
      })}
    </Panel>
  );
}
