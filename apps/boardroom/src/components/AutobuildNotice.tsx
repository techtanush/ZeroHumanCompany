import { useEffect, useState } from 'react';
import { api, type VentureSettings } from '../api';
import { useStore } from '../store';

/**
 * Pinned to the right side of the HQ, this is the one place the founder learns
 * "your idea is now a real running product." D07's auto-build pipeline (idea →
 * OpenAI-generated code → pushed to a new GitHub repo → served on localhost)
 * writes its progress into venture settings at every stage; this just renders
 * whatever is there. It stays up once a build starts — through generating,
 * pushing, serving, and the final ready/failed state — until the founder
 * dismisses it, and a fresh build (new `updated_at`) un-dismisses it again.
 */
export function AutobuildNotice() {
  const { ventureId, settings } = useStore();
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState<VentureSettings['autobuild'] | null>(null);

  // Settings already arrive live via SSE → venture.settings_updated → refreshSettings(),
  // but fetch once on mount too so a page refresh mid-build doesn't lose the card.
  useEffect(() => {
    if (!ventureId) return;
    api.autobuild(ventureId).then((r) => setHydrated(r.autobuild as VentureSettings['autobuild'])).catch(() => undefined);
  }, [ventureId]);

  const build = settings?.autobuild ?? hydrated;
  if (!build || build.status === 'idle') return null;
  if (dismissedAt && dismissedAt === build.updated_at) return null;

  const busy = build.status === 'generating' || build.status === 'pushing' || build.status === 'serving';
  const title =
    build.status === 'generating' ? 'Building your product…'
    : build.status === 'pushing' ? 'Pushing code to GitHub…'
    : build.status === 'serving' ? 'Starting the preview…'
    : build.status === 'ready' ? 'Your product is ready'
    : 'Auto-build hit a snag';

  return (
    <div className="autobuild-notice" style={{ position: 'fixed', top: 90, right: 16, width: 320, zIndex: 40 }}>
      <div className="card" style={{ background: 'var(--panel, #12151c)', border: '1px solid var(--border, #2a2f3a)', boxShadow: '0 8px 24px rgba(0,0,0,.35)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {busy ? <span className="chip">working…</span> : <span className={`chip ${build.status === 'ready' ? 'ok' : 'err'}`}>{build.status}</span>}
            <b className="small">{title}</b>
          </div>
          <button className="btn sm ghost" onClick={() => setDismissedAt(build.updated_at ?? 'x')} title="Dismiss">×</button>
        </div>
        {build.idea_summary && <div className="small muted mt">{build.idea_summary}</div>}
        <div className="col mt" style={{ gap: 6 }}>
          {build.local_url && (
            <a className="btn sm" href={build.local_url} target="_blank" rel="noreferrer noopener">
              Open locally → <span className="mono">{build.local_url}</span>
            </a>
          )}
          {build.repo_url && (
            <a className="btn sm" href={build.repo_url} target="_blank" rel="noreferrer noopener">
              View code → GitHub {build.repo_owner === 'company' ? '(company repo — connect your own GitHub in Setup to change this)' : ''}
            </a>
          )}
          {build.used_env?.length > 0 && (
            <div className="tiny muted">Backend uses your real keys: {build.used_env.join(', ')} (test/sandbox where applicable).</div>
          )}
          {build.error && <div className="tiny" style={{ color: 'var(--err)' }}>{build.error}</div>}
        </div>
      </div>
    </div>
  );
}
