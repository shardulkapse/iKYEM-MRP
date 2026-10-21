"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { expenses, loanPayments, loans } from "@/db/schema";
import { type ActionResult, fail, firstIssue, ok } from "@/lib/action-result";
import { requireRole } from "@/lib/auth";
import { todayInFactory } from "@/lib/dates";
import { EXPENSE_CATEGORIES } from "@/lib/labels";
import { RUPEES_PATTERN, toPaise } from "@/lib/money";


const rupees = (what: string) => z.string().trim().regex(RUPEES_PATTERN, `Enter ${what} in rupees, like 18000 or 1450.50.`);
const optionalId = z.union([z.uuid(), z.literal("")]).optional();
const note = z.string().trim().max(300).optional().transform((v) => v || null);
const notFuture = async (day: string) => (day > (await todayInFactory()) ? "The date can't be in the future." : null);

/* ------------------------------------------------------------ expenses */

export async function saveExpense(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = z.object({
    id: optionalId,
    category: z.enum(EXPENSE_CATEGORIES),
    amount: rupees("the amount"),
    spentOn: z.iso.date("Pick the date."),
    note,
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const bad = await notFuture(v.spentOn);
  if (bad) return fail(bad);
  if (toPaise(v.amount) <= 0) return fail("The amount must be more than zero.");
  const values = { category: v.category, amountPaise: toPaise(v.amount), spentOn: v.spentOn, note: v.note };
  if (v.id) await db.update(expenses).set(values).where(eq(expenses.id, v.id));
  else await db.insert(expenses).values({ ...values, createdBy: userId });
  refresh();
  return ok();
}

export async function deleteExpense(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(["owner"]);
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return fail("That expense no longer exists.");
  await db.delete(expenses).where(eq(expenses.id, id.data));
  refresh();
  return ok();
}

/* ------------------------------------------------------------ loans */

export async function saveLoan(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = z.object({
    id: optionalId,
    name: z.string().trim().min(1, "Give the loan a name.").max(80),
    lender: z.string().trim().max(80).optional().transform((v) => v || null),
    principal: rupees("the amount borrowed"),
    rate: z.string().trim().regex(/^(\d{1,2}(\.\d{1,2})?)?$/, "Enter the yearly interest rate, like 10.5, or leave it empty."),
    emi: z.union([rupees("the EMI"), z.literal("")]),
    takenOn: z.iso.date("Pick the date the loan was taken."),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  if (toPaise(v.principal) <= 0) return fail("The amount borrowed must be more than zero.");
  const values = { name: v.name, lender: v.lender, principalPaise: toPaise(v.principal), annualRatePct: v.rate || null, emiPaise: v.emi ? toPaise(v.emi) : null, takenOn: v.takenOn };
  if (v.id) await db.update(loans).set(values).where(eq(loans.id, v.id));
  else await db.insert(loans).values({ ...values, createdBy: userId });
  refresh();
  return ok();
}

export async function deleteLoan(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(["owner"]);
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return fail("That loan no longer exists.");
  const [hasPayment] = await db.select({ id: loanPayments.id }).from(loanPayments).where(eq(loanPayments.loanId, id.data)).limit(1);
  if (hasPayment) return fail("This loan has payments recorded. Delete those first if you really want to remove it.");
  await db.delete(loans).where(eq(loans.id, id.data));
  refresh();
  return ok();
}

export async function recordLoanPayment(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = z.object({ loanId: z.uuid(), amount: rupees("the amount"), paidOn: z.iso.date("Pick the date."), note }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const bad = await notFuture(v.paidOn);
  if (bad) return fail(bad);
  if (toPaise(v.amount) <= 0) return fail("The amount must be more than zero.");
  await db.insert(loanPayments).values({ loanId: v.loanId, amountPaise: toPaise(v.amount), paidOn: v.paidOn, note: v.note, createdBy: userId });
  refresh();
  return ok();
}

export async function deleteLoanPayment(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireRole(["owner"]);
  const id = z.uuid().safeParse(fd.get("id"));
  if (!id.success) return fail("That payment no longer exists.");
  await db.delete(loanPayments).where(eq(loanPayments.id, id.data));
  refresh();
  return ok();
}
