import Link from "next/link";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader, Streamed } from "@/components/page";
import { PeriodBar } from "@/components/period-bar";
import { SkeletonPickers, SkeletonTable } from "@/components/skeletons";
import { requireRole } from "@/lib/auth";
import { todayInFactory } from "@/lib/dates";
import { PAY_TYPE_LABEL, WEEKDAYS } from "@/lib/labels";
import { periodRange, type PeriodKind } from "@/lib/periods";
import { getSettings, listWorkers } from "@/lib/setup-queries";
import {
  TASK_LABEL, dateText, daysText, perDay, readView, rejectRate, summariseTeam, teamHref, type TaskKey, type Totals,
} from "@/lib/team";
import { teamWork, workflowsInUse } from "@/lib/team-queries";
import { saveWorker } from "./actions";
import { TaskPicker } from "./task-picker";
import { WorkerFields, payLine, type Worker } from "./worker-fields";
import "./team.css";

export const metadata = { title: "Team" };

export default function TeamPage({ searchParams }: PageProps<"/team">) {
  return (
    <>
      <PageHeader title="Team" sub="Everyone who works here and what they got done, added up from the daily sheets. Open a person for their day-by-day history." />
      <Streamed fallback={<><SkeletonPickers /><section className="panel"><SkeletonTable rows={8} cols={7} /></section></>}>
        <TeamBody searchParams={searchParams} />
      </Streamed>
    </>
  );
}

async function TeamBody({ searchParams }: { searchParams: PageProps<"/team">["searchParams"] }) {
  await requireRole(["owner"]);
  const [params, today, settings, workflows] = await Promise.all([searchParams, todayInFactory(), getSettings(), workflowsInUse()]);
  const { kind, refDay, task } = readView(params, today);
  const day = WEEKDAYS[settings.payWeekday];
  return (
    <>
      <div className="pickers">
        <TaskPicker value={task} workflows={workflows} hrefFor={(t) => teamHref("/team", { task: t, period: kind, ref: refDay })} />
        <span className="spacer" />
        <FormDialog title="New person" trigger="Add person" triggerClassName="btn primary" action={saveWorker}><WorkerFields day={day} /></FormDialog>
      </div>
      <PeriodBar base={teamHref("/team", { task })} kind={kind} refDay={refDay} today={today} />
      <Streamed key={`${task}${kind}${refDay}`} fallback={<section className="panel"><SkeletonTable rows={8} cols={7} /></section>}>
        <TeamTable task={task} kind={kind} refDay={refDay} today={today} day={day} />
      </Streamed>
    </>
  );
}

const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(n && n < 0.1 ? 1 : 0)}%`);
const avgText = (n: number | null) => (n == null ? "—" : n.toFixed(1));

async function TeamTable({ task, kind, refDay, today, day }: { task: TaskKey; kind: PeriodKind; refDay: string; today: string; day: string }) {
  const p = periodRange(kind, refDay);
  const to = p.to < today ? p.to : today;
  const [everyone, { rows, attendance }] = await Promise.all([listWorkers(), teamWork(p.from, to)]);
  if (!everyone.length) {
    return (
      <section className="panel empty">
        <b>Nobody added yet</b>Add everyone who works at the factory. Their work then adds up here from the daily sheets.
        <div style={{ marginTop: 14 }}><FormDialog title="New person" trigger="Add person" triggerClassName="btn primary" action={saveWorker}><WorkerFields day={day} /></FormDialog></div>
      </section>
    );
  }

  // Everyone employed at any point in the period, plus anyone with work or attendance in it.
  const involved = new Set([...rows.map((r) => r.workerId), ...attendance.keys()]);
  const employed = (w: Worker) => (!w.startedOn || w.startedOn <= to) && (!w.leftOn || w.leftOn >= p.from);
  const shown = everyone.filter((w) => employed(w) || involved.has(w.id));
  const away = everyone.filter((w) => !shown.includes(w));

  const summary = summariseTeam(shown.map((w) => w.id), rows, attendance, task);
  let list = shown.map((w, i) => ({ w, s: summary[i] }));
  if (task !== "all") list = list.filter((x) => x.s.total.good + x.s.total.rejected > 0);

  const sum: Totals = list.reduce((a, x) => ({ days: a.days + x.s.total.days, good: a.good + x.s.total.good, rejected: a.rejected + x.s.total.rejected }), { days: 0, good: 0, rejected: 0 });
  const unassigned = rows.find((r) => r.workerId === null && (task === "all" ? r.stage === null : r.stage === task));
  const view = { task, period: kind, ref: refDay };

  return (
    <>
      {list.length ? (
        <section className="panel">
          <h2>{task === "all" ? "Everyone" : TASK_LABEL[task]} <small>{task === "all" ? "all tasks" : "everyone who did this task"}</small></h2>
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Paid by</th>
                  <th className="num">Days present</th>
                  <th className="num">{task === "all" ? "Days with work" : "Days on this"}</th>
                  <th className="num">Done</th>
                  <th className="num">Rejected</th>
                  <th className="num">Average a day</th>
                  {task === "all" ? <th>Mostly</th> : null}
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map(({ w, s }) => {
                  const a = perDay(s.total);
                  return (
                    <tr key={w.id}>
                      <td>
                        <Link className="who" href={teamHref(`/team/${w.id}`, view)}>{w.name}</Link>
                        {w.role ? <><br /><small className="muted">{w.role}</small></> : null}
                        {w.leftOn ? <><br /><small className="muted">Left {dateText(w.leftOn)}</small></> : null}
                      </td>
                      <td className="muted nw">{PAY_TYPE_LABEL[w.payType]}<br /><small>{payLine(w, day)}</small></td>
                      <td className="num">{daysText(s.daysPresent)}</td>
                      <td className="num">{s.total.days || "—"}</td>
                      <td className="num"><b>{s.total.good || "—"}</b></td>
                      <td className="num">{s.total.rejected ? <>{s.total.rejected} <small className="muted">{pct(rejectRate(s.total))}</small></> : "—"}</td>
                      <td className="num">{avgText(a)}</td>
                      {task === "all" ? (
                        <td className="nw">{s.topStage ? <>{TASK_LABEL[s.topStage]} <small className="muted">{pct(s.topShare)}</small></> : <span className="muted">No work logged</span>}</td>
                      ) : null}
                      <td className="num"><FormDialog title={`Edit ${w.name}`} trigger="Edit" triggerClassName="btn sm ghost" action={saveWorker}><WorkerFields w={w} day={day} /></FormDialog></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>{list.length} {list.length === 1 ? "person" : "people"}</td>
                  <td className="num">{sum.days}</td>
                  <td className="num">{sum.good}</td>
                  <td className="num">{sum.rejected ? <>{sum.rejected} <small className="muted">{pct(rejectRate(sum))}</small></> : "—"}</td>
                  <td colSpan={task === "all" ? 3 : 2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : (
        <section className="panel empty"><b>Nobody did {task === "all" ? "any work" : TASK_LABEL[task].toLowerCase()} in this period</b>Pick another task or period, or fill in the daily sheets for these days.</section>
      )}

      <p className="hint" style={{ margin: "12px 0 0" }}>
        Average a day is what that person finished on the days they did this work. Totals count every task, so pick one task above to see output for just that.
        {unassigned ? ` Cutting with nobody picked on the daily sheet (the manager or owner): ${unassigned.good} balls on ${unassigned.days} ${unassigned.days === 1 ? "day" : "days"}.` : ""}
      </p>

      {away.length ? (
        <details className="panel more" style={{ marginTop: 18 }}>
          <summary>Not working here in this period ({away.length})</summary>
          <div className="list">
            {away.map((w) => (
              <div key={w.id} className="row archived">
                <span><Link className="who" href={teamHref(`/team/${w.id}`, view)}>{w.name}</Link><br /><small className="muted">{w.leftOn ? `Left ${dateText(w.leftOn)}` : w.startedOn ? `Starts ${dateText(w.startedOn)}` : ""}</small></span>
                <span className="row-actions"><FormDialog title={`Edit ${w.name}`} trigger="Edit" action={saveWorker}><WorkerFields w={w} day={day} /></FormDialog></span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
