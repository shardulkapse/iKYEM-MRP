import Link from "next/link";
import { Field, FormNote } from "@/components/fields";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader, Streamed } from "@/components/page";
import { SkeletonList, SkeletonTable, SkeletonTabs } from "@/components/skeletons";
import { TabLinks } from "@/components/tab-links";
import { requireRole } from "@/lib/auth";
import { todayInFactory } from "@/lib/dates";
import { addDays, dayShort, isValidDay } from "@/lib/day";
import { PAY_TYPE_LABEL, WEEKDAYS } from "@/lib/labels";
import { formatRupees, paiseToInput } from "@/lib/money";
import { lastPayday, nextPayday, openDaysFilled, payPeriod, paydayRows, recentAdvances, salaryRows, type PaydayRow } from "@/lib/pay-queries";
import { getSettings, listWorkers } from "@/lib/setup-queries";
import { deleteWagePayment, giveAdvance, payEveryone, paySalary, payWeekly } from "./actions";

export const metadata = { title: "Pay" };

export default function PayPage({ searchParams }: PageProps<"/pay">) {
  return (
    <>
      <PageHeader title="Pay" sub="Weekly payday worked out from the daily sheets, month-end salaries and advances. People and their rates are on the Team page." />
      <Streamed fallback={<><SkeletonTabs /><section className="panel"><SkeletonTable rows={6} cols={4} /></section></>}>
        <PayBody searchParams={searchParams} />
      </Streamed>
    </>
  );
}

async function PayBody({ searchParams }: { searchParams: PageProps<"/pay">["searchParams"] }) {
  await requireRole(["owner"]);
  const [params, today, settings] = await Promise.all([searchParams, todayInFactory(), getSettings()]);
  const day = WEEKDAYS[settings.payWeekday];
  const tabs = [
    { key: "payday", label: `${day} payday` },
    { key: "salary", label: "Month-end salary" },
    { key: "advances", label: "Advances" },
  ];
  const tab = tabs.some((t) => t.key === params.tab) ? String(params.tab) : "payday";
  const next = nextPayday(today, settings.payWeekday);
  const askedPayday = typeof params.payday === "string" && isValidDay(params.payday) ? lastPayday(params.payday, settings.payWeekday) : next;
  const payday = askedPayday > next ? next : askedPayday;
  const month = typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month) ? params.month : today.slice(0, 7);
  return (
    <>
      <div className="tabbar-row">
        <TabLinks base="/pay" current={tab} tabs={tabs} />
        <AdvanceButton today={today} />
      </div>
      <Streamed key={`${tab}${payday}${month}`} fallback={<section className="panel"><SkeletonList rows={6} /></section>}>
        {tab === "payday" ? <PaydayTab payday={payday} next={next} today={today} day={day} weeklyOff={settings.weeklyOff} />
          : tab === "salary" ? <SalaryTab month={month} today={today} day={day} />
          : <AdvancesTab today={today} />}
      </Streamed>
    </>
  );
}

/* ------------------------------------------------------------ payday */

function detail(r: PaydayRow, day: string) {
  const w = r.worker;
  const base = w.payType === "daily" ? `${r.days} ${r.days === 1 ? "day" : "days"} × ${formatRupees(w.ratePaise)}`
    : w.payType === "piece" ? `${r.pieces} pieces × ${formatRupees(w.ratePaise)}`
    : `Weekly payout, comes off the month-end salary`;
  return r.advances ? `${base}, less ${formatRupees(r.advances)} advance` : w.payType === "salary" && !w.weeklyPayoutPaise ? `No ${day} payout set` : base;
}

async function PaydayTab({ payday, next, today, day, weeklyOff }: { payday: string; next: string; today: string; day: string; weeklyOff: number | null }) {
  const { from, firstDay, to } = payPeriod(payday, weeklyOff);
  const [rows, daysFilled] = await Promise.all([paydayRows(payday, weeklyOff), openDaysFilled(from, to < today ? to : today)]);
  const unpaid = rows.filter((r) => !r.paid && r.due > 0);
  const toPay = unpaid.reduce((a, r) => a + r.due, 0);
  const paid = rows.reduce((a, r) => a + (r.paid?.amountPaise ?? 0), 0);
  const paidOn = payday <= today ? payday : today;
  // Daily-wage workers on their own: days present so far this work week × their rate, less any
  // advance, for everyone not yet marked paid. Grows as each day's sheet is saved.
  const dailyRows = rows.filter((r) => r.worker.payType === "daily");
  const dailyUnpaid = dailyRows.filter((r) => !r.paid);
  const dailyOwed = dailyUnpaid.reduce((a, r) => a + r.due, 0);
  const dailyPeople = dailyUnpaid.filter((r) => r.due > 0).length;
  const dailyAdvances = dailyUnpaid.reduce((a, r) => a + Math.min(r.advances, r.earned), 0);
  const weekOpen = to >= today; // the work week hasn't finished yet
  const groups = (["daily", "piece", "salary"] as const).map((k) => ({ k, rows: rows.filter((r) => r.worker.payType === k) })).filter((g) => g.rows.length);
  return (
    <>
      <div className="periodbar">
        <Link className="btn sm" href={`/pay?payday=${addDays(payday, -7)}`} scroll={false} aria-label="Previous payday">‹</Link>
        <b>{day} {dayShort(payday)}</b>
        {payday < next ? <Link className="btn sm" href={`/pay?payday=${addDays(payday, 7)}`} scroll={false} aria-label="Next payday">›</Link> : <span className="btn sm" aria-disabled="true">›</span>}
        <span className="muted">Pays for {dayShort(firstDay)} to {dayShort(to)}{to === payday ? ", including payday itself" : ""}</span>
        {payday !== next ? <Link className="btn sm" href="/pay" scroll={false}>Next payday</Link> : null}
      </div>
      <div className="strip plain">
        <div className={toPay ? "alert" : ""}><b>{formatRupees(toPay)}</b><span>Still to pay, everyone ({unpaid.length})</span></div>
        {dailyRows.length ? (
          <div className="hero">
            <b>{formatRupees(dailyOwed)}</b>
            <span>
              Owed to daily workers{weekOpen ? " so far this week" : ""}: {dailyPeople} {dailyPeople === 1 ? "person" : "people"}
              {weekOpen ? `, ${daysFilled} ${daysFilled === 1 ? "day" : "days"} filled in` : ""}
              {dailyAdvances ? `, less ${formatRupees(dailyAdvances)} advance` : ""}
              {dailyUnpaid.length < dailyRows.length ? `, ${dailyRows.length - dailyUnpaid.length} already paid` : ""}
            </span>
          </div>
        ) : null}
        <div><b>{formatRupees(paid)}</b><span>Paid</span></div>
      </div>
      {!rows.length ? <section className="panel empty"><b>Nobody to pay</b>Add your team on the <Link href="/team">Team</Link> page.</section> : (
        <div className="grid">
          {groups.map((g) => (
            <section key={g.k} className="panel">
              <h2>{PAY_TYPE_LABEL[g.k]}</h2>
              <div className="tbl">
                <table>
                  <thead><tr><th>Name</th><th>How it&apos;s worked out</th><th className="num">Amount</th><th /></tr></thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.worker.id}>
                        <td><b>{r.worker.name}</b>{r.worker.role ? <><br /><small className="muted">{r.worker.role}</small></> : null}</td>
                        <td className="muted">{detail(r, day)}</td>
                        <td className="num"><b>{formatRupees(r.paid ? r.paid.amountPaise : r.due)}</b>{r.paid && r.paid.amountPaise !== r.due ? <><br /><small className="muted">sheets now say {formatRupees(r.due)}</small></> : null}</td>
                        <td className="num nw">
                          {r.paid ? (
                            <span className="row-actions" style={{ justifyContent: "flex-end" }}>
                              <span className="chip done">Paid {dayShort(r.paid.paidOn)}</span>
                              <UndoPayment id={r.paid.id} what={`${formatRupees(r.paid.amountPaise)} paid to ${r.worker.name}`} />
                            </span>
                          ) : r.due > 0 ? (
                            <FormDialog title={`Pay ${r.worker.name}`} trigger="Pay" triggerClassName="btn sm primary" submitLabel="Mark paid" action={payWeekly}>
                              <input type="hidden" name="workerId" value={r.worker.id} />
                              <input type="hidden" name="payday" value={payday} />
                              <FormNote>{detail(r, day)}: {formatRupees(r.due)}.</FormNote>
                              <Field label="Amount paid (₹)"><input name="amount" inputMode="decimal" defaultValue={paiseToInput(r.due)} required /></Field>
                              <Field label="Paid on"><input name="paidOn" type="date" defaultValue={paidOn} max={today} required /></Field>
                              <Field label="Note" full><input name="note" /></Field>
                            </FormDialog>
                          ) : <span className="muted">Nothing due</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {unpaid.length ? (
            <div>
              <FormDialog title={`Pay everyone for ${day} ${dayShort(payday)}`} trigger={`Mark everyone paid (${formatRupees(toPay)})`} triggerClassName="btn primary big" submitLabel="Mark all paid" action={payEveryone}>
                <input type="hidden" name="payday" value={payday} />
                <FormNote>Marks {unpaid.length} {unpaid.length === 1 ? "person" : "people"} paid at the amounts shown, {formatRupees(toPay)} in total, dated {dayShort(paidOn)}. Anyone you&apos;ve paid a different amount, pay one by one instead.</FormNote>
              </FormDialog>
            </div>
          ) : null}
          <p className="hint" style={{ margin: 0 }}>Amounts come from the daily sheets, so fill in every day of the week, payday included, before paying. Once someone is marked paid, the amount you paid stays as recorded.</p>
        </div>
      )}
    </>
  );
}

function UndoPayment({ id, what }: { id: string; what: string }) {
  return (
    <FormDialog title="Undo this payment?" trigger="↺" triggerClassName="x" submitLabel="Undo payment" action={deleteWagePayment}>
      <input type="hidden" name="id" value={id} />
      <FormNote>{what} will be removed and show as still to pay.</FormNote>
    </FormDialog>
  );
}

/* ------------------------------------------------------------ month-end salary */

async function SalaryTab({ month, today, day }: { month: string; today: string; day: string }) {
  const rows = await salaryRows(month);
  const [y, m] = month.split("-").map(Number);
  const shift = (n: number) => new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const paidOn = monthEnd <= today ? monthEnd : today;
  return (
    <>
      <div className="periodbar">
        <Link className="btn sm" href={`/pay?tab=salary&month=${shift(-1)}`} scroll={false} aria-label="Previous month">‹</Link>
        <b>{label}</b>
        {shift(1) <= today.slice(0, 7) ? <Link className="btn sm" href={`/pay?tab=salary&month=${shift(1)}`} scroll={false} aria-label="Next month">›</Link> : <span className="btn sm" aria-disabled="true">›</span>}
        <span className="muted">Salary left after {day} payouts and advances</span>
      </div>
      {!rows.length ? <section className="panel empty"><b>No salaried staff</b>Salaried people appear here.</section> : (
        <div className="tbl card">
          <table>
            <thead><tr><th>Name</th><th className="num">Monthly salary</th><th className="num">{day} payouts</th><th className="num">Advances</th><th className="num">Balance to pay</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.worker.id}>
                  <td><b>{r.worker.name}</b>{r.worker.role ? <><br /><small className="muted">{r.worker.role}</small></> : null}</td>
                  <td className="num">{formatRupees(r.salary)}</td>
                  <td className="num">{r.weekly ? `− ${formatRupees(r.weekly)}` : "—"}</td>
                  <td className="num">{r.advances ? `− ${formatRupees(r.advances)}` : "—"}</td>
                  <td className={`num ${r.balance < 0 ? "bad" : ""}`}><b>{formatRupees(r.paid ? r.paid.amountPaise : r.balance)}</b></td>
                  <td className="num nw">
                    {r.paid ? (
                      <span className="row-actions" style={{ justifyContent: "flex-end" }}>
                        <span className="chip done">Paid {dayShort(r.paid.paidOn)}</span>
                        <UndoPayment id={r.paid.id} what={`${label} salary of ${formatRupees(r.paid.amountPaise)} for ${r.worker.name}`} />
                      </span>
                    ) : r.balance > 0 ? (
                      <FormDialog title={`${label} salary: ${r.worker.name}`} trigger="Pay salary" triggerClassName="btn sm primary" submitLabel="Mark paid" action={paySalary}>
                        <input type="hidden" name="workerId" value={r.worker.id} />
                        <input type="hidden" name="forMonth" value={month} />
                        <FormNote>{formatRupees(r.salary)} salary, less {formatRupees(r.weekly)} in {day} payouts and {formatRupees(r.advances)} in advances.</FormNote>
                        <Field label="Amount paid (₹)"><input name="amount" inputMode="decimal" defaultValue={paiseToInput(r.balance)} required /></Field>
                        <Field label="Paid on"><input name="paidOn" type="date" defaultValue={paidOn} max={today} required /></Field>
                        <Field label="Note" full><input name="note" /></Field>
                      </FormDialog>
                    ) : <span className="muted">Nothing left</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>Only {day} payouts actually marked paid come off. Someone who joins or leaves mid-month still shows the full salary here: adjust the amount when you pay.</p>
    </>
  );
}

/* ------------------------------------------------------------ advances */

async function AdvanceButton({ today }: { today: string }) {
  const people = (await listWorkers()).filter((w) => !w.leftOn || w.leftOn >= today);
  if (!people.length) return null;
  return (
    <FormDialog title="Give an advance" trigger="Give an advance" triggerClassName="btn sm" submitLabel="Record advance" action={giveAdvance}>
      <Field label="Person" full>
        <select name="workerId" defaultValue="">
          <option value="" disabled>Pick a person</option>
          {people.map((w) => <option key={w.id} value={w.id}>{w.name} ({PAY_TYPE_LABEL[w.payType]})</option>)}
        </select>
      </Field>
      <Field label="Amount (₹)"><input name="amount" inputMode="decimal" required /></Field>
      <Field label="Given on"><input name="paidOn" type="date" defaultValue={today} max={today} required /></Field>
      <Field label="Note" full><input name="note" placeholder="Reason" /></Field>
      <FormNote>Daily-wage and piece-work advances come off the payday that covers the date given. Salaried advances come off that month&apos;s salary.</FormNote>
    </FormDialog>
  );
}

async function AdvancesTab({ today }: { today: string }) {
  const rows = await recentAdvances(addDays(today, -120));
  if (!rows.length) return <section className="panel empty"><b>No advances in the last four months</b>Use Give an advance when someone takes money before payday.</section>;
  return (
    <section className="panel">
      <h2>Advances <small>last four months</small></h2>
      <div className="tbl">
        <table>
          <thead><tr><th>Given on</th><th>Person</th><th>Comes off</th><th>Note</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="nw">{dayShort(a.paidOn)}</td>
                <td><b>{a.name}</b></td>
                <td className="muted">{a.payType === "salary" ? "Month-end salary" : "That week's payday"}</td>
                <td className="muted">{a.note ?? ""}</td>
                <td className="num">{formatRupees(a.amountPaise)}</td>
                <td className="num"><UndoPayment id={a.id} what={`The ${formatRupees(a.amountPaise)} advance to ${a.name}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
