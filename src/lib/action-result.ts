import type { z } from "zod";

// What every form action returns, so the dialog can show an error or close.
export type ActionResult = { ok: true } | { ok: false; error: string };

export const ok = (): ActionResult => ({ ok: true });
export const fail = (error: string): ActionResult => ({ ok: false, error });

export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Check the form and try again.";
}

// Postgres error code from a failed query (Drizzle wraps the driver error in `cause`).
// 23505 = unique violation, 23503 = foreign key violation, 23514 = check constraint.
export function pgCode(e: unknown): string | undefined {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.cause?.code ?? x?.code;
}
