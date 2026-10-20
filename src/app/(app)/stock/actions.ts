"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { ballTypes, grades, materialOnHand, purchases, readyStock, stockAdjustments, suppliers, wipBuffer, wipLevels } from "@/db/schema";
import { type ActionResult, fail, firstIssue, ok } from "@/lib/action-result";
import { requireRole } from "@/lib/auth";
import { todayInFactory } from "@/lib/dates";
import { RUPEES_PATTERN, toPaise } from "@/lib/money";
import { STAGES, stageAppliesTo, type Buffer } from "@/lib/stages";

const QTY = /^\d+(\.\d{1,3})?$/;

/* ------------------------------------------------------------ purchases */

const purchaseSchema = z.object({
  materialId: z.uuid("Pick a material."),
  supplierId: z.union([z.uuid(), z.literal("")]).optional(),
  newSupplier: z.string().trim().max(80).optional(),
  receivedOn: z.iso.date("Enter the date it arrived."),
  qty: z.string().trim().regex(QTY, "Enter the quantity, like 12 or 12.5."),
  price: z.string().trim().regex(RUPEES_PATTERN, "Enter the price per unit in rupees, like 1450 or 38.50."),
  note: z.string().trim().max(300).optional(),
});

export async function recordPurchase(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = purchaseSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  if (Number(v.qty) <= 0) return fail("The quantity must be more than zero.");
  if (v.receivedOn > (await todayInFactory())) return fail("The arrival date can't be in the future.");

  let supplierId = v.supplierId || null;
  if (v.newSupplier) {
    const [found] = await db.select({ id: suppliers.id }).from(suppliers).where(sql`lower(${suppliers.name}) = lower(${v.newSupplier})`);
    if (found) supplierId = found.id;
    else [{ id: supplierId }] = await db.insert(suppliers).values({ name: v.newSupplier, createdBy: userId }).returning({ id: suppliers.id });
  }
  await db.insert(purchases).values({
    materialId: v.materialId, supplierId, receivedOn: v.receivedOn, qty: v.qty, pricePaise: toPaise(v.price), note: v.note || null, createdBy: userId,
  });
  refresh();
  return ok();
}

export async function deletePurchase(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(["owner"]);
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return fail("That purchase no longer exists.");
  await db.delete(purchases).where(eq(purchases.id, id.data));
  refresh();
  return ok();
}

/* ------------------------------------------------------------ count corrections */
// A correction records the difference between what you counted and what the app thought,
// worked out at the moment you save, so it's right even if other entries landed meanwhile.

export async function correctMaterial(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = z.object({
    materialId: z.uuid(),
    counted: z.string().trim().regex(QTY, "Enter what you counted, like 14 or 5.5."),
    note: z.string().trim().max(300).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const [row] = await db.select({ qty: materialOnHand.qty }).from(materialOnHand).where(eq(materialOnHand.materialId, v.materialId));
  const delta = Number(v.counted) - Number(row?.qty ?? 0);
  if (Math.abs(delta) >= 0.0005) {
    await db.insert(stockAdjustments).values({
      day: await todayInFactory(), target: "material", materialId: v.materialId, delta: delta.toFixed(3), note: v.note || "Stock count", createdBy: userId,
    });
  }
  refresh();
  return ok();
}

const countField = z.string().trim().regex(/^\d+$/, "Counts are whole balls, zero or more.");

export async function correctReadyStock(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const ballTypeId = z.uuid().safeParse(fd.get("ballTypeId"));
  if (!ballTypeId.success) return fail("That ball type no longer exists.");
  const [current, gradeList] = await Promise.all([
    db.select().from(readyStock).where(eq(readyStock.ballTypeId, ballTypeId.data)),
    db.select({ id: grades.id }).from(grades),
  ]);
  const now = new Map(current.map((r) => [r.gradeId, Number(r.qty ?? 0)]));
  const day = await todayInFactory();
  const rows = [];
  for (const g of gradeList) {
    const raw = fd.get(`g_${g.id}`);
    if (raw == null) continue;
    const c = countField.safeParse(raw);
    if (!c.success) return fail(firstIssue(c.error));
    const delta = Number(c.data) - (now.get(g.id) ?? 0);
    if (delta) rows.push({ day, target: "ready_stock" as const, ballTypeId: ballTypeId.data, gradeId: g.id, delta: String(delta), note: "Stock count", createdBy: userId });
  }
  if (rows.length) await db.insert(stockAdjustments).values(rows);
  refresh();
  return ok();
}

export async function correctWip(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const ballTypeId = z.uuid().safeParse(fd.get("ballTypeId"));
  if (!ballTypeId.success) return fail("That ball type no longer exists.");
  const [type] = await db.select().from(ballTypes).where(eq(ballTypes.id, ballTypeId.data));
  if (!type) return fail("That ball type no longer exists.");
  const buffers = new Set<Buffer>(STAGES.filter((s) => stageAppliesTo(s, type)).map((s) => s.addsTo));
  const current = await db.select().from(wipLevels).where(eq(wipLevels.ballTypeId, type.id));
  const now = new Map(current.map((r) => [r.buffer, Number(r.qty ?? 0)]));
  const day = await todayInFactory();
  const rows = [];
  for (const b of wipBuffer.enumValues) {
    if (!buffers.has(b)) continue;
    const raw = fd.get(`b_${b}`);
    if (raw == null) continue;
    const c = countField.safeParse(raw);
    if (!c.success) return fail(firstIssue(c.error));
    const delta = Number(c.data) - (now.get(b) ?? 0);
    if (delta) rows.push({ day, target: "wip" as const, ballTypeId: type.id, buffer: b, delta: String(delta), note: "Stock count", createdBy: userId });
  }
  if (rows.length) await db.insert(stockAdjustments).values(rows);
  refresh();
  return ok();
}

