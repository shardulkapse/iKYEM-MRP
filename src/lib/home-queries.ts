import "server-only";
import { cache } from "react";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { daySheets } from "@/db/schema";
import { addDays, dayLong, dayShort, isWorkDay } from "@/lib/day";
import { loadNegatives } from "@/lib/day-queries";
import { formatRupees } from "@/lib/money";
import { ordersPageData } from "@/lib/order-queries";
import { lastPayday, nextPayday, paydayRows } from "@/lib/pay-queries";
import { getSettings } from "@/lib/setup-queries";
import { STAGE_BY_ID, type StageId } from "@/lib/stages";
import { materialCards } from "@/lib/stock-queries";

// One order lookup per page load, shared by the alerts and the next-deliveries list.
export const homeOrders = cache(() => ordersPageData());

export type Alert = { tone: "bad" | "warn"; text: string; sub: string; href: string };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// Working days with no daily sheet, from the first sheet ever (at most 60 days back) to yesterday.
export async function missingDays(today: string, workDays: number): Promise<string[]> {
  const [[first], recent] = await Promise.all([
    db.select({ d: sql<string | null>`min(${daySheets.day})::text` }).from(daySheets),
    db.select({ day: daySheets.day }).from(daySheets).where(and(gte(daySheets.day, addDays(today, -60)), lte(daySheets.day, today))),
  ]);
  if (!first?.d) return [];
  const filled = new Set(recent.map((r) => r.day));
  const out: string[] = [];
  for (let d = first.d > addDays(today, -60) ? first.d : addDays(today, -60); d < today; d = addDays(d, 1)) if (isWorkDay(d, workDays) && !filled.has(d)) out.push(d);
  return out;
}

// Everything on Home in one go. Money items (payday, what's left this month) are owner only;
// stock, orders and missing days show to the manager too.
export async function homeData(today: string, owner: boolean) {
  const settings = await getSettings();
  const next = nextPayday(today, settings.payWeekday);
  const last = lastPayday(addDays(today, -1), settings.payWeekday);
  const [cards, orders, missing, negatives, nextRows, lastRows] = await Promise.all([
    materialCards(today),
    homeOrders(),
    missingDays(today, settings.workDays),
    loadNegatives(),
    owner ? paydayRows(next) : Promise.resolve([]),
    owner && last !== next ? paydayRows(last) : Promise.resolve([]),
  ]);

  const alerts: Alert[] = [];
  if (negatives.length) alerts.push({ tone: "bad", text: "Some counts are below zero", sub: negatives[0] + (negatives.length > 1 ? ` (and ${negatives.length - 1} more)` : ""), href: "/today" });
  for (const o of orders.open.filter((o) => o.dueOn < today)) {
    alerts.push({ tone: "bad", text: `${o.customer} order is late`, sub: `Was due ${dayShort(o.dueOn)}`, href: "/orders" });
  }
  for (const o of orders.open.filter((o) => o.dueOn >= today && daysBetween(today, o.dueOn) <= 7 && (orders.check[o.id]?.short ?? 0) > 0)) {
    alerts.push({ tone: "warn", text: `${o.customer} needs ${orders.check[o.id].short} more balls`, sub: `Due ${dayShort(o.dueOn)}, not enough in ready stock`, href: "/orders" });
  }
  for (const o of orders.all.filter((o) => o.owedPaise > 0 && o.lastDelivery && daysBetween(o.lastDelivery, today) > 30)) {
    alerts.push({ tone: "bad", text: `${o.customer} owes ${formatRupees(o.owedPaise)}`, sub: `Delivered ${daysBetween(o.lastDelivery!, today)} days ago`, href: "/orders?tab=collect" });
  }
  for (const c of cards.filter((c) => c.kind !== "other" && c.status !== "ok")) {
    alerts.push(c.status === "now"
      ? { tone: "bad", text: `Buy ${c.name.toLowerCase()} now`, sub: c.onHand <= 0 ? "None left in stock" : `About ${Math.floor(c.coverDays ?? 0)} working days left`, href: "/stock?tab=materials" }
      : { tone: "warn", text: `Buy ${c.name.toLowerCase()} by ${dayShort(c.buyBy!)}`, sub: `About ${Math.floor(c.coverDays ?? 0)} working days left`, href: "/stock?tab=materials" });
  }
  if (owner) {
    const due = nextRows.filter((r) => !r.paid && r.due > 0);
    if (due.length && daysBetween(today, next) <= 1) {
      alerts.push({ tone: "warn", text: `Payday ${next === today ? "today" : "tomorrow"}: ${formatRupees(due.reduce((a, r) => a + r.due, 0))}`, sub: `${due.length} ${due.length === 1 ? "person" : "people"} to pay`, href: `/pay?payday=${next}` });
    }
    const missed = lastRows.filter((r) => !r.paid && r.due > 0);
    if (missed.length) {
      alerts.push({ tone: "bad", text: `${dayShort(last)} payday not fully paid`, sub: `${missed.length} ${missed.length === 1 ? "person" : "people"}, ${formatRupees(missed.reduce((a, r) => a + r.due, 0))}`, href: `/pay?payday=${last}` });
    }
  }
  if (missing.length) {
    alerts.push({ tone: "warn", text: `${missing.length} working ${missing.length === 1 ? "day" : "days"} not filled in`, sub: `The first is ${dayLong(missing[0])}`, href: `/today?date=${missing[0]}` });
  }

  return { alerts, orders };
}

// How fast the factory is going: balls off seam stitching per working day, and what one person
// usually does in a day at each stage (last 30 days).
export async function factoryPace(today: string) {
  const from = addDays(today, -29);
  const [finished, perStage] = await Promise.all([
    db.execute<{ balls: string; days: number }>(sql`
      select coalesce((select sum(good) from work_entries where stage in ('hand_seam_stitching', 'machine_closing_seam') and day between ${from} and ${today}), 0) as balls,
             (select count(*)::int from day_sheets where not closed and day between ${from} and ${today}) as days`),
    db.execute<{ stage: StageId; per_person: string }>(sql`
      select stage, sum(good)::float / count(distinct (day, worker_id)) as per_person
        from work_entries where worker_id is not null and stage <> 'cutting' and day between ${from} and ${today}
       group by stage`),
  ]);
  const f = finished.rows[0];
  return {
    perDay: f && f.days ? Number(f.balls) / f.days : null,
    days: f?.days ?? 0,
    stages: perStage.rows.map((r) => ({ stage: STAGE_BY_ID[r.stage], perPerson: Number(r.per_person) })),
  };
}

export async function sheetFilledToday(today: string) {
  const [row] = await db.select({ day: daySheets.day }).from(daySheets).where(eq(daySheets.day, today));
  return !!row;
}
