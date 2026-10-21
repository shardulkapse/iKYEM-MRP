// iKYEM MRP: database schema (Drizzle ORM on Neon Postgres)
//
// Conventions
// - Money is stored in paise as bigint (₹1 = 100 paise), so sums never hit floating-point errors.
// - Business dates (the day work happened, was paid, was delivered) are `date` columns read as
//   "YYYY-MM-DD" strings. Audit times are timestamptz.
// - Stock is never stored as a number. Ready stock, balls in production and material on hand are
//   all derived from the movement tables below (work entries, gradings, deliveries, purchases,
//   adjustments) through SQL views, exactly like the prototype's ledger. Back-filling a missed
//   day therefore just works.
// - created_by holds the Clerk user id of whoever made the change. Roles (owner, manager) live in
//   Clerk metadata and are checked in server actions, not in the database.

import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, date, index, integer, numeric, pgEnum, pgTable, pgView, primaryKey,
  smallint, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ enums */

export const colour = pgEnum("colour", ["red", "white", "pink"]);
export const construction = pgEnum("construction", ["4pc", "2pc"]);
export const workflow = pgEnum("workflow", ["hand", "machine"]);

// Every stage a ball passes through before grading. Cutting is shared by both workflows.
//   hand:    cutting -> hand_quarter_stitching (4pc only) -> hand_closing -> hand_seam_stitching
//   machine: cutting -> machine_quarter_stitching (4pc only) -> machine_stitching -> machine_closing_seam
export const stage = pgEnum("stage", [
  "cutting",
  "hand_quarter_stitching", "hand_closing", "hand_seam_stitching",
  "machine_quarter_stitching", "machine_stitching", "machine_closing_seam",
]);

// The piles balls sit in between stages. Only used by stock corrections; views derive the rest.
export const wipBuffer = pgEnum("wip_buffer", ["cut", "cups", "machine_stitched", "closed", "awaiting_grading"]);

export const materialKind = pgEnum("material_kind", ["leather", "cork", "other"]);
export const payType = pgEnum("pay_type", ["daily", "piece", "salary"]);
export const attendanceStatus = pgEnum("attendance_status", ["present", "half", "absent"]);
export const wagePaymentKind = pgEnum("wage_payment_kind", ["weekly", "salary", "advance"]);
export const paymentMode = pgEnum("payment_mode", ["cash", "online"]);
export const orderStatus = pgEnum("order_status", ["open", "closed"]);
export const adjustmentTarget = pgEnum("adjustment_target", ["material", "wip", "ready_stock"]);

const audit = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
};

/* ---------------------------------------------------------------- setup */

export const factorySettings = pgTable("factory_settings", {
  id: smallint("id").primaryKey().default(1),
  weeklyOff: smallint("weekly_off").default(0),            // the day the factory is shut, 0 = Sunday … 6 = Saturday; null = open every day
  payWeekday: smallint("pay_weekday").notNull().default(2), // 0 = Sunday ... 2 = Tuesday
}, (t) => [
  check("single_row", sql`${t.id} = 1`),
  check("weekly_off_valid", sql`${t.weeklyOff} between 0 and 6`),
  check("pay_weekday_valid", sql`${t.payWeekday} between 0 and 6`),
]);

// A product you sell. Machine-stitched balls are separate types from hand-stitched ones.
export const ballTypes = pgTable("ball_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  colour: colour("colour").notNull(),
  construction: construction("construction").notNull(),
  workflow: workflow("workflow").notNull(),
  weightGrams: numeric("weight_grams", { precision: 6, scale: 1 }),
  sortOrder: integer("sort_order").notNull().default(0),
  archivedAt: timestamp("archived_at", { withTimezone: true }), // hide without losing history
  ...audit,
}, (t) => [uniqueIndex("ball_types_name_uq").on(t.name)]);

export const grades = pgTable("grades", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  note: text("note"),
  sortOrder: integer("sort_order").notNull().default(0), // best grade first
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex("grades_name_uq").on(t.name)]);

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone"),
  notes: text("notes"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...audit,
}, (t) => [uniqueIndex("suppliers_name_uq").on(t.name)]);

// Leather (several kinds per colour allowed), the cork core (one per ball) and anything else.
export const materials = pgTable("materials", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: materialKind("kind").notNull(),
  colour: colour("colour"),                 // leather only
  unit: text("unit").notNull(),             // sheets, cores, spools, litres
  leadDays: smallint("lead_days").notNull().default(7),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...audit,
}, (t) => [
  check("leather_has_colour", sql`(${t.kind} = 'leather') = (${t.colour} is not null)`),
  uniqueIndex("one_cork_core").on(t.kind).where(sql`${t.kind} = 'cork'`),
]);

export const purchases = pgTable("purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  materialId: uuid("material_id").notNull().references(() => materials.id),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  receivedOn: date("received_on", { mode: "string" }).notNull(),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  pricePaise: bigint("price_paise", { mode: "number" }).notNull(), // per unit
  note: text("note"),
  ...audit,
}, (t) => [
  check("qty_positive", sql`${t.qty} > 0`),
  check("price_not_negative", sql`${t.pricePaise} >= 0`),
  index("purchases_material_date_idx").on(t.materialId, t.receivedOn),
  index("purchases_supplier_idx").on(t.supplierId),
]);

/* ----------------------------------------------------------------- team */

// Nobody is tied to a stage; who did what is recorded per day in work_entries.
export const workers = pgTable("workers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  role: text("role"),
  payType: payType("pay_type").notNull(),
  ratePaise: bigint("rate_paise", { mode: "number" }).notNull(),        // daily wage, rate per piece, or monthly salary
  weeklyPayoutPaise: bigint("weekly_payout_paise", { mode: "number" }), // salaried only, comes off the month-end salary
  startedOn: date("started_on", { mode: "string" }),
  leftOn: date("left_on", { mode: "string" }),                          // null while working here
  sortOrder: integer("sort_order").notNull().default(0),
  ...audit,
}, (t) => [
  check("rate_not_negative", sql`${t.ratePaise} >= 0`),
  check("weekly_only_for_salary", sql`${t.payType} = 'salary' or ${t.weeklyPayoutPaise} is null`),
]);

/* ---------------------------------------------------------- daily sheet */

// One row per day that has been filled in. A missing working day = no row here.
export const daySheets = pgTable("day_sheets", {
  day: date("day", { mode: "string" }).primaryKey(),
  closed: boolean("closed").notNull().default(false), // factory was closed that day
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export const attendance = pgTable("attendance", {
  day: date("day", { mode: "string" }).notNull().references(() => daySheets.day, { onDelete: "cascade" }),
  workerId: uuid("worker_id").notNull().references(() => workers.id),
  status: attendanceStatus("status").notNull(),
}, (t) => [
  primaryKey({ columns: [t.day, t.workerId] }),
  index("attendance_worker_day_idx").on(t.workerId, t.day),
]);

// One row per "person did this much of this ball type at this stage" on a day.
// Cutting rows also say which leather and supplier, and how many sheets, for the yield tracker.
export const workEntries = pgTable("work_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  day: date("day", { mode: "string" }).notNull().references(() => daySheets.day, { onDelete: "cascade" }),
  stage: stage("stage").notNull(),
  workerId: uuid("worker_id").references(() => workers.id), // null on cutting = manager or owner
  ballTypeId: uuid("ball_type_id").notNull().references(() => ballTypes.id),
  good: integer("good").notNull().default(0),
  rejected: integer("rejected").notNull().default(0),
  leatherId: uuid("leather_id").references(() => materials.id),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  sheets: numeric("sheets", { precision: 8, scale: 2 }),
  ...audit,
}, (t) => [
  check("counts_not_negative", sql`${t.good} >= 0 and ${t.rejected} >= 0`),
  check("cutting_fields_only_on_cutting", sql`${t.stage} = 'cutting' or (${t.leatherId} is null and ${t.supplierId} is null and ${t.sheets} is null)`),
  check("worker_required_after_cutting", sql`${t.stage} = 'cutting' or ${t.workerId} is not null`),
  index("work_entries_day_idx").on(t.day),
  index("work_entries_stage_day_idx").on(t.stage, t.day),
  index("work_entries_worker_day_idx").on(t.workerId, t.day),
]);

// Balls moved from "awaiting grading" into ready stock, or rejected at grading.
// The supplier tag is optional: set it when you know whose leather the balls came from.
export const gradings = pgTable("gradings", {
  id: uuid("id").primaryKey().defaultRandom(),
  day: date("day", { mode: "string" }).notNull().references(() => daySheets.day, { onDelete: "cascade" }),
  ballTypeId: uuid("ball_type_id").notNull().references(() => ballTypes.id),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  gradeId: uuid("grade_id").references(() => grades.id),
  rejected: boolean("rejected").notNull().default(false),
  qty: integer("qty").notNull(),
  ...audit,
}, (t) => [
  check("qty_positive", sql`${t.qty} > 0`),
  check("grade_or_rejected", sql`(${t.rejected} and ${t.gradeId} is null) or (not ${t.rejected} and ${t.gradeId} is not null)`),
  index("gradings_day_idx").on(t.day),
  index("gradings_type_grade_idx").on(t.ballTypeId, t.gradeId),
]);

// Physical counts and opening stock. delta = counted minus what the system thought.
export const stockAdjustments = pgTable("stock_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  day: date("day", { mode: "string" }).notNull(),
  target: adjustmentTarget("target").notNull(),
  materialId: uuid("material_id").references(() => materials.id),   // target = material
  ballTypeId: uuid("ball_type_id").references(() => ballTypes.id),  // target = wip or ready_stock
  buffer: wipBuffer("buffer"),                                      // target = wip
  gradeId: uuid("grade_id").references(() => grades.id),            // target = ready_stock
  delta: numeric("delta", { precision: 12, scale: 3 }).notNull(),
  note: text("note"),
  ...audit,
}, (t) => [
  check("adjustment_shape", sql`
    (${t.target} = 'material'    and ${t.materialId} is not null and ${t.ballTypeId} is null and ${t.buffer} is null and ${t.gradeId} is null) or
    (${t.target} = 'wip'         and ${t.materialId} is null and ${t.ballTypeId} is not null and ${t.buffer} is not null and ${t.gradeId} is null) or
    (${t.target} = 'ready_stock' and ${t.materialId} is null and ${t.ballTypeId} is not null and ${t.buffer} is null and ${t.gradeId} is not null)`),
]);

/* ------------------------------------------------------------- selling */

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone"),
  notes: text("notes"),
  ...audit,
}, (t) => [uniqueIndex("customers_name_uq").on(t.name)]);

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  dueOn: date("due_on", { mode: "string" }).notNull(),
  status: orderStatus("status").notNull().default("open"),
  notes: text("notes"),
  ...audit,
}, (t) => [
  index("orders_status_due_idx").on(t.status, t.dueOn),
  index("orders_customer_idx").on(t.customerId),
]);

export const orderLines = pgTable("order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  ballTypeId: uuid("ball_type_id").notNull().references(() => ballTypes.id),
  gradeId: uuid("grade_id").notNull().references(() => grades.id),
  qty: integer("qty").notNull(),
  pricePaise: bigint("price_paise", { mode: "number" }).notNull(),
}, (t) => [
  check("qty_positive", sql`${t.qty} > 0`),
  index("order_lines_order_idx").on(t.orderId),
]);

// A delivery takes balls out of ready stock and counts as a sale on its date.
export const deliveries = pgTable("deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  deliveredOn: date("delivered_on", { mode: "string" }).notNull(),
  note: text("note"),
  ...audit,
}, (t) => [
  index("deliveries_order_idx").on(t.orderId),
  index("deliveries_date_idx").on(t.deliveredOn),
]);

export const deliveryLines = pgTable("delivery_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  deliveryId: uuid("delivery_id").notNull().references(() => deliveries.id, { onDelete: "cascade" }),
  ballTypeId: uuid("ball_type_id").notNull().references(() => ballTypes.id),
  gradeId: uuid("grade_id").notNull().references(() => grades.id),
  qty: integer("qty").notNull(),
  pricePaise: bigint("price_paise", { mode: "number" }).notNull(),
}, (t) => [
  check("qty_positive", sql`${t.qty} > 0`),
  index("delivery_lines_delivery_idx").on(t.deliveryId),
  index("delivery_lines_type_grade_idx").on(t.ballTypeId, t.gradeId),
]);

// Every payment from a customer: advance, on delivery, or later. An order can have many.
export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  receivedOn: date("received_on", { mode: "string" }).notNull(),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  mode: paymentMode("mode").notNull(),
  note: text("note"),
  ...audit,
}, (t) => [
  check("amount_positive", sql`${t.amountPaise} > 0`),
  index("receipts_order_idx").on(t.orderId),
  index("receipts_date_idx").on(t.receivedOn),
]);

/* --------------------------------------------- money out (owner only) */

export const wagePayments = pgTable("wage_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  workerId: uuid("worker_id").notNull().references(() => workers.id),
  kind: wagePaymentKind("kind").notNull(),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  paidOn: date("paid_on", { mode: "string" }).notNull(),
  payday: date("payday", { mode: "string" }),  // kind = weekly: the payday it settles
  forMonth: text("for_month"),                 // kind = salary: "YYYY-MM"
  note: text("note"),
  ...audit,
}, (t) => [
  check("amount_positive", sql`${t.amountPaise} > 0`),
  check("weekly_has_payday", sql`${t.kind} <> 'weekly' or ${t.payday} is not null`),
  check("salary_has_month", sql`${t.kind} <> 'salary' or ${t.forMonth} ~ '^[0-9]{4}-[0-9]{2}$'`),
  uniqueIndex("one_weekly_payment_per_payday").on(t.workerId, t.payday).where(sql`${t.kind} = 'weekly'`),
  uniqueIndex("one_salary_payment_per_month").on(t.workerId, t.forMonth).where(sql`${t.kind} = 'salary'`),
  index("wage_payments_paid_on_idx").on(t.paidOn),
]);

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: text("category").notNull(), // Rent, Electricity, Transport, Repairs, Packing, Other
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  spentOn: date("spent_on", { mode: "string" }).notNull(),
  note: text("note"),
  ...audit,
}, (t) => [
  check("amount_positive", sql`${t.amountPaise} > 0`),
  index("expenses_date_idx").on(t.spentOn),
]);

export const loans = pgTable("loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  lender: text("lender"),
  principalPaise: bigint("principal_paise", { mode: "number" }).notNull(),
  annualRatePct: numeric("annual_rate_pct", { precision: 5, scale: 2 }),
  emiPaise: bigint("emi_paise", { mode: "number" }),
  takenOn: date("taken_on", { mode: "string" }).notNull(),
  ...audit,
});

export const loanPayments = pgTable("loan_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  paidOn: date("paid_on", { mode: "string" }).notNull(),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  note: text("note"),
  ...audit,
}, (t) => [
  check("amount_positive", sql`${t.amountPaise} > 0`),
  index("loan_payments_loan_date_idx").on(t.loanId, t.paidOn),
]);

/* ---------------------------------------------------------------- views */
// Created by drizzle/0001_stock_views.sql. Declared here (as existing) so queries are typed.
// The *_movements views carry a `day` column, so "stock as of a date" is a filter, not new SQL.

export const wipMovements = pgView("wip_movements", {
  day: date("day", { mode: "string" }),
  ballTypeId: uuid("ball_type_id"),
  buffer: wipBuffer("buffer"),
  qty: numeric("qty"),
}).existing();

export const wipLevels = pgView("wip_levels", {
  ballTypeId: uuid("ball_type_id"),
  buffer: wipBuffer("buffer"),
  qty: numeric("qty"),
}).existing();

export const readyStockMovements = pgView("ready_stock_movements", {
  day: date("day", { mode: "string" }),
  ballTypeId: uuid("ball_type_id"),
  gradeId: uuid("grade_id"),
  qty: numeric("qty"),
}).existing();

export const readyStock = pgView("ready_stock", {
  ballTypeId: uuid("ball_type_id"),
  gradeId: uuid("grade_id"),
  qty: numeric("qty"),
}).existing();

export const materialMovements = pgView("material_movements", {
  day: date("day", { mode: "string" }),
  materialId: uuid("material_id"),
  qty: numeric("qty"),
}).existing();

export const materialOnHand = pgView("material_on_hand", {
  materialId: uuid("material_id"),
  qty: numeric("qty"),
}).existing();
