-- Remove host_up alert config row (replaced by generic resolved notifications).
DELETE FROM "alert_config" WHERE "alert_type" = 'host_up';

-- Resolve and deactivate any existing host_up alerts.
UPDATE "alerts"
SET "is_active" = false,
    "resolved_at" = NOW(),
    "updated_at" = NOW()
WHERE "type" = 'host_up' AND "is_active" = true;
