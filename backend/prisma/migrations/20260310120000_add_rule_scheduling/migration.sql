-- Add scheduling fields to cm_rules
ALTER TABLE "cm_rules" ADD COLUMN "run_schedule" TEXT NOT NULL DEFAULT 'always';
ALTER TABLE "cm_rules" ADD COLUMN "schedule_interval" INTEGER;
ALTER TABLE "cm_rules" ADD COLUMN "schedule_cron" TEXT;
ALTER TABLE "cm_rules" ADD COLUMN "schedule_timezone" TEXT DEFAULT 'UTC';
