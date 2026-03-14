-- Add SSH credential fields for terminal auto-login
ALTER TABLE "hosts"
  ADD COLUMN IF NOT EXISTS "ssh_username"    TEXT,
  ADD COLUMN IF NOT EXISTS "ssh_port"        INTEGER,
  ADD COLUMN IF NOT EXISTS "ssh_auth_method" TEXT,
  ADD COLUMN IF NOT EXISTS "ssh_password"    TEXT,
  ADD COLUMN IF NOT EXISTS "ssh_private_key" TEXT;
