import Link from "next/link";
import { PageHeader, Streamed } from "@/components/page";
import { SkeletonList, SkeletonStrip, SkeletonTable } from "@/components/skeletons";
import { ReadyStockTable, WipTable } from "@/components/stock-tables";
import { getRole, requireRole } from "@/lib/auth";
import { todayInFactory } from "@/lib/dates";
import { dayLong, dayShort } from "@/lib/day";
import { factoryPace, homeData, homeOrders, sheetFilledToday } from "@/lib/home-queries";
import { formatRupees } from "@/lib/money";
import { figures, owedAllTime } from "@/lib/money-queries";
import { periodRange } from "@/lib/periods";
import { activeTypesAndGrades, finishedOn, readyStockByTypeAndGrade, wipByTypeAndBuffer } from "@/lib/queries";
import { BUFFER_LABEL, WORKFLOWS, type Buffer } from "@/lib/stages";
import "./home.css";

export default function HomePage() {
  return (
    <>
      <PageHeader title="Home" actions={<Link className="btn primary" href="/today">Fill in today</Link>} />
      <Streamed fallback={<SkeletonStrip />}><Scoreboard /></Streamed>
      <div className="home-grid">
        <div className="grid" style={{ alignContent: "start" }}>
          <section className="panel"><h2>Ready stock <small>graded and waiting for orders</small></h2><Streamed fallback={<SkeletonTable rows={4} cols={5} />}><Guarded><ReadyStockTable /></Guarded></Streamed></section>
          <section className="panel"><h2>Balls in production</h2><Streamed fallback={<SkeletonTable rows={3} cols={6} />}><Production /></Streamed></section>
          <section className="panel"><h2>Next deliveries</h2><Streamed fallback={<SkeletonList rows={4} action={false} />}><NextDeliveries /></Streamed></section>
        </div>
        <div className="grid" style={{ alignContent: "start" }}>
          <section className="panel"><h2>Needs attention</h2><Streamed fallback={<SkeletonList rows={4} action={false} />}><Attention /></Streamed></section>
          <section className="panel"><h2>Factory pace <small>last 30 days</small></h2><Streamed fallback={<SkeletonList rows={3} action={false} />}><Pace /></Streamed></section>
        </div>
      </div>
    </>
  );
}

async function Guarded({ children }: { children: React.ReactNode }) {
  await requireRole();
  return children;
}

/* ------------------------------------------------------------ scoreboard */

async function Scoreboard() {
  await requireRole();
  const [today, role] = await Promise.all([todayInFactory(), getRole()]);
  const owner = role === "owner";
  const month = periodRange("month", today);
  const [ready, wip, finished, filled, owed, thisMonth] = await Promise.all([
    readyStockByTypeAndGrade(), wipByTypeAndBuffer(), finishedOn(today), sheetFilledToday(today),
    owedAllTime(), owner ? figures(month.from, month.to, today).then((m) => m.get("all")!) : Promise.resolve(null),
  ]);
  const sumPos = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + Math.max(0, b), 0);
  return (
    <div className="strip score">
      <div className="hero"><b>{sumPos(ready).toLocaleString("en-IN")}</b><span>Ready stock, graded</span></div>
      <div><b>{filled ? finished.toLocaleString("en-IN") : "—"}</b><span>{filled ? "Finished today" : "Today not filled in yet"}</span></div>
      {owner && thisMonth ? (
        <>
          <div className={owed ? "alert" : ""}><b>{formatRupees(owed)}</b><span>Customers owe you</span></div>
          <div className={thisMonth.left < 0 ? "alert" : ""}><b>{formatRupees(thisMonth.left)}</b><span>Left this month so far</span></div>
        </>
      ) : (
        <>
          <div><b>{sumPos(wip).toLocaleString("en-IN")}</b><span>In production</span></div>
          <div className={owed ? "alert" : ""}><b>{formatRupees(owed)}</b><span>Customers owe</span></div>
        </>
      )}
      <div className="score-date"><b>{dayLong(today)}</b><span>Factory date, India time</span></div>
    </div>
  );
}

/* ------------------------------------------------------------ production flow */

async function Production() {
  await requireRole();
  const [{ types }, wip] = await Promise.all([activeTypesAndGrades(), wipByTypeAndBuffer()]);
  const ready = await readyStockByTypeAndGrade();
  const FLOW: Record<"hand" | "machine", Buffer[]> = {
    hand: ["cut", "cups", "closed", "awaiting_grading"],
    machine: ["cut", "cups", "machine_stitched", "awaiting_grading"],
  };
  const flows = WORKFLOWS.filter((f) => types.some((t) => t.workflow === f.id));
  if (!flows.length) return <p className="muted" style={{ margin: 0 }}>Add ball types in Setup to see production.</p>;
  return (
    <>
      {flows.map((f) => {
        const ts = types.filter((t) => t.workflow === f.id);
        const stockOf = ts.reduce((a, t) => a + [...ready].filter(([k]) => k.startsWith(t.id + "|")).reduce((b, [, v]) => b + Math.max(0, v), 0), 0);
        return (
          <div key={f.id}>
            <div className="flowlbl">{f.name}</div>
            <div className="flow">
              {FLOW[f.id].map((b, i) => {
                const v = ts.reduce((a, t) => a + Math.max(0, wip.get(`${t.id}|${b}`) ?? 0), 0);
                return <div key={b} className={`node ${v > 0 ? "has" : ""}`}><div className="dot">{i + 1}</div><b>{v.toLocaleString("en-IN")}</b><span>{BUFFER_LABEL[b]}</span></div>;
              })}
              <div className="node end"><div className="dot">✓</div><b>{stockOf.toLocaleString("en-IN")}</b><span>Ready stock</span></div>
            </div>
          </div>
        );
      })}
      <details className="more"><summary>By ball type</summary><div style={{ marginTop: 10 }}><WipTable /></div></details>
    </>
  );
}

/* ------------------------------------------------------------ next deliveries */

async function NextDeliveries() {
  await requireRole();
  const today = await todayInFactory();
  const orders = await homeOrders();
  const list = orders.open.slice(0, 6);
  if (!list.length) return <p className="muted" style={{ margin: 0 }}>No open orders.</p>;
  const dueText = (d: string) => { const n = Math.round((Date.parse(d) - Date.parse(today)) / 86400000); return n < 0 ? `${-n} days late` : n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`; };
  return (
    <div className="list">
      {list.map((o) => {
        const c = orders.check[o.id];
        const chip = o.dueOn < today ? <span className="chip bad">Late</span>
          : !c?.need ? <span className="chip draft">Nothing left</span>
          : c.short === 0 ? <span className="chip done">In stock</span>
          : <span className={`chip ${Date.parse(o.dueOn) - Date.parse(today) <= 7 * 86400000 ? "bad" : "progress"}`}>Short {c.short}</span>;
        return (
          <Link key={o.id} href="/orders" className="row arow">
            <span><b>{o.customer}</b><br /><small className="muted">{c?.need ?? 0} balls left to send, due {dayShort(o.dueOn)} ({dueText(o.dueOn)})</small></span>
            {chip}
          </Link>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ needs attention */

async function Attention() {
  await requireRole();
  const [today, role] = await Promise.all([todayInFactory(), getRole()]);
  const { alerts } = await homeData(today, role === "owner");
  if (!alerts.length) return <p className="muted" style={{ margin: 0 }}>All clear.</p>;
  return (
    <div className="list">
      {alerts.map((a, i) => (
        <Link key={i} href={a.href} className="row arow">
          <span><b className={a.tone}>{a.text}</b><br /><small className="muted">{a.sub}</small></span>
          <span className="muted" aria-hidden="true">›</span>
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ pace */

async function Pace() {
  await requireRole();
  const p = await factoryPace(await todayInFactory());
  if (p.perDay == null) return <p className="muted" style={{ margin: 0 }}>Shows after a few days of entries.</p>;
  return (
    <>
      <p style={{ margin: "0 0 8px" }}>About <b>{Math.round(p.perDay)} balls a day</b> come off seam stitching, over {p.days} working {p.days === 1 ? "day" : "days"} with entries.</p>
      <div className="list">
        {p.stages.sort((a, b) => a.perPerson - b.perPerson).map((s) => (
          <div key={s.stage.id} className="row">
            <span>{s.stage.name}<br /><small className="muted">{s.stage.workflow === "machine" ? "Machine stitched" : "Hand stitched"}</small></span>
            <span className="nw">{Math.round(s.perPerson)} per person a day</span>
          </div>
        ))}
      </div>
      <p className="hint" style={{ margin: "10px 0 0" }}>The stage with the lowest number per person usually decides how many balls the factory finishes. Another person there adds roughly that many a day.</p>
    </>
  );
}
