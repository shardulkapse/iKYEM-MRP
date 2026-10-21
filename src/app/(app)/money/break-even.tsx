"use client";

import { useState } from "react";
import { formatRupees } from "@/lib/money";

type Defaults = { price: number; materials: number; piece: number; fixed: number; fixedNote: string; workDays: number; soldThisMonth: number; finishedPerDay: number | null };

const toRs = (paise: number) => String(Math.round(paise) / 100);
const fromRs = (v: string) => Math.round((Number(v) || 0) * 100);

// Play with price and costs to see how many balls a month cover everything, and hit a profit target.
export function BreakEven({ d }: { d: Defaults }) {
  const initial = { price: toRs(d.price), materials: toRs(d.materials), piece: toRs(d.piece), fixed: toRs(d.fixed), target: "50000" };
  const [v, setV] = useState(initial);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  const margin = fromRs(v.price) - fromRs(v.materials) - fromRs(v.piece);
  const fixed = fromRs(v.fixed), target = fromRs(v.target);
  const be = margin > 0 ? Math.ceil(fixed / margin) : null;
  const tg = margin > 0 ? Math.ceil((fixed + target) / margin) : null;
  const pct = be ? Math.min(100, Math.round((d.soldThisMonth / be) * 100)) : 0;

  return (
    <div className="grid g2">
      <section className="panel">
        <h2>Your numbers <small>per month</small></h2>
        <div className="calc">
          <label className="fld"><span>Average selling price per ball (₹)</span><input inputMode="decimal" value={v.price} onChange={set("price")} /><small className="hint">From recent deliveries. Change it to try other prices.</small></label>
          <label className="fld"><span>Materials per ball (₹)</span><input inputMode="decimal" value={v.materials} onChange={set("materials")} /><small className="hint">Leather, cork and other materials, averaged across ball types.</small></label>
          <label className="fld"><span>Piece-rate labour per ball (₹)</span><input inputMode="decimal" value={v.piece} onChange={set("piece")} /><small className="hint">The piece rates of everyone paid by the piece.</small></label>
          <label className="fld"><span>Monthly costs that don&apos;t change with output (₹)</span><input inputMode="decimal" value={v.fixed} onChange={set("fixed")} /><small className="hint">{d.fixedNote}</small></label>
          <label className="fld"><span>Profit you want in a month (₹)</span><input inputMode="decimal" value={v.target} onChange={set("target")} /></label>
        </div>
        <button type="button" className="btn sm" style={{ marginTop: 12 }} onClick={() => setV(initial)}>Reset to my numbers</button>
      </section>
      <section className="panel">
        <h2>What it takes each month</h2>
        {margin > 0 ? (
          <>
            <div className="sline"><span>Each ball leaves you<br /><small className="muted">before fixed costs</small></span><b>{formatRupees(margin)}</b></div>
            <div className="sline"><span>To break even<br /><small className="muted">cover every cost, profit zero</small></span><b>{be!.toLocaleString("en-IN")} balls<br /><small>{formatRupees(be! * fromRs(v.price))} of sales</small></b></div>
            <div className="sline total"><span>To make {formatRupees(target)}</span><b>{tg!.toLocaleString("en-IN")} balls<br /><small>{formatRupees(tg! * fromRs(v.price))} of sales</small></b></div>
            <p style={{ margin: "14px 0 6px" }}>That&apos;s about <b>{Math.ceil(tg! / d.workDays)} balls sold every working day</b> across {d.workDays} working days.{d.finishedPerDay != null ? ` Right now the factory finishes about ${Math.round(d.finishedPerDay)} a day.` : ""}</p>
            <div className="seam" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
            <p className="hint" style={{ marginTop: 6 }}>{d.soldThisMonth.toLocaleString("en-IN")} balls delivered so far this month: {pct}% of the way to break-even.</p>
          </>
        ) : <p className="bad" style={{ margin: 0 }}>At these numbers each ball loses money, so no amount of sales covers your costs. Raise the price or lower the cost per ball.</p>}
      </section>
    </div>
  );
}
