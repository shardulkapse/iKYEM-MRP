CREATE TYPE "public"."location_type" AS ENUM('domestic', 'international');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "location_type" "location_type";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "location_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "location_note" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "location_set_together" CHECK (("orders"."location_type" is null) = ("orders"."location_code" is null));