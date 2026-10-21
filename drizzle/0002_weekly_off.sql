ALTER TABLE "factory_settings" ADD COLUMN "weekly_off" smallint DEFAULT 0;--> statement-breakpoint
ALTER TABLE "factory_settings" ADD CONSTRAINT "weekly_off_valid" CHECK ("factory_settings"."weekly_off" between 0 and 6);--> statement-breakpoint
-- Carry the old setting over: Monday to Saturday meant Sunday off; every day means no weekly holiday.
UPDATE "factory_settings" SET "weekly_off" = CASE WHEN "work_days" = 7 THEN NULL ELSE 0 END;