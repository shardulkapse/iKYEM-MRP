import Link from "next/link";
import { Field, FormNote } from "@/components/fields";
import { FormDialog } from "@/components/form-dialog";
import { InfoDialog } from "@/components/info-dialog";
import { dayShort } from "@/lib/day";
import { LOCATION_TYPE_LABEL, placeName } from "@/lib/locations";
import { formatRupees, paiseToInput } from "@/lib/money";
import { lineKey, type OrderView } from "@/lib/order-queries";
import { deleteReceipt, recordPayment, undoDelivery } from "./actions";
import type { OrderInitial } from "./order-dialog";

// Pieces of an order shared by the Orders and Customers screens: its details dialog, its payments,
// the payment form, and how its location reads.

export type Names = { type: (id: string) => { name: string; colour: string }; grade: (id: string) => string };

export function makeNames(types: { id: string; name: string; colour: string }[], grades: { id: string; name: string }[]): Names {
  const typeMap = new Map(types.map((t) => [t.id, t]));
  const gradeMap = new Map(grades.map((g) => [g.id, g.name]));
  return {
    type: (id) => ({ name: typeMap.get(id)?.name ?? "(removed type)", colour: typeMap.get(id)?.colour ?? "red" }),
    grade: (id) => gradeMap.get(id) ?? "(removed grade)",
  };
}

// The customer's name, linking to their page.
export function CustomerLink({ o }: { o: OrderView }) {
  return <Link className="who" href={`/customers/${o.customerId}`}>{o.customer}</Link>;
}

/* ------------------------------------------------------------ location */

// What the edit form starts with for an existing order.
export function initialOf(o: OrderView): OrderInitial {
  return {
    id: o.id, customer: o.customer, phone: o.phone ?? "", dueOn: o.dueOn, notes: o.notes ?? "",
    locationType: o.locationType, locationCode: o.locationCode ?? "", locationNote: o.locationNote ?? "",
    lines: o.lines.map((l) => ({ ballTypeId: l.ballTypeId, gradeId: l.gradeId, qty: l.qty, price: paiseToInput(l.pricePaise) })),
  };
}

// "Maharashtra", or "United Kingdom · International"
export function locationText(o: OrderView) {
  if (!o.locationType) return null;
  const name = placeName(o.locationType, o.locationCode);
  return o.locationType === "international" ? `${name} · International` : name;
}

export function LocationLine({ o }: { o: OrderView }) {
  const t = locationText(o);
  return t ? <><br /><small className="muted">{t}{o.locationNote ? `, ${o.locationNote}` : ""}</small></> : null;
}

/* ------------------------------------------------------------ payments */

export function PaymentButton({ o, today, label = "Payment", primary }: { o: OrderView; today: string; label?: string; primary?: boolean }) {
  const due = o.deliveries.length ? o.owedPaise : o.balancePaise;
  return (
    <FormDialog title={`Payment from ${o.customer}`} trigger={label} triggerClassName={primary ? "btn sm primary" : "btn sm"} submitLabel="Record payment" action={recordPayment}>
      <input type="hidden" name="orderId" value={o.id} />
      <FormNote>
        Order worth <b>{formatRupees(o.valuePaise)}</b>{o.deliveries.length ? `, ${formatRupees(o.deliveredValuePaise)} delivered so far` : ", nothing delivered yet"}. Received <b>{formatRupees(o.receivedPaise)}</b>.
      </FormNote>
      <Field label={o.deliveries.length ? "Amount received (₹)" : "Advance received (₹)"}><input name="amount" inputMode="decimal" defaultValue={due ? paiseToInput(due) : ""} required /></Field>
      <Field label="Received on"><input name="receivedOn" type="date" defaultValue={today} max={today} required /></Field>
      <Field label="Paid by"><select name="mode" defaultValue="online"><option value="online">Online</option><option value="cash">Cash</option></select></Field>
      <Field label="Note"><input name="note" placeholder="UPI reference, advance…" /></Field>
    </FormDialog>
  );
}

export function PaymentsList({ o, owner }: { o: OrderView; owner: boolean }) {
  if (!o.receipts.length) return <span className="muted">None yet</span>;
  return (
    <div className="pays">
      {o.receipts.map((r) => (
        <div key={r.id}>
          {dayShort(r.receivedOn)}: {formatRupees(r.amountPaise)} <span className="muted">{r.mode === "cash" ? "Cash" : "Online"}</span>
          {owner ? (
            <FormDialog title="Delete this payment?" trigger="✕" triggerClassName="x" submitLabel="Delete payment" action={deleteReceipt}>
              <input type="hidden" name="receiptId" value={r.id} />
              <FormNote>{formatRupees(r.amountPaise)} received {dayShort(r.receivedOn)} from {o.customer}. They&apos;ll show as owing it again.</FormNote>
            </FormDialog>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ order details */

export function OrderDetails({ o, names, owner }: { o: OrderView; names: Names; owner: boolean }) {
  return (
    <InfoDialog title={o.customer} trigger="View">
      <dl className="kv">
        <dt>Due</dt><dd>{dayShort(o.dueOn)}</dd>
        <dt>Location</dt><dd>{o.locationType ? <>{placeName(o.locationType, o.locationCode)} <span className="muted">({LOCATION_TYPE_LABEL[o.locationType]})</span>{o.locationNote ? <><br /><span className="muted">{o.locationNote}</span></> : null}</> : <span className="muted">Not set</span>}</dd>
        <dt>Status</dt><dd>{o.status === "closed" ? "Delivered" : "Open"}</dd>
        <dt>Order value</dt><dd>{formatRupees(o.valuePaise)}</dd>
        <dt>Delivered</dt><dd>{formatRupees(o.deliveredValuePaise)}</dd>
        <dt>Received</dt><dd>{formatRupees(o.receivedPaise)}</dd>
        <dt>Still owed</dt><dd>{formatRupees(o.owedPaise)}</dd>
      </dl>
      <h4>Lines</h4>
      <div className="tbl"><table>
        <thead><tr><th>Balls</th><th className="num">Ordered</th><th className="num">Delivered</th><th className="num">Left</th><th className="num">Price</th></tr></thead>
        <tbody>{o.lines.map((l) => { const k = lineKey(l.ballTypeId, l.gradeId); const t = names.type(l.ballTypeId); return (
          <tr key={l.id}><td><span className={`swatch sw-${t.colour}`} />{t.name}, {names.grade(l.gradeId)}</td><td className="num">{l.qty}</td><td className="num">{o.delivered[k] ?? 0}</td><td className="num">{o.remaining[k] ?? 0}</td><td className="num">{formatRupees(l.pricePaise)}</td></tr>
        ); })}</tbody>
      </table></div>
      <h4>Deliveries</h4>
      {o.deliveries.length ? (
        <div className="list">{o.deliveries.map((d) => (
          <div key={d.id} className="row">
            <span>{dayShort(d.deliveredOn)}: {d.lines.map((l) => `${l.qty} ${names.type(l.ballTypeId).name}, ${names.grade(l.gradeId)}`).join("; ")}<br /><small className="muted">{formatRupees(d.valuePaise)}</small></span>
            {owner ? (
              <FormDialog title="Undo this delivery?" trigger="Undo" submitLabel="Undo delivery" action={undoDelivery}>
                <input type="hidden" name="deliveryId" value={d.id} />
                <FormNote>The balls go back into ready stock, the sale is removed, and the order reopens. Payments stay as they are.</FormNote>
              </FormDialog>
            ) : null}
          </div>
        ))}</div>
      ) : <p className="muted">None yet.</p>}
      <h4>Payments</h4>
      <PaymentsList o={o} owner={owner} />
    </InfoDialog>
  );
}

