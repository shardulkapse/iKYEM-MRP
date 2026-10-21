import { auth } from "@clerk/nextjs/server";
import ExcelJS from "exceljs";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { todayInFactory } from "@/lib/dates";
import { isValidDay } from "@/lib/day";
import { figures } from "@/lib/money-queries";
import { isPeriodKind, periodRange } from "@/lib/periods";

const rupees = (paise: unknown) => Math.round(Number(paise ?? 0)) / 100;

// GET /money/export?period=month&ref=2026-10-20 -> an .xlsx workbook for that period. Owner only.
export async function GET(req: Request) {
  const { userId, sessionClaims } = await auth();
  if (!userId || sessionClaims?.metadata?.role !== "owner") return new Response("Not allowed", { status: 403 });

  const url = new URL(req.url);
  const today = await todayInFactory();
  const kind = isPeriodKind(url.searchParams.get("period")) ? (url.searchParams.get("period") as "week" | "month" | "quarter" | "year") : "month";
  const refParam = url.searchParams.get("ref") ?? "";
  const ref = isValidDay(refParam) ? refParam : today;
  const p = periodRange(kind, ref);
  const between = (col: SQL) => sql`${col} between ${p.from} and ${p.to}`;
  const rows = <T extends Record<string, unknown>>(s: SQL) => db.execute<T>(s).then((r) => r.rows);

  const [f, production, cutting, grading, attendance, wages, sales, received, purchases, expenses, loanPays] = await Promise.all([
    figures(p.from, p.to, today).then((m) => m.get("all")!),
    rows(sql`select e.day::text as day, e.stage, coalesce(w.name, '') as person, b.name as ball_type, e.good, e.rejected
      from work_entries e join ball_types b on b.id = e.ball_type_id left join workers w on w.id = e.worker_id
      where e.stage <> 'cutting' and ${between(sql`e.day`)} order by e.day, e.created_at`),
    rows(sql`select e.day::text as day, b.name as ball_type, coalesce(w.name, 'Manager or owner') as person, coalesce(m.name, '') as leather,
        coalesce(s.name, '') as supplier, e.sheets, e.good
      from work_entries e join ball_types b on b.id = e.ball_type_id left join workers w on w.id = e.worker_id
        left join materials m on m.id = e.leather_id left join suppliers s on s.id = e.supplier_id
      where e.stage = 'cutting' and ${between(sql`e.day`)} order by e.day, e.created_at`),
    rows(sql`select g.day::text as day, b.name as ball_type, coalesce(s.name, '') as supplier, case when g.rejected then 'Rejected' else gr.name end as grade, g.qty
      from gradings g join ball_types b on b.id = g.ball_type_id left join grades gr on gr.id = g.grade_id left join suppliers s on s.id = g.supplier_id
      where ${between(sql`g.day`)} order by g.day`),
    rows(sql`select a.day::text as day, w.name, w.pay_type, a.status from attendance a join workers w on w.id = a.worker_id
      where ${between(sql`a.day`)} order by a.day, w.name`),
    rows(sql`select p.paid_on::text as day, w.name, p.kind, p.payday::text as payday, p.for_month, p.amount_paise, coalesce(p.note, '') as note
      from wage_payments p join workers w on w.id = p.worker_id where ${between(sql`p.paid_on`)} order by p.paid_on`),
    rows(sql`select d.delivered_on::text as day, c.name as customer, b.name as ball_type, g.name as grade, l.qty, l.price_paise
      from delivery_lines l join deliveries d on d.id = l.delivery_id join orders o on o.id = d.order_id join customers c on c.id = o.customer_id
        join ball_types b on b.id = l.ball_type_id join grades g on g.id = l.grade_id
      where ${between(sql`d.delivered_on`)} order by d.delivered_on`),
    rows(sql`select r.received_on::text as day, c.name as customer, r.amount_paise, r.mode, coalesce(r.note, '') as note
      from receipts r join orders o on o.id = r.order_id join customers c on c.id = o.customer_id where ${between(sql`r.received_on`)} order by r.received_on`),
    rows(sql`select p.received_on::text as day, m.name as material, m.kind, coalesce(s.name, '') as supplier, p.qty, m.unit, p.price_paise, coalesce(p.note, '') as note
      from purchases p join materials m on m.id = p.material_id left join suppliers s on s.id = p.supplier_id where ${between(sql`p.received_on`)} order by p.received_on`),
    rows(sql`select spent_on::text as day, category, amount_paise, coalesce(note, '') as note from expenses where ${between(sql`spent_on`)} order by spent_on`),
    rows(sql`select lp.paid_on::text as day, l.name as loan, lp.amount_paise, coalesce(lp.note, '') as note
      from loan_payments lp join loans l on l.id = lp.loan_id where ${between(sql`lp.paid_on`)} order by lp.paid_on`),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "iKYEM MRP";
  const sheet = (name: string, header: string[], data: unknown[][], widths?: number[]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(header).font = { bold: true };
    if (data.length) ws.addRows(data); else ws.addRow(["Nothing recorded in this period"]);
    ws.columns.forEach((c, i) => { c.width = widths?.[i] ?? Math.max(12, header[i]?.length ?? 10); });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const STAGE: Record<string, string> = {
    hand_quarter_stitching: "Quarter stitching (hand)", hand_closing: "Closing (hand)", hand_seam_stitching: "Seam stitching (hand)",
    machine_quarter_stitching: "Quarter stitching (machine)", machine_stitching: "Machine stitching", machine_closing_seam: "Closing and seam (machine)",
  };

  sheet("Summary", ["", "₹ / count"], [
    ["Period", `${p.label} (${p.from} to ${p.to})`],
    ["Sales", rupees(f.sales)], ["Balls delivered", f.balls], ["Materials bought", -rupees(f.materials)], ["Wages", -rupees(f.wages)],
    ["Other expenses", -rupees(f.expenses)], ["Loan payments", -rupees(f.loan)], ["Left over", rupees(f.left)], [],
    ["Balls finished", f.made], ["Orders completed", f.ordersCompleted], ["Money received", rupees(f.cash + f.online)], ["  Cash", rupees(f.cash)], ["  Online", rupees(f.online)],
  ], [28, 30]);
  sheet("Production", ["Date", "Stage", "Person", "Ball type", "Done", "Rejected"], production.map((r) => [r.day, STAGE[String(r.stage)] ?? r.stage, r.person, r.ball_type, r.good, r.rejected]), [12, 28, 20, 24, 8, 10]);
  sheet("Cutting", ["Date", "Ball type", "Cut by", "Leather", "Supplier", "Sheets", "Balls cut", "Per sheet"],
    cutting.map((r) => [r.day, r.ball_type, r.person, r.leather, r.supplier, r.sheets == null ? "" : Number(r.sheets), r.good, r.sheets ? Math.round((Number(r.good) / Number(r.sheets)) * 10) / 10 : ""]), [12, 24, 20, 28, 24, 8, 10, 10]);
  sheet("Grading", ["Date", "Ball type", "Leather supplier", "Grade", "Balls"], grading.map((r) => [r.day, r.ball_type, r.supplier, r.grade, r.qty]), [12, 24, 24, 14, 8]);
  sheet("Attendance", ["Date", "Name", "Paid by", "Attendance"], attendance.map((r) => [r.day, r.name, { daily: "Daily wage", piece: "Per piece", salary: "Salary" }[String(r.pay_type)], { present: "Present", half: "Half day", absent: "Absent" }[String(r.status)]]), [12, 22, 12, 12]);
  sheet("Wage payments", ["Paid on", "Name", "Type", "For", "Amount (₹)", "Note"],
    wages.map((r) => [r.day, r.name, { weekly: "Weekly pay", salary: "Salary", advance: "Advance" }[String(r.kind)], r.payday ?? r.for_month ?? "", rupees(r.amount_paise), r.note]), [12, 22, 12, 12, 12, 24]);
  sheet("Sales", ["Date", "Customer", "Ball type", "Grade", "Balls", "Price (₹)", "Value (₹)"],
    sales.map((r) => [r.day, r.customer, r.ball_type, r.grade, r.qty, rupees(r.price_paise), rupees(Number(r.qty) * Number(r.price_paise))]), [12, 26, 24, 12, 8, 10, 12]);
  sheet("Money received", ["Date", "Customer", "Amount (₹)", "Paid by", "Note"], received.map((r) => [r.day, r.customer, rupees(r.amount_paise), r.mode === "cash" ? "Cash" : "Online", r.note]), [12, 26, 12, 10, 24]);
  sheet("Purchases", ["Date", "Material", "Kind", "Supplier", "Quantity", "Unit", "Price (₹)", "Total (₹)", "Note"],
    purchases.map((r) => [r.day, r.material, r.kind, r.supplier, Number(r.qty), r.unit, rupees(r.price_paise), rupees(Number(r.qty) * Number(r.price_paise)), r.note]), [12, 26, 10, 24, 10, 8, 10, 12, 24]);
  sheet("Expenses", ["Date", "What for", "Amount (₹)", "Note"], expenses.map((r) => [r.day, r.category, rupees(r.amount_paise), r.note]), [12, 14, 12, 28]);
  sheet("Loan payments", ["Date", "Loan", "Amount (₹)", "Note"], loanPays.map((r) => [r.day, r.loan, rupees(r.amount_paise), r.note]), [12, 22, 12, 24]);

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="iKYEM-${p.from}-to-${p.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
