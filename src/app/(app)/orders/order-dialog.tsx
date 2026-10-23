"use client";

import { useRef, useState, useTransition } from "react";
import { COUNTRIES, INDIA_STATES, LOCATION_TYPE_LABEL, placeName, type LocationType } from "@/lib/locations";
import { formatRupees } from "@/lib/money";
import { deleteOrder, saveOrder } from "./actions";

type Opt = { id: string; name: string; colour?: string };
type Line = { key: number; ballTypeId: string; gradeId: string; qty: string; price: string };
export type OrderInitial = {
  id: string; customer: string; phone: string; dueOn: string; notes: string;
  locationType: LocationType | null; locationCode: string; locationNote: string;
  lines: { ballTypeId: string; gradeId: string; qty: number; price: string }[];
};

type Props = {
  title: string;
  trigger: string;
  triggerClassName?: string;
  initial?: OrderInitial;
  delivered?: Record<string, number>; // already sent per type|grade, when editing
  canDelete?: boolean;
  types: Opt[];
  grades: Opt[];
  customers: { name: string; phone: string | null; location: { type: LocationType; code: string } | null }[];
  usedCountries: string[]; // country codes already on orders, offered first
  ready: Record<string, number>;
  defaultDue: string;
};

let seq = 0;

export function OrderDialog(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [openCount, setOpenCount] = useState(0);
  return (
    <>
      <button type="button" className={props.triggerClassName ?? "btn sm"} onClick={() => { setOpenCount((n) => n + 1); ref.current?.showModal(); }}>{props.trigger}</button>
      <dialog ref={ref} className="dlg wide" aria-label={props.title}>
        <OrderForm key={openCount} {...props} close={() => ref.current?.close()} />
      </dialog>
    </>
  );
}

function OrderForm({ title, initial, delivered = {}, canDelete, types, grades, customers, usedCountries, ready, defaultDue, close }: Props & { close: () => void }) {
  const firstLine = (): Line => ({ key: seq++, ballTypeId: types[0]?.id ?? "", gradeId: grades[0]?.id ?? "", qty: "100", price: "" });
  const [customer, setCustomer] = useState(initial?.customer ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [dueOn, setDueOn] = useState(initial?.dueOn ?? defaultDue);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [locType, setLocType] = useState<LocationType | "">(initial?.locationType ?? "");
  const [locCode, setLocCode] = useState(initial?.locationCode ?? "");
  const [locNote, setLocNote] = useState(initial?.locationNote ?? "");
  const [lines, setLines] = useState<Line[]>(() => initial?.lines.map((l) => ({ key: seq++, ballTypeId: l.ballTypeId, gradeId: l.gradeId, qty: String(l.qty), price: l.price })) ?? [firstLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * Math.round((Number(l.price) || 0) * 100), 0);

  const pickCustomer = (name: string) => {
    setCustomer(name);
    const known = customers.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
    if (known?.phone && !phone) setPhone(known.phone);
    // A repeat customer usually goes to the same place: fill it in if nothing is chosen yet.
    if (known?.location && !locType) { setLocType(known.location.type); setLocCode(known.location.code); }
  };

  const chooseType = (t: LocationType) => {
    if (t === locType) return;
    setLocType(t);
    setLocCode(""); // a state isn't a country, so pick again
  };
  const used = usedCountries.map((c) => ({ code: c, name: placeName("international", c) })).sort((a, b) => a.name.localeCompare(b.name, "en"));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await saveOrder({
        id: initial?.id ?? null, customer, phone, dueOn, notes, locationType: locType, locationCode: locCode, locationNote: locNote,
        lines: lines.map((l) => ({ ballTypeId: l.ballTypeId, gradeId: l.gradeId, qty: Number(l.qty), price: l.price })),
      });
      if (res.ok) close();
      else setError(res.error);
    });
  };

  const remove = () => {
    if (!initial || !window.confirm("Delete this order? This can't be undone.")) return;
    start(async () => {
      const res = await deleteOrder(initial.id);
      if (res.ok) close();
      else setError(res.error);
    });
  };

  return (
    <form onSubmit={submit}>
      <header className="dlg-head"><h3>{title}</h3><button type="button" className="x" onClick={close} aria-label="Close">✕</button></header>
      <div className="dlg-body">
        <label className="fld full"><span>Customer</span>
          <input list="customer-names" value={customer} onChange={(e) => pickCustomer(e.target.value)} required placeholder="Club, dealer or academy" autoComplete="off" />
          <datalist id="customer-names">{customers.map((c) => <option key={c.name} value={c.name} />)}</datalist>
          <small className="hint">Pick an existing customer or type a new name.</small>
        </label>
        <label className="fld"><span>Phone (optional)</span><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="fld"><span>Due date</span><input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} required /></label>

        <div className="fld">
          <span id="loc-type-label">Location</span>
          <div className="seg loc-seg" role="radiogroup" aria-labelledby="loc-type-label">
            {(["domestic", "international"] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={locType === t} onClick={() => chooseType(t)}>{LOCATION_TYPE_LABEL[t]}</button>
            ))}
          </div>
        </div>
        <label className="fld">
          <span>{locType === "international" ? "Country" : "State or union territory"}</span>
          <select value={locCode} onChange={(e) => setLocCode(e.target.value)} disabled={!locType} required>
            <option value="">{!locType ? "Choose domestic or international first" : locType === "domestic" ? "Choose a state" : "Choose a country"}</option>
            {locType === "domestic" ? (
              <>
                <optgroup label="States">{INDIA_STATES.filter((p) => !p.ut).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</optgroup>
                <optgroup label="Union territories">{INDIA_STATES.filter((p) => p.ut).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</optgroup>
              </>
            ) : locType === "international" ? (
              <>
                {used.length ? <optgroup label="Used before">{used.map((p) => <option key={`u-${p.code}`} value={p.code}>{p.name}</option>)}</optgroup> : null}
                <optgroup label="All countries">{COUNTRIES.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</optgroup>
              </>
            ) : null}
          </select>
        </label>
        <label className="fld full"><span>Location note</span><textarea value={locNote} onChange={(e) => setLocNote(e.target.value)} placeholder="City, delivery address, transport or courier details" rows={2} /></label>

        <div className="sub"><span>Balls</span><button type="button" className="btn sm" onClick={() => setLines((ls) => [...ls, { ...firstLine(), ballTypeId: ls.at(-1)?.ballTypeId ?? firstLine().ballTypeId, gradeId: ls.at(-1)?.gradeId ?? firstLine().gradeId, qty: "", price: ls.at(-1)?.price ?? "" }])}>Add line</button></div>
        <div className="olines">
          <div className="oline head"><span>Ball type</span><span>Grade</span><span>Quantity</span><span>Price per ball (₹)</span><span /></div>
          {lines.map((l) => {
            const k = `${l.ballTypeId}|${l.gradeId}`;
            const sent = delivered[k] ?? 0;
            const stock = Math.max(0, ready[k] ?? 0);
            return (
              <div key={l.key} className="oline-wrap">
                <div className="oline">
                  <select value={l.ballTypeId} onChange={(e) => setLine(l.key, { ballTypeId: e.target.value })} aria-label="Ball type">{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                  <select value={l.gradeId} onChange={(e) => setLine(l.key, { gradeId: e.target.value })} aria-label="Grade">{grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
                  <input type="number" min={1} step={1} inputMode="numeric" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} aria-label="Quantity" required />
                  <input inputMode="decimal" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} aria-label="Price per ball" placeholder="540" required />
                  <button type="button" className="x" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))} aria-label="Remove line" disabled={lines.length === 1}>✕</button>
                </div>
                <p className="mnote">
                  <span className={Number(l.qty) > stock ? "warn" : "ok"}>{stock} in ready stock</span>
                  {sent ? <span className="muted">, {sent} already delivered</span> : null}
                </p>
              </div>
            );
          })}
        </div>
        <label className="fld full"><span>Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Logo, stamping, packing" rows={2} /></label>
        <p className="note">Order value <b>{formatRupees(total)}</b>. Ready stock is checked against every open order by due date, earliest first.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
      <footer className="dlg-foot">
        {canDelete ? <button type="button" className="btn danger" style={{ marginRight: "auto" }} onClick={remove} disabled={pending}>Delete order</button> : null}
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="submit" className="btn primary" disabled={pending}>{pending ? "Saving…" : "Save order"}</button>
      </footer>
    </form>
  );
}
