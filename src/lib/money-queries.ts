import "server-only";
import { asc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { daySheets, loanPayments, loans, workers } from "@/db/schema";
import { addDays } from "@/lib/day";

/* ------------------------------------------------------------ period figures */

export type Figures = {
  sales: number; balls: number; materials: number; wages: number; expenses: number; loan: number;
  cash: number; online: number; made: number; ordersCompleted: number; left: number; costs: number;
};
const empty = (): Figures => ({ sales: 0, balls: 0, materials: 0, wages: 0, expenses: 0, loan: 0, cash: 0, online: 0, made: 0, ordersCompleted: 0, left: 0, costs: 0 });

const daysInMonth = (day: string) => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();

// Salaried pay counts day by day: a ₹26,000 October salary is ₹838.71 for each day of October
// the person was employed, so any period gets its fair share.
async function salaryByKey(from: string, to: string, key: (day: string) => string) {
  const ws = await db.select().from(workers).where(eq(workers.payType, "salary"));
  const out = new Map<string, number>();
  for (const w of ws) {
    let d = w.startedOn && w.startedOn > from ? w.startedOn : from;
    const end = w.leftOn && w.leftOn < to ? w.leftOn : to;
    while (d <= end) {
      out.set(key(d), (out.get(key(d)) ?? 0) + w.ratePaise / daysInMonth(d));
      d = addDays(d, 1);
    }
  }
  return out;
}

// Every money and production figure for a date range, either as one total or split by month.
// Sales count on the delivery date, materials on the purchase date, wages as they are earned
// (up to today), expenses and loan payments on the day paid.
export async function figures(from: string, to: string, today: string, byMonth = false): Promise<Map<string, Figures>> {
  const wageTo = to < today ? to : today;
  const k = (col: SQL) => (byMonth ? sql<string>`to_char(${col}, 'YYYY-MM')` : sql<string>`'all'`);
  const q = <T extends Record<string, unknown>>(s: SQL) => db.execute<T & { k: string }>(s).then((r) => r.rows);
  const [sales, mats, exps, loanRows, recs, made, daily, piece, done, salary] = await Promise.all([
    q<{ value: string; balls: string }>(sql`select ${k(sql`d.delivered_on`)} as k, sum(l.qty * l.price_paise) as value, sum(l.qty) as balls
      from delivery_lines l join deliveries d on d.id = l.delivery_id where d.delivered_on between ${from} and ${to} group by 1`),
    q<{ value: string }>(sql`select ${k(sql`received_on`)} as k, sum(qty * price_paise) as value from purchases where received_on between ${from} and ${to} group by 1`),
    q<{ value: string }>(sql`select ${k(sql`spent_on`)} as k, sum(amount_paise) as value from expenses where spent_on between ${from} and ${to} group by 1`),
    q<{ value: string }>(sql`select ${k(sql`paid_on`)} as k, sum(amount_paise) as value from loan_payments where paid_on between ${from} and ${to} group by 1`),
    q<{ cash: string; online: string }>(sql`select ${k(sql`received_on`)} as k,
        sum(case when mode = 'cash' then amount_paise else 0 end) as cash, sum(case when mode = 'online' then amount_paise else 0 end) as online
      from receipts where received_on between ${from} and ${to} group by 1`),
    q<{ n: string }>(sql`select ${k(sql`day`)} as k, sum(good) as n from work_entries
      where stage in ('hand_seam_stitching', 'machine_closing_seam') and day between ${from} and ${to} group by 1`),
    q<{ value: string }>(sql`select ${k(sql`a.day`)} as k,
        sum(case a.status when 'present' then w.rate_paise when 'half' then w.rate_paise / 2.0 else 0 end) as value
      from attendance a join workers w on w.id = a.worker_id where w.pay_type = 'daily' and a.day between ${from} and ${wageTo} group by 1`),
    q<{ value: string }>(sql`select ${k(sql`e.day`)} as k, sum(e.good * w.rate_paise) as value
      from work_entries e join workers w on w.id = e.worker_id where w.pay_type = 'piece' and e.day between ${from} and ${wageTo} group by 1`),
    q<{ n: string }>(sql`select ${k(sql`last`)} as k, count(*) as n from (
        select o.id, max(d.delivered_on) as last from orders o join deliveries d on d.order_id = o.id where o.status = 'closed' group by o.id
      ) x where last between ${from} and ${to} group by 1`),
    from <= wageTo ? salaryByKey(from, wageTo, (d) => (byMonth ? d.slice(0, 7) : "all")) : Promise.resolve(new Map<string, number>()),
  ]);
  const out = new Map<string, Figures>();
  const get = (key: string) => out.get(key) ?? (out.set(key, empty()), out.get(key)!);
  for (const r of sales) { get(r.k).sales += Number(r.value); get(r.k).balls += Number(r.balls); }
  for (const r of mats) get(r.k).materials += Math.round(Number(r.value));
  for (const r of exps) get(r.k).expenses += Number(r.value);
  for (const r of loanRows) get(r.k).loan += Number(r.value);
  for (const r of recs) { get(r.k).cash += Number(r.cash); get(r.k).online += Number(r.online); }
  for (const r of made) get(r.k).made += Number(r.n);
  for (const r of daily) get(r.k).wages += Number(r.value);
  for (const r of piece) get(r.k).wages += Number(r.value);
  for (const r of done) get(r.k).ordersCompleted += Number(r.n);
  for (const [key, v] of salary) get(key).wages += v;
  if (!byMonth) get("all");
  for (const f of out.values()) {
    f.wages = Math.round(f.wages);
    f.costs = f.materials + f.wages + f.expenses + f.loan;
    f.left = f.sales - f.costs;
  }
  return out;
}

export async function gradedInPeriod(from: string, to: string) {
  const r = await db.execute<{ grade: string; n: string }>(sql`
    select g2.name as grade, sum(g.qty) as n from gradings g join grades g2 on g2.id = g.grade_id
     where not g.rejected and g.day between ${from} and ${to} group by g2.name, g2.sort_order order by g2.sort_order`);
  return r.rows.map((x) => ({ grade: x.grade, n: Number(x.n) }));
}

export async function owedAllTime() {
  const r = await db.execute<{ owed: string }>(sql`
    select coalesce(sum(greatest(delivered - received, 0)), 0) as owed from (
      select o.id,
        coalesce((select sum(l.qty * l.price_paise) from deliveries d join delivery_lines l on l.delivery_id = d.id where d.order_id = o.id), 0) as delivered,
        coalesce((select sum(r.amount_paise) from receipts r where r.order_id = o.id), 0) as received
      from orders o) x`);
  return Number(r.rows[0]?.owed ?? 0);
}

/* ------------------------------------------------------------ cost per ball */

export type BallCost = { id: string; name: string; colour: string; leather: number | null; cork: number; other: number; labour: number; overheads: number; total: number; sellPrice: number | null; noYield: boolean };

// The last 30 days (or since the first daily sheet, if that's more recent).
export async function costPerBall(today: string) {
  const [first] = await db.select({ d: sql<string | null>`min(${daySheets.day})::text` }).from(daySheets);
  let from = addDays(today, -29);
  if (first?.d && first.d > from) from = first.d;
  const span = Math.round((Date.parse(today) - Date.parse(from)) / 86400000) + 1;
  const f = (await figures(from, today, today)).get("all")!;
  const q = <T extends Record<string, unknown>>(s: SQL) => db.execute<T>(s).then((r) => r.rows);
  const [types, leatherPrice, yields, cork, otherMats, overhead90, sell, openPrice] = await Promise.all([
    q<{ id: string; name: string; colour: string }>(sql`select id, name, colour from ball_types where archived_at is null order by sort_order, name`),
    q<{ colour: string; avg: string }>(sql`select colour, sum(qty * price_paise) / nullif(sum(qty), 0) as avg from (
        select m.colour, p.qty, p.price_paise, row_number() over (partition by m.colour order by p.received_on desc, p.created_at desc) rn
          from purchases p join materials m on m.id = p.material_id where m.kind = 'leather' and p.price_paise > 0) x where rn <= 6 group by colour`),
    q<{ colour: string; recent_sheets: string; recent_balls: string; all_sheets: string; all_balls: string }>(sql`
      select m.colour,
             sum(case when w.day > ${addDays(today, -90)} then w.sheets else 0 end) as recent_sheets,
             sum(case when w.day > ${addDays(today, -90)} then w.good else 0 end) as recent_balls,
             sum(w.sheets) as all_sheets, sum(w.good) as all_balls
        from work_entries w join materials m on m.id = w.leather_id where w.stage = 'cutting' and w.sheets > 0 group by m.colour`),
    q<{ avg: string }>(sql`select sum(qty * price_paise) / nullif(sum(qty), 0) as avg from (
        select p.qty, p.price_paise from purchases p join materials m on m.id = p.material_id
         where m.kind = 'cork' and p.price_paise > 0 order by p.received_on desc, p.created_at desc limit 6) x`),
    q<{ v: string }>(sql`select coalesce(sum(p.qty * p.price_paise), 0) as v from purchases p join materials m on m.id = p.material_id
       where m.kind = 'other' and p.received_on between ${from} and ${today}`),
    q<{ v: string }>(sql`select coalesce(sum(amount_paise), 0) as v from expenses where spent_on > ${addDays(today, -90)} and spent_on <= ${today}`),
    q<{ ball_type_id: string; avg: string }>(sql`select l.ball_type_id, sum(l.qty * l.price_paise) / nullif(sum(l.qty), 0) as avg
        from delivery_lines l join deliveries d on d.id = l.delivery_id where d.delivered_on > ${addDays(today, -120)} group by l.ball_type_id`),
    q<{ ball_type_id: string; avg: string }>(sql`select l.ball_type_id, sum(l.qty * l.price_paise) / nullif(sum(l.qty), 0) as avg
        from order_lines l join orders o on o.id = l.order_id where o.status = 'open' group by l.ball_type_id`),
  ]);
  const balls = f.made;
  const per = (v: number) => (balls ? v / balls : 0);
  const labour = per(f.wages);
  const other = per(Number(otherMats[0]?.v ?? 0));
  const overheads = per((Number(overhead90[0]?.v ?? 0) / 90) * span);
  const corkCost = Number(cork[0]?.avg ?? 0);
  const priceBy = new Map(leatherPrice.map((x) => [x.colour, Number(x.avg)]));
  const yieldBy = new Map(yields.map((y) => {
    const recent = Number(y.recent_sheets) > 0;
    return [y.colour, recent ? Number(y.recent_balls) / Number(y.recent_sheets) : Number(y.all_balls) / Number(y.all_sheets)];
  }));
  const sellBy = new Map(sell.map((s) => [s.ball_type_id, Number(s.avg)]));
  const openBy = new Map(openPrice.map((s) => [s.ball_type_id, Number(s.avg)]));
  const rows: BallCost[] = types.map((t) => {
    const price = priceBy.get(t.colour), y = yieldBy.get(t.colour);
    const leather = price && y ? price / y : null;
    const total = (leather ?? 0) + corkCost + other + labour + overheads;
    return { id: t.id, name: t.name, colour: t.colour, leather, cork: corkCost, other, labour, overheads, total, sellPrice: sellBy.get(t.id) ?? openBy.get(t.id) ?? null, noYield: !y };
  });
  return { from, span, balls, rows, labour, overheads, other };
}

/* ------------------------------------------------------------ break-even inputs */

export async function breakEvenDefaults(today: string) {
  const [ws, exp, emi, cost] = await Promise.all([
    db.select().from(workers),
    db.execute<{ v: string }>(sql`select coalesce(sum(amount_paise), 0) as v from expenses where spent_on > ${addDays(today, -90)} and spent_on <= ${today}`),
    db.select({ v: sql<string>`coalesce(sum(${loans.emiPaise}), 0)` }).from(loans),
    costPerBall(today),
  ]);
  const active = ws.filter((w) => !w.leftOn || w.leftOn >= today);
  const workDaysInMonth = 26;
  const salaries = active.filter((w) => w.payType === "salary").reduce((a, w) => a + w.ratePaise, 0);
  const dailyWages = active.filter((w) => w.payType === "daily").reduce((a, w) => a + w.ratePaise * workDaysInMonth * 0.92, 0); // ~92% attendance
  const piecePerBall = active.filter((w) => w.payType === "piece").reduce((a, w) => a + w.ratePaise, 0);
  const expensesMonthly = Number(exp.rows[0]?.v ?? 0) / 3;
  const materialPerBall = cost.rows.length ? cost.rows.reduce((a, r) => a + (r.leather ?? 0) + r.cork + r.other, 0) / cost.rows.length : 0;
  const prices = cost.rows.map((r) => r.sellPrice).filter((p): p is number => p != null);
  return {
    pricePaise: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0,
    materialPerBall, piecePerBall,
    salaries, dailyWages, expensesMonthly, emi: Number(emi[0]?.v ?? 0),
  };
}

/* ------------------------------------------------------------ loans */

export type LoanView = {
  id: string; name: string; lender: string | null; principal: number; ratePct: number; emi: number; takenOn: string;
  balance: number; paid: number; interestPaid: number; months: number | null;
  payments: { id: string; paidOn: string; amountPaise: number; note: string | null }[];
};

export function payoffMonths(balance: number, monthlyRate: number, emi: number): number | null {
  if (balance <= 0) return 0;
  if (emi <= 0) return null;
  if (monthlyRate <= 0) return Math.ceil(balance / emi);
  if (monthlyRate * balance >= emi) return null; // EMI doesn't cover the interest
  return Math.ceil(-Math.log(1 - (monthlyRate * balance) / emi) / Math.log(1 + monthlyRate));
}

// Interest builds daily on what's still owed; each payment pays the interest so far, then principal.
export async function loanViews(): Promise<LoanView[]> {
  const [ls, ps] = await Promise.all([
    db.select().from(loans).orderBy(asc(loans.takenOn)),
    db.select().from(loanPayments).orderBy(asc(loanPayments.paidOn), asc(loanPayments.createdAt)),
  ]);
  return ls.map((l) => {
    const rate = Number(l.annualRatePct ?? 0) / 100;
    let balance = l.principalPaise, last = l.takenOn, interestPaid = 0, paid = 0;
    const payments = ps.filter((p) => p.loanId === l.id);
    for (const p of payments) {
      const days = Math.max(0, Math.round((Date.parse(p.paidOn) - Date.parse(last)) / 86400000));
      const interest = (balance * rate * days) / 365;
      const toInterest = Math.min(interest, p.amountPaise);
      interestPaid += toInterest;
      balance = Math.max(0, balance - (p.amountPaise - toInterest));
      paid += p.amountPaise;
      last = p.paidOn;
    }
    return {
      id: l.id, name: l.name, lender: l.lender, principal: l.principalPaise, ratePct: Number(l.annualRatePct ?? 0), emi: l.emiPaise ?? 0, takenOn: l.takenOn,
      balance: Math.round(balance), paid, interestPaid: Math.round(interestPaid),
      months: payoffMonths(balance, rate / 12, l.emiPaise ?? 0),
      payments: payments.map((p) => ({ id: p.id, paidOn: p.paidOn, amountPaise: p.amountPaise, note: p.note })),
    };
  });
}
