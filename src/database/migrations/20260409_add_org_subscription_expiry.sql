-- 20260409_add_org_subscription_expiry.sql
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_expiry TIMESTAMP;
