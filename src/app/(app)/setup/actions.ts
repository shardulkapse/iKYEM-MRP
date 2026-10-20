"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { ballTypes, colour, construction, factorySettings, grades, materialKind, materials, suppliers, workflow } from "@/db/schema";
import { type ActionResult, fail, firstIssue, ok, pgCode } from "@/lib/action-result";
import { requireRole } from "@/lib/auth";

const optionalId = z.union([z.uuid(), z.literal("")]).optional();
const name = (what: string) => z.string().trim().min(1, `Give the ${what} a name.`).max(80, "That name is too long.");
const position = z.coerce.number().int("Position is a whole number.").min(0).max(999).catch(0);
const optionalText = z.string().trim().max(500).optional().transform((v) => v || null);

/* ------------------------------------------------------------ ball types */

const ballTypeSchema = z.object({
  id: optionalId,
  name: name("ball type"),
  colour: z.enum(colour.enumValues),
  construction: z.enum(construction.enumValues),
  workflow: z.enum(workflow.enumValues),
  weightGrams: z.string().trim().regex(/^(\d{1,4}(\.\d)?)?$/, "Weight is in grams, like 156 or 156.5."),
  sortOrder: position,
});

async function ballTypeInUse(id: string) {
  const r = await db.execute<{ used: boolean }>(sql`
    select exists(select 1 from work_entries where ball_type_id = ${id})
        or exists(select 1 from gradings where ball_type_id = ${id})
        or exists(select 1 from order_lines where ball_type_id = ${id})
        or exists(select 1 from stock_adjustments where ball_type_id = ${id}) as used`);
  return Boolean(r.rows[0]?.used);
}

export async function saveBallType(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = ballTypeSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const values = { name: v.name, colour: v.colour, construction: v.construction, workflow: v.workflow, weightGrams: v.weightGrams || null, sortOrder: v.sortOrder };
  try {
    if (v.id) {
      const [current] = await db.select().from(ballTypes).where(eq(ballTypes.id, v.id));
      if (!current) return fail("That ball type no longer exists.");
      const shapeChanged = current.construction !== v.construction || current.workflow !== v.workflow;
      if (shapeChanged && (await ballTypeInUse(v.id))) {
        return fail("This ball type already has production, stock or orders recorded, so its construction and stitching can't change. Add a new ball type instead.");
      }
      await db.update(ballTypes).set(values).where(eq(ballTypes.id, v.id));
    } else {
      await db.insert(ballTypes).values({ ...values, createdBy: userId });
    }
  } catch (e) {
    if (pgCode(e) === "23505") return fail(`A ball type called "${v.name}" already exists. If it's archived, restore it instead.`);
    throw e;
  }
  refresh();
  return ok();
}

/* --------------------------------------------------------------- grades */

const gradeSchema = z.object({ id: optionalId, name: name("grade"), note: optionalText, sortOrder: position });

export async function saveGrade(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = gradeSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { id, ...values } = parsed.data;
  try {
    if (id) await db.update(grades).set(values).where(eq(grades.id, id));
    else await db.insert(grades).values({ ...values, createdBy: userId });
  } catch (e) {
    if (pgCode(e) === "23505") return fail(`A grade called "${values.name}" already exists. If it's archived, restore it instead.`);
    throw e;
  }
  refresh();
  return ok();
}

/* ------------------------------------------------------------ materials */

const materialSchema = z
  .object({
    id: optionalId,
    name: name("material"),
    kind: z.enum(materialKind.enumValues),
    colour: z.enum(colour.enumValues).optional(),
    unit: z.string().trim().min(1, "Say what it's counted in, like sheets or spools.").max(20),
    leadDays: z.coerce.number().int("Lead time is a whole number of days.").min(0).max(365).catch(7),
  })
  .transform((v) => ({ ...v, colour: v.kind === "leather" ? (v.colour ?? "red") : null }));

async function materialInUse(id: string) {
  const r = await db.execute<{ used: boolean }>(sql`
    select exists(select 1 from purchases where material_id = ${id})
        or exists(select 1 from work_entries where leather_id = ${id})
        or exists(select 1 from stock_adjustments where material_id = ${id}) as used`);
  return Boolean(r.rows[0]?.used);
}

export async function saveMaterial(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = materialSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { id, ...values } = parsed.data;
  try {
    if (id) {
      const [current] = await db.select().from(materials).where(eq(materials.id, id));
      if (!current) return fail("That material no longer exists.");
      if ((current.kind !== values.kind || current.colour !== values.colour) && (await materialInUse(id))) {
        return fail("This material already has purchases or usage recorded, so its kind and colour can't change. Add a new material instead.");
      }
      await db.update(materials).set(values).where(eq(materials.id, id));
    } else {
      await db.insert(materials).values({ ...values, createdBy: userId });
    }
  } catch (e) {
    if (pgCode(e) === "23505") return fail(values.kind === "cork" ? "There's already a cork core material. Edit that one instead." : "That name is already taken.");
    throw e;
  }
  refresh();
  return ok();
}

/* ------------------------------------------------------------ suppliers */

const supplierSchema = z.object({ id: optionalId, name: name("supplier"), phone: optionalText, notes: optionalText });

export async function saveSupplier(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = supplierSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { id, ...values } = parsed.data;
  try {
    if (id) await db.update(suppliers).set(values).where(eq(suppliers.id, id));
    else await db.insert(suppliers).values({ ...values, createdBy: userId });
  } catch (e) {
    if (pgCode(e) === "23505") return fail(`A supplier called "${values.name}" already exists. If it's archived, restore it instead.`);
    throw e;
  }
  refresh();
  return ok();
}

/* ------------------------------------------------------ archive / restore */

// Used straight from a <form action>, so it returns nothing. Archiving hides an item from
// pickers without touching history; restoring brings it back.
export async function setArchived(fd: FormData): Promise<void> {
  await requireRole(["owner"]);
  const id = String(fd.get("id") ?? "");
  if (!z.uuid().safeParse(id).success) return;
  const archivedAt = fd.get("archive") === "1" ? new Date() : null;
  switch (fd.get("entity")) {
    case "ballType": await db.update(ballTypes).set({ archivedAt }).where(eq(ballTypes.id, id)); break;
    case "grade": await db.update(grades).set({ archivedAt }).where(eq(grades.id, id)); break;
    case "material": await db.update(materials).set({ archivedAt }).where(eq(materials.id, id)); break;
    case "supplier": await db.update(suppliers).set({ archivedAt }).where(eq(suppliers.id, id)); break;
    default: return;
  }
  refresh();
}

/* ------------------------------------------------------ factory settings */

const settingsSchema = z.object({
  workDays: z.coerce.number().pipe(z.union([z.literal(6), z.literal(7)])),
  payWeekday: z.coerce.number().int().min(0).max(6),
});

export async function saveSettings(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(["owner"]);
  const parsed = settingsSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  await db
    .insert(factorySettings)
    .values({ id: 1, ...parsed.data })
    .onConflictDoUpdate({ target: factorySettings.id, set: parsed.data });
  refresh();
  return ok();
}
