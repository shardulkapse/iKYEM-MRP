import "server-only";
import { connection } from "next/server";

// The factory runs on India time. Vercel servers run on UTC, so "today" must be worked out
// in Asia/Kolkata or entries made after midnight IST would land on the previous day.
export const FACTORY_TZ = "Asia/Kolkata";

// Pure conversion, safe anywhere (and easy to test).
export function factoryDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FACTORY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Today's date in the factory. Reading the clock must happen per request, never while Next.js
// prerenders the page, so connection() marks this as request-time before the clock is read.
export async function todayInFactory(): Promise<string> {
  await connection();
  return factoryDate(new Date());
}

export function formatLong(day: string): string {
  return new Date(day + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
