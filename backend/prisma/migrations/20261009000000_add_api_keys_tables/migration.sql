-- Create user_api_keys table (per-user API keys for MCP / integrations)
CREATE TABLE IF NOT EXISTS "user_api_keys" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "masked_key" TEXT NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "user_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_api_keys_user_id_idx" ON "user_api_keys"("user_id");
CREATE INDEX IF NOT EXISTS "user_api_keys_masked_key_idx" ON "user_api_keys"("masked_key");

-- Create admin_api_keys table (service-account / admin API keys)
CREATE TABLE IF NOT EXISTS "admin_api_keys" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "masked_key" TEXT NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "admin_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "admin_api_keys_username_idx" ON "admin_api_keys"("username");
CREATE INDEX IF NOT EXISTS "admin_api_keys_masked_key_idx" ON "admin_api_keys"("masked_key");
