import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, kernelBase, kernelToken, VENTURE_KEY, type Gate, type KernelEvent, type VentureSettings } from './api';

/**
 * One store for the whole Boardroom: the active venture, its live event stream
 * (SSE with replay), pending gates, settings, meeting state, and toasts.
 */

export type MeetingKind = 'executive' | 'all_hands' | 'department' | null;

interface Store {
  ventureId: string | null;
  setVentureId(id: string | null): void;
  venture: any | null;
  events: KernelEvent[];
  sse: 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';
  gates: Gate[];
  settings: VentureSettings | null;
  meeting: MeetingKind;
  workday: 'day' | 'night' | 'unknown';
  refreshGates(): Promise<void>;
  refreshSettings(): Promise<void>;
  refreshVenture(): Promise<void>;
  toast(msg: string, type?: string): void;
  toasts: Array<{ id: number; msg: string; type: string }>;
  kernelOk: boolean | null;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ventureId, setVentureIdState] = useState<string | null>(() => localStorage.getItem(VENTURE_KEY));
  const [venture, setVenture] = useState<any | null>(null);
  const [events, setEvents] = useState<KernelEvent[]>([]);
  const [sse, setSse] = useState<Store['sse']>('idle');
  const [gates, setGates] = useState<Gate[]>([]);
  const [settings, setSettings] = useState<VentureSettings | null>(null);
  const [meeting, setMeeting] = useState<MeetingKind>(null);
  const [workday, setWorkday] = useState<Store['workday']>('unknown');
  const [toasts, setToasts] = useState<Store['toasts']>([]);
  const [kernelOk, setKernelOk] = useState<boolean | null>(null);
  const seqRef = useRef(0);
  const toastId = useRef(1);

  const setVentureId = useCallback((id: string | null) => {
    if (id) localStorage.setItem(VENTURE_KEY, id); else localStorage.removeItem(VENTURE_KEY);
    setEvents([]); seqRef.current = 0; setGates([]); setSettings(null); setVenture(null); setMeeting(null);
    setVentureIdState(id);
  }, []);

  const toast = useCallback((msg: string, type = 'info') => {
    const id = toastId.current++;
    setToasts((t) => [...t.slice(-4), { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const refreshGates = useCallback(async () => {
    if (!ventureId) return;
    try { const r = await api.gates(ventureId); setGates(r.gates); } catch { /* keep last */ }
  }, [ventureId]);
  const refreshSettings = useCallback(async () => {
    if (!ventureId) return;
    try { const r = await api.settings(ventureId); setSettings(r.settings); } catch { /* keep last */ }
  }, [ventureId]);
  const refreshVenture = useCallback(async () => {
    if (!ventureId) return;
    try { setVenture(await api.venture(ventureId)); } catch (e: any) { if (e?.status === 404) setVentureId(null); }
  }, [ventureId, setVentureId]);

  useEffect(() => { api.health().then(() => setKernelOk(true)).catch(() => setKernelOk(false)); const t = setInterval(() => api.health().then(() => setKernelOk(true)).catch(() => setKernelOk(false)), 15000); return () => clearInterval(t); }, []);

  useEffect(() => { void refreshGates(); void refreshSettings(); void refreshVenture(); }, [refreshGates, refreshSettings, refreshVenture]);

  // SSE: replay from seq 0, then live. EventSource can't set headers, so the token rides as a query param
  // through the dev proxy — for the hackathon the kernel runs on the founder's own machine.
  useEffect(() => {
    if (!ventureId) { setSse('idle'); return; }
    let es: EventSource | null = null;
    let closed = false;
    let backoff = 1000;
    const open = () => {
      if (closed) return;
      setSse((s) => (s === 'live' ? 'reconnecting' : 'connecting'));
      // fetch-based SSE so we can send the Authorization header
      const ac = new AbortController();
      (async () => {
        try {
          const res = await fetch(`${kernelBase()}/v1/ventures/${ventureId}/stream?after_seq=${seqRef.current}`, { headers: { authorization: `Bearer ${kernelToken()}`, accept: 'text/event-stream' }, signal: ac.signal });
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          setSse('live'); backoff = 1000;
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          while (!closed) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
              const lines = chunk.split('\n');
              const ev = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
              const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
              if (ev !== 'event' || !data) continue;
              try {
                const j = JSON.parse(data);
                const e: KernelEvent = { seq: j.seq, ts: j.payload?.ts ?? new Date().toISOString(), type: j.type, actor_id: j.payload?.actor_id ?? '', department_id: j.payload?.department_id ?? null, payload: j.payload ?? {}, trace_id: j.trace_id };
                if (e.seq > seqRef.current) seqRef.current = e.seq;
                setEvents((prev) => (prev.length && prev[prev.length - 1].seq >= e.seq ? prev : [...prev.slice(-1500), e]));
              } catch { /* skip malformed */ }
            }
          }
          throw new Error('stream ended');
        } catch (e) {
          if (closed) return;
          setSse('reconnecting');
          setTimeout(open, backoff);
          backoff = Math.min(backoff * 2, 15000);
        }
      })();
      es = { close: () => ac.abort() } as unknown as EventSource;
    };
    open();
    return () => { closed = true; es?.close(); };
  }, [ventureId]);

  // Derive gates/settings/meeting/toasts from the stream.
  const lastHandled = useRef(0);
  useEffect(() => {
    const fresh = events.filter((e) => e.seq > lastHandled.current);
    if (!fresh.length) return;
    lastHandled.current = events[events.length - 1].seq;
    let touchGates = false, touchSettings = false, touchVenture = false;
    for (const e of fresh) {
      if (e.type.startsWith('gate.')) touchGates = true;
      if (e.type === 'venture.settings_updated') touchSettings = true;
      if (e.type === 'venture.milestone_reached' || e.type.startsWith('money.') || e.type.startsWith('system.kill')) touchVenture = true;
      if (e.type === 'ops.meeting_started') setMeeting((e.payload?.kind as MeetingKind) ?? 'executive');
      if (e.type === 'ops.meeting_ended') setMeeting(null);
      if (e.type === 'ops.workday_started') setWorkday('day');
      if (e.type === 'ops.workday_ended') setWorkday('night');
      const isReplay = Date.now() - new Date(e.ts).getTime() > 20_000;
      if (!isReplay) {
        if (e.type === 'gate.opened') toast(`Decision needed: ${e.payload?.gate_type}${e.payload?.amount_usd ? ` · $${e.payload.amount_usd}` : ''}`, 'gate');
        else if (e.type === 'venture.milestone_reached') toast(`Milestone: ${e.payload?.milestone}`, 'milestone');
        else if (e.type === 'artifact.signed') toast(`${e.department_id} signed ${e.payload?.artifact?.type}`, 'artifact');
        else if (e.type === 'money.revenue_received') toast(`Revenue: $${e.payload?.amount_usd} via ${e.payload?.rail}`, 'money');
        else if (e.type === 'ops.meeting_started') toast(`${e.payload?.kind === 'all_hands' ? 'All-hands' : 'Executive meeting'} started — everyone to the boardroom`, 'meeting');
        else if (e.type === 'ops.improvement_run_started') toast('Improvement branch is reviewing today\'s work', 'meeting');
        else if (e.type === 'build.deployed') toast(`Deployed: ${e.payload?.url}`, 'build');
      }
    }
    if (touchGates) void refreshGates();
    if (touchSettings) void refreshSettings();
    if (touchVenture) void refreshVenture();
  }, [events, refreshGates, refreshSettings, refreshVenture, toast]);

  const value = useMemo<Store>(() => ({ ventureId, setVentureId, venture, events, sse, gates, settings, meeting, workday, refreshGates, refreshSettings, refreshVenture, toast, toasts, kernelOk }),
    [ventureId, setVentureId, venture, events, sse, gates, settings, meeting, workday, refreshGates, refreshSettings, refreshVenture, toast, toasts, kernelOk]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

export function fmtTime(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function ago(ts: string | null | undefined): string {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
