"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { type ActionResult, fail, firstIssue, ok, pgCode } from "@/lib/action-result";
import { requireRole } from "@/lib/auth";

const customerSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Enter the customer's name.").max(120),
  phone: z.string().trim().max(30).transform((v) => v || null),
  notes: z.string().trim().max(1000).transform((v) => v || null),
});

// Saves a customer's name, phone and notes. Orders find their customer by name (ignoring capitals),
// so two customers can't share a name.
export async function saveCustomer(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole();
  const parsed = customerSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const [clash] = await db.select({ id: customers.id }).from(customers)
    .where(and(sql`lower(${customers.name}) = lower(${v.name})`, ne(customers.id, v.id)));
  if (clash) return fail(`Another customer is already called ${v.name}.`);
  try {
    const done = await db.update(customers).set({ name: v.name, phone: v.phone, notes: v.notes }).where(eq(customers.id, v.id)).returning({ id: customers.id });
    if (!done.length) return fail("That customer no longer exists.");
  } catch (e) {
    if (pgCode(e) === "23505") return fail(`Another customer is already called ${v.name}.`);
    throw e;
  }
  refresh();
  return ok();
}

// Removes a customer who has no orders (one left over after their only order was deleted).
export async function deleteCustomer(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole();
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return fail("That customer no longer exists.");
  const [used] = await db.select({ id: orders.id }).from(orders).where(eq(orders.customerId, id.data)).limit(1);
  if (used) return fail("This customer has orders, so they can't be deleted.");
  try {
    await db.delete(customers).where(eq(customers.id, id.data));
  } catch (e) {
    if (pgCode(e) === "23503") return fail("This customer has orders, so they can't be deleted.");
    throw e;
  }
  redirect("/customers");
}
