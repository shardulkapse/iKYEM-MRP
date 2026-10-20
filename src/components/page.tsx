import { Suspense } from "react";
import { SkeletonLines } from "./skeletons";

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="top">
      <div><h1>{title}</h1>{sub ? <p>{sub}</p> : null}</div>
      {actions ? <div style={{ display: "flex", gap: 8 }}>{actions}</div> : null}
    </div>
  );
}

// With Cache Components on, anything that reads the session or the database renders inside
// a Suspense boundary. The header above stays in the instant static shell, and the fallback
// is a skeleton shaped like what's coming.
export function Streamed({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  return <Suspense fallback={fallback ?? <SkeletonLines />}>{children}</Suspense>;
}

export function ComingNext({ what }: { what: string }) {
  return (
    <section className="panel">
      <h2>Coming next</h2>
      <p className="muted" style={{ margin: 0 }}>{what}</p>
    </section>
  );
}
