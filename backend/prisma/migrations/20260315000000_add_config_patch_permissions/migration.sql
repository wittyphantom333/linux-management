-- Add config management and patch management permission columns
ALTER TABLE "role_permissions"
  ADD COLUMN IF NOT EXISTS "can_view_config_management"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "can_manage_config_management" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "can_view_patch_management"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "can_manage_patch_management"  BOOLEAN NOT NULL DEFAULT false;

-- Set sensible defaults for built-in roles
-- superadmin: full access
UPDATE "role_permissions"
  SET "can_view_config_management"   = true,
      "can_manage_config_management" = true,
      "can_view_patch_management"    = true,
      "can_manage_patch_management"  = true
  WHERE "role" = 'superadmin';

-- admin: full access (except superuser management, unchanged)
UPDATE "role_permissions"
  SET "can_view_config_management"   = true,
      "can_manage_config_management" = true,
      "can_view_patch_management"    = true,
      "can_manage_patch_management"  = true
  WHERE "role" = 'admin';

-- host_manager: view + manage both
UPDATE "role_permissions"
  SET "can_view_config_management"   = true,
      "can_manage_config_management" = true,
      "can_view_patch_management"    = true,
      "can_manage_patch_management"  = true
  WHERE "role" = 'host_manager';

-- user: view only
UPDATE "role_permissions"
  SET "can_view_config_management"   = true,
      "can_manage_config_management" = false,
      "can_view_patch_management"    = true,
      "can_manage_patch_management"  = false
  WHERE "role" = 'user';

-- readonly: view only
UPDATE "role_permissions"
  SET "can_view_config_management"   = true,
      "can_manage_config_management" = false,
      "can_view_patch_management"    = true,
      "can_manage_patch_management"  = false
  WHERE "role" = 'readonly';
