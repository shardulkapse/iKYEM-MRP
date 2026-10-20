import "server-only";
import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendance, ballTypes, daySheets, grades, gradings, materials, readyStock, suppliers, wipLevels, wipMovements, workEntries, workers,
} from "@/db/schema";
import { addDays, isWorkDay } from "@/lib/day";
import type { Buffer, Construction, StageId, Workflow } from "@/lib/stages";
import { getSettings } from "@/lib/setup-queries";

export type AttendanceStatus = "present" | "half" | "absent";

export type DayData = {
  day: string;
  today: string;
  workDays: number;
  sheet: { exists: boolean; closed: boolean; updatedAt: string | null };
  types: { id: string; name: string; colour: string; construction: Construction; workflow: Workflow }[];
  grades: { id: string; name: string }[];
  workers: { id: string; name: string; role: string | null; payType: string }[];
  leathers: { id: string; name: string; colour: string | null }[];
  suppliers: { id: string; name: string }[];
  attendance: Record<string, AttendanceStatus>;
  work: { stage: StageId; workerId: string | null; ballTypeId: string; good: number; rejected: number; leatherId: string | null; supplierId: string | null; sheets: number | null }[];
  grading: { ballTypeId: string; supplierId: string | null; gradeId: string | null; rejected: boolean; qty: number }[];
  startOfDay: Record<string, number>; // "ballTypeId|buffer" -> balls waiting before this day's work
  lastCut: Record<string, { leatherId: string | null; supplierId: string | null }>; // per ball type, for defaults
  missing: string[]; // working days with no sheet, oldest first
  negatives: string[]; // counts currently below zero anywhere
};

export async function loadDay(day: string, today: string): Promise<DayData> {
  const settings = await getSettings();
  const [
    typeRows, gradeRows, workerRows, leatherRows, supplierRows, sheetRows, attRows, workRows, gradingRows, wipRows, lastCutRows, firstRow, recentDays, negatives,
  ] = await Promise.all([
    db.select().from(ballTypes).orderBy(asc(ballTypes.sortOrder), asc(ballTypes.name)),
    db.select().from(grades).orderBy(asc(grades.sortOrder), asc(grades.name)),
    db.select().from(workers).orderBy(asc(workers.sortOrder), asc(workers.name)),
    db.select().from(materials).where(eq(materials.kind, "leather")).orderBy(asc(materials.name)),
    db.select().from(suppliers).orderBy(asc(suppliers.name)),
    db.select().from(daySheets).where(eq(daySheets.day, day)),
    db.select().from(attendance).where(eq(attendance.day, day)),
    db.select().from(workEntries).where(eq(workEntries.day, day)).orderBy(asc(workEntries.createdAt), asc(workEntries.id)),
    db.select().from(gradings).where(eq(gradings.day, day)),
    db
      .select({ ballTypeId: wipMovements.ballTypeId, buffer: wipMovements.buffer, qty: sql<string>`sum(${wipMovements.qty})` })
      .from(wipMovements)
      .where(lt(wipMovements.day, day))
      .groupBy(wipMovements.ballTypeId, wipMovements.buffer),
    db.execute<{ ball_type_id: string; leather_id: string | null; supplier_id: string | null }>(sql`
      select distinct on (ball_type_id) ball_type_id, leather_id, supplier_id
      from work_entries
      where stage = 'cutting' and day <= ${day}
      order by ball_type_id, day desc, created_at desc`),
    db.select({ first: sql<string | null>`min(${daySheets.day})::text` }).from(daySheets),
    db.select({ day: daySheets.day }).from(daySheets).where(and(gte(daySheets.day, addDays(today, -60)), lte(daySheets.day, today))),
    loadNegatives(),
  ]);

  // Show what's in use on this day, plus anything this day's sheet already refers to.
  const usedTypes = new Set([...workRows.map((w) => w.ballTypeId), ...gradingRows.map((g) => g.ballTypeId)]);
  const usedWorkers = new Set([...attRows.map((a) => a.workerId), ...workRows.map((w) => w.workerId).filter(Boolean)] as string[]);
  const usedLeather = new Set(workRows.map((w) => w.leatherId).filter(Boolean) as string[]);
  const usedSuppliers = new Set([...workRows.map((w) => w.supplierId), ...gradingRows.map((g) => g.supplierId)].filter(Boolean) as string[]);
  const usedGrades = new Set(gradingRows.map((g) => g.gradeId).filter(Boolean) as string[]);

  const first = firstRow[0]?.first ?? null;
  const filled = new Set(recentDays.map((r) => r.day));
  const missing: string[] = [];
  if (first) {
    const from = first > addDays(today, -60) ? first : addDays(today, -60);
    for (let d = from; d < today; d = addDays(d, 1)) if (isWorkDay(d, settings.workDays) && !filled.has(d)) missing.push(d);
  }

  const sheet = sheetRows[0];
  return {
    day,
    today,
    workDays: settings.workDays,
    sheet: { exists: !!sheet, closed: sheet?.closed ?? false, updatedAt: sheet ? sheet.updatedAt.toISOString() : null },
    types: typeRows.filter((t) => !t.archivedAt || usedTypes.has(t.id)).map((t) => ({ id: t.id, name: t.name, colour: t.colour, construction: t.construction, workflow: t.workflow })),
    grades: gradeRows.filter((g) => !g.archivedAt || usedGrades.has(g.id)).map((g) => ({ id: g.id, name: g.name })),
    workers: workerRows
      .filter((w) => usedWorkers.has(w.id) || ((!w.startedOn || w.startedOn <= day) && (!w.leftOn || w.leftOn >= day)))
      .map((w) => ({ id: w.id, name: w.name, role: w.role, payType: w.payType })),
    leathers: leatherRows.filter((m) => !m.archivedAt || usedLeather.has(m.id)).map((m) => ({ id: m.id, name: m.name, colour: m.colour })),
    suppliers: supplierRows.filter((s) => !s.archivedAt || usedSuppliers.has(s.id)).map((s) => ({ id: s.id, name: s.name })),
    attendance: Object.fromEntries(attRows.map((a) => [a.workerId, a.status])),
    work: workRows.map((w) => ({ stage: w.stage, workerId: w.workerId, ballTypeId: w.ballTypeId, good: w.good, rejected: w.rejected, leatherId: w.leatherId, supplierId: w.supplierId, sheets: w.sheets == null ? null : Number(w.sheets) })),
    grading: gradingRows.map((g) => ({ ballTypeId: g.ballTypeId, supplierId: g.supplierId, gradeId: g.gradeId, rejected: g.rejected, qty: g.qty })),
    startOfDay: Object.fromEntries(wipRows.map((r) => [`${r.ballTypeId}|${r.buffer as Buffer}`, Number(r.qty ?? 0)])),
    lastCut: Object.fromEntries(lastCutRows.rows.map((r) => [r.ball_type_id, { leatherId: r.leather_id, supplierId: r.supplier_id }])),
    missing,
    negatives,
  };
}

// Any pile or ready-stock count below zero means some day's entries took more than was there.
export async function loadNegatives(): Promise<string[]> {
  const LABEL: Record<string, string> = { cut: "cut leather", cups: "cups", machine_stitched: "machine stitched", closed: "closed", awaiting_grading: "waiting for grading" };
  const [wip, ready] = await Promise.all([
    db.select({ name: ballTypes.name, buffer: wipLevels.buffer, qty: wipLevels.qty }).from(wipLevels).innerJoin(ballTypes, eq(ballTypes.id, wipLevels.ballTypeId)).where(lt(wipLevels.qty, "0")),
    db.select({ name: ballTypes.name, grade: grades.name, qty: readyStock.qty }).from(readyStock).innerJoin(ballTypes, eq(ballTypes.id, readyStock.ballTypeId)).innerJoin(grades, eq(grades.id, readyStock.gradeId)).where(lt(readyStock.qty, "0")),
  ]);
  return [
    ...wip.map((w) => `${w.name}: ${LABEL[w.buffer ?? ""] ?? w.buffer} is at ${Number(w.qty)}`),
    ...ready.map((r) => `${r.name}, ${r.grade}: ready stock is at ${Number(r.qty)}`),
  ];
}
