import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { customers, deliveries, deliveryLines, orderLines, orders, receipts } from "@/db/schema";
import type { LocationType } from "@/lib/locations";
import { activeTypesAndGrades, readyStockByTypeAndGrade, wipByTypeAndBuffer } from "@/lib/queries";

export const lineKey = (ballTypeId: string, gradeId: string) => `${ballTypeId}|${gradeId}`;

export type OrderView = {
  id: string; customerId: string; customer: string; phone: string | null; dueOn: string; status: "open" | "closed"; notes: string | null; createdAt: string;
  locationType: LocationType | null; locationCode: string | null; locationNote: string | null;
  lines: { id: string; ballTypeId: string; gradeId: string; qty: number; pricePaise: number }[];
  ordered: Record<string, number>; delivered: Record<string, number>; remaining: Record<string, number>;
  deliveries: { id: string; deliveredOn: string; lines: { ballTypeId: string; gradeId: string; qty: number; pricePaise: number }[]; valuePaise: number }[];
  receipts: { id: string; receivedOn: string; amountPaise: number; mode: "cash" | "online"; note: string | null }[];
  valuePaise: number; deliveredValuePaise: number; receivedPaise: number; owedPaise: number; balancePaise: number;
  ballsOrdered: number; ballsDelivered: number; lastDelivery: string | null;
};

// Everything about every order, worked out in one pass. The business has hundreds of orders a
// year, not millions, so loading them all keeps the logic simple and in one place.
export async function loadOrders(): Promise<OrderView[]> {
  const [orderRows, customerRows, lineRows, deliveryRows, dLineRows, receiptRows] = await Promise.all([
    db.select().from(orders),
    db.select().from(customers),
    db.select().from(orderLines),
    db.select().from(deliveries).orderBy(asc(deliveries.deliveredOn), asc(deliveries.createdAt)),
    db.select().from(deliveryLines),
    db.select().from(receipts).orderBy(asc(receipts.receivedOn), asc(receipts.createdAt)),
  ]);
  const customerById = new Map(customerRows.map((c) => [c.id, c]));
  const group = <T, K>(rows: T[], key: (r: T) => K) => {
    const m = new Map<K, T[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  const linesBy = group(lineRows, (l) => l.orderId);
  const dLinesBy = group(dLineRows, (l) => l.deliveryId);
  const deliveriesBy = group(deliveryRows, (d) => d.orderId);
  const receiptsBy = group(receiptRows, (r) => r.orderId);

  return orderRows.map((o) => {
    const lines = (linesBy.get(o.id) ?? []).map((l) => ({ id: l.id, ballTypeId: l.ballTypeId, gradeId: l.gradeId, qty: l.qty, pricePaise: l.pricePaise }));
    const dels = (deliveriesBy.get(o.id) ?? []).map((d) => {
      const dl = (dLinesBy.get(d.id) ?? []).map((l) => ({ ballTypeId: l.ballTypeId, gradeId: l.gradeId, qty: l.qty, pricePaise: l.pricePaise }));
      return { id: d.id, deliveredOn: d.deliveredOn, lines: dl, valuePaise: dl.reduce((a, l) => a + l.qty * l.pricePaise, 0) };
    });
    const recs = (receiptsBy.get(o.id) ?? []).map((r) => ({ id: r.id, receivedOn: r.receivedOn, amountPaise: r.amountPaise, mode: r.mode, note: r.note }));
    const ordered: Record<string, number> = {}, delivered: Record<string, number> = {}, remaining: Record<string, number> = {};
    for (const l of lines) ordered[lineKey(l.ballTypeId, l.gradeId)] = (ordered[lineKey(l.ballTypeId, l.gradeId)] ?? 0) + l.qty;
    for (const d of dels) for (const l of d.lines) delivered[lineKey(l.ballTypeId, l.gradeId)] = (delivered[lineKey(l.ballTypeId, l.gradeId)] ?? 0) + l.qty;
    for (const k of Object.keys(ordered)) remaining[k] = Math.max(0, ordered[k] - (delivered[k] ?? 0));
    const valuePaise = lines.reduce((a, l) => a + l.qty * l.pricePaise, 0);
    const deliveredValuePaise = dels.reduce((a, d) => a + d.valuePaise, 0);
    const receivedPaise = recs.reduce((a, r) => a + r.amountPaise, 0);
    const c = customerById.get(o.customerId);
    return {
      id: o.id, customerId: o.customerId, customer: c?.name ?? "(removed customer)", phone: c?.phone ?? null, dueOn: o.dueOn, status: o.status, notes: o.notes,
      locationType: o.locationType, locationCode: o.locationCode, locationNote: o.locationNote,
      createdAt: o.createdAt.toISOString(),
      lines, ordered, delivered, remaining, deliveries: dels, receipts: recs,
      valuePaise, deliveredValuePaise, receivedPaise,
      owedPaise: Math.max(0, deliveredValuePaise - receivedPaise),
      balancePaise: Math.max(0, (o.status === "closed" ? deliveredValuePaise : valuePaise) - receivedPaise),
      ballsOrdered: lines.reduce((a, l) => a + l.qty, 0),
      ballsDelivered: dels.reduce((a, d) => a + d.lines.reduce((b, l) => b + l.qty, 0), 0),
      lastDelivery: dels.at(-1)?.deliveredOn ?? null,
    };
  });
}

export type StockCheck = { need: number; ready: number; short: number; lines: Record<string, { need: number; ready: number; short: number }> };

// Ready stock is set aside for open orders in due-date order: the earliest order gets first claim.
export function checkStock(open: OrderView[], ready: Map<string, number>): Record<string, StockCheck> {
  const pool = new Map([...ready].map(([k, v]) => [k, Math.max(0, v)]));
  const out: Record<string, StockCheck> = {};
  for (const o of [...open].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.createdAt.localeCompare(b.createdAt))) {
    const r: StockCheck = { need: 0, ready: 0, short: 0, lines: {} };
    for (const [k, need] of Object.entries(o.remaining)) {
      const have = Math.min(need, pool.get(k) ?? 0);
      pool.set(k, (pool.get(k) ?? 0) - have);
      r.lines[k] = { need, ready: have, short: need - have };
      r.need += need; r.ready += have; r.short += need - have;
    }
    out[o.id] = r;
  }
  return out;
}

export async function ordersPageData() {
  const [all, ready, wip, { types, grades }, customerRows] = await Promise.all([
    loadOrders(), readyStockByTypeAndGrade(), wipByTypeAndBuffer(), activeTypesAndGrades(), db.select().from(customers).orderBy(asc(customers.name)),
  ]);
  const open = all.filter((o) => o.status === "open").sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const inProduction: Record<string, number> = {};
  for (const [k, v] of wip) {
    const t = k.split("|")[0];
    inProduction[t] = (inProduction[t] ?? 0) + Math.max(0, v);
  }
  // Each customer's latest location, to fill in when they order again.
  const lastLocation = new Map<string, { type: LocationType; code: string }>();
  for (const o of [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (o.locationType && o.locationCode) lastLocation.set(o.customerId, { type: o.locationType, code: o.locationCode });
  }
  return {
    all, open,
    check: checkStock(open, ready),
    ready: Object.fromEntries(ready),
    inProduction, types, grades,
    customers: customerRows.map((c) => ({ name: c.name, phone: c.phone, location: lastLocation.get(c.id) ?? null })),
  };
}
