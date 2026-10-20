import { Field, FormNote } from "@/components/fields";
import { FormDialog } from "@/components/form-dialog";
import { ComingNext, PageHeader, Streamed } from "@/components/page";
import { SkeletonList } from "@/components/skeletons";
import type { workers } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { PAY_TYPE_LABEL, WEEKDAYS } from "@/lib/labels";
import { formatRupees, paiseToInput } from "@/lib/money";
import { getSettings, listWorkers } from "@/lib/setup-queries";
import { saveWorker } from "./actions";

export const metadata = { title: "Pay" };

type Worker = typeof workers.$inferSelect;

export default function PayPage() {
  return (
    <>
      <PageHeader title="Pay" sub="Your team now. Paydays, month-end salaries and advances come next." />
      <div className="grid" style={{ gap: 18 }}>
        <Streamed fallback={<section className="panel"><SkeletonList rows={6} /></section>}><Team /></Streamed>
        <ComingNext what="The weekly payday worked out from the daily sheets, month-end salary balances, and advances." />
      </div>
    </>
  );
}

async function Team() {
  await requireRole(["owner"]);
  const [all, settings] = await Promise.all([listWorkers(), getSettings()]);
  const payday = WEEKDAYS[settings.payWeekday];
  const current = all.filter((w) => !w.leftOn);
  const left = all.filter((w) => w.leftOn);
  const payLine = (w: Worker) =>
    w.payType === "daily" ? `${formatRupees(w.ratePaise)} a day`
    : w.payType === "piece" ? `${formatRupees(w.ratePaise)} a piece`
    : `${formatRupees(w.ratePaise)} a month${w.weeklyPayoutPaise ? `, ${formatRupees(w.weeklyPayoutPaise)} every ${payday}` : ""}`;
  const row = (w: Worker) => (
    <div key={w.id} className={w.leftOn ? "row archived" : "row"}>
      <span><b>{w.name}</b>{w.role ? <span className="muted"> {w.role}</span> : null}<br /><small className="muted">{PAY_TYPE_LABEL[w.payType]}: {payLine(w)}{w.leftOn ? `. Left ${w.leftOn}` : ""}</small></span>
      <span className="row-actions"><FormDialog title={`Edit ${w.name}`} trigger="Edit" action={saveWorker}><WorkerFields w={w} payday={payday} /></FormDialog></span>
    </div>
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Team <small>{current.length} {current.length === 1 ? "person" : "people"}</small></h2>
        <FormDialog title="New person" trigger="Add person" triggerClassName="btn sm primary" action={saveWorker}><WorkerFields payday={payday} /></FormDialog>
      </div>
      {current.length ? <div className="list">{current.map(row)}</div> : <p className="muted" style={{ margin: 0 }}>Nobody added yet.</p>}
      {left.length ? <details className="more"><summary>People who have left ({left.length})</summary><div className="list">{left.map(row)}</div></details> : null}
    </section>
  );
}

function WorkerFields({ w, payday }: { w?: Worker; payday: string }) {
  return (
    <>
      <input type="hidden" name="id" value={w?.id ?? ""} />
      <Field label="Name"><input name="name" defaultValue={w?.name} required autoComplete="off" /></Field>
      <Field label="Role (optional)"><input name="role" defaultValue={w?.role ?? ""} placeholder="e.g. Manager, Helper" /></Field>
      <Field label="Paid by">
        <select name="payType" defaultValue={w?.payType ?? "daily"}>{Object.entries(PAY_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Field label="Rate (₹)" hint="Daily wage, rate per piece, or monthly salary."><input name="rate" inputMode="decimal" defaultValue={paiseToInput(w?.ratePaise)} required placeholder="550" /></Field>
      <Field label={`${payday} payout (salaried only, ₹)`} hint="Comes off the month-end salary."><input name="weeklyPayout" inputMode="decimal" defaultValue={paiseToInput(w?.weeklyPayoutPaise)} placeholder="1000" /></Field>
      <Field label="Started on"><input name="startedOn" type="date" defaultValue={w?.startedOn ?? ""} /></Field>
      <Field label="Left on" hint="Leave empty while they work here."><input name="leftOn" type="date" defaultValue={w?.leftOn ?? ""} /></Field>
      <FormNote>Nobody is tied to a stage. On the daily sheet you pick who did which work. Piece workers are paid for every piece logged against them, at any stage.</FormNote>
    </>
  );
}
