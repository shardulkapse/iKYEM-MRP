"use client";

import { useRef, useState, useTransition } from "react";
import { formatRupees } from "@/lib/money";
import { recordDelivery } from "./actions";

export type DeliverLine = { key: string; ballTypeId: string; gradeId: string; label: string; colour: string; remaining: number; inStock: number; price: string };

type Props = { orderId: string; customer: string; receivedPaise: number; lines: DeliverLine[]; today: string };

export function DeliverDialog(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [openCount, setOpenCount] = useState(0);
  return (
    <>
      <button type="button" className="btn sm primary" onClick={() => { setOpenCount((n) => n + 1); ref.current?.showModal(); }}>Deliver</button>
      <dialog ref={ref} className="dlg wide" aria-label={`Deliver to ${props.customer}`}>
        <DeliverForm key={openCount} {...props} close={() => ref.current?.close()} />
      </dialog>
    </>
  );
}

function DeliverForm({ orderId, customer, receivedPaise, lines, today, close }: Props & { close: () => void }) {
  const [deliveredOn, setDeliveredOn] = useState(today);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.key, String(Math.min(l.remaining, l.inStock))])));
  const [price, setPrice] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.key, l.price])));
  const [paid, setPaid] = useState("");
  const [mode, setMode] = useState<"cash" | "online">("cash");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const value = lines.reduce((a, l) => a + (Number(qty[l.key]) || 0) * Math.round((Number(price[l.key]) || 0) * 100), 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const short = lines.find((l) => (Number(qty[l.key]) || 0) > l.inStock);
    if (short && !window.confirm(`Only ${short.inStock} ${short.label} in ready stock. Deliver ${qty[short.key]} anyway? Ready stock will go below zero until the counts are corrected.`)) return;
    start(async () => {
      const res = await recordDelivery({
        orderId, deliveredOn, paid: paid.trim(), mode,
        lines: lines.map((l) => ({ ballTypeId: l.ballTypeId, gradeId: l.gradeId, qty: Number(qty[l.key]) || 0, price: price[l.key] })),
      });
      if (res.ok) close();
      else setError(res.error);
    });
  };

  return (
    <form onSubmit={submit}>
      <header className="dlg-head"><h3>Deliver to {customer}</h3><button type="button" className="x" onClick={close} aria-label="Close">✕</button></header>
      <div className="dlg-body">
        <label className="fld"><span>Delivered on</span><input type="date" value={deliveredOn} max={today} onChange={(e) => setDeliveredOn(e.target.value)} required /></label>
        <div className="olines">
          <div className="oline dl head"><span>Balls</span><span>Left to send</span><span>In stock</span><span>Sending now</span><span>Price per ball (₹)</span></div>
          {lines.map((l) => (
            <div key={l.key} className="oline dl">
              <span><span className={`swatch sw-${l.colour}`} />{l.label}</span>
              <span className="num">{l.remaining}</span>
              <span className={`num ${l.inStock < l.remaining ? "warn" : ""}`}>{l.inStock}</span>
              <input type="number" min={0} max={l.remaining} step={1} inputMode="numeric" value={qty[l.key]} onChange={(e) => setQty({ ...qty, [l.key]: e.target.value })} aria-label={`${l.label} sending now`} />
              <input inputMode="decimal" value={price[l.key]} onChange={(e) => setPrice({ ...price, [l.key]: e.target.value })} aria-label={`${l.label} price`} required />
            </div>
          ))}
        </div>
        <label className="fld"><span>Paid on delivery (₹, optional)</span><input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" /></label>
        <label className="fld"><span>Paid by</span><select value={mode} onChange={(e) => setMode(e.target.value as "cash" | "online")}><option value="cash">Cash</option><option value="online">Online</option></select></label>
        <p className="note">This delivery is worth <b>{formatRupees(value)}</b>. The balls come out of ready stock and the sale counts on the delivery date.{receivedPaise ? ` They've already paid ${formatRupees(receivedPaise)} on this order.` : ""} Anything unpaid shows under Money to collect.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
      <footer className="dlg-foot">
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="submit" className="btn primary" disabled={pending}>{pending ? "Saving…" : "Record delivery"}</button>
      </footer>
    </form>
  );
}
