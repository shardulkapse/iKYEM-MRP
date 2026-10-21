"use server";

import { eq } from "drizzle-orm";
import { getSettings } from "@/lib/setup-queries";
import { todayInFactory } from "@/lib/dates";
import { isValidDay } from "@/lib/day";
import { lastPayday, paydayRows } from "@/lib/pay-queries";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { wagePayments } from "@/db/schema";
import { type ActionResult, fail, firstIssue, ok } from "@/lib/action-result";
import { requireRole } from "@/lib/auth";
import { RUPEES_PATTERN, toPaise } from "@/lib/money";

/* ------------------------------------------------------------ payments */

const amount = z.string().trim().regex(RUPEES_PATTERN, "Enter the amount in rupees, like 1200 or 741.50.");
const paidOnField = z.iso.date("Pick the date it was paid.");
const note = z.string().trim().max(300).optional().transform((v) => v || null);

async function checkPaidOn(paidOn: string) {
  return paidOn > (await todayInFactory()) ? "The payment date can't be in the future." : null;
}

export async function payWeekly(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = z.object({ workerId: z.uuid(), payday: z.iso.date(), amount, paidOn: paidOnField, note }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const bad = await checkPaidOn(v.paidOn);
  if (bad) return fail(bad);
  if (toPaise(v.amount) <= 0) return fail("The amount must be more than zero.");
  const inserted = await db.insert(wagePayments)
    .values({ workerId: v.workerId, kind: "weekly", payday: v.payday, amountPaise: toPaise(v.amount), paidOn: v.paidOn, note: v.note, createdBy: userId })
    .onConflictDoNothing().returning({ id: wagePayments.id });
  if (!inserted.length) return fail("This person is already marked paid for that payday.");
  refresh();
  return ok();
}

// Marks everyone still unpaid on a payday as paid, at the amounts worked out from the sheets.
export async function payEveryone(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const payday = String(fd.get("payday") ?? "");
  if (!isValidDay(payday)) return fail("That payday isn't valid.");
  const today = await todayInFactory();
  const settings = await getSettings();
  if (payday !== lastPayday(payday, settings.payWeekday)) return fail("That date isn't a payday.");
  const rows = (await paydayRows(payday, settings.weeklyOff)).filter((r) => !r.paid && r.due > 0);
  if (!rows.length) return fail("Nobody is left to pay on this payday.");
  const paidOn = payday <= today ? payday : today;
  await db.insert(wagePayments)
    .values(rows.map((r) => ({ workerId: r.worker.id, kind: "weekly" as const, payday, amountPaise: r.due, paidOn, createdBy: userId })))
    .onConflictDoNothing();
  refresh();
  return ok();
}

export async function paySalary(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = z.object({ workerId: z.uuid(), forMonth: z.string().regex(/^[0-9]{4}-[0-9]{2}$/, "Pick a month."), amount, paidOn: paidOnField, note }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const bad = await checkPaidOn(v.paidOn);
  if (bad) return fail(bad);
  if (toPaise(v.amount) <= 0) return fail("The amount must be more than zero.");
  const inserted = await db.insert(wagePayments)
    .values({ workerId: v.workerId, kind: "salary", forMonth: v.forMonth, amountPaise: toPaise(v.amount), paidOn: v.paidOn, note: v.note, createdBy: userId })
    .onConflictDoNothing().returning({ id: wagePayments.id });
  if (!inserted.length) return fail("This salary is already marked paid for that month.");
  refresh();
  return ok();
}

export async function giveAdvance(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = z.object({ workerId: z.uuid("Pick who the advance is for."), amount, paidOn: paidOnField, note }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const bad = await checkPaidOn(v.paidOn);
  if (bad) return fail(bad);
  if (toPaise(v.amount) <= 0) return fail("The amount must be more than zero.");
  await db.insert(wagePayments).values({ workerId: v.workerId, kind: "advance", amountPaise: toPaise(v.amount), paidOn: v.paidOn, note: v.note, createdBy: userId });
  refresh();
  return ok();
}

// Undo any wage payment or advance.
export async function deleteWagePayment(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(["owner"]);
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return fail("That payment no longer exists.");
  await db.delete(wagePayments).where(eq(wagePayments.id, id.data));
  refresh();
  return ok();
}
