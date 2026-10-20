CREATE TYPE "public"."adjustment_target" AS ENUM('material', 'wip', 'ready_stock');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('present', 'half', 'absent');--> statement-breakpoint
CREATE TYPE "public"."colour" AS ENUM('red', 'white', 'pink');--> statement-breakpoint
CREATE TYPE "public"."construction" AS ENUM('4pc', '2pc');--> statement-breakpoint
CREATE TYPE "public"."material_kind" AS ENUM('leather', 'cork', 'other');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."pay_type" AS ENUM('daily', 'piece', 'salary');--> statement-breakpoint
CREATE TYPE "public"."payment_mode" AS ENUM('cash', 'online');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('cutting', 'hand_quarter_stitching', 'hand_closing', 'hand_seam_stitching', 'machine_quarter_stitching', 'machine_stitching', 'machine_closing_seam');--> statement-breakpoint
CREATE TYPE "public"."wage_payment_kind" AS ENUM('weekly', 'salary', 'advance');--> statement-breakpoint
CREATE TYPE "public"."wip_buffer" AS ENUM('cut', 'cups', 'machine_stitched', 'closed', 'awaiting_grading');--> statement-breakpoint
CREATE TYPE "public"."workflow" AS ENUM('hand', 'machine');--> statement-breakpoint
CREATE TABLE "attendance" (
	"day" date NOT NULL,
	"worker_id" uuid NOT NULL,
	"status" "attendance_status" NOT NULL,
	CONSTRAINT "attendance_day_worker_id_pk" PRIMARY KEY("day","worker_id")
);
--> statement-breakpoint
CREATE TABLE "ball_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"colour" "colour" NOT NULL,
	"construction" "construction" NOT NULL,
	"workflow" "workflow" NOT NULL,
	"weight_grams" numeric(6, 1),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "day_sheets" (
	"day" date PRIMARY KEY NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"delivered_on" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "delivery_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"ball_type_id" uuid NOT NULL,
	"grade_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"price_paise" bigint NOT NULL,
	CONSTRAINT "qty_positive" CHECK ("delivery_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"spent_on" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "amount_positive" CHECK ("expenses"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "factory_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"work_days" smallint DEFAULT 6 NOT NULL,
	"pay_weekday" smallint DEFAULT 2 NOT NULL,
	CONSTRAINT "single_row" CHECK ("factory_settings"."id" = 1),
	CONSTRAINT "work_days_valid" CHECK ("factory_settings"."work_days" in (6, 7)),
	CONSTRAINT "pay_weekday_valid" CHECK ("factory_settings"."pay_weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "gradings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"ball_type_id" uuid NOT NULL,
	"supplier_id" uuid,
	"grade_id" uuid,
	"rejected" boolean DEFAULT false NOT NULL,
	"qty" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "qty_positive" CHECK ("gradings"."qty" > 0),
	CONSTRAINT "grade_or_rejected" CHECK (("gradings"."rejected" and "gradings"."grade_id" is null) or (not "gradings"."rejected" and "gradings"."grade_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "loan_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "amount_positive" CHECK ("loan_payments"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"lender" text,
	"principal_paise" bigint NOT NULL,
	"annual_rate_pct" numeric(5, 2),
	"emi_paise" bigint,
	"taken_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "material_kind" NOT NULL,
	"colour" "colour",
	"unit" text NOT NULL,
	"lead_days" smallint DEFAULT 7 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "leather_has_colour" CHECK (("materials"."kind" = 'leather') = ("materials"."colour" is not null))
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"ball_type_id" uuid NOT NULL,
	"grade_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"price_paise" bigint NOT NULL,
	CONSTRAINT "qty_positive" CHECK ("order_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"status" "order_status" DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"supplier_id" uuid,
	"received_on" date NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"price_paise" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "qty_positive" CHECK ("purchases"."qty" > 0),
	CONSTRAINT "price_not_negative" CHECK ("purchases"."price_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"mode" "payment_mode" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "amount_positive" CHECK ("receipts"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"target" "adjustment_target" NOT NULL,
	"material_id" uuid,
	"ball_type_id" uuid,
	"buffer" "wip_buffer",
	"grade_id" uuid,
	"delta" numeric(12, 3) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "adjustment_shape" CHECK (
    ("stock_adjustments"."target" = 'material'    and "stock_adjustments"."material_id" is not null and "stock_adjustments"."ball_type_id" is null and "stock_adjustments"."buffer" is null and "stock_adjustments"."grade_id" is null) or
    ("stock_adjustments"."target" = 'wip'         and "stock_adjustments"."material_id" is null and "stock_adjustments"."ball_type_id" is not null and "stock_adjustments"."buffer" is not null and "stock_adjustments"."grade_id" is null) or
    ("stock_adjustments"."target" = 'ready_stock' and "stock_adjustments"."material_id" is null and "stock_adjustments"."ball_type_id" is not null and "stock_adjustments"."buffer" is null and "stock_adjustments"."grade_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "wage_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid NOT NULL,
	"kind" "wage_payment_kind" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"paid_on" date NOT NULL,
	"payday" date,
	"for_month" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "amount_positive" CHECK ("wage_payments"."amount_paise" > 0),
	CONSTRAINT "weekly_has_payday" CHECK ("wage_payments"."kind" <> 'weekly' or "wage_payments"."payday" is not null),
	CONSTRAINT "salary_has_month" CHECK ("wage_payments"."kind" <> 'salary' or "wage_payments"."for_month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "work_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"stage" "stage" NOT NULL,
	"worker_id" uuid,
	"ball_type_id" uuid NOT NULL,
	"good" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"leather_id" uuid,
	"supplier_id" uuid,
	"sheets" numeric(8, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "counts_not_negative" CHECK ("work_entries"."good" >= 0 and "work_entries"."rejected" >= 0),
	CONSTRAINT "cutting_fields_only_on_cutting" CHECK ("work_entries"."stage" = 'cutting' or ("work_entries"."leather_id" is null and "work_entries"."supplier_id" is null and "work_entries"."sheets" is null)),
	CONSTRAINT "worker_required_after_cutting" CHECK ("work_entries"."stage" = 'cutting' or "work_entries"."worker_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"pay_type" "pay_type" NOT NULL,
	"rate_paise" bigint NOT NULL,
	"weekly_payout_paise" bigint,
	"started_on" date,
	"left_on" date,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "rate_not_negative" CHECK ("workers"."rate_paise" >= 0),
	CONSTRAINT "weekly_only_for_salary" CHECK ("workers"."pay_type" = 'salary' or "workers"."weekly_payout_paise" is null)
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_day_day_sheets_day_fk" FOREIGN KEY ("day") REFERENCES "public"."day_sheets"("day") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_ball_type_id_ball_types_id_fk" FOREIGN KEY ("ball_type_id") REFERENCES "public"."ball_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradings" ADD CONSTRAINT "gradings_day_day_sheets_day_fk" FOREIGN KEY ("day") REFERENCES "public"."day_sheets"("day") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradings" ADD CONSTRAINT "gradings_ball_type_id_ball_types_id_fk" FOREIGN KEY ("ball_type_id") REFERENCES "public"."ball_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradings" ADD CONSTRAINT "gradings_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gradings" ADD CONSTRAINT "gradings_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_ball_type_id_ball_types_id_fk" FOREIGN KEY ("ball_type_id") REFERENCES "public"."ball_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_ball_type_id_ball_types_id_fk" FOREIGN KEY ("ball_type_id") REFERENCES "public"."ball_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wage_payments" ADD CONSTRAINT "wage_payments_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_entries" ADD CONSTRAINT "work_entries_day_day_sheets_day_fk" FOREIGN KEY ("day") REFERENCES "public"."day_sheets"("day") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_entries" ADD CONSTRAINT "work_entries_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_entries" ADD CONSTRAINT "work_entries_ball_type_id_ball_types_id_fk" FOREIGN KEY ("ball_type_id") REFERENCES "public"."ball_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_entries" ADD CONSTRAINT "work_entries_leather_id_materials_id_fk" FOREIGN KEY ("leather_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_entries" ADD CONSTRAINT "work_entries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_worker_day_idx" ON "attendance" USING btree ("worker_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "ball_types_name_uq" ON "ball_types" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_name_uq" ON "customers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "deliveries_order_idx" ON "deliveries" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "deliveries_date_idx" ON "deliveries" USING btree ("delivered_on");--> statement-breakpoint
CREATE INDEX "delivery_lines_delivery_idx" ON "delivery_lines" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "delivery_lines_type_grade_idx" ON "delivery_lines" USING btree ("ball_type_id","grade_id");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("spent_on");--> statement-breakpoint
CREATE UNIQUE INDEX "grades_name_uq" ON "grades" USING btree ("name");--> statement-breakpoint
CREATE INDEX "gradings_day_idx" ON "gradings" USING btree ("day");--> statement-breakpoint
CREATE INDEX "gradings_type_grade_idx" ON "gradings" USING btree ("ball_type_id","grade_id");--> statement-breakpoint
CREATE INDEX "loan_payments_loan_date_idx" ON "loan_payments" USING btree ("loan_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "one_cork_core" ON "materials" USING btree ("kind") WHERE "materials"."kind" = 'cork';--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_status_due_idx" ON "orders" USING btree ("status","due_on");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "purchases_material_date_idx" ON "purchases" USING btree ("material_id","received_on");--> statement-breakpoint
CREATE INDEX "purchases_supplier_idx" ON "purchases" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "receipts_order_idx" ON "receipts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "receipts_date_idx" ON "receipts" USING btree ("received_on");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_name_uq" ON "suppliers" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "one_weekly_payment_per_payday" ON "wage_payments" USING btree ("worker_id","payday") WHERE "wage_payments"."kind" = 'weekly';--> statement-breakpoint
CREATE UNIQUE INDEX "one_salary_payment_per_month" ON "wage_payments" USING btree ("worker_id","for_month") WHERE "wage_payments"."kind" = 'salary';--> statement-breakpoint
CREATE INDEX "wage_payments_paid_on_idx" ON "wage_payments" USING btree ("paid_on");--> statement-breakpoint
CREATE INDEX "work_entries_day_idx" ON "work_entries" USING btree ("day");--> statement-breakpoint
CREATE INDEX "work_entries_stage_day_idx" ON "work_entries" USING btree ("stage","day");--> statement-breakpoint
CREATE INDEX "work_entries_worker_day_idx" ON "work_entries" USING btree ("worker_id","day");