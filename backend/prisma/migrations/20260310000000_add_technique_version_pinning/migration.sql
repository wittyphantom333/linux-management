-- Add technique_version to cm_directives for version pinning
ALTER TABLE "cm_directives" ADD COLUMN "technique_version" TEXT;

-- Backfill existing directives with their current technique version
UPDATE "cm_directives" d
SET "technique_version" = t."version"
FROM "cm_techniques" t
WHERE d."technique_id" = t."id";

-- Set a default for future rows
ALTER TABLE "cm_directives" ALTER COLUMN "technique_version" SET DEFAULT '1.0';
