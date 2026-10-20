import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { ballTypes, grades, materialOnHand, materials, readyStock, wipLevels, workEntries } from "@/db/schema";

const FINAL_STAGES = ["hand_seam_stitching", "machine_closing_seam"] as const;

export async function activeTypesAndGrades() {
  const [types, gradeList] = await Promise.all([
    db.select().from(ballTypes).where(isNull(ballTypes.archivedAt)).orderBy(asc(ballTypes.sortOrder), asc(ballTypes.name)),
    db.select().from(grades).where(isNull(grades.archivedAt)).orderBy(asc(grades.sortOrder), asc(grades.name)),
  ]);
  return { types, grades: gradeList };
}

export async function readyStockByTypeAndGrade() {
  const rows = await db.select().from(readyStock);
  const out = new Map<string, number>();
  for (const r of rows) out.set(`${r.ballTypeId}|${r.gradeId}`, Number(r.qty ?? 0));
  return out;
}

export async function wipByTypeAndBuffer() {
  const rows = await db.select().from(wipLevels);
  const out = new Map<string, number>();
  for (const r of rows) out.set(`${r.ballTypeId}|${r.buffer}`, Number(r.qty ?? 0));
  return out;
}

export async function finishedOn(day: string) {
  const [row] = await db
    .select({ n: sql<string>`coalesce(sum(${workEntries.good}), 0)` })
    .from(workEntries)
    .where(and(eq(workEntries.day, day), inArray(workEntries.stage, [...FINAL_STAGES])));
  return Number(row?.n ?? 0);
}

export async function materialsWithStock() {
  return db
    .select({ id: materials.id, name: materials.name, kind: materials.kind, colour: materials.colour, unit: materials.unit, qty: materialOnHand.qty })
    .from(materials)
    .leftJoin(materialOnHand, eq(materialOnHand.materialId, materials.id))
    .where(isNull(materials.archivedAt))
    .orderBy(asc(materials.kind), asc(materials.name));
}
