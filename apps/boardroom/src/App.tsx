import { useEffect, useState } from 'react';
import { useStore } from './store';
import { Onboarding } from './components/Onboarding';
import { Hq } from './hq/HqCanvas';
import { Landing, savedAccount } from './components/Landing';

/**
 * Two worlds: onboarding (no venture yet, or the founder re-opens it) and the
 * HQ (a live venture). The venture id persists in localStorage.
 */
export function App() {
  const { ventureId, kernelOk, toasts } = useStore();
  const [forceOnboarding, setForceOnboarding] = useState(false);
  const [showLanding, setShowLanding] = useState(() => !ventureId && !savedAccount());
  const [profile, setProfile] = useState<{ display_name?: string; email?: string } | undefined>(() => savedAccount() ?? undefined);
  useEffect(() => { const q = new URLSearchParams(location.search); if (q.get('onboarding') === '1') setForceOnboarding(true); }, []);

  return (
    <>
      {showLanding
        ? <Landing onStart={(p) => { setProfile(p); setShowLanding(false); }} />
        : ventureId && !forceOnboarding
          ? <Hq onReonboard={() => setForceOnboarding(true)} />
          : <Onboarding initialProfile={profile} onDone={() => { setForceOnboarding(false); setShowLanding(false); history.replaceState(null, '', location.pathname); }} />}
      {kernelOk === false && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50, background: 'var(--err)', color: '#fff', padding: '6px 14px', fontSize: 13, textAlign: 'center' }}>
          Kernel unreachable at <span className="kbd">/v1</span>. Start it with <span className="kbd">pnpm dev:kernel</span> (port 4000) — the Boardroom keeps retrying.
        </div>
      )}
      <div className="toast-stack">
        {toasts.map((t) => (<div key={t.id} className="toast"><span className="type">{t.type}</span>{t.msg}</div>))}
      </div>
    </>
  );
}
