// Work done by each person, worked out from the daily sheets. Pure functions only (no database),
// so the Team pages and any test can share them.

import { addDays, isValidDay, isWorkDay } from "./day";
import { isPeriodKind, periodRange, type PeriodKind } from "./periods";
import { STAGES, type StageId, type Workflow } from "./stages";

/* ------------------------------------------------------------ tasks */

// "Task" is what the floor calls a stage. Hand and machine both have a quarter stitching stage,
// so the stitching method goes in brackets wherever the name alone would be ambiguous.
export type TaskKey = "all" | StageId;

export const TASK_LABEL: Record<StageId, string> = {
  cutting: "Leather cutting",
  hand_quarter_stitching: "Quarter stitching (hand)",
  hand_closing: "Closing (hand)",
  hand_seam_stitching: "Seam stitching (hand)",
  machine_quarter_stitching: "Quarter stitching (machine)",
  machine_stitching: "Machine stitching",
  machine_closing_seam: "Closing and seam (machine)",
};

export function parseTask(v: unknown): TaskKey {
  return typeof v === "string" && v in TASK_LABEL ? (v as StageId) : "all";
}

// Tasks offered in the dropdown: cutting, then each workflow the factory actually makes.
export function taskGroups(workflows: Workflow[]): { group: string; tasks: StageId[] }[] {
  const out = [{ group: "All stitching methods", tasks: ["cutting" as StageId] }];
  if (workflows.includes("hand")) out.push({ group: "Hand stitched", tasks: STAGES.filter((s) => s.workflow === "hand").map((s) => s.id) });
  if (workflows.includes("machine")) out.push({ group: "Machine stitched", tasks: STAGES.filter((s) => s.workflow === "machine").map((s) => s.id) });
  return out;
}

/* ------------------------------------------------------------ links and view */

// What the address asks for: ?task=…&period=week|month|quarter|year&ref=YYYY-MM-DD.
// A month up to today unless it says otherwise; a date after today falls back to today.
export function readView(params: Record<string, string | string[] | undefined>, today: string) {
  const kind: PeriodKind = isPeriodKind(params.period) ? params.period : "month";
  const ref = typeof params.ref === "string" && isValidDay(params.ref) && params.ref <= today ? params.ref : today;
  return { kind, refDay: ref, task: parseTask(params.task) };
}

// Team links keep the chosen task and period as you move between people and periods.
export function teamHref(path: string, o: { task?: TaskKey; period?: PeriodKind; ref?: string }): string {
  const q = new URLSearchParams();
  if (o.task && o.task !== "all") q.set("task", o.task);
  if (o.period) q.set("period", o.period);
  if (o.ref) q.set("ref", o.ref);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/* ------------------------------------------------------------ totals */

// days = days with at least one row of work (for the chosen task), good and rejected = counts.
export type Totals = { days: number; good: number; rejected: number };
export const emptyTotals = (): Totals => ({ days: 0, good: 0, rejected: 0 });
export const perDay = (t: Totals): number | null => (t.days ? t.good / t.days : null);
export const rejectRate = (t: Totals): number | null => (t.good + t.rejected ? t.rejected / (t.good + t.rejected) : null);

export type AttendanceStatus = "present" | "half" | "absent";
// 1 Apr 2026
export const dateText = (day: string) =>
  new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// 4, 4.5
export const daysText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const presentValue = (s: AttendanceStatus | undefined) => (s === "present" ? 1 : s === "half" ? 0.5 : 0);

/* ------------------------------------------------------------ one person */

export type Entry = {
  day: string; stage: StageId; ballTypeId: string; ballType: string; colour: string;
  good: number; rejected: number; sheets: number | null; leather: string | null; supplier: string | null;
};

// What the day list shows for a date:
//   present / half / absent  from the attendance on that day's sheet
//   unmarked                 the sheet was saved without marking this person
//   closed                   the sheet says the factory was closed
//   missing                  a working day nobody has filled in yet
export type DayStatus = AttendanceStatus | "unmarked" | "closed" | "missing";
export type DayRow = { day: string; status: DayStatus; entries: Entry[]; good: number; rejected: number };

// firstSheet is the first day anyone ever filled in: days before it predate the app, so they are
// never "not filled in". Today isn't either until the day is over, the same rule Home uses.
export type PersonInput = {
  from: string; to: string; today: string; weeklyOff: number | null; task: TaskKey;
  startedOn: string | null; leftOn: string | null; firstSheet: string | null;
  entries: Entry[]; attendance: Map<string, AttendanceStatus>; sheets: Map<string, boolean>; // day -> closed
};

const employedOn = (day: string, startedOn: string | null, leftOn: string | null) => (!startedOn || startedOn <= day) && (!leftOn || leftOn >= day);
// A working day with no sheet only counts as missing once the app was in use, and not today.
const inUse = (day: string, p: { firstSheet: string | null; today: string }) => !!p.firstSheet && day >= p.firstSheet && day < p.today;

// Newest first. With "all" every day they were employed shows, so absences and unfilled days are
// visible; with one task only the days they did that task show.
export function personDays(p: PersonInput): DayRow[] {
  const byDay = new Map<string, Entry[]>();
  for (const e of p.entries) if (p.task === "all" || e.stage === p.task) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  const out: DayRow[] = [];
  for (let d = p.to; d >= p.from; d = addDays(d, -1)) {
    const es = byDay.get(d) ?? [];
    if (p.task !== "all" && !es.length) continue;
    if (!es.length && !employedOn(d, p.startedOn, p.leftOn)) continue;
    const closed = p.sheets.get(d);
    let status: DayStatus;
    if (closed === undefined) {
      if (!isWorkDay(d, p.weeklyOff) || !inUse(d, p)) continue;
      status = "missing";
    } else if (closed) status = "closed";
    else status = p.attendance.get(d) ?? "unmarked";
    out.push({ day: d, status, entries: es, good: es.reduce((a, e) => a + e.good, 0), rejected: es.reduce((a, e) => a + e.rejected, 0) });
  }
  return out;
}

export type TypeTotals = Totals & { ballTypeId: string; name: string; colour: string; sheets: number };

export type PersonSummary = {
  total: Totals;                         // for the chosen task (or everything)
  byStage: Map<StageId, Totals>;         // always across all tasks, for the "by task" table
  byType: TypeTotals[];                  // for the chosen task, biggest first
  daysPresent: number;                   // half days count 0.5
  factoryDays: number;                   // days the factory was open (a sheet, not closed) while they worked here
  missingDays: number;                   // working days with no sheet yet
};

export function summarisePerson(p: PersonInput): PersonSummary {
  const total = emptyTotals();
  const byStage = new Map<StageId, Totals>();
  const byType = new Map<string, TypeTotals>();
  const daysAll = new Set<string>();
  const stageDays = new Map<StageId, Set<string>>();
  const typeDays = new Map<string, Set<string>>();
  for (const e of p.entries) {
    const s = byStage.get(e.stage) ?? emptyTotals();
    s.good += e.good; s.rejected += e.rejected;
    byStage.set(e.stage, s);
    const sd = stageDays.get(e.stage) ?? new Set<string>();
    sd.add(e.day); stageDays.set(e.stage, sd);
    if (p.task !== "all" && e.stage !== p.task) continue;
    daysAll.add(e.day);
    total.good += e.good; total.rejected += e.rejected;
    const t = byType.get(e.ballTypeId) ?? { ...emptyTotals(), ballTypeId: e.ballTypeId, name: e.ballType, colour: e.colour, sheets: 0 };
    t.good += e.good; t.rejected += e.rejected; t.sheets += e.sheets ?? 0;
    byType.set(e.ballTypeId, t);
    const td = typeDays.get(e.ballTypeId) ?? new Set<string>();
    td.add(e.day); typeDays.set(e.ballTypeId, td);
  }
  total.days = daysAll.size;
  for (const [k, v] of byStage) v.days = stageDays.get(k)!.size;
  for (const [k, v] of byType) v.days = typeDays.get(k)!.size;

  let daysPresent = 0, factoryDays = 0, missingDays = 0;
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) {
    if (!employedOn(d, p.startedOn, p.leftOn)) continue;
    const closed = p.sheets.get(d);
    if (closed === false) { factoryDays++; daysPresent += presentValue(p.attendance.get(d)); }
    else if (closed === undefined && isWorkDay(d, p.weeklyOff) && inUse(d, p)) missingDays++;
  }
  return { total, byStage, byType: [...byType.values()].sort((a, b) => b.good - a.good), daysPresent, factoryDays, missingDays };
}

// A quarter is shown week by week and a year month by month, each linking to that shorter period.
export type Bucket = Totals & { from: string; label: string; present: number };

export function buckets(kind: PeriodKind, p: PersonInput): { kind: PeriodKind; rows: Bucket[] } | null {
  if (kind !== "quarter" && kind !== "year") return null;
  const sub: PeriodKind = kind === "quarter" ? "week" : "month";
  const rows = new Map<string, Bucket & { dayset: Set<string> }>();
  const get = (d: string) => {
    const r = periodRange(sub, d);
    const b = rows.get(r.from) ?? { ...emptyTotals(), from: r.from, label: r.label, present: 0, dayset: new Set<string>() };
    rows.set(r.from, b);
    return b;
  };
  // weeks or months from the first daily sheet on (earlier ones would only ever be empty)
  const start = p.firstSheet && p.firstSheet > p.from ? p.firstSheet : p.from;
  for (let d = start; d <= p.to; d = addDays(d, 1)) {
    const b = get(d);
    if (p.sheets.get(d) === false && employedOn(d, p.startedOn, p.leftOn)) b.present += presentValue(p.attendance.get(d));
  }
  for (const e of p.entries) {
    if (p.task !== "all" && e.stage !== p.task) continue;
    if (e.day < p.from || e.day > p.to) continue;
    const b = get(e.day);
    b.good += e.good; b.rejected += e.rejected; b.dayset.add(e.day);
  }
  const out = [...rows.values()].map(({ dayset, ...b }) => ({ ...b, days: dayset.size })).sort((a, b) => b.from.localeCompare(a.from));
  return { kind: sub, rows: out };
}

/* ------------------------------------------------------------ the whole team */

export type StageRow = { workerId: string | null; stage: StageId | null; days: number; good: number; rejected: number };

export type TeamRow = {
  workerId: string;
  daysPresent: number;
  total: Totals;                 // for the chosen task (or everything)
  topStage: StageId | null;      // where most of their work went
  topShare: number;              // share of their work in that task
};

// stageRows come from one grouping-sets query: a row per (person, task) and, with stage null,
// a row per person across all tasks (so days aren't double-counted when someone does two tasks).
export function summariseTeam(workerIds: string[], stageRows: StageRow[], attendance: Map<string, number>, task: TaskKey): TeamRow[] {
  return workerIds.map((id) => {
    const mine = stageRows.filter((r) => r.workerId === id);
    const pick = mine.find((r) => (task === "all" ? r.stage === null : r.stage === task));
    const stages = mine.filter((r) => r.stage !== null).sort((a, b) => b.good - a.good);
    const all = mine.find((r) => r.stage === null);
    return {
      workerId: id,
      daysPresent: attendance.get(id) ?? 0,
      total: pick ? { days: pick.days, good: pick.good, rejected: pick.rejected } : emptyTotals(),
      topStage: stages[0]?.stage ?? null,
      topShare: stages[0] && all?.good ? stages[0].good / all.good : 0,
    };
  });
}
