import "server-only";
import { asc, sql } from "drizzle-orm";
import { db } from "@/db";
import { ballTypes, factorySettings, grades, materials, suppliers, workers } from "@/db/schema";

// Archived rows sort last; everything else by the owner's chosen order, then name.
const archivedLast = (col: typeof ballTypes.archivedAt | typeof grades.archivedAt | typeof materials.archivedAt | typeof suppliers.archivedAt) =>
  sql`${col} is not null`;

export const listBallTypes = () => db.select().from(ballTypes).orderBy(archivedLast(ballTypes.archivedAt), asc(ballTypes.sortOrder), asc(ballTypes.name));
export const listGrades = () => db.select().from(grades).orderBy(archivedLast(grades.archivedAt), asc(grades.sortOrder), asc(grades.name));
export const listMaterials = () => db.select().from(materials).orderBy(archivedLast(materials.archivedAt), asc(materials.kind), asc(materials.name));
export const listSuppliers = () => db.select().from(suppliers).orderBy(archivedLast(suppliers.archivedAt), asc(suppliers.name));
export const listWorkers = () => db.select().from(workers).orderBy(sql`${workers.leftOn} is not null`, asc(workers.sortOrder), asc(workers.name));

export async function getSettings() {
  const [row] = await db.select().from(factorySettings);
  return row ?? { id: 1, workDays: 6, payWeekday: 2 };
}
