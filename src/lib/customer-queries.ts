import "server-only";
import { type SQL, sql } from "drizzle-orm";
import { db } from "@/db";
import type { LocationType } from "@/lib/locations";
import { loadOrders } from "@/lib/order-queries";
import { paging } from "@/lib/paging";

// Customers and what they've bought. Every figure comes from orders, deliveries and payments:
//   bought   = value of balls delivered to them (all time)
//   received = payments recorded against their orders
//   owes     = per order, delivered value less payments, never below zero (an advance on one
//              order doesn't cancel what's owed on another, same as Money to collect)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One row per order with its delivered balls and value, payments and what's owed on it.
const PER_ORDER = sql`
  per_order as (
    select o.id, o.customer_id, o.status, o.ordered_on,
           coalesce(dv.balls, 0) as balls, coalesce(dv.value, 0) as value, coalesce(rc.amt, 0) as received,
           greatest(coalesce(dv.value, 0) - coalesce(rc.amt, 0), 0) as owed
      from orders o
      left join (select d.order_id, sum(l.qty) as balls, sum(l.qty * l.price_paise) as value
                   from deliveries d join delivery_lines l on l.delivery_id = d.id group by d.order_id) dv on dv.order_id = o.id
      left join (select order_id, sum(amount_paise) as amt from receipts group by order_id) rc on rc.order_id = o.id
  ),
  last_loc as (
    select distinct on (customer_id) customer_id, location_type, location_code, location_note
      from orders where location_type is not null order by customer_id, ordered_on desc, created_at desc
  )`;

export type CustomerSort = "name" | "owes" | "bought" | "recent";
export const CUSTOMER_SORTS: { key: CustomerSort; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "owes", label: "Owes the most" },
  { key: "bought", label: "Bought the most" },
  { key: "recent", label: "Ordered most recently" },
];
export const isCustomerSort = (v: unknown): v is CustomerSort => CUSTOMER_SORTS.some((s) => s.key === v);

const ORDER_BY: Record<CustomerSort, SQL> = {
  name: sql`lower(c.name)`,
  owes: sql`owed desc, lower(c.name)`,
  bought: sql`bought desc, lower(c.name)`,
  recent: sql`last_order desc nulls last, lower(c.name)`,
};

export type CustomerRow = {
  id: string; name: string; phone: string | null;
  orders: number; open: number; balls: number; bought: number; received: number; owed: number;
  lastOrder: string | null; locationType: LocationType | null; locationCode: string | null;
};

// The customers list: search by name or phone, sorted, a page at a time, plus totals for everyone.
export async function customerList(search: string, sort: CustomerSort, page: unknown) {
  const q = search.trim().toLowerCase();
  const match = q ? sql`(position(${q} in lower(c.name)) > 0 or position(${q} in lower(coalesce(c.phone, ''))) > 0)` : sql`true`;
  const [count, totals] = await Promise.all([
    db.execute<{ n: number }>(sql`select count(*)::int as n from customers c where ${match}`),
    db.execute<{ customers: number; owing: number; owed: string; open: number }>(sql`
      with ${PER_ORDER}
      select (select count(*)::int from customers) as customers,
             (select count(distinct customer_id)::int from per_order where owed > 0) as owing,
             (select coalesce(sum(owed), 0) from per_order) as owed,
             (select count(*)::int from per_order where status = 'open') as open`),
  ]);
  const p = paging(page, count.rows[0]?.n ?? 0);
  const rows = p.total
    ? (await db.execute<{
        id: string; name: string; phone: string | null; orders: number; open: number; balls: string; bought: string; received: string; owed: string;
        last_order: string | null; location_type: LocationType | null; location_code: string | null;
      }>(sql`
        with ${PER_ORDER}
        select c.id, c.name, c.phone,
               count(po.id)::int as orders, (count(po.id) filter (where po.status = 'open'))::int as open,
               coalesce(sum(po.balls), 0) as balls, coalesce(sum(po.value), 0) as bought,
               coalesce(sum(po.received), 0) as received, coalesce(sum(po.owed), 0) as owed,
               max(po.ordered_on)::text as last_order,
               ll.location_type, ll.location_code
          from customers c
          left join per_order po on po.customer_id = c.id
          left join last_loc ll on ll.customer_id = c.id
         where ${match}
         group by c.id, ll.location_type, ll.location_code
         order by ${ORDER_BY[sort]}
         limit ${p.size} offset ${p.offset}`)).rows
    : [];
  const t = totals.rows[0];
  return {
    rows: rows.map((r): CustomerRow => ({
      id: r.id, name: r.name, phone: r.phone, orders: r.orders, open: r.open,
      balls: Number(r.balls), bought: Number(r.bought), received: Number(r.received), owed: Number(r.owed),
      lastOrder: r.last_order, locationType: r.location_type, locationCode: r.location_code,
    })),
    paging: p,
    totals: { customers: t?.customers ?? 0, owing: t?.owing ?? 0, owed: Number(t?.owed ?? 0), open: t?.open ?? 0 },
  };
}

// One customer: their details, all-time figures, where they order to, what they buy, a year-by-year
// summary, one page of their orders (newest first) and one page of their payments.
export async function customerDetail(id: string, orderPage: unknown, paymentPage: unknown) {
  if (!UUID.test(id)) return null;
  const [cust] = (await db.execute<{ id: string; name: string; phone: string | null; notes: string | null }>(sql`
    select id, name, phone, notes from customers where id = ${id}`)).rows;
  if (!cust) return null;

  const [sum, places, byType, years, orderCount, payCount] = await Promise.all([
    db.execute<{ orders: number; open: number; balls: string; bought: string; received: string; owed: string; first: string | null }>(sql`
      with ${PER_ORDER}
      select count(*)::int as orders, (count(*) filter (where status = 'open'))::int as open,
             coalesce(sum(balls), 0) as balls, coalesce(sum(value), 0) as bought,
             coalesce(sum(received), 0) as received, coalesce(sum(owed), 0) as owed,
             min(ordered_on)::text as first
        from per_order where customer_id = ${id}`),
    db.execute<{ t: LocationType; code: string; orders: number; last: string; note: string | null }>(sql`
      select location_type as t, location_code as code, count(*)::int as orders,
             max(ordered_on)::text as last,
             (array_agg(location_note order by ordered_on desc, created_at desc) filter (where location_note is not null))[1] as note
        from orders where customer_id = ${id} and location_type is not null
       group by location_type, location_code order by max(ordered_on) desc`),
    db.execute<{ ball_type_id: string; grade_id: string; balls: string; value: string; last: string }>(sql`
      select l.ball_type_id, l.grade_id, sum(l.qty) as balls, sum(l.qty * l.price_paise) as value, max(d.delivered_on)::text as last
        from deliveries d join delivery_lines l on l.delivery_id = d.id join orders o on o.id = d.order_id
       where o.customer_id = ${id}
       group by l.ball_type_id, l.grade_id order by sum(l.qty) desc`),
    // Indian financial years (April to March), keyed by the year they start in
    db.execute<{ fy: number; orders: string; balls: string; sales: string; received: string }>(sql`
      select fy, sum(orders) as orders, sum(balls) as balls, sum(sales) as sales, sum(received) as received from (
        select extract(year from (o.ordered_on - interval '3 months'))::int as fy, 1 as orders, 0 as balls, 0 as sales, 0 as received
          from orders o where o.customer_id = ${id}
        union all
        select extract(year from (d.delivered_on - interval '3 months'))::int, 0, l.qty, l.qty * l.price_paise, 0
          from deliveries d join delivery_lines l on l.delivery_id = d.id join orders o on o.id = d.order_id where o.customer_id = ${id}
        union all
        select extract(year from (r.received_on - interval '3 months'))::int, 0, 0, 0, r.amount_paise
          from receipts r join orders o on o.id = r.order_id where o.customer_id = ${id}
      ) x group by fy order by fy desc`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from orders where customer_id = ${id}`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from receipts r join orders o on o.id = r.order_id where o.customer_id = ${id}`),
  ]);

  const op = paging(orderPage, orderCount.rows[0]?.n ?? 0);
  const pp = paging(paymentPage, payCount.rows[0]?.n ?? 0);
  const [orderIds, payments] = await Promise.all([
    op.total
      ? db.execute<{ id: string }>(sql`select id from orders where customer_id = ${id} order by ordered_on desc, created_at desc, id desc limit ${op.size} offset ${op.offset}`)
      : Promise.resolve({ rows: [] as { id: string }[] }),
    pp.total
      ? db.execute<{ id: string; received_on: string; amount: string; mode: "cash" | "online"; note: string | null; order_id: string; order_on: string }>(sql`
          select r.id, r.received_on::text as received_on, r.amount_paise as amount, r.mode, r.note, o.id as order_id,
                 o.ordered_on::text as order_on
            from receipts r join orders o on o.id = r.order_id
           where o.customer_id = ${id}
           order by r.received_on desc, r.created_at desc, r.id desc limit ${pp.size} offset ${pp.offset}`)
      : Promise.resolve({ rows: [] }),
  ]);
  const s = sum.rows[0];
  return {
    customer: cust,
    totals: {
      orders: s?.orders ?? 0, open: s?.open ?? 0, balls: Number(s?.balls ?? 0), bought: Number(s?.bought ?? 0),
      received: Number(s?.received ?? 0), owed: Number(s?.owed ?? 0), first: s?.first ?? null,
    },
    places: places.rows,
    byType: byType.rows.map((r) => ({ ballTypeId: r.ball_type_id, gradeId: r.grade_id, balls: Number(r.balls), value: Number(r.value), last: r.last })),
    years: years.rows.map((r) => ({ fy: r.fy, orders: Number(r.orders), balls: Number(r.balls), sales: Number(r.sales), received: Number(r.received) })),
    orders: await loadOrders(orderIds.rows.map((r) => r.id)),
    orderPaging: op,
    payments: payments.rows.map((r) => ({ id: r.id, receivedOn: r.received_on, amount: Number(r.amount), mode: r.mode, note: r.note, orderId: r.order_id, orderOn: r.order_on })),
    paymentPaging: pp,
  };
}
