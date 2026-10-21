import Link from "next/link";
import { PERIOD_KINDS, periodRange, shiftPeriod, type PeriodKind } from "@/lib/periods";

// Week / Month / Quarter / Year switch with previous and next, as links (?period=...&ref=...).
export function PeriodBar({ base, kind, refDay, today, extra }: { base: string; kind: PeriodKind; refDay: string; today: string; extra?: React.ReactNode }) {
  const p = periodRange(kind, refDay);
  const join = base.includes("?") ? "&" : "?";
  const href = (k: PeriodKind, r: string) => `${base}${join}period=${k}&ref=${r}`;
  const prev = shiftPeriod(kind, refDay, -1), next = shiftPeriod(kind, refDay, 1);
  return (
    <div className="periodbar">
      <span className="seg">{PERIOD_KINDS.map((k) => <Link key={k.key} href={href(k.key, refDay)} aria-current={k.key === kind ? "page" : undefined} scroll={false}>{k.label}</Link>)}</span>
      <Link className="btn sm" href={href(kind, prev)} scroll={false} aria-label="Previous period">‹</Link>
      <b>{p.label}</b>
      {periodRange(kind, next).from <= today ? <Link className="btn sm" href={href(kind, next)} scroll={false} aria-label="Next period">›</Link> : <span className="btn sm" aria-disabled="true">›</span>}
      {p.sub ? <span className="muted">{p.sub}</span> : null}
      {extra ? <span style={{ marginLeft: "auto" }}>{extra}</span> : null}
    </div>
  );
}
