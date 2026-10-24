ALTER TABLE "orders" ADD COLUMN "ordered_on" date DEFAULT current_date NOT NULL;--> statement-breakpoint
-- Orders already entered get the day they were entered, in India.
UPDATE "orders" SET "ordered_on" = ("created_at" AT TIME ZONE 'Asia/Kolkata')::date;