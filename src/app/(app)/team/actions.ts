"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { payType, workers } from "@/db/schema";
import { type ActionResult, fail, firstIssue, ok } from "@/lib/action-result";
import { requireRole } from "@/lib/auth";
import { RUPEES_PATTERN, toPaise } from "@/lib/money";

const day = z.union([z.iso.date(), z.literal("")]).optional().transform((v) => v || null);

const workerSchema = z
  .object({
    id: z.union([z.uuid(), z.literal("")]).optional(),
    name: z.string().trim().min(1, "Enter the person's name.").max(80),
    role: z.string().trim().max(60).optional().transform((v) => v || null),
    payType: z.enum(payType.enumValues),
    rate: z.string().trim().regex(RUPEES_PATTERN, "Enter the rate in rupees, like 550 or 9.50."),
    weeklyPayout: z.string().trim().optional(),
    startedOn: day,
    leftOn: day,
  })
  .superRefine((v, ctx) => {
    if (v.payType === "salary" && v.weeklyPayout && !RUPEES_PATTERN.test(v.weeklyPayout)) {
      ctx.addIssue({ code: "custom", message: "Enter the weekly payout in rupees, like 1000." });
    }
    if (v.startedOn && v.leftOn && v.leftOn < v.startedOn) {
      ctx.addIssue({ code: "custom", message: "The leaving date is before the start date." });
    }
  });

// Adds a person or saves changes to one. Owner only: the form holds pay rates.
export async function saveWorker(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { userId } = await requireRole(["owner"]);
  const parsed = workerSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const v = parsed.data;
  const values = {
    name: v.name,
    role: v.role,
    payType: v.payType,
    ratePaise: toPaise(v.rate),
    weeklyPayoutPaise: v.payType === "salary" && v.weeklyPayout ? toPaise(v.weeklyPayout) : null,
    startedOn: v.startedOn,
    leftOn: v.leftOn,
  };
  if (v.id) {
    const done = await db.update(workers).set(values).where(eq(workers.id, v.id)).returning({ id: workers.id });
    if (!done.length) return fail("That person no longer exists.");
  } else {
    await db.insert(workers).values({ ...values, createdBy: userId });
  }
  refresh();
  return ok();
}
