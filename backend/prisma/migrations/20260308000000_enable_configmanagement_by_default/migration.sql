-- AlterColumn: Change configmanagement_enabled default from false to true
ALTER TABLE "hosts" ALTER COLUMN "configmanagement_enabled" SET DEFAULT true;

-- Update all existing hosts to have config management enabled
UPDATE "hosts" SET "configmanagement_enabled" = true WHERE "configmanagement_enabled" = false;
