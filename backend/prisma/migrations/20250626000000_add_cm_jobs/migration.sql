-- CreateTable
CREATE TABLE "cm_jobs" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "rule_name" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "triggered_by" TEXT NOT NULL DEFAULT 'manual',
    "triggered_by_user" TEXT,
    "total_hosts" INTEGER NOT NULL DEFAULT 0,
    "completed_hosts" INTEGER NOT NULL DEFAULT 0,
    "failed_hosts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cm_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cm_job_hosts" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "run_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "cm_job_hosts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cm_jobs_rule_id_idx" ON "cm_jobs"("rule_id");
CREATE INDEX "cm_jobs_status_idx" ON "cm_jobs"("status");
CREATE INDEX "cm_jobs_created_at_idx" ON "cm_jobs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cm_job_hosts_job_id_host_id_key" ON "cm_job_hosts"("job_id", "host_id");
CREATE INDEX "cm_job_hosts_job_id_idx" ON "cm_job_hosts"("job_id");
CREATE INDEX "cm_job_hosts_host_id_idx" ON "cm_job_hosts"("host_id");
CREATE INDEX "cm_job_hosts_status_idx" ON "cm_job_hosts"("status");

-- AddForeignKey
ALTER TABLE "cm_jobs" ADD CONSTRAINT "cm_jobs_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "cm_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cm_job_hosts" ADD CONSTRAINT "cm_job_hosts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "cm_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cm_job_hosts" ADD CONSTRAINT "cm_job_hosts_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
