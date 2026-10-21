import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { daySheets, materialOnHand, materials, purchases, suppliers } from "@/db/schema";
import { addDays, addWorkDays, subWorkDays } from "@/lib/day";
import { getSettings } from "@/lib/setup-queries";

const USAGE_WINDOW_DAYS = 28;

export type MaterialStatus = "now" | "soon" | "ok";
export type MaterialCard = {
  id: string; name: string; kind: "leather" | "cork" | "other"; colour: string | null; unit: string; leadDays: number;
  onHand: number; perDay: number | null; coverDays: number | null; buyBy: string | null; status: MaterialStatus;
  avgPricePaise: number | null; lastBought: string | null; lastSupplier: string | null; ballsPerSheet: number | null;
};

// Everything the Materials tab shows: stock, how fast it's used, when to reorder, and prices.
export async function materialCards(today: string): Promise<MaterialCard[]> {
  const settings = await getSettings();
  const from = addDays(today, -USAGE_WINDOW_DAYS);
  const [rows, usage, filled, prices, last, yields] = await Promise.all([
    db.select({ m: materials, qty: materialOnHand.qty }).from(materials).leftJoin(materialOnHand, eq(materialOnHand.materialId, materials.id))
      .where(isNull(materials.archivedAt)).orderBy(asc(materials.kind), asc(materials.name)),
    db.execute<{ material_id: string; used: string }>(sql`
      select leather_id as material_id, sum(sheets) as used from work_entries
       where stage = 'cutting' and leather_id is not null and day > ${from} and day <= ${today} group by leather_id
      union all
      select m.id, sum(w.good + w.rejected) from work_entries w
        join ball_types b on b.id = w.ball_type_id
        join materials m on m.kind = 'cork'
       where w.day > ${from} and w.day <= ${today}
         and ((w.stage = 'hand_closing' and b.workflow = 'hand') or (w.stage = 'machine_closing_seam' and b.workflow = 'machine'))
       group by m.id`),
    db.select({ n: sql<number>`count(*)::int` }).from(daySheets).where(and(gte(daySheets.day, addDays(from, 1)), lte(daySheets.day, today), eq(daySheets.closed, false))),
    avgPrices(),
    db.execute<{ material_id: string; received_on: string; supplier: string | null }>(sql`
      select distinct on (p.material_id) p.material_id, p.received_on::text as received_on, s.name as supplier
        from purchases p left join suppliers s on s.id = p.supplier_id
       order by p.material_id, p.received_on desc, p.created_at desc`),
    db.execute<{ leather_id: string; sheets: string; balls: string }>(sql`
      select leather_id, sum(sheets) as sheets, sum(good) as balls from work_entries
       where stage = 'cutting' and leather_id is not null and sheets > 0 group by leather_id`),
  ]);
  const usedBy = new Map(usage.rows.map((u) => [u.material_id, Number(u.used)]));
  const days = filled[0]?.n ?? 0;
  const lastBy = new Map(last.rows.map((r) => [r.material_id, r]));
  const yieldBy = new Map(yields.rows.map((y) => [y.leather_id, Number(y.balls) / Number(y.sheets)]));

  return rows.map(({ m, qty }) => {
    const onHand = Number(qty ?? 0);
    const used = usedBy.get(m.id) ?? 0;
    const perDay = m.kind !== "other" && days && used ? used / days : null;
    const coverDays = perDay ? onHand / perDay : null;
    const runsOut = coverDays != null ? addWorkDays(today, Math.max(0, Math.floor(coverDays)), settings.weeklyOff) : null;
    const buyBy = runsOut ? subWorkDays(runsOut, m.leadDays, settings.weeklyOff) : null;
    const status: MaterialStatus =
      m.kind === "other" ? "ok"
      : onHand <= 0 || (buyBy && buyBy <= today) ? "now"
      : buyBy && buyBy <= addDays(today, 5) ? "soon" : "ok";
    const l = lastBy.get(m.id);
    return {
      id: m.id, name: m.name, kind: m.kind, colour: m.colour, unit: m.unit, leadDays: m.leadDays,
      onHand, perDay, coverDays, buyBy, status,
      avgPricePaise: prices.get(m.id) ?? null, lastBought: l?.received_on ?? null, lastSupplier: l?.supplier ?? null,
      ballsPerSheet: yieldBy.get(m.id) ?? null,
    };
  });
}

// Average price per unit over each material's last six purchases, weighted by quantity.
export async function avgPrices(): Promise<Map<string, number>> {
  const r = await db.execute<{ material_id: string; avg: string }>(sql`
    select material_id, sum(qty * price_paise) / nullif(sum(qty), 0) as avg from (
      select material_id, qty, price_paise,
             row_number() over (partition by material_id order by received_on desc, created_at desc) as rn
        from purchases where price_paise > 0
    ) p where rn <= 6 group by material_id`);
  return new Map(r.rows.filter((x) => x.avg != null).map((x) => [x.material_id, Number(x.avg)]));
}

export type YieldRow = { leatherId: string; leather: string; colour: string | null; supplierId: string | null; supplier: string | null; days: number; sheets: number; balls: number; perSheet: number; last: string; pricePaise: number | null };

// Balls per sheet for every leather and supplier pair that has been cut, with that pair's price.
export async function yieldBySupplier(): Promise<YieldRow[]> {
  const r = await db.execute<{ leather_id: string; leather: string; colour: string | null; supplier_id: string | null; supplier: string | null; days: number; sheets: string; balls: string; last: string; price: string | null }>(sql`
    select w.leather_id, m.name as leather, m.colour, w.supplier_id, s.name as supplier,
           count(distinct w.day)::int as days, sum(w.sheets) as sheets, sum(w.good) as balls, max(w.day)::text as last,
           (select sum(p.qty * p.price_paise) / nullif(sum(p.qty), 0) from purchases p
             where p.material_id = w.leather_id and p.supplier_id is not distinct from w.supplier_id and p.price_paise > 0) as price
      from work_entries w
      join materials m on m.id = w.leather_id
      left join suppliers s on s.id = w.supplier_id
     where w.stage = 'cutting' and w.sheets > 0
     group by w.leather_id, m.name, m.colour, w.supplier_id, s.name
     order by m.name, sum(w.good) / sum(w.sheets) desc`);
  return r.rows.map((x) => ({
    leatherId: x.leather_id, leather: x.leather, colour: x.colour, supplierId: x.supplier_id, supplier: x.supplier, days: x.days,
    sheets: Number(x.sheets), balls: Number(x.balls), perSheet: Number(x.balls) / Number(x.sheets), last: x.last, pricePaise: x.price == null ? null : Number(x.price),
  }));
}

// Grade split for grading rows tagged with a leather supplier.
export async function gradesBySupplier() {
  const r = await db.execute<{ supplier_id: string; supplier: string; grade_id: string | null; rejected: boolean; qty: string }>(sql`
    select g.supplier_id, s.name as supplier, g.grade_id, g.rejected, sum(g.qty) as qty
      from gradings g join suppliers s on s.id = g.supplier_id
     group by g.supplier_id, s.name, g.grade_id, g.rejected`);
  const out = new Map<string, { supplier: string; total: number; rejected: number; byGrade: Map<string, number> }>();
  for (const x of r.rows) {
    const o = out.get(x.supplier_id) ?? { supplier: x.supplier, total: 0, rejected: 0, byGrade: new Map() };
    const q = Number(x.qty);
    o.total += q;
    if (x.rejected) o.rejected += q;
    else if (x.grade_id) o.byGrade.set(x.grade_id, (o.byGrade.get(x.grade_id) ?? 0) + q);
    out.set(x.supplier_id, o);
  }
  return [...out.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.supplier.localeCompare(b.supplier));
}

export async function recentCutting(limit = 25) {
  const r = await db.execute<{ id: string; day: string; ball_type: string; leather: string | null; supplier: string | null; sheets: string | null; good: number }>(sql`
    select w.id, w.day::text as day, b.name as ball_type, m.name as leather, s.name as supplier, w.sheets, w.good
      from work_entries w
      join ball_types b on b.id = w.ball_type_id
      left join materials m on m.id = w.leather_id
      left join suppliers s on s.id = w.supplier_id
     where w.stage = 'cutting'
     order by w.day desc, w.created_at desc
     limit ${limit}`);
  return r.rows;
}

export async function listPurchases(limit = 100) {
  return db
    .select({
      id: purchases.id, receivedOn: purchases.receivedOn, qty: purchases.qty, pricePaise: purchases.pricePaise, note: purchases.note,
      material: materials.name, kind: materials.kind, colour: materials.colour, unit: materials.unit, supplier: suppliers.name,
    })
    .from(purchases)
    .innerJoin(materials, eq(materials.id, purchases.materialId))
    .leftJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .orderBy(desc(purchases.receivedOn), desc(purchases.createdAt))
    .limit(limit);
}

// cache(): several "Bought" buttons on one page share a single lookup per request.
export const purchaseFormOptions = cache(async function purchaseFormOptions() {
  const [mats, sups] = await Promise.all([
    db.select({ id: materials.id, name: materials.name, kind: materials.kind, unit: materials.unit }).from(materials).where(isNull(materials.archivedAt)).orderBy(asc(materials.kind), asc(materials.name)),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(isNull(suppliers.archivedAt)).orderBy(asc(suppliers.name)),
  ]);
  return { materials: mats, suppliers: sups };
});
