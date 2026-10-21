import "server-only";
import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, wagePayments, workEntries, workers } from "@/db/schema";
import { addDays, isWorkDay, weekdayOf } from "@/lib/day";

/* ------------------------------------------------------------ paydays */

export function lastPayday(ref: string, payWeekday: number): string {
  let d = ref;
  while (weekdayOf(d) !== payWeekday) d = addDays(d, -1);
  return d;
}
export function nextPayday(today: string, payWeekday: number): string {
  const last = lastPayday(today, payWeekday);
  return last === today ? last : addDays(last, 7);
}
// A payday pays for the factory's latest work week that has ended by then. The work week ends on
// the day before the weekly holiday, so with Wednesday off a Tuesday payday pays Thursday to that
// Tuesday, and a Wednesday or Thursday payday pays the Thursday-to-Tuesday just gone.
// With no weekly holiday it pays the seven days before the payday.
// from..to is always seven days (it includes the holiday, in case anyone worked it); firstDay is
// the first working day, for showing the period.
export function payPeriod(payday: string, weeklyOff: number | null) {
  if (weeklyOff == null) return { from: addDays(payday, -7), to: addDays(payday, -1), firstDay: addDays(payday, -7) };
  const lastDay = (weeklyOff + 6) % 7;
  let to = payday;
  while (weekdayOf(to) !== lastDay) to = addDays(to, -1);
  const from = addDays(to, -6);
  return { from, to, firstDay: isWorkDay(from, weeklyOff) ? from : addDays(from, 1) };
}

type Worker = typeof workers.$inferSelect;
const employedBetween = (w: Worker, from: string, to: string) => (!w.startedOn || w.startedOn <= to) && (!w.leftOn || w.leftOn >= from);

export type PaydayRow = {
  worker: Worker; due: number; earned: number; advances: number; days: number; pieces: number;
  paid: { id: string; amountPaise: number; paidOn: string } | null;
};

// What each person is owed on a payday, worked out from the daily sheets in its work week.
// Daily wage: days present (half days count 0.5) × rate. Per piece: every good piece logged
// against them at any stage × rate. Advances given that week come off. Salaried staff get their
// fixed weekly payout, and their advances come off the month-end salary instead.
export async function paydayRows(payday: string, weeklyOff: number | null): Promise<PaydayRow[]> {
  const { from, to } = payPeriod(payday, weeklyOff);
  const [ws, att, pieces, adv, paid] = await Promise.all([
    db.select().from(workers).orderBy(asc(workers.sortOrder), asc(workers.name)),
    db.select({ workerId: attendance.workerId, days: sql<string>`sum(case ${attendance.status} when 'present' then 1 when 'half' then 0.5 else 0 end)` })
      .from(attendance).where(and(gte(attendance.day, from), lte(attendance.day, to))).groupBy(attendance.workerId),
    db.select({ workerId: workEntries.workerId, pieces: sql<string>`sum(${workEntries.good})` })
      .from(workEntries).where(and(gte(workEntries.day, from), lte(workEntries.day, to), isNotNull(workEntries.workerId))).groupBy(workEntries.workerId),
    db.select({ workerId: wagePayments.workerId, total: sql<string>`sum(${wagePayments.amountPaise})` })
      .from(wagePayments).where(and(eq(wagePayments.kind, "advance"), gte(wagePayments.paidOn, from), lte(wagePayments.paidOn, to))).groupBy(wagePayments.workerId),
    db.select().from(wagePayments).where(and(eq(wagePayments.kind, "weekly"), eq(wagePayments.payday, payday))),
  ]);
  const daysBy = new Map(att.map((a) => [a.workerId, Number(a.days)]));
  const piecesBy = new Map(pieces.map((p) => [p.workerId!, Number(p.pieces)]));
  const advBy = new Map(adv.map((a) => [a.workerId, Number(a.total)]));
  const paidBy = new Map(paid.map((p) => [p.workerId, p]));
  return ws
    .filter((w) => employedBetween(w, from, to) || paidBy.has(w.id))
    .map((w) => {
      const days = daysBy.get(w.id) ?? 0;
      const pc = piecesBy.get(w.id) ?? 0;
      const advances = w.payType === "salary" ? 0 : (advBy.get(w.id) ?? 0);
      const earned = w.payType === "daily" ? Math.round(days * w.ratePaise) : w.payType === "piece" ? pc * w.ratePaise : (w.weeklyPayoutPaise ?? 0);
      const p = paidBy.get(w.id);
      return { worker: w, days, pieces: pc, advances, earned, due: Math.max(0, earned - advances), paid: p ? { id: p.id, amountPaise: p.amountPaise, paidOn: p.paidOn } : null };
    });
}

/* ------------------------------------------------------------ month-end salary */

export type SalaryRow = {
  worker: Worker; salary: number; weekly: number; advances: number; balance: number;
  paid: { id: string; amountPaise: number; paidOn: string } | null;
};

// Salary minus the weekly payouts made on paydays in that month, minus advances given that month.
export async function salaryRows(month: string): Promise<SalaryRow[]> {
  const from = `${month}-01`;
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const [ws, weekly, adv, paid] = await Promise.all([
    db.select().from(workers).where(eq(workers.payType, "salary")).orderBy(asc(workers.sortOrder), asc(workers.name)),
    db.select({ workerId: wagePayments.workerId, total: sql<string>`sum(${wagePayments.amountPaise})` })
      .from(wagePayments).where(and(eq(wagePayments.kind, "weekly"), gte(wagePayments.payday, from), lte(wagePayments.payday, to))).groupBy(wagePayments.workerId),
    db.select({ workerId: wagePayments.workerId, total: sql<string>`sum(${wagePayments.amountPaise})` })
      .from(wagePayments).where(and(eq(wagePayments.kind, "advance"), gte(wagePayments.paidOn, from), lte(wagePayments.paidOn, to))).groupBy(wagePayments.workerId),
    db.select().from(wagePayments).where(and(eq(wagePayments.kind, "salary"), eq(wagePayments.forMonth, month))),
  ]);
  const weeklyBy = new Map(weekly.map((x) => [x.workerId, Number(x.total)]));
  const advBy = new Map(adv.map((x) => [x.workerId, Number(x.total)]));
  const paidBy = new Map(paid.map((p) => [p.workerId, p]));
  return ws
    .filter((w) => employedBetween(w, from, to) || paidBy.has(w.id))
    .map((w) => {
      const wk = weeklyBy.get(w.id) ?? 0, a = advBy.get(w.id) ?? 0;
      const p = paidBy.get(w.id);
      return { worker: w, salary: w.ratePaise, weekly: wk, advances: a, balance: w.ratePaise - wk - a, paid: p ? { id: p.id, amountPaise: p.amountPaise, paidOn: p.paidOn } : null };
    });
}

/* ------------------------------------------------------------ advances */

export async function recentAdvances(since: string) {
  return db
    .select({ id: wagePayments.id, paidOn: wagePayments.paidOn, amountPaise: wagePayments.amountPaise, note: wagePayments.note, name: workers.name, payType: workers.payType })
    .from(wagePayments)
    .innerJoin(workers, eq(workers.id, wagePayments.workerId))
    .where(and(eq(wagePayments.kind, "advance"), gte(wagePayments.paidOn, since)))
    .orderBy(desc(wagePayments.paidOn), desc(wagePayments.createdAt));
}
