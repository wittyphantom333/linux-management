-- Seed disk_space_critical alert config row.
-- Fires when any partition is at or above 95% usage (less than 5% free).
-- Uses ON CONFLICT to be safely re-runnable.

INSERT INTO "alert_config" ("id", "alert_type", "is_enabled", "default_severity", "auto_assign_enabled", "notification_enabled", "cleanup_resolved_only", "metadata", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'disk_space_critical', true, 'critical', false, true, true, '{"threshold_percent": 95}', NOW(), NOW())
ON CONFLICT ("alert_type") DO NOTHING;
