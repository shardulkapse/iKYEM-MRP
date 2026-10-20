"use server";

import { eq, inArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { attendance, attendanceStatus, ballTypes, daySheets, gradings, materials, stage, workEntries } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { todayInFactory } from "@/lib/dates";
import { STAGE_BY_ID, stageAppliesTo } from "@/lib/stages";

export type SaveDayResult = { ok: true; updatedAt: string } | { ok: false; error: string };

const count = z.number().int("Counts are whole numbers.").min(0, "Counts can't be negative.").max(100000, "That count is too large.");

const sheetSchema = z.object({
  day: z.iso.date(),
  closed: z.boolean(),
  expectedUpdatedAt: z.string().nullable(),
  attendance: z.record(z.uuid(), z.enum(attendanceStatus.enumValues)),
  work: z
    .array(
      z.object({
        stage: z.enum(stage.enumValues),
        workerId: z.uuid().nullable(),
        ballTypeId: z.uuid(),
        good: count,
        rejected: count,
        leatherId: z.uuid().nullable(),
        supplierId: z.uuid().nullable(),
        sheets: z.number().min(0, "Sheets can't be negative.").max(10000).nullable(),
      }),
    )
    .max(500),
  grading: z
    .array(z.object({ ballTypeId: z.uuid(), supplierId: z.uuid().nullable(), gradeId: z.uuid().nullable(), rejected: z.boolean(), qty: count.min(1) }))
    .max(500),
});

// Saves one whole day: attendance, every work row, and grading. The day's previous rows are
// replaced in a single all-or-nothing batch, so a failed save never leaves half a day behind.
export async function saveDaySheet(input: unknown): Promise<SaveDayResult> {
  const { userId } = await requireRole(["owner", "manager"]);
  const parsed = sheetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Something in the sheet isn't valid." };
  const s = parsed.data;

  const today = await todayInFactory();
  if (s.day > today) return { ok: false, error: "You can't fill in a day that hasn't happened yet." };

  // Someone else saved this day after this sheet was opened: don't overwrite their work.
  const [existing] = await db.select().from(daySheets).where(eq(daySheets.day, s.day));
  if (existing && existing.updatedAt.toISOString() !== s.expectedUpdatedAt) {
    return { ok: false, error: "Someone else saved this day while you were editing. Copy anything you need, then reload the page to see their changes." };
  }

  // Every row must make sense for its ball type and stage.
  const typeIds = [...new Set([...s.work.map((w) => w.ballTypeId), ...s.grading.map((g) => g.ballTypeId)])];
  const types = typeIds.length ? await db.select().from(ballTypes).where(inArray(ballTypes.id, typeIds)) : [];
  const typeById = new Map(types.map((t) => [t.id, t]));
  const leatherIds = [...new Set(s.work.map((w) => w.leatherId).filter((x): x is string => !!x))];
  const leathers = leatherIds.length ? await db.select().from(materials).where(inArray(materials.id, leatherIds)) : [];
  const leatherOk = new Set(leathers.filter((m) => m.kind === "leather").map((m) => m.id));

  for (const w of s.work) {
    const st = STAGE_BY_ID[w.stage];
    const t = typeById.get(w.ballTypeId);
    if (!t) return { ok: false, error: "One of the rows uses a ball type that no longer exists." };
    if (!stageAppliesTo(st, t)) return { ok: false, error: `${t.name} doesn't go through ${st.name.toLowerCase()}${st.workflow ? ` (${st.workflow} stitched)` : ""}.` };
    if (w.stage !== "cutting" && !w.workerId) return { ok: false, error: `Pick who did the work on every ${st.name.toLowerCase()} row.` };
    if (w.leatherId && !leatherOk.has(w.leatherId)) return { ok: false, error: "A cutting row's leather isn't a leather material." };
  }
  for (const g of s.grading) if (!typeById.has(g.ballTypeId)) return { ok: false, error: "A grading row uses a ball type that no longer exists." };

  // Anyone logged against work is at least present.
  const att = { ...s.attendance };
  for (const w of s.work) if (w.workerId && !att[w.workerId]) att[w.workerId] = "present";

  const now = new Date();
  const ops: BatchItem<"pg">[] = [
    db.insert(daySheets).values({ day: s.day, closed: s.closed, updatedAt: now, updatedBy: userId })
      .onConflictDoUpdate({ target: daySheets.day, set: { closed: s.closed, updatedAt: now, updatedBy: userId } }),
    db.delete(attendance).where(eq(attendance.day, s.day)),
    db.delete(workEntries).where(eq(workEntries.day, s.day)),
    db.delete(gradings).where(eq(gradings.day, s.day)),
  ];
  const attRows = Object.entries(att).map(([workerId, status]) => ({ day: s.day, workerId, status }));
  if (attRows.length) ops.push(db.insert(attendance).values(attRows));
  if (s.work.length) {
    ops.push(
      db.insert(workEntries).values(
        s.work.map((w, i) => {
          const cutting = w.stage === "cutting";
          return {
            day: s.day,
            stage: w.stage,
            workerId: w.workerId,
            ballTypeId: w.ballTypeId,
            good: w.good,
            rejected: cutting ? 0 : w.rejected,
            leatherId: cutting ? w.leatherId : null,
            supplierId: cutting ? w.supplierId : null,
            sheets: cutting && w.sheets != null ? String(w.sheets) : null,
            createdAt: new Date(now.getTime() + i), // keeps rows in the order they were entered
            createdBy: userId,
          };
        }),
      ),
    );
  }
  if (s.grading.length) ops.push(db.insert(gradings).values(s.grading.map((g) => ({ ...g, day: s.day, createdBy: userId }))));

  try {
    await db.batch(ops as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
  } catch (e) {
    console.error("saveDaySheet failed", e);
    return { ok: false, error: "The day couldn't be saved. Nothing was changed. Check the rows and try again." };
  }
  refresh();
  return { ok: true, updatedAt: now.toISOString() };
}
