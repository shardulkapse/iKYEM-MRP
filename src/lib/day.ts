// Calendar helpers for "YYYY-MM-DD" factory dates. Pure string/UTC arithmetic, so they give
// the same answer in the browser and on the server whatever the machine's time zone.

const asUTC = (day: string) => new Date(day + "T00:00:00Z");

export function addDays(day: string, n: number): string {
  const d = asUTC(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isValidDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(asUTC(day).getTime()) && asUTC(day).toISOString().slice(0, 10) === day;
}

// workDays 6 = Monday to Saturday (Sunday off), 7 = every day
export function isWorkDay(day: string, workDays: number): boolean {
  return workDays >= 7 || asUTC(day).getUTCDay() !== 0;
}

export function dayLong(day: string): string {
  return asUTC(day).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export function dayShort(day: string): string {
  return asUTC(day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

// Count forward/back over working days only (Sundays skipped on a 6-day week).
export function addWorkDays(day: string, n: number, workDays: number): string {
  let d = day;
  for (let k = 0; k < n; ) { d = addDays(d, 1); if (isWorkDay(d, workDays)) k++; }
  return d;
}
export function subWorkDays(day: string, n: number, workDays: number): string {
  let d = day;
  for (let k = 0; k < n; ) { d = addDays(d, -1); if (isWorkDay(d, workDays)) k++; }
  return d;
}
