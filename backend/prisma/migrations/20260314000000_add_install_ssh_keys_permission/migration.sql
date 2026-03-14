-- Add can_install_ssh_keys permission column (defaults to false for all roles)
ALTER TABLE "role_permissions"
  ADD COLUMN IF NOT EXISTS "can_install_ssh_keys" BOOLEAN NOT NULL DEFAULT false;

-- Only superadmin and admin get this permission by default
UPDATE "role_permissions"
  SET "can_install_ssh_keys" = true
  WHERE "role" IN ('superadmin', 'admin');
