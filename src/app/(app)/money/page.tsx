import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Field, FormNote } from "@/components/fields";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader, Streamed } from "@/components/page";
import { Pager } from "@/components/pager";
import { PeriodBar } from "@/components/period-bar";
import {
  SkeletonLines,
  SkeletonTable,
  SkeletonTabs,
} from "@/components/skeletons";
import { TabLinks } from "@/components/tab-links";
import { db } from "@/db";
import { daySheets, expenses } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { todayInFactory } from "@/lib/dates";
import { dayShort, isValidDay, isWorkDay } from "@/lib/day";
import { EXPENSE_CATEGORIES } from "@/lib/labels";
import { formatRupees, paiseToInput } from "@/lib/money";
import {
  breakEvenDefaults,
  costPerBall,
  figures,
  gradedInPeriod,
  loanViews,
  owedAllTime,
  type Figures,
} from "@/lib/money-queries";
import { paging } from "@/lib/paging";
import { isPeriodKind, periodRange, type PeriodKind } from "@/lib/periods";
import { getSettings } from "@/lib/setup-queries";
import {
  deleteExpense,
  deleteLoan,
  deleteLoanPayment,
  recordLoanPayment,
  saveExpense,
  saveLoan,
} from "./actions";
import { BreakEven } from "./break-even";
import { LoanExtra } from "./loan-extra";
import "./money.css";

export const metadata = { title: "Money" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "cost", label: "Cost per ball" },
  { key: "breakeven", label: "Break-even" },
  { key: "expenses", label: "Other expenses" },
  { key: "loan", label: "Loan" },
  { key: "export", label: "Export to Excel" },
];

export default function MoneyPage({ searchParams }: PageProps<"/money">) {
  return (
    <>
      <PageHeader
        title="Money"
        sub="Sales from deliveries, the cost of running the factory, what each ball costs you, and your loan."
      />
      <Streamed
        fallback={
          <>
            <SkeletonTabs tabs={6} />
            <section className="panel">
              <SkeletonLines lines={6} />
            </section>
          </>
        }
      >
        <MoneyBody searchParams={searchParams} />
      </Streamed>
    </>
  );
}

async function MoneyBody({
  searchParams,
}: {
  searchParams: PageProps<"/money">["searchParams"];
}) {
  await requireRole(["owner"]);
  const [params, today] = await Promise.all([searchParams, todayInFactory()]);
  const tab = TABS.some((t) => t.key === params.tab)
    ? String(params.tab)
    : "overview";
  const kind: PeriodKind = isPeriodKind(params.period)
    ? params.period
    : "month";
  const refDay =
    typeof params.ref === "string" &&
    isValidDay(params.ref) &&
    params.ref <= today
      ? params.ref
      : today;
  const base = tab === "overview" ? "/money" : `/money?tab=${tab}`;
  return (
    <>
      <TabLinks base="/money" current={tab} tabs={TABS} />
      <Streamed
        key={`${tab}${kind}${refDay}`}
        fallback={
          <section className="panel">
            <SkeletonTable rows={6} cols={4} />
          </section>
        }
      >
        {tab === "overview" ? (
          <Overview kind={kind} refDay={refDay} today={today} base={base} />
        ) : tab === "cost" ? (
          <CostTab today={today} />
        ) : tab === "breakeven" ? (
          <BreakEvenTab today={today} />
        ) : tab === "expenses" ? (
          <ExpensesTab kind={kind} refDay={refDay} today={today} base={base} page={params.page} />
        ) : tab === "loan" ? (
          <LoanTab today={today} />
        ) : (
          <ExportTab kind={kind} refDay={refDay} today={today} base={base} />
        )}
      </Streamed>
    </>
  );
}

const Line = ({
  label,
  value,
  sub,
  cls = "",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  cls?: string;
}) => (
  <div className={`sline ${cls}`}>
    <span>
      {label}
      {sub ? (
        <>
          <br />
          <small className="muted">{sub}</small>
        </>
      ) : null}
    </span>
    <b>{value}</b>
  </div>
);

/* ------------------------------------------------------------ overview */

async function Overview({
  kind,
  refDay,
  today,
  base,
}: {
  kind: PeriodKind;
  refDay: string;
  today: string;
  base: string;
}) {
  const p = periodRange(kind, refDay);
  const current = p.from <= today && p.to >= today;
  const [total, full, graded, owed, months] = await Promise.all([
    figures(p.from, p.to, today).then((m) => m.get("all")!),
    current
      ? figures(p.from, p.to, p.to).then((m) => m.get("all")!)
      : Promise.resolve(null),
    gradedInPeriod(p.from, p.to),
    owedAllTime(),
    kind === "quarter" || kind === "year"
      ? figures(p.from, p.to < today ? p.to : today, today, true)
      : Promise.resolve(null),
  ]);
  const f: Figures = total;
  return (
    <>
      <PeriodBar base={base} kind={kind} refDay={refDay} today={today} />
      <div className="grid g2">
        <section className="panel">
          <h2>Money {current ? <small>so far</small> : null}</h2>
          <Line
            label="Sales"
            value={formatRupees(f.sales)}
            sub={`${f.balls.toLocaleString("en-IN")} balls delivered`}
          />
          <Line
            label="Materials bought"
            value={`− ${formatRupees(f.materials)}`}
            sub="Leather, cork and other materials"
          />
          <Line
            label="Wages"
            value={`− ${formatRupees(f.wages)}`}
            sub={
              full && full.wages > f.wages + 100
                ? `Up to today. Whole period about ${formatRupees(full.wages)}`
                : "Daily wages and piece work from the daily sheets, plus salaries"
            }
          />
          <Line
            label="Other expenses"
            value={`− ${formatRupees(f.expenses)}`}
            sub="Rent, electricity and the rest"
          />
          <Line label="Loan payments" value={`− ${formatRupees(f.loan)}`} />
          <Line
            label="Left over"
            value={formatRupees(f.left)}
            cls={f.left < 0 ? "total neg" : "total"}
          />
        </section>
        <section className="panel">
          <h2>Production and orders</h2>
          <Line
            label="Balls finished"
            value={f.made.toLocaleString("en-IN")}
            sub="Came off seam stitching"
          />
          <Line
            label="Balls graded into stock"
            value={graded.reduce((a, g) => a + g.n, 0).toLocaleString("en-IN")}
            sub={graded.map((g) => `${g.n} ${g.grade}`).join(", ") || undefined}
          />
          <Line
            label="Balls delivered"
            value={f.balls.toLocaleString("en-IN")}
          />
          <Line label="Orders completed" value={f.ordersCompleted} />
          <Line
            label="Money received"
            value={formatRupees(f.cash + f.online)}
            sub={`${formatRupees(f.cash)} cash, ${formatRupees(f.online)} online`}
          />
          <Line
            label="Customers still owe"
            value={formatRupees(owed)}
            sub="For balls already delivered, all time"
          />
        </section>
      </div>
      {months ? (
        <section className="panel" style={{ marginTop: 18 }}>
          <h2>Month by month</h2>
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Finished</th>
                  <th className="num">Delivered</th>
                  <th className="num">Sales</th>
                  <th className="num">Costs</th>
                  <th className="num">Left over</th>
                  <th className="num">Received</th>
                </tr>
              </thead>
              <tbody>
                {[...months.entries()]
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([m, x]) => (
                    <tr key={m}>
                      <td>
                        {new Date(m + "-01T00:00:00Z").toLocaleDateString(
                          "en-IN",
                          { month: "long", year: "numeric", timeZone: "UTC" },
                        )}
                      </td>
                      <td className="num">{x.made}</td>
                      <td className="num">{x.balls}</td>
                      <td className="num">{formatRupees(x.sales)}</td>
                      <td className="num">{formatRupees(x.costs)}</td>
                      <td className={`num ${x.left < 0 ? "bad" : ""}`}>
                        {formatRupees(x.left)}
                      </td>
                      <td className="num">{formatRupees(x.cash + x.online)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <p className="hint" style={{ marginTop: 12 }}>
        Sales count on the delivery date and materials on the purchase date, not
        when they&apos;re used. Wages count as they&apos;re earned. Quarters and
        years follow the April to March financial year.
      </p>
    </>
  );
}

/* ------------------------------------------------------------ cost per ball */

async function CostTab({ today }: { today: string }) {
  const c = await costPerBall(today);
  const rs2 = (p: number) =>
    "₹" +
    (p / 100).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  if (!c.rows.length)
    return (
      <section className="panel empty">
        <b>No ball types yet</b>Add them in Setup.
      </section>
    );
  return (
    <section className="panel">
      <h2>
        What one ball costs you{" "}
        <small>
          {dayShort(c.from)} to {dayShort(today)}, {c.balls} balls finished
        </small>
      </h2>
      <div className="tbl">
        <table>
          <thead>
            <tr>
              <th>Ball type</th>
              <th className="num">Leather</th>
              <th className="num">Cork</th>
              <th className="num">Other materials</th>
              <th className="num">Labour</th>
              <th className="num">Overheads</th>
              <th className="num">Total</th>
              <th className="num">You sell at</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.id}>
                <td className="nw">
                  <span className={`swatch sw-${r.colour}`} />
                  {r.name}
                </td>
                <td className="num">
                  {r.leather == null ? (
                    <span className="muted">—</span>
                  ) : (
                    rs2(r.leather)
                  )}
                </td>
                <td className="num">{rs2(r.cork)}</td>
                <td className="num">{rs2(r.other)}</td>
                <td className="num">{rs2(r.labour)}</td>
                <td className="num">{rs2(r.overheads)}</td>
                <td className="num">
                  <b>{rs2(r.total)}</b>
                </td>
                <td
                  className={`num ${r.sellPrice != null && r.sellPrice < r.total ? "bad" : ""}`}
                >
                  {r.sellPrice == null ? (
                    <span className="muted">—</span>
                  ) : (
                    rs2(r.sellPrice)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ margin: "14px 0 0" }}>
        Leather is the average price per sheet (last six purchases of that
        colour) divided by balls per sheet from your cutting rows
        {c.rows.some((r) => r.noYield)
          ? "; — means no cutting recorded for that colour yet"
          : ""}
        . Labour and other materials are the wages and purchases of this window
        spread over the balls finished in it. Overheads are your average daily
        expenses over the last 90 days, spread the same way. Labour is averaged
        across every ball, so machine-stitched balls carry the same labour as
        hand-stitched for now. Every grade costs the same to make: the selling
        price is where grades differ. The loan isn&apos;t a cost of making a
        ball, so it&apos;s left out.
        {c.balls === 0
          ? " No balls finished in this window yet, so labour and overheads show as zero."
          : ""}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------ break-even */

async function BreakEvenTab({ today }: { today: string }) {
  const settings = await getSettings();
  const month = periodRange("month", today);
  const [d, thisMonth, cost, sheetDays] = await Promise.all([
    breakEvenDefaults(today),
    figures(month.from, month.to, today).then((m) => m.get("all")!),
    costPerBall(today),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(daySheets)
      .where(
        and(
          gte(daySheets.day, sql`${today}::date - 29`),
          lte(daySheets.day, today),
          eq(daySheets.closed, false),
        ),
      ),
  ]);
  let workDays = 0;
  for (
    let day = month.from;
    day <= month.to;
    day = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10)
  )
    if (isWorkDay(day, settings.weeklyOff)) workDays++;
  const fixed = d.salaries + d.dailyWages + d.expensesMonthly + d.emi;
  const fixedNote = `Salaries ${formatRupees(d.salaries)}, daily wages about ${formatRupees(Math.round(d.dailyWages))}, other expenses about ${formatRupees(Math.round(d.expensesMonthly))}, loan EMI ${formatRupees(d.emi)}.`;
  const days = sheetDays[0]?.n ?? 0;
  return (
    <BreakEven
      d={{
        price: d.pricePaise,
        materials: d.materialPerBall,
        piece: d.piecePerBall,
        fixed,
        fixedNote,
        workDays,
        soldThisMonth: thisMonth.balls,
        finishedPerDay: days
          ? cost.balls / Math.max(1, Math.min(days, cost.span))
          : null,
      }}
    />
  );
}

/* ------------------------------------------------------------ other expenses */

function ExpenseFields({
  e,
  today,
}: {
  e?: typeof expenses.$inferSelect;
  today: string;
}) {
  return (
    <>
      <input type="hidden" name="id" value={e?.id ?? ""} />
      <Field label="What for">
        <select name="category" defaultValue={e?.category ?? "Rent"}>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Amount (₹)">
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={paiseToInput(e?.amountPaise)}
          required
        />
      </Field>
      <Field label="Date">
        <input
          name="spentOn"
          type="date"
          defaultValue={e?.spentOn ?? today}
          max={today}
          required
        />
      </Field>
      <Field label="Note">
        <input
          name="note"
          defaultValue={e?.note ?? ""}
          placeholder="e.g. October bill"
        />
      </Field>
      <FormNote>
        Thread, lacquer and foil go under Stock as purchases, so they count in
        cost per ball. Wages and loan payments are tracked separately.
      </FormNote>
    </>
  );
}

async function ExpensesTab({
  kind,
  refDay,
  today,
  base,
  page,
}: {
  kind: PeriodKind;
  refDay: string;
  today: string;
  base: string;
  page: string | string[] | undefined;
}) {
  const p = periodRange(kind, refDay);
  const inPeriod = and(gte(expenses.spentOn, p.from), lte(expenses.spentOn, p.to));
  // Totals cover the whole period; the list below shows it a page at a time.
  const byCategory = await db
    .select({ category: expenses.category, total: sql<string>`sum(${expenses.amountPaise})`, n: sql<number>`count(*)::int` })
    .from(expenses)
    .where(inPeriod)
    .groupBy(expenses.category);
  const by = new Map(byCategory.map((c) => [c.category, Number(c.total)]));
  const total = [...by.values()].reduce((a, v) => a + v, 0);
  const pg = paging(page, byCategory.reduce((a, c) => a + c.n, 0));
  const rows = pg.total
    ? await db
        .select()
        .from(expenses)
        .where(inPeriod)
        .orderBy(sql`${expenses.spentOn} desc`, sql`${expenses.createdAt} desc`, sql`${expenses.id} desc`)
        .limit(pg.size)
        .offset(pg.offset)
    : [];
  const add = (
    <FormDialog
      title="Add expense"
      trigger="Add expense"
      triggerClassName="btn sm primary"
      action={saveExpense}
    >
      <ExpenseFields today={today} />
    </FormDialog>
  );
  return (
    <>
      <PeriodBar
        base={base}
        kind={kind}
        refDay={refDay}
        today={today}
        extra={add}
      />
      {rows.length ? (
        <>
          <div className="strip plain">
            <div>
              <b>{formatRupees(total)}</b>
              <span>Total</span>
            </div>
            {[...by.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([k, v]) => (
                <div key={k}>
                  <b>{formatRupees(v)}</b>
                  <span>{k}</span>
                </div>
              ))}
          </div>
          <div className="tbl card">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>What for</th>
                  <th>Note</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nw">{dayShort(r.spentOn)}</td>
                    <td>{r.category}</td>
                    <td className="muted">{r.note ?? ""}</td>
                    <td className="num">{formatRupees(r.amountPaise)}</td>
                    <td className="num nw">
                      <span
                        className="row-actions"
                        style={{ justifyContent: "flex-end" }}
                      >
                        <FormDialog
                          title="Edit expense"
                          trigger="Edit"
                          action={saveExpense}
                        >
                          <ExpenseFields e={r} today={today} />
                        </FormDialog>
                        <FormDialog
                          title="Delete this expense?"
                          trigger="✕"
                          triggerClassName="x"
                          submitLabel="Delete"
                          action={deleteExpense}
                        >
                          <input type="hidden" name="id" value={r.id} />
                          <FormNote>
                            {r.category}, {formatRupees(r.amountPaise)} on{" "}
                            {dayShort(r.spentOn)}.
                          </FormNote>
                        </FormDialog>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager p={pg} href={`${base}${base.includes("?") ? "&" : "?"}period=${kind}&ref=${refDay}`} noun={["expense", "expenses"]} />
        </>
      ) : (
        <section className="panel empty">
          <b>No expenses in this period</b>Add rent, electricity, transport and
          anything else the factory pays for. Wages and materials are already
          counted.
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------ loan */

function LoanFields({
  l,
  today,
}: {
  l?: {
    id: string;
    name: string;
    lender: string | null;
    principal: number;
    ratePct: number;
    emi: number;
    takenOn: string;
  };
  today: string;
}) {
  return (
    <>
      <input type="hidden" name="id" value={l?.id ?? ""} />
      <Field label="Name" full>
        <input name="name" defaultValue={l?.name ?? "Business loan"} required />
      </Field>
      <Field label="Lender">
        <input name="lender" defaultValue={l?.lender ?? ""} />
      </Field>
      <Field label="Taken on">
        <input
          name="takenOn"
          type="date"
          defaultValue={l?.takenOn ?? today}
          max={today}
          required
        />
      </Field>
      <Field label="Amount borrowed (₹)">
        <input
          name="principal"
          inputMode="decimal"
          defaultValue={paiseToInput(l?.principal)}
          required
        />
      </Field>
      <Field label="Interest rate (% a year)">
        <input
          name="rate"
          inputMode="decimal"
          defaultValue={l?.ratePct ? String(l.ratePct) : ""}
          placeholder="10.5"
        />
      </Field>
      <Field label="EMI per month (₹)">
        <input
          name="emi"
          inputMode="decimal"
          defaultValue={paiseToInput(l?.emi || null)}
        />
      </Field>
    </>
  );
}

async function LoanTab({ today }: { today: string }) {
  const ls = await loanViews();
  const add = (
    <FormDialog
      title="Add loan"
      trigger="Add loan"
      triggerClassName="btn sm primary"
      action={saveLoan}
    >
      <LoanFields today={today} />
    </FormDialog>
  );
  if (!ls.length)
    return (
      <section className="panel empty">
        <b>No loans added</b>Add your business loan with the amount, interest
        rate and EMI.
        <br />
        <br />
        {add}
      </section>
    );
  return (
    <div className="grid">
      <div>{add}</div>
      {ls.map((l) => {
        const pct = l.principal
          ? Math.max(
              0,
              Math.min(100, Math.round((1 - l.balance / l.principal) * 100)),
            )
          : 0;
        const doneBy = l.months
          ? new Date(
              Date.parse(today) + l.months * 30.44 * 86400000,
            ).toLocaleDateString("en-IN", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })
          : null;
        return (
          <section key={l.id} className="panel">
            <div className="panel-head">
              <div>
                <h2>{l.name}</h2>
                <span className="hint">
                  {l.lender ? `${l.lender}, ` : ""}since {dayShort(l.takenOn)}
                </span>
              </div>
              <span className="row-actions">
                <FormDialog
                  title={`Payment on ${l.name}`}
                  trigger="Record payment"
                  triggerClassName="btn sm primary"
                  submitLabel="Record payment"
                  action={recordLoanPayment}
                >
                  <input type="hidden" name="loanId" value={l.id} />
                  <Field label="Amount (₹)">
                    <input
                      name="amount"
                      inputMode="decimal"
                      defaultValue={paiseToInput(l.emi || null)}
                      required
                    />
                  </Field>
                  <Field label="Paid on">
                    <input
                      name="paidOn"
                      type="date"
                      defaultValue={today}
                      max={today}
                      required
                    />
                  </Field>
                  <Field label="Note" full>
                    <input name="note" placeholder="EMI, extra principal…" />
                  </Field>
                </FormDialog>
                <FormDialog
                  title={`Edit ${l.name}`}
                  trigger="Edit"
                  action={saveLoan}
                >
                  <LoanFields l={l} today={today} />
                </FormDialog>
                {!l.payments.length ? (
                  <FormDialog
                    title="Delete this loan?"
                    trigger="✕"
                    triggerClassName="x"
                    submitLabel="Delete loan"
                    action={deleteLoan}
                  >
                    <input type="hidden" name="id" value={l.id} />
                    <FormNote>
                      {l.name}, {formatRupees(l.principal)} borrowed. It has no
                      payments recorded.
                    </FormNote>
                  </FormDialog>
                ) : null}
              </span>
            </div>
            <div className="strip plain">
              <div>
                <b>{formatRupees(l.principal)}</b>
                <span>Borrowed</span>
              </div>
              <div>
                <b>{formatRupees(l.paid)}</b>
                <span>Paid so far</span>
              </div>
              <div>
                <b>{formatRupees(l.interestPaid)}</b>
                <span>Of that, interest</span>
              </div>
              <div className={l.balance ? "alert" : ""}>
                <b>{formatRupees(l.balance)}</b>
                <span>Still owed</span>
              </div>
            </div>
            <div className="seam" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </div>
            <p style={{ margin: "12px 0 0" }}>
              {l.balance <= 0 ? (
                "Paid off."
              ) : !l.emi ? (
                <span className="muted">
                  Add the EMI to see when it will be paid off.
                </span>
              ) : l.months == null ? (
                <span className="bad">
                  The EMI doesn&apos;t cover the interest, so the loan never
                  gets smaller.
                </span>
              ) : (
                <>
                  At {formatRupees(l.emi)} a month
                  {l.ratePct ? ` and ${l.ratePct}% interest` : ""}, it&apos;s
                  paid off in about <b>{l.months} months</b> ({doneBy}).
                </>
              )}
            </p>
            {l.emi && l.balance > 0 && l.months != null ? (
              <LoanExtra balance={l.balance} ratePct={l.ratePct} emi={l.emi} />
            ) : null}
            {l.payments.length ? (
              <details className="more">
                <summary>Payments ({l.payments.length})</summary>
                <div className="list">
                  {[...l.payments].reverse().map((p) => (
                    <div key={p.id} className="row">
                      <span>
                        {dayShort(p.paidOn)}
                        {p.note ? (
                          <span className="muted"> {p.note}</span>
                        ) : null}
                      </span>
                      <span className="row-actions">
                        {formatRupees(p.amountPaise)}
                        <FormDialog
                          title="Delete this loan payment?"
                          trigger="✕"
                          triggerClassName="x"
                          submitLabel="Delete"
                          action={deleteLoanPayment}
                        >
                          <input type="hidden" name="id" value={p.id} />
                          <FormNote>
                            {formatRupees(p.amountPaise)} paid{" "}
                            {dayShort(p.paidOn)}.
                          </FormNote>
                        </FormDialog>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </section>
        );
      })}
      <p className="hint" style={{ margin: 0 }}>
        Interest builds daily on what&apos;s still owed; each payment covers the
        interest so far, then reduces the amount owed. Your lender&apos;s
        statement is the final word if the two differ.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ export */

function ExportTab({
  kind,
  refDay,
  today,
  base,
}: {
  kind: PeriodKind;
  refDay: string;
  today: string;
  base: string;
}) {
  const p = periodRange(kind, refDay);
  return (
    <>
      <PeriodBar base={base} kind={kind} refDay={refDay} today={today} />
      <section className="panel" style={{ maxWidth: 680 }}>
        <h2>Download {p.label} as Excel</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          One workbook with a sheet each for the summary, production, cutting,
          grading, attendance, wage payments, sales, money received, purchases,
          expenses and loan payments.
        </p>
        <a
          className="btn primary mt-2"
          href={`/money/export?period=${kind}&ref=${refDay}`}
          download
        >
          Download Excel
        </a>
      </section>
    </>
  );
}
