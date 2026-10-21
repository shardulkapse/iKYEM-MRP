import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { StageId, Workflow } from "@/lib/stages";
import type { AttendanceStatus, Entry, StageRow } from "@/lib/team";

// Every person's work in a date range, per task and in total, in one query. GROUPING SETS gives a
// row per (person, task) and a row per person (stage null) whose day count doesn't double-count
// days when someone worked at two tasks. Rows with no person are cutting done by the manager or owner.
export async function teamWork(from: string, to: string) {
  const [work, att] = await Promise.all([
    db.execute<{ worker_id: string | null; stage: StageId | null; days: number; good: string; rejected: string }>(sql`
      select worker_id, stage, count(distinct day)::int as days, sum(good) as good, sum(rejected) as rejected
        from work_entries
       where day between ${from} and ${to}
       group by grouping sets ((worker_id, stage), (worker_id))`),
    db.execute<{ worker_id: string; present: string }>(sql`
      select a.worker_id, sum(case a.status when 'present' then 1 when 'half' then 0.5 else 0 end) as present
        from attendance a join day_sheets s on s.day = a.day
       where not s.closed and a.day between ${from} and ${to}
       group by a.worker_id`),
  ]);
  const rows: StageRow[] = work.rows.map((r) => ({ workerId: r.worker_id, stage: r.stage, days: r.days, good: Number(r.good), rejected: Number(r.rejected) }));
  return { rows, attendance: new Map(att.rows.map((a) => [a.worker_id, Number(a.present)])) };
}

// One person's rows, attendance and the factory's day sheets for a date range.
export async function personWork(workerId: string, from: string, to: string) {
  const [entries, att, sheets, first] = await Promise.all([
    db.execute<{ day: string; stage: StageId; ball_type_id: string; ball_type: string; colour: string; good: number; rejected: number; sheets: string | null; leather: string | null; supplier: string | null }>(sql`
      select e.day::text as day, e.stage, e.ball_type_id, b.name as ball_type, b.colour, e.good, e.rejected, e.sheets,
             m.name as leather, s.name as supplier
        from work_entries e
        join ball_types b on b.id = e.ball_type_id
        left join materials m on m.id = e.leather_id
        left join suppliers s on s.id = e.supplier_id
       where e.worker_id = ${workerId} and e.day between ${from} and ${to}
       order by e.day desc, e.created_at, e.id`),
    db.execute<{ day: string; status: AttendanceStatus }>(sql`
      select day::text as day, status from attendance where worker_id = ${workerId} and day between ${from} and ${to}`),
    db.execute<{ day: string; closed: boolean }>(sql`
      select day::text as day, closed from day_sheets where day between ${from} and ${to}`),
    db.execute<{ first: string | null }>(sql`select min(day)::text as first from day_sheets`),
  ]);
  return {
    entries: entries.rows.map((e): Entry => ({
      day: e.day, stage: e.stage, ballTypeId: e.ball_type_id, ballType: e.ball_type, colour: e.colour,
      good: Number(e.good), rejected: Number(e.rejected), sheets: e.sheets == null ? null : Number(e.sheets), leather: e.leather, supplier: e.supplier,
    })),
    attendance: new Map(att.rows.map((a) => [a.day, a.status])),
    sheets: new Map(sheets.rows.map((s) => [s.day, Boolean(s.closed)])),
    firstSheet: first.rows[0]?.first ?? null,
  };
}

// Which stitching methods have ball types, so the task list only offers stages that can happen.
export async function workflowsInUse(): Promise<Workflow[]> {
  const r = await db.execute<{ workflow: Workflow }>(sql`select distinct workflow from ball_types`);
  return r.rows.map((x) => x.workflow);
}
