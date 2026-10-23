"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Place } from "@/lib/locations";

export type LocationScope = "" | "domestic" | "international" | "unset";

type Props = {
  scope: LocationScope;
  selected: string[];
  options: { domestic: Place[]; international: Place[] }; // places that appear on orders
  hasUnset: boolean;                                       // some orders have no location yet
  period: string;
  refDay: string;
};

// Delivered tab filter: first domestic or international, then any number of states or countries.
// The choice lives in the address (?loc=domestic&in=MH,KA) like the period does.
export function LocationFilter({ scope, selected, options, hasUnset, period, refDay }: Props) {
  const router = useRouter();
  const go = (s: LocationScope, places: string[]) => {
    const q = new URLSearchParams({ tab: "done", period, ref: refDay });
    if (s) q.set("loc", s);
    if (places.length) q.set("in", places.join(","));
    router.push(`/orders?${q}`, { scroll: false });
  };
  const list = scope === "domestic" || scope === "international" ? options[scope] : [];
  const nameOf = (code: string) => list.find((p) => p.code === code)?.name ?? code;

  return (
    <div className="ofilter">
      <label className="ofield">
        <span>Location</span>
        <select value={scope} onChange={(e) => go(e.target.value as LocationScope, [])}>
          <option value="">All locations</option>
          <option value="domestic">Domestic</option>
          <option value="international">International</option>
          {hasUnset || scope === "unset" ? <option value="unset">Not set (older orders)</option> : null}
        </select>
      </label>
      {scope === "domestic" || scope === "international" ? (
        list.length ? (
          <PlacePicker
            key={`${scope}|${selected.join(",")}`}
            label={scope === "domestic" ? "States" : "Countries"}
            noun={scope === "domestic" ? ["state", "states"] : ["country", "countries"]}
            options={list}
            selected={selected}
            apply={(codes) => go(scope, codes)}
          />
        ) : (
          <p className="hint" style={{ margin: "0 0 10px" }}>No {scope} orders have a {scope === "domestic" ? "state" : "country"} yet.</p>
        )
      ) : null}
      {selected.length ? (
        <div className="ochips">
          {selected.map((c) => (
            <button key={c} type="button" className="chip" onClick={() => go(scope, selected.filter((x) => x !== c))} aria-label={`Remove ${nameOf(c)}`}>
              {nameOf(c)} ✕
            </button>
          ))}
          <button type="button" className="link-btn" onClick={() => go(scope, [])}>Clear</button>
        </div>
      ) : null}
    </div>
  );
}

function PlacePicker({ label, noun, options, selected, apply }: {
  label: string; noun: [string, string]; options: Place[]; selected: string[]; apply: (codes: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string[]>(selected);
  const [search, setSearch] = useState("");
  const box = useRef<HTMLDivElement>(null);

  // close when clicking elsewhere or pressing Escape, dropping unapplied ticks
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setPick(selected); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setPick(selected); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open, selected]);

  const shown = options.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const summary = !selected.length ? `All ${noun[1]}` : selected.length === 1 ? (options.find((p) => p.code === selected[0])?.name ?? selected[0]) : `${selected.length} ${noun[1]}`;
  const toggle = (code: string) => setPick((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  return (
    <div className="ofield" ref={box}>
      <span>{label}</span>
      <button type="button" className="opick" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{summary}<span aria-hidden="true">▾</span></button>
      {open ? (
        <div className="opop" role="dialog" aria-label={`Choose ${noun[1]}`}>
          {options.length > 8 ? <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${noun[1]}`} autoFocus /> : null}
          <div className="olist">
            {shown.map((p) => (
              <label key={p.code}><input type="checkbox" checked={pick.includes(p.code)} onChange={() => toggle(p.code)} />{p.name}</label>
            ))}
            {!shown.length ? <p className="muted" style={{ margin: 8 }}>No {noun[0]} matches.</p> : null}
          </div>
          <div className="ofoot">
            <button type="button" className="btn sm" onClick={() => setPick([])} disabled={!pick.length}>Clear</button>
            <button type="button" className="btn sm primary" onClick={() => { setOpen(false); apply(pick); }}>
              {pick.length ? `Show ${pick.length} ${pick.length === 1 ? noun[0] : noun[1]}` : `Show all ${noun[1]}`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
