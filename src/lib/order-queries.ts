import "server-only";
import { type SQL, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { customers, deliveries, deliveryLines, orderLines, orders, receipts } from "@/db/schema";
import type { LocationType } from "@/lib/locations";
import { paging } from "@/lib/paging";
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

// Everything about the given orders (their lines, deliveries and payments), worked out in one
// pass, in the order the ids were given. Callers pick which orders they need, so a page never
// loads the whole history: open orders, orders still owing, or one page of delivered ones.
export async function loadOrders(ids: string[]): Promise<OrderView[]> {
  if (!ids.length) return [];
  const orderRows = await db.select().from(orders).where(inArray(orders.id, ids));
  const [customerRows, lineRows, deliveryRows, receiptRows] = await Promise.all([
    db.select().from(customers).where(inArray(customers.id, [...new Set(orderRows.map((o) => o.customerId))])),
    db.select().from(orderLines).where(inArray(orderLines.orderId, ids)),
    db.select().from(deliveries).where(inArray(deliveries.orderId, ids)).orderBy(asc(deliveries.deliveredOn), asc(deliveries.createdAt)),
    db.select().from(receipts).where(inArray(receipts.orderId, ids)).orderBy(asc(receipts.receivedOn), asc(receipts.createdAt)),
  ]);
  const dLineRows = deliveryRows.length ? await db.select().from(deliveryLines).where(inArray(deliveryLines.deliveryId, deliveryRows.map((d) => d.id))) : [];
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
  const position = new Map(ids.map((id, i) => [id, i]));

  return orderRows.sort((a, b) => position.get(a.id)! - position.get(b.id)!).map((o) => {
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

// One order, for the save, delete and delivery actions.
export async function loadOrder(id: string): Promise<OrderView | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return (await loadOrders([id]))[0] ?? null;
}

// Orders still being filled, earliest due first.
async function openOrderIds(): Promise<string[]> {
  const r = await db.select({ id: orders.id }).from(orders).where(eq(orders.status, "open")).orderBy(asc(orders.dueOn), asc(orders.createdAt));
  return r.map((x) => x.id);
}

// Orders with balls delivered but not yet paid for, longest waiting first.
async function owingOrderIds(): Promise<string[]> {
  const r = await db.execute<{ id: string }>(sql`
    select o.id from orders o
     where coalesce((select sum(l.qty * l.price_paise) from deliveries d join delivery_lines l on l.delivery_id = d.id where d.order_id = o.id), 0)
         > coalesce((select sum(r.amount_paise) from receipts r where r.order_id = o.id), 0)
     order by (select max(d.delivered_on) from deliveries d where d.order_id = o.id), o.created_at`);
  return r.rows.map((x) => x.id);
}

export async function ordersPageData() {
  const [openIds, owingIds, ready, wip, { types, grades }, customerRows, lastLoc, countries] = await Promise.all([
    openOrderIds(), owingOrderIds(), readyStockByTypeAndGrade(), wipByTypeAndBuffer(), activeTypesAndGrades(),
    db.select().from(customers).orderBy(asc(customers.name)),
    // each customer's latest location, to fill in when they order again
    db.execute<{ customer_id: string; location_type: LocationType; location_code: string }>(sql`
      select distinct on (customer_id) customer_id, location_type, location_code from orders
       where location_type is not null order by customer_id, created_at desc`),
    db.execute<{ code: string }>(sql`select distinct location_code as code from orders where location_type = 'international'`),
  ]);
  const loaded = await loadOrders([...new Set([...openIds, ...owingIds])]);
  const byId = new Map(loaded.map((o) => [o.id, o]));
  const open = openIds.map((id) => byId.get(id)!).filter(Boolean);
  const owing = owingIds.map((id) => byId.get(id)!).filter(Boolean);
  const inProduction: Record<string, number> = {};
  for (const [k, v] of wip) {
    const t = k.split("|")[0];
    inProduction[t] = (inProduction[t] ?? 0) + Math.max(0, v);
  }
  const lastLocation = new Map(lastLoc.rows.map((r) => [r.customer_id, { type: r.location_type, code: r.location_code }]));
  return {
    open, owing,
    check: checkStock(open, ready),
    ready: Object.fromEntries(ready),
    inProduction, types, grades,
    customers: customerRows.map((c) => ({ name: c.name, phone: c.phone, location: lastLocation.get(c.id) ?? null })),
    usedCountries: countries.rows.map((r) => r.code),
  };
}

/* ------------------------------------------------------------ delivered orders, a page at a time */

export type LocationFilter = { scope: "" | "unset" | LocationType; places: string[] };

function locationWhere(f: LocationFilter): SQL {
  if (!f.scope) return sql`true`;
  if (f.scope === "unset") return sql`o.location_type is null`;
  const places = f.places.length ? sql` and o.location_code in (${sql.join(f.places.map((p) => sql`${p}`), sql`, `)})` : sql``;
  return sql`o.location_type = ${f.scope}${places}`;
}

// The Delivered tab: orders completed in a period (last delivery in it), newest first, one page at
// a time, plus the period's totals for the same location filter, all worked out in the database.
// Balls and sales count every delivery in the period, part deliveries included.
export async function deliveredPage(from: string, to: string, f: LocationFilter, page: unknown) {
  const where = locationWhere(f);
  const completed = sql`
    from orders o join (select order_id, max(delivered_on) as last from deliveries group by order_id) d on d.order_id = o.id
    where o.status = 'closed' and d.last between ${from} and ${to} and ${where}`;
  const [count, sales, recs, places, unset] = await Promise.all([
    db.execute<{ n: number }>(sql`select count(*)::int as n ${completed}`),
    db.execute<{ balls: string; sales: string }>(sql`
      select coalesce(sum(l.qty), 0) as balls, coalesce(sum(l.qty * l.price_paise), 0) as sales
        from deliveries dd join delivery_lines l on l.delivery_id = dd.id join orders o on o.id = dd.order_id
       where dd.delivered_on between ${from} and ${to} and ${where}`),
    db.execute<{ cash: string; online: string }>(sql`
      select coalesce(sum(case when r.mode = 'cash' then r.amount_paise else 0 end), 0) as cash,
             coalesce(sum(case when r.mode = 'online' then r.amount_paise else 0 end), 0) as online
        from receipts r join orders o on o.id = r.order_id
       where r.received_on between ${from} and ${to} and ${where}`),
    db.execute<{ t: LocationType; code: string }>(sql`select distinct location_type as t, location_code as code from orders where location_type is not null`),
    db.execute<{ any: boolean }>(sql`select exists (select 1 from orders where location_type is null) as any`),
  ]);
  const p = paging(page, count.rows[0]?.n ?? 0);
  const ids = p.total
    ? (await db.execute<{ id: string }>(sql`select o.id ${completed} order by d.last desc, o.created_at desc limit ${p.size} offset ${p.offset}`)).rows.map((r) => r.id)
    : [];
  return {
    orders: await loadOrders(ids),
    paging: p,
    balls: Number(sales.rows[0]?.balls ?? 0),
    sales: Number(sales.rows[0]?.sales ?? 0),
    cash: Number(recs.rows[0]?.cash ?? 0),
    online: Number(recs.rows[0]?.online ?? 0),
    places: places.rows,
    hasUnset: Boolean(unset.rows[0]?.any),
  };
}
