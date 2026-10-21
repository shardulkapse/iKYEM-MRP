import { Field, FormNote } from "@/components/fields";
import type { workers } from "@/db/schema";
import { PAY_TYPE_LABEL } from "@/lib/labels";
import { formatRupees, paiseToInput } from "@/lib/money";

export type Worker = typeof workers.$inferSelect;

// The add and edit person form. Plain markup, so it works inside server-rendered dialogs.
export function WorkerFields({ w, day }: { w?: Worker; day: string }) {
  return (
    <>
      <input type="hidden" name="id" value={w?.id ?? ""} />
      <Field label="Name"><input name="name" defaultValue={w?.name} required autoComplete="off" /></Field>
      <Field label="Role (optional)"><input name="role" defaultValue={w?.role ?? ""} placeholder="e.g. Manager, Helper" /></Field>
      <Field label="Paid by">
        <select name="payType" defaultValue={w?.payType ?? "daily"}>{Object.entries(PAY_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Field label="Rate (₹)" hint="Daily wage, rate per piece, or monthly salary."><input name="rate" inputMode="decimal" defaultValue={paiseToInput(w?.ratePaise)} required placeholder="550" /></Field>
      <Field label={`${day} payout (salaried only, ₹)`} hint="Comes off the month-end salary."><input name="weeklyPayout" inputMode="decimal" defaultValue={paiseToInput(w?.weeklyPayoutPaise)} placeholder="1000" /></Field>
      <Field label="Started on"><input name="startedOn" type="date" defaultValue={w?.startedOn ?? ""} /></Field>
      <Field label="Left on" hint="Leave empty while they work here."><input name="leftOn" type="date" defaultValue={w?.leftOn ?? ""} /></Field>
      <FormNote>Nobody is tied to a task. On the daily sheet you pick who did which work, and this screen adds it up. Piece workers are paid for every piece logged against them, at any task.</FormNote>
    </>
  );
}

// "₹550 a day", "₹9.50 a piece", "₹26,000 a month, ₹1,500 every Tuesday"
export function payLine(w: Worker, day: string) {
  return w.payType === "daily" ? `${formatRupees(w.ratePaise)} a day`
    : w.payType === "piece" ? `${formatRupees(w.ratePaise)} a piece`
    : `${formatRupees(w.ratePaise)} a month${w.weeklyPayoutPaise ? `, ${formatRupees(w.weeklyPayoutPaise)} every ${day}` : ""}`;
}
