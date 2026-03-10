-- AddAuditedCounter
-- Adds audited counter to cm_policy_runs for tracking audit-mode directives
-- that are informational-only (no pass/fail judgment).
ALTER TABLE "cm_policy_runs" ADD COLUMN "audited" INTEGER NOT NULL DEFAULT 0;
