// Reporting periods. Weeks run Monday to Sunday; quarters and years follow the Indian
// financial year (April to March), so "Q1" is April to June and "FY 2026–27" starts 1 April 2026.

import { addDays } from "./day";

export type PeriodKind = "week" | "month" | "quarter" | "year";
export const PERIOD_KINDS: { key: PeriodKind; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const monthLabel = (day: string) => new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (day: string) => new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export function periodRange(kind: PeriodKind, ref: string): { from: string; to: string; label: string; sub?: string } {
  const d = new Date(ref + "T00:00:00Z");
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (kind === "week") {
    const from = addDays(ref, -((d.getUTCDay() + 6) % 7));
    const to = addDays(from, 6);
    return { from, to, label: `Week of ${shortDate(from)}`, sub: `${shortDate(from)} to ${shortDate(to)}` };
  }
  if (kind === "month") return { from: iso(y, m, 1), to: iso(y, m + 1, 0), label: monthLabel(ref) };
  const fy = m >= 3 ? y : y - 1;
  const fyLabel = `FY ${fy}–${String(fy + 1).slice(2)}`;
  if (kind === "quarter") {
    const q = Math.floor(((m - 3 + 12) % 12) / 3);
    const from = iso(fy, 3 + q * 3, 1), to = iso(fy, 3 + q * 3 + 3, 0);
    return { from, to, label: `Q${q + 1} ${fyLabel}`, sub: `${monthLabel(from)} to ${monthLabel(to)}` };
  }
  return { from: iso(fy, 3, 1), to: iso(fy + 1, 2, 31), label: fyLabel, sub: `April ${fy} to March ${fy + 1}` };
}

export function shiftPeriod(kind: PeriodKind, ref: string, n: number): string {
  if (kind === "week") return addDays(ref, 7 * n);
  const d = new Date(ref + "T00:00:00Z");
  const months = kind === "month" ? n : kind === "quarter" ? 3 * n : 12 * n;
  return iso(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
}

export function isPeriodKind(v: unknown): v is PeriodKind {
  return v === "week" || v === "month" || v === "quarter" || v === "year";
}
