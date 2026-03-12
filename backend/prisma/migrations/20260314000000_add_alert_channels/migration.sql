-- CreateTable
CREATE TABLE "alert_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL,
    "webhook_url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severity_filter" JSONB,
    "type_filter" JSONB,
    "config" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_channels_channel_type_idx" ON "alert_channels"("channel_type");

-- CreateIndex
CREATE INDEX "alert_channels_enabled_idx" ON "alert_channels"("enabled");
