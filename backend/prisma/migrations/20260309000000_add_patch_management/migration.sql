-- CreateTable: patch_policies
CREATE TABLE "patch_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "policy_type" TEXT NOT NULL DEFAULT 'all',
    "auto_approve" BOOLEAN NOT NULL DEFAULT false,
    "approval_timeout_hours" INTEGER DEFAULT 72,
    "reboot_policy" TEXT NOT NULL DEFAULT 'if_needed',
    "pre_snapshot" BOOLEAN NOT NULL DEFAULT true,
    "post_snapshot" BOOLEAN NOT NULL DEFAULT true,
    "max_concurrent_hosts" INTEGER NOT NULL DEFAULT 5,
    "stop_on_failure_percent" INTEGER NOT NULL DEFAULT 30,
    "blackout_start" TEXT,
    "blackout_end" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patch_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable: patch_policy_groups (many-to-many: policy <-> host_group)
CREATE TABLE "patch_policy_groups" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "host_group_id" TEXT NOT NULL,

    CONSTRAINT "patch_policy_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable: patch_policy_filters (include/exclude package patterns)
CREATE TABLE "patch_policy_filters" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "filter_type" TEXT NOT NULL DEFAULT 'exclude',
    "match_type" TEXT NOT NULL DEFAULT 'glob',
    "pattern" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patch_policy_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable: patch_windows (scheduled maintenance windows)
CREATE TABLE "patch_windows" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "policy_id" TEXT NOT NULL,
    "schedule_type" TEXT NOT NULL DEFAULT 'recurring',
    "schedule_cron" TEXT,
    "schedule_timezone" TEXT DEFAULT 'UTC',
    "duration_minutes" INTEGER NOT NULL DEFAULT 120,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patch_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable: patch_jobs (execution instances)
CREATE TABLE "patch_jobs" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "window_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "triggered_by" TEXT NOT NULL DEFAULT 'manual',
    "triggered_by_user" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "total_hosts" INTEGER NOT NULL DEFAULT 0,
    "completed_hosts" INTEGER NOT NULL DEFAULT 0,
    "failed_hosts" INTEGER NOT NULL DEFAULT 0,
    "skipped_hosts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patch_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: patch_job_hosts (per-host status within a job)
CREATE TABLE "patch_job_hosts" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "packages_updated" INTEGER NOT NULL DEFAULT 0,
    "packages_failed" INTEGER NOT NULL DEFAULT 0,
    "pre_snapshot" JSONB,
    "post_snapshot" JSONB,
    "error_message" TEXT,
    "reboot_required" BOOLEAN NOT NULL DEFAULT false,
    "reboot_completed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "patch_job_hosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: patch_job_packages (per-package result within a job-host)
CREATE TABLE "patch_job_packages" (
    "id" TEXT NOT NULL,
    "job_host_id" TEXT NOT NULL,
    "package_name" TEXT NOT NULL,
    "previous_version" TEXT,
    "target_version" TEXT,
    "installed_version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,

    CONSTRAINT "patch_job_packages_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "patch_policies_name_key" ON "patch_policies"("name");
CREATE UNIQUE INDEX "patch_policy_groups_policy_id_host_group_id_key" ON "patch_policy_groups"("policy_id", "host_group_id");
CREATE UNIQUE INDEX "patch_job_hosts_job_id_host_id_key" ON "patch_job_hosts"("job_id", "host_id");

-- Indexes
CREATE INDEX "patch_policies_enabled_idx" ON "patch_policies"("enabled");
CREATE INDEX "patch_policy_groups_policy_id_idx" ON "patch_policy_groups"("policy_id");
CREATE INDEX "patch_policy_groups_host_group_id_idx" ON "patch_policy_groups"("host_group_id");
CREATE INDEX "patch_policy_filters_policy_id_idx" ON "patch_policy_filters"("policy_id");
CREATE INDEX "patch_windows_policy_id_idx" ON "patch_windows"("policy_id");
CREATE INDEX "patch_windows_enabled_idx" ON "patch_windows"("enabled");
CREATE INDEX "patch_windows_next_run_at_idx" ON "patch_windows"("next_run_at");
CREATE INDEX "patch_jobs_policy_id_idx" ON "patch_jobs"("policy_id");
CREATE INDEX "patch_jobs_status_idx" ON "patch_jobs"("status");
CREATE INDEX "patch_jobs_created_at_idx" ON "patch_jobs"("created_at");
CREATE INDEX "patch_job_hosts_job_id_idx" ON "patch_job_hosts"("job_id");
CREATE INDEX "patch_job_hosts_host_id_idx" ON "patch_job_hosts"("host_id");
CREATE INDEX "patch_job_hosts_status_idx" ON "patch_job_hosts"("status");
CREATE INDEX "patch_job_packages_job_host_id_idx" ON "patch_job_packages"("job_host_id");
CREATE INDEX "patch_job_packages_status_idx" ON "patch_job_packages"("status");

-- Foreign keys
ALTER TABLE "patch_policy_groups" ADD CONSTRAINT "patch_policy_groups_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "patch_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patch_policy_groups" ADD CONSTRAINT "patch_policy_groups_host_group_id_fkey" FOREIGN KEY ("host_group_id") REFERENCES "host_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patch_policy_filters" ADD CONSTRAINT "patch_policy_filters_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "patch_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patch_windows" ADD CONSTRAINT "patch_windows_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "patch_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patch_jobs" ADD CONSTRAINT "patch_jobs_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "patch_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patch_jobs" ADD CONSTRAINT "patch_jobs_window_id_fkey" FOREIGN KEY ("window_id") REFERENCES "patch_windows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "patch_job_hosts" ADD CONSTRAINT "patch_job_hosts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "patch_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patch_job_hosts" ADD CONSTRAINT "patch_job_hosts_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patch_job_packages" ADD CONSTRAINT "patch_job_packages_job_host_id_fkey" FOREIGN KEY ("job_host_id") REFERENCES "patch_job_hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
