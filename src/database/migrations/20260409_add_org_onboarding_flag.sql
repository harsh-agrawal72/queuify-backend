-- 20260409_add_org_onboarding_flag.sql
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_onboarded BOOLEAN DEFAULT false;
