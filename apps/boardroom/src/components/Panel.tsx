import type { ReactNode } from 'react';

export function Panel({ title, sub, onClose, children, foot, size, tabs }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; size?: 'wide' | 'xwide'; tabs?: ReactNode }) {
  return (
    <div className={`panel ${size ?? ''}`}>
      <div className="panel-head">
        <div className="grow">
          <div className="title">{title}</div>
          {sub && <div className="muted small" style={{ marginTop: 3 }}>{sub}</div>}
        </div>
        <button className="close" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      {tabs}
      <div className="panel-body">{children}</div>
      {foot && <div className="panel-foot">{foot}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted small center" style={{ padding: '18px 8px' }}>{children}</div>;
}
