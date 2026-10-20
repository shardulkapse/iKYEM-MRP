import Link from "next/link";
import { PageHeader, Streamed } from "@/components/page";
import { SkeletonStrip, SkeletonTable } from "@/components/skeletons";
import { ReadyStockTable, WipTable } from "@/components/stock-tables";
import { requireRole } from "@/lib/auth";
import { formatLong, todayInFactory } from "@/lib/dates";
import { finishedOn, readyStockByTypeAndGrade, wipByTypeAndBuffer } from "@/lib/queries";

export default function HomePage() {
  return (
    <>
      <PageHeader title="Home" actions={<Link className="btn primary" href="/today">Fill in today</Link>} />
      <Streamed fallback={<SkeletonStrip />}><Scoreboard /></Streamed>
      <div style={{ display: "grid", gap: 18 }}>
        <section className="panel"><h2>Ready stock <small>graded and waiting for orders</small></h2><Streamed fallback={<SkeletonTable rows={4} cols={5} />}><Guarded><ReadyStockTable /></Guarded></Streamed></section>
        <section className="panel"><h2>Balls in production</h2><Streamed fallback={<SkeletonTable rows={4} cols={6} />}><Guarded><WipTable /></Guarded></Streamed></section>
      </div>
    </>
  );
}

async function Scoreboard() {
  await requireRole();
  const today = await todayInFactory();
  const [ready, wip, finished] = await Promise.all([readyStockByTypeAndGrade(), wipByTypeAndBuffer(), finishedOn(today)]);
  const sumPos = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + Math.max(0, b), 0);
  return (
    <div className="strip score">
      <div><b>{sumPos(ready).toLocaleString("en-IN")}</b><span>Ready stock, graded</span></div>
      <div><b>{finished.toLocaleString("en-IN")}</b><span>Finished today</span></div>
      <div><b>{sumPos(wip).toLocaleString("en-IN")}</b><span>In production</span></div>
      <div><b style={{ fontSize: 20 }}>{formatLong(today)}</b><span>Factory date (India time)</span></div>
    </div>
  );
}

async function Guarded({ children }: { children: React.ReactNode }) {
  await requireRole();
  return children;
}
