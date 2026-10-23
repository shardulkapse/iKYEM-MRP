import Link from "next/link";
import { FormDialog } from "@/components/form-dialog";
import { Streamed } from "@/components/page";
import { Pager } from "@/components/pager";
import { PeriodBar } from "@/components/period-bar";
import { SelectNav } from "@/components/select-nav";
import { Sk, SkeletonPickers, SkeletonStrip, SkeletonTable } from "@/components/skeletons";
import { requireRole } from "@/lib/auth";
import { todayInFactory } from "@/lib/dates";
import { dayShort } from "@/lib/day";
import { PAY_TYPE_LABEL, WEEKDAYS } from "@/lib/labels";
import { periodRange, type PeriodKind } from "@/lib/periods";
import { pageOf, paging } from "@/lib/paging";
import { getSettings, listWorkers } from "@/lib/setup-queries";
import { STAGES } from "@/lib/stages";
import {
  TASK_LABEL, buckets, dateText, daysText, perDay, personDays, readView, rejectRate, summarisePerson, teamHref,
  type Bucket, type DayRow, type DayStatus, type Entry, type TaskKey,
} from "@/lib/team";
import { personWork, workflowsInUse } from "@/lib/team-queries";
import { saveWorker } from "../actions";
import { TaskPicker } from "../task-picker";
import { WorkerFields, payLine, type Worker } from "../worker-fields";
import "../team.css";

export const metadata = { title: "Team member" };

export default function PersonPage({ params, searchParams }: PageProps<"/team/[id]">) {
  return (
    <>
      <Link className="back" href="/team">‹ Team</Link>
      <Streamed fallback={<><div className="top"><div><Sk w={240} h={30} /><Sk w={320} h={14} style={{ marginTop: 10 }} /></div></div><SkeletonPickers pickers={2} /><BodySkeleton /></>}>
        <Person params={params} searchParams={searchParams} />
      </Streamed>
    </>
  );
}

function BodySkeleton() {
  return (
    <>
      <SkeletonStrip plain />
      <section className="panel"><SkeletonTable rows={8} cols={5} /></section>
    </>
  );
}

async function Person({ params, searchParams }: { params: PageProps<"/team/[id]">["params"]; searchParams: PageProps<"/team/[id]">["searchParams"] }) {
  await requireRole(["owner"]);
  const [{ id }, sp, today, settings, workflows, everyone] = await Promise.all([params, searchParams, todayInFactory(), getSettings(), workflowsInUse(), listWorkers()]);
  const w = everyone.find((x) => x.id === id);
  if (!w) {
    return (
      <section className="panel empty">
        <b>This person isn&apos;t on the team list</b>
        The link may be out of date. <Link href="/team">See everyone</Link>
      </section>
    );
  }
  const { kind, refDay, task } = readView(sp, today);
  const day = WEEKDAYS[settings.payWeekday];
  const path = `/team/${w.id}`;
  const view = { task, period: kind, ref: refDay };
  const current = everyone.filter((x) => !x.leftOn || x.leftOn >= today);
  const gone = everyone.filter((x) => !current.includes(x));
  const choice = (x: Worker) => ({ value: x.id, label: x.name, href: teamHref(`/team/${x.id}`, view) });
  const facts = [w.role, `${PAY_TYPE_LABEL[w.payType]}, ${payLine(w, day)}`, w.startedOn ? `Started ${dateText(w.startedOn)}` : null].filter(Boolean).join(" · ");

  return (
    <>
      <div className="top">
        <div>
          <h1>{w.name} {w.leftOn ? <span className="chip draft" style={{ verticalAlign: "middle" }}>Left {dateText(w.leftOn)}</span> : null}</h1>
          <p>{facts}</p>
        </div>
        <FormDialog title={`Edit ${w.name}`} trigger="Edit details" triggerClassName="btn" action={saveWorker}><WorkerFields w={w} day={day} /></FormDialog>
      </div>
      <div className="pickers">
        <SelectNav label="Person" value={w.id} groups={[{ choices: current.map(choice) }, ...(gone.length ? [{ group: "Have left", choices: gone.map(choice) }] : [])]} />
        <TaskPicker value={task} workflows={workflows} hrefFor={(t) => teamHref(path, { ...view, task: t })} />
      </div>
      <PeriodBar base={teamHref(path, { task })} kind={kind} refDay={refDay} today={today} />
      <Streamed key={`${task}${kind}${refDay}`} fallback={<BodySkeleton />}>
        <PersonBody w={w} task={task} kind={kind} refDay={refDay} today={today} weeklyOff={settings.weeklyOff} path={path} page={sp.page} />
      </Streamed>
    </>
  );
}

const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(n && n < 0.1 ? 1 : 0)}%`);
const avgText = (n: number | null) => (n == null ? "—" : n.toFixed(1));

async function PersonBody({ w, task, kind, refDay, today, weeklyOff, path, page }: {
  w: Worker; task: TaskKey; kind: PeriodKind; refDay: string; today: string; weeklyOff: number | null; path: string; page: string | string[] | undefined;
}) {
  const p = periodRange(kind, refDay);
  const to = p.to < today ? p.to : today;
  if (p.from > to) return <section className="panel empty"><b>This period hasn&apos;t started yet</b>Pick an earlier one.</section>;
  const data = await personWork(w.id, p.from, to);
  const away = w.leftOn && w.leftOn < p.from ? { text: `${w.name} left on ${dateText(w.leftOn)}, before this period.`, ref: w.leftOn, label: "See their last month" }
    : w.startedOn && w.startedOn > to ? { text: `${w.name} starts on ${dateText(w.startedOn)}, after this period.`, ref: w.startedOn < today ? w.startedOn : today, label: "See their first month" }
    : null;
  if (away && !data.entries.length && !data.attendance.size) {
    return <section className="panel empty"><b>Nothing in this period</b>{away.text}<div style={{ marginTop: 14 }}><Link className="btn" href={teamHref(path, { task, period: "month", ref: away.ref })}>{away.label}</Link></div></section>;
  }
  const input = { from: p.from, to, today, weeklyOff, task, startedOn: w.startedOn, leftOn: w.leftOn, ...data };
  const s = summarisePerson(input);
  const days = personDays(input);
  const bk = buckets(kind, input);
  const link = (o: { task?: TaskKey; period?: PeriodKind; ref?: string }) => teamHref(path, { task, period: kind, ref: refDay, ...o });

  return (
    <>
      <div className="strip plain">
        {task === "all" ? (
          <div><b>{daysText(s.daysPresent)}</b><span>Days present, of {s.factoryDays} the factory was open</span></div>
        ) : (
          <div><b>{s.total.days}</b><span>Days on {TASK_LABEL[task].toLowerCase()}, of {daysText(s.daysPresent)} present</span></div>
        )}
        <div className="hero"><b>{s.total.good}</b><span>Done{task === "all" ? ", all tasks" : ""}</span></div>
        <div className={s.total.rejected && (rejectRate(s.total) ?? 0) >= 0.05 ? "alert" : ""}><b>{s.total.rejected}</b><span>Rejected, {pct(rejectRate(s.total))}</span></div>
        <div><b>{avgText(perDay(s.total))}</b><span>Average a day they worked</span></div>
      </div>

      {s.missingDays ? (
        <div className="banner">{s.missingDays} working {s.missingDays === 1 ? "day" : "days"} in this period {s.missingDays === 1 ? "isn't" : "aren't"} filled in yet, so these figures may be low. They show below as &quot;Not filled in&quot;.</div>
      ) : null}

      <div className="grid">
        {task === "all" ? <ByTask s={s} link={link} /> : <ByType s={s} cutting={task === "cutting"} />}
        {bk && bk.rows.length ? <Buckets kind={bk.kind} rows={bk.rows} link={link} /> : null}
        <DayList days={days} task={task} page={page} href={link({})} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------ by task / by ball type */

function ByTask({ s, link }: { s: ReturnType<typeof summarisePerson>; link: (o: { task?: TaskKey }) => string }) {
  const rows = STAGES.filter((st) => s.byStage.has(st.id)).map((st) => ({ id: st.id, t: s.byStage.get(st.id)! }));
  if (!rows.length) return null;
  return (
    <section className="panel">
      <h2>By task <small>pick one to see just that task</small></h2>
      <div className="tbl">
        <table>
          <thead><tr><th>Task</th><th className="num">Days</th><th className="num">Done</th><th className="num">Rejected</th><th className="num">Average a day</th></tr></thead>
          <tbody>
            {rows.map(({ id, t }) => {
              return (
                <tr key={id}>
                  <td><Link href={link({ task: id })}>{TASK_LABEL[id]}</Link></td>
                  <td className="num">{t.days}</td>
                  <td className="num"><b>{t.good}</b></td>
                  <td className="num">{t.rejected ? <>{t.rejected} <small className="muted">{pct(rejectRate(t))}</small></> : "—"}</td>
                  <td className="num">{avgText(perDay(t))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ByType({ s, cutting }: { s: ReturnType<typeof summarisePerson>; cutting: boolean }) {
  if (!s.byType.length) return null;
  return (
    <section className="panel">
      <h2>By ball type</h2>
      <div className="tbl">
        <table>
          <thead>
            <tr>
              <th>Ball type</th><th className="num">Days</th><th className="num">Done</th>
              {cutting ? <><th className="num">Sheets</th><th className="num">Per sheet</th></> : <th className="num">Rejected</th>}
              <th className="num">Average a day</th>
            </tr>
          </thead>
          <tbody>
            {s.byType.map((t) => (
              <tr key={t.ballTypeId}>
                <td><span className={`swatch sw-${t.colour}`} />{t.name}</td>
                <td className="num">{t.days}</td>
                <td className="num"><b>{t.good}</b></td>
                {cutting
                  ? <><td className="num">{t.sheets ? t.sheets.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</td><td className="num">{t.sheets ? (t.good / t.sheets).toFixed(1) : "—"}</td></>
                  : <td className="num">{t.rejected ? <>{t.rejected} <small className="muted">{pct(rejectRate(t))}</small></> : "—"}</td>}
                <td className="num">{avgText(perDay(t))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ week by week / month by month */

function Buckets({ kind, rows, link }: { kind: PeriodKind; rows: Bucket[]; link: (o: { period?: PeriodKind; ref?: string }) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.good));
  return (
    <section className="panel">
      <h2>{kind === "week" ? "Week by week" : "Month by month"} <small>open one for its days</small></h2>
      <div className="tbl">
        <table>
          <thead><tr><th>{kind === "week" ? "Week" : "Month"}</th><th className="num">Days present</th><th className="num">Days with work</th><th className="num">Done</th><th className="num">Rejected</th><th className="num">Average a day</th><th className="barcol" /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.from}>
                <td className="nw"><Link href={link({ period: kind, ref: r.from })}>{r.label}</Link></td>
                <td className="num">{daysText(r.present)}</td>
                <td className="num">{r.days || "—"}</td>
                <td className="num"><b>{r.good || "—"}</b></td>
                <td className="num">{r.rejected || "—"}</td>
                <td className="num">{avgText(perDay(r))}</td>
                <td className="barcol"><Bar v={r.good} max={max} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ day by day */

const STATUS: Record<DayStatus, { label: string; cls: string }> = {
  present: { label: "Present", cls: "chip good" },
  half: { label: "Half day", cls: "chip progress" },
  absent: { label: "Absent", cls: "chip bad" },
  unmarked: { label: "Not marked", cls: "chip draft" },
  closed: { label: "Factory closed", cls: "chip draft" },
  missing: { label: "Not filled in", cls: "chip draft" },
};

function Bar({ v, max }: { v: number; max: number }) {
  return <span className="bar" aria-hidden="true"><i style={{ width: `${Math.round((v / max) * 100)}%` }} /></span>;
}

function WorkLine({ e, showTask }: { e: Entry; showTask: boolean }) {
  return (
    <div>
      {showTask ? <span className="t">{TASK_LABEL[e.stage]}</span> : null}
      <span><span className={`swatch sw-${e.colour}`} />{e.ballType} <b>{e.good}</b>{e.rejected ? <span className="bad"> +{e.rejected} rejected</span> : null}</span>
      {e.stage === "cutting" && e.sheets ? <span className="muted">{e.sheets.toLocaleString("en-IN", { maximumFractionDigits: 2 })} {e.sheets === 1 ? "sheet" : "sheets"}{e.leather ? ` of ${e.leather.toLowerCase()}` : ""}{e.supplier ? `, ${e.supplier}` : ""}</span> : null}
    </div>
  );
}

// A month's days (up to 31 rows) always fit on one page; quarters and years run to more.
const DAYS_PER_PAGE = 35;

function DayList({ days, task, page, href }: { days: DayRow[]; task: TaskKey; page: string | string[] | undefined; href: string }) {
  const title = <>Day by day <small>{task === "all" ? "every day they were employed, newest first" : `days they did ${TASK_LABEL[task].toLowerCase()}`}</small></>;
  if (!days.length) {
    return <section className="panel"><h2>{title}</h2><p className="muted" style={{ margin: 0 }}>{task === "all" ? "No days to show in this period." : `No ${TASK_LABEL[task].toLowerCase()} in this period.`}</p></section>;
  }
  const max = Math.max(1, ...days.map((d) => d.good));
  const pg = paging(page, days.length, DAYS_PER_PAGE);
  return (
    <section className="panel">
      <h2>{title}</h2>
    <div className="tbl">
      <table className="days">
        <thead><tr><th>Day</th><th>Attendance</th><th>Work</th><th className="num">Done</th><th className="num">Rejected</th><th className="barcol" /></tr></thead>
        <tbody>
          {pageOf(days, pg).map((d) => {
            const st = STATUS[d.status];
            const quiet = d.status === "closed" || d.status === "missing" || (!d.entries.length && d.status === "absent");
            return (
              <tr key={d.day} className={quiet ? "quiet" : undefined}>
                <td className="nw"><Link href={`/today?date=${d.day}`} title="Open this day's sheet">{dayShort(d.day)}</Link></td>
                <td className="nw">{d.status === "missing" ? <Link className={st.cls} href={`/today?date=${d.day}`}>{st.label}</Link> : <span className={st.cls}>{st.label}</span>}</td>
                <td>
                  {d.entries.length ? <div className="worklines">{d.entries.map((e, i) => <WorkLine key={i} e={e} showTask={task === "all"} />)}</div>
                    : <span className="muted">{d.status === "present" || d.status === "half" ? "No work logged" : "—"}</span>}
                </td>
                <td className="num"><b>{d.entries.length ? d.good : ""}</b></td>
                <td className="num">{d.rejected || ""}</td>
                <td className="barcol">{d.good ? <Bar v={d.good} max={max} /> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
      <Pager p={pg} href={href} noun={["day", "days"]} />
    </section>
  );
}
