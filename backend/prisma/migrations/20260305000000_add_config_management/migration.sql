-- CreateTable: cm_techniques
CREATE TABLE "cm_techniques" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "category" TEXT,
    "parameters" JSONB,
    "methods" JSONB NOT NULL,
    "conditions" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cm_techniques_pkey" PRIMARY KEY ("id")
);

-- CreateTable: cm_directives
CREATE TABLE "cm_directives" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "technique_id" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "policy_mode" TEXT NOT NULL DEFAULT 'audit',
    "parameters" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tags" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cm_directives_pkey" PRIMARY KEY ("id")
);

-- CreateTable: cm_rules
CREATE TABLE "cm_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "tags" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cm_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable: cm_rule_directives (join)
CREATE TABLE "cm_rule_directives" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "directive_id" TEXT NOT NULL,

    CONSTRAINT "cm_rule_directives_pkey" PRIMARY KEY ("id")
);

-- CreateTable: cm_rule_groups (join)
CREATE TABLE "cm_rule_groups" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "host_group_id" TEXT NOT NULL,

    CONSTRAINT "cm_rule_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable: cm_policy_runs
CREATE TABLE "cm_policy_runs" (
    "id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "global_mode" TEXT NOT NULL DEFAULT 'audit',
    "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_directives" INTEGER NOT NULL DEFAULT 0,
    "compliant" INTEGER NOT NULL DEFAULT 0,
    "non_compliant" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "repaired" INTEGER NOT NULL DEFAULT 0,
    "not_applicable" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "directive_results" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cm_policy_runs_pkey" PRIMARY KEY ("id")
);

-- AddColumn: configmanagement_enabled on hosts
ALTER TABLE "hosts" ADD COLUMN IF NOT EXISTS "configmanagement_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: cm_techniques
CREATE UNIQUE INDEX "cm_techniques_name_version_key" ON "cm_techniques"("name", "version");
CREATE INDEX "cm_techniques_category_idx" ON "cm_techniques"("category");
CREATE INDEX "cm_techniques_enabled_idx" ON "cm_techniques"("enabled");

-- CreateIndex: cm_directives
CREATE INDEX "cm_directives_technique_id_idx" ON "cm_directives"("technique_id");
CREATE INDEX "cm_directives_enabled_idx" ON "cm_directives"("enabled");
CREATE INDEX "cm_directives_policy_mode_idx" ON "cm_directives"("policy_mode");

-- CreateIndex: cm_rules
CREATE INDEX "cm_rules_enabled_idx" ON "cm_rules"("enabled");

-- CreateIndex: cm_rule_directives
CREATE UNIQUE INDEX "cm_rule_directives_rule_id_directive_id_key" ON "cm_rule_directives"("rule_id", "directive_id");

-- CreateIndex: cm_rule_groups
CREATE UNIQUE INDEX "cm_rule_groups_rule_id_host_group_id_key" ON "cm_rule_groups"("rule_id", "host_group_id");
CREATE INDEX "cm_rule_groups_host_group_id_idx" ON "cm_rule_groups"("host_group_id");

-- CreateIndex: cm_policy_runs
CREATE INDEX "cm_policy_runs_host_id_idx" ON "cm_policy_runs"("host_id");
CREATE INDEX "cm_policy_runs_evaluated_at_idx" ON "cm_policy_runs"("evaluated_at");
CREATE INDEX "cm_policy_runs_host_id_evaluated_at_idx" ON "cm_policy_runs"("host_id", "evaluated_at");
CREATE INDEX "cm_policy_runs_score_idx" ON "cm_policy_runs"("score");

-- AddForeignKey: cm_directives → cm_techniques
ALTER TABLE "cm_directives" ADD CONSTRAINT "cm_directives_technique_id_fkey" FOREIGN KEY ("technique_id") REFERENCES "cm_techniques"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: cm_rule_directives → cm_rules
ALTER TABLE "cm_rule_directives" ADD CONSTRAINT "cm_rule_directives_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "cm_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: cm_rule_directives → cm_directives
ALTER TABLE "cm_rule_directives" ADD CONSTRAINT "cm_rule_directives_directive_id_fkey" FOREIGN KEY ("directive_id") REFERENCES "cm_directives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: cm_rule_groups → cm_rules
ALTER TABLE "cm_rule_groups" ADD CONSTRAINT "cm_rule_groups_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "cm_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: cm_policy_runs → hosts
ALTER TABLE "cm_policy_runs" ADD CONSTRAINT "cm_policy_runs_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
