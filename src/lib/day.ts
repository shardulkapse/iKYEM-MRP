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

// weeklyOff is the one day a week the factory is shut (0 = Sunday … 6 = Saturday), or null when it
// opens every day. iKYEM: 3, Wednesday off, so the working week runs Thursday to Tuesday.
export function isWorkDay(day: string, weeklyOff: number | null): boolean {
  return weeklyOff == null || asUTC(day).getUTCDay() !== weeklyOff;
}

export function dayLong(day: string): string {
  return asUTC(day).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export function dayShort(day: string): string {
  return asUTC(day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

// Count forward/back over working days only (the weekly holiday is skipped).
export function addWorkDays(day: string, n: number, weeklyOff: number | null): string {
  let d = day;
  for (let k = 0; k < n; ) { d = addDays(d, 1); if (isWorkDay(d, weeklyOff)) k++; }
  return d;
}
export function subWorkDays(day: string, n: number, weeklyOff: number | null): string {
  let d = day;
  for (let k = 0; k < n; ) { d = addDays(d, -1); if (isWorkDay(d, weeklyOff)) k++; }
  return d;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// "Thursday to Tuesday, Wednesday off" or "Every day"
export function workWeekText(weeklyOff: number | null): string {
  if (weeklyOff == null) return "Every day";
  return `${WEEKDAY_NAMES[(weeklyOff + 1) % 7]} to ${WEEKDAY_NAMES[(weeklyOff + 6) % 7]}, ${WEEKDAY_NAMES[weeklyOff]} off`;
}

// 0 = Sunday ... 6 = Saturday
export const weekdayOf = (day: string) => asUTC(day).getUTCDay();
