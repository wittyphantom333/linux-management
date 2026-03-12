-- Seed new alert_config rows for host-report-based alerts and patch job alerts.
-- Uses ON CONFLICT to be safely re-runnable.

INSERT INTO "alert_config" ("id", "alert_type", "is_enabled", "default_severity", "auto_assign_enabled", "notification_enabled", "cleanup_resolved_only", "metadata", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'disk_space_warning',  true,  'warning',       false, true, true, '{"threshold_percent": 85}',  NOW(), NOW()),
    (gen_random_uuid(), 'high_load_average',   true,  'warning',       false, true, true, '{"per_core_threshold": 2.0}', NOW(), NOW()),
    (gen_random_uuid(), 'reboot_required',     true,  'informational', false, true, true, '{}',                          NOW(), NOW()),
    (gen_random_uuid(), 'security_updates',    true,  'warning',       false, true, true, '{"min_count": 1}',            NOW(), NOW()),
    (gen_random_uuid(), 'patch_job_failed',    true,  'error',         false, true, true, '{}',                          NOW(), NOW())
ON CONFLICT ("alert_type") DO NOTHING;

-- Also seed alert_actions if missing (upsert-safe)
INSERT INTO "alert_actions" ("id", "name", "display_name", "description", "is_state_action", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'acknowledged', 'Acknowledged', 'Acknowledge the alert', true, NOW(), NOW()),
    (gen_random_uuid(), 'resolved',     'Resolved',     'Resolve the alert',     true, NOW(), NOW()),
    (gen_random_uuid(), 'silenced',     'Silenced',     'Silence the alert',     true, NOW(), NOW()),
    (gen_random_uuid(), 'unsilenced',   'Unsilenced',   'Unsilence the alert',   true, NOW(), NOW()),
    (gen_random_uuid(), 'done',         'Done',         'Mark as done',          true, NOW(), NOW())
ON CONFLICT ("name") DO NOTHING;
