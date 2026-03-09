-- Add patchmanagement_enabled column to hosts table
ALTER TABLE "hosts" ADD COLUMN "patchmanagement_enabled" BOOLEAN NOT NULL DEFAULT false;
