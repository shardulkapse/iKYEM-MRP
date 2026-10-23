"use server";

import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { customers, deliveries, deliveryLines, orderLines, orders, paymentMode, receipts } from "@/db/schema";
import { type ActionResult, fail, firstIssue, ok } from "@/lib/action-result";
import { requireRole } from "@/lib/auth";
import { todayInFactory } from "@/lib/dates";
import { RUPEES_PATTERN, toPaise } from "@/lib/money";
import { isPlace } from "@/lib/locations";
import { lineKey, loadOrders } from "@/lib/order-queries";

const rupees = (what: string) => z.string().trim().regex(RUPEES_PATTERN, `Enter ${what} in rupees, like 540 or 540.50.`);
const batch = (ops: BatchItem<"pg">[]) => db.batch(ops as [BatchItem<"pg">, ...BatchItem<"pg">[]]);

async function findOrCreateCustomer(name: string, phone: string, userId: string) {
  const [found] = await db.select().from(customers).where(sql`lower(${customers.name}) = lower(${name})`);
  if (found) {
    if (phone && phone !== found.phone) await db.update(customers).set({ phone }).where(eq(customers.id, found.id));
    return found.id;
  }
  const [created] = await db.insert(customers).values({ name, phone: phone || null, createdBy: userId }).returning({ id: customers.id });
  return created.id;
}

/* ------------------------------------------------------------ create / edit */

const orderSchema = z.object({
  id: z.uuid().nullable(),
  customer: z.string().trim().min(1, "Enter the customer's name.").max(120),
  phone: z.string().trim().max(30),
  dueOn: z.iso.date("Pick a due date."),
  notes: z.string().trim().max(500),
  locationType: z.enum(["domestic", "international"], "Choose whether the order is domestic or international."),
  locationCode: z.string().trim(),
  locationNote: z.string().trim().max(500),
  lines: z
    .array(
      z.object({
        ballTypeId: z.uuid("Pick a ball type on every line."),
        gradeId: z.uuid("Pick a grade on every line."),
        qty: z.number().int("Quantities are whole balls.").min(1, "Every line needs at least 1 ball.").max(1_000_000),
        price: rupees("each line's price per ball"),
      }),
    )
    .min(1, "Add at least one line of balls.")
    .max(50),
}).superRefine((v, ctx) => {
  if (!isPlace(v.locationType, v.locationCode)) {
    ctx.addIssue({ code: "custom", message: v.locationType === "domestic" ? "Choose the state." : "Choose the country." });
  }
});

export async function saveOrder(input: unknown): Promise<ActionResult> {
  const { userId } = await requireRole();
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;

  let status: "open" | "closed" = "open";
  if (v.id) {
    const existing = (await loadOrders()).find((o) => o.id === v.id);
    if (!existing) return fail("That order no longer exists.");
    const newOrdered: Record<string, number> = {};
    for (const l of v.lines) newOrdered[lineKey(l.ballTypeId, l.gradeId)] = (newOrdered[lineKey(l.ballTypeId, l.gradeId)] ?? 0) + l.qty;
    for (const [k, sent] of Object.entries(existing.delivered)) {
      if ((newOrdered[k] ?? 0) < sent) return fail(`You've already delivered ${sent} of one of these lines, so it can't be less than ${sent} or removed.`);
    }
    if (existing.deliveries.length && Object.entries(newOrdered).every(([k, q]) => q <= (existing.delivered[k] ?? 0))) status = "closed";
  }

  const customerId = await findOrCreateCustomer(v.customer, v.phone, userId);
  const id = v.id ?? crypto.randomUUID();
  const fields = { customerId, dueOn: v.dueOn, notes: v.notes || null, status, locationType: v.locationType, locationCode: v.locationCode, locationNote: v.locationNote || null };
  await batch([
    v.id ? db.update(orders).set(fields).where(eq(orders.id, id)) : db.insert(orders).values({ id, ...fields, createdBy: userId }),
    db.delete(orderLines).where(eq(orderLines.orderId, id)),
    db.insert(orderLines).values(v.lines.map((l) => ({ orderId: id, ballTypeId: l.ballTypeId, gradeId: l.gradeId, qty: l.qty, pricePaise: toPaise(l.price) }))),
  ]);
  refresh();
  return ok();
}

export async function deleteOrder(id: string): Promise<ActionResult> {
  await requireRole();
  const order = (await loadOrders()).find((o) => o.id === id);
  if (!order) return fail("That order no longer exists.");
  if (order.deliveries.length || order.receipts.length) return fail("This order has deliveries or payments recorded, so it can't be deleted.");
  await db.delete(orders).where(eq(orders.id, id)); // its lines go with it
  refresh();
  return ok();
}

/* ------------------------------------------------------------ deliveries */

const deliverySchema = z.object({
  orderId: z.uuid(),
  deliveredOn: z.iso.date("Pick the delivery date."),
  lines: z.array(z.object({ ballTypeId: z.uuid(), gradeId: z.uuid(), qty: z.number().int("Quantities are whole balls.").min(0), price: rupees("the price per ball") })).max(50),
  paid: z.union([rupees("the amount paid"), z.literal("")]),
  mode: z.enum(paymentMode.enumValues),
});

export async function recordDelivery(input: unknown): Promise<ActionResult> {
  const { userId } = await requireRole();
  const parsed = deliverySchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  if (v.deliveredOn > (await todayInFactory())) return fail("The delivery date can't be in the future.");
  const order = (await loadOrders()).find((o) => o.id === v.orderId);
  if (!order) return fail("That order no longer exists.");
  if (order.status === "closed") return fail("Everything on this order is already delivered.");

  const lines = v.lines.filter((l) => l.qty > 0);
  if (!lines.length) return fail("Enter how many balls you delivered.");
  const sending: Record<string, number> = {};
  for (const l of lines) sending[lineKey(l.ballTypeId, l.gradeId)] = (sending[lineKey(l.ballTypeId, l.gradeId)] ?? 0) + l.qty;
  for (const [k, q] of Object.entries(sending)) {
    const left = order.remaining[k];
    if (left == null) return fail("One of the delivered lines isn't on this order.");
    if (q > left) return fail(`Only ${left} of one line are left to deliver on this order.`);
  }
  const closes = Object.entries(order.remaining).every(([k, left]) => (sending[k] ?? 0) >= left);

  const deliveryId = crypto.randomUUID();
  const ops: BatchItem<"pg">[] = [
    db.insert(deliveries).values({ id: deliveryId, orderId: order.id, deliveredOn: v.deliveredOn, createdBy: userId }),
    db.insert(deliveryLines).values(lines.map((l) => ({ deliveryId, ballTypeId: l.ballTypeId, gradeId: l.gradeId, qty: l.qty, pricePaise: toPaise(l.price) }))),
  ];
  if (v.paid && toPaise(v.paid) > 0) {
    ops.push(db.insert(receipts).values({ orderId: order.id, receivedOn: v.deliveredOn, amountPaise: toPaise(v.paid), mode: v.mode, note: "Paid on delivery", createdBy: userId }));
  }
  if (closes) ops.push(db.update(orders).set({ status: "closed" }).where(eq(orders.id, order.id)));
  await batch(ops);
  refresh();
  return ok();
}

export async function undoDelivery(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(["owner"]);
  const id = z.uuid().safeParse(fd.get("deliveryId"));
  if (!id.success) return fail("That delivery no longer exists.");
  const [d] = await db.select().from(deliveries).where(eq(deliveries.id, id.data));
  if (!d) return fail("That delivery no longer exists.");
  await batch([
    db.delete(deliveries).where(eq(deliveries.id, d.id)), // its lines go with it
    db.update(orders).set({ status: "open" }).where(eq(orders.id, d.orderId)),
  ]);
  refresh();
  return ok();
}

/* ------------------------------------------------------------ payments */

const paymentSchema = z.object({
  orderId: z.uuid(),
  amount: rupees("the amount received"),
  receivedOn: z.iso.date("Pick the date it was received."),
  mode: z.enum(paymentMode.enumValues),
  note: z.string().trim().max(300).optional(),
});

export async function recordPayment(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole();
  const parsed = paymentSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  if (toPaise(v.amount) <= 0) return fail("The amount must be more than zero.");
  if (v.receivedOn > (await todayInFactory())) return fail("The date can't be in the future.");
  await db.insert(receipts).values({ orderId: v.orderId, receivedOn: v.receivedOn, amountPaise: toPaise(v.amount), mode: v.mode, note: v.note || null, createdBy: userId });
  refresh();
  return ok();
}

export async function deleteReceipt(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(["owner"]);
  const id = z.uuid().safeParse(fd.get("receiptId"));
  if (!id.success) return fail("That payment no longer exists.");
  await db.delete(receipts).where(eq(receipts.id, id.data));
  refresh();
  return ok();
}
