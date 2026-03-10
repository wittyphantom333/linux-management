-- CreateTable
CREATE TABLE "agent_logs" (
    "id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_logs_host_id_idx" ON "agent_logs"("host_id");

-- CreateIndex
CREATE INDEX "agent_logs_host_id_timestamp_idx" ON "agent_logs"("host_id", "timestamp");

-- CreateIndex
CREATE INDEX "agent_logs_level_idx" ON "agent_logs"("level");

-- CreateIndex
CREATE INDEX "agent_logs_source_idx" ON "agent_logs"("source");

-- CreateIndex
CREATE INDEX "agent_logs_received_at_idx" ON "agent_logs"("received_at");

-- AddForeignKey
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
