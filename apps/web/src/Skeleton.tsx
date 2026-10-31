import type { CSSProperties } from 'react';
import './skeleton.css';

/** A placeholder block. Decorative: pair it with a labelled status region. */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = 6,
  className = '',
}: {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  radius?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius: radius }}
    />
  );
}

/** Announces loading once for assistive technology while the skeleton is shown. */
function Busy({ label }: { label: string }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}

/** Generic page placeholder: heading, description and content rows. */
export function PageSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="page-skeleton" aria-busy="true">
      {label && <Busy label={label} />}
      <Skeleton width="min(380px, 70%)" height={36} radius={8} />
      <Skeleton width="min(520px, 90%)" className="skeleton-gap" />
      <div className="skeleton-rows">
        {Array.from({ length: rows }, (_, index) => (
          <div className="skeleton-row" key={index}>
            <Skeleton width={36} height={36} radius={8} />
            <div>
              <Skeleton width={`${60 - index * 7}%`} />
              <Skeleton width={`${35 + index * 5}%`} height={11} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** List rows used inside panels (sessions, vaults). */
export function RowsSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="skeleton-rows" aria-busy="true">
      <Busy label={label} />
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <Skeleton width={24} height={24} radius={6} />
          <div>
            <Skeleton width={`${55 - index * 10}%`} />
            <Skeleton width={`${30 + index * 8}%`} height={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Whole workspace shell while the signed-in account is being checked. */
export function ShellSkeleton() {
  return (
    <div className="dashboard shell-skeleton" aria-busy="true">
      <Busy label="Opening your workspace…" />
      <aside className="app-sidebar">
        <Skeleton width={130} height={30} radius={8} className="skeleton-brand" />
        {[3, 3].map((count, group) => (
          <div className="skeleton-nav" key={group}>
            <Skeleton width={70} height={10} />
            {Array.from({ length: count }, (_, index) => (
              <Skeleton key={index} height={34} radius={7} />
            ))}
          </div>
        ))}
      </aside>
      <main className="dashboard-main">
        <header className="dashboard-top">
          <Skeleton width={160} />
          <Skeleton width={34} height={34} radius={17} className="skeleton-push" />
          <Skeleton width={90} height={34} radius={8} />
        </header>
        <div className="dashboard-content">
          <PageSkeleton label="" rows={3} />
        </div>
      </main>
    </div>
  );
}
