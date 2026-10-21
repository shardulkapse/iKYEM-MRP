"use client";

import { useState } from "react";
import { formatRupees } from "@/lib/money";

function simulate(balance: number, monthlyRate: number, payment: number) {
  let b = balance, interest = 0, months = 0;
  while (b > 50 && months < 600) {
    const i = b * monthlyRate;
    interest += i;
    b = b + i - Math.min(payment, b + i);
    months++;
  }
  return { months, interest };
}

// "What if I paid a bit more each month?"
export function LoanExtra({ balance, ratePct, emi }: { balance: number; ratePct: number; emi: number }) {
  const [extra, setExtra] = useState("");
  const add = Math.round((Number(extra) || 0) * 100);
  const mr = ratePct / 100 / 12;
  const base = simulate(balance, mr, emi);
  const faster = add > 0 ? simulate(balance, mr, emi + add) : null;
  return (
    <div className="calc" style={{ maxWidth: 440, marginTop: 12 }}>
      <label className="fld"><span>Pay extra each month (₹)</span><input inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. 2000" /></label>
      {faster ? (
        <p style={{ margin: 0 }}>
          Paying {formatRupees(add)} more each month finishes <b>{base.months - faster.months} months sooner</b>
          {ratePct ? <> and saves about <b>{formatRupees(Math.round(base.interest - faster.interest))}</b> in interest</> : null}.
        </p>
      ) : null}
    </div>
  );
}
