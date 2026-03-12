-- Seed host_up alert config row for "host back online" notifications.
-- Uses ON CONFLICT to be safely re-runnable.

INSERT INTO "alert_config" ("id", "alert_type", "is_enabled", "default_severity", "auto_assign_enabled", "notification_enabled", "cleanup_resolved_only", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'host_up', true, 'informational', false, true, true, NOW(), NOW())
ON CONFLICT ("alert_type") DO NOTHING;
