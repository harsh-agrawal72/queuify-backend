-- 16-add-user-plans.sql

-- 1. Update plans table to distinguish between admin and user plans
ALTER TABLE plans ADD COLUMN IF NOT EXISTS target_role VARCHAR(20) DEFAULT 'admin';

-- 2. Update users table to link to plans
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expiry TIMESTAMP WITH TIME ZONE;

-- 3. Seed User Plans
-- Ensure existing plans are marked as admin plans
UPDATE plans SET target_role = 'admin' WHERE target_role IS NULL;

-- Insert 3 tiers of User Plans if they don't exist
-- Using a subquery to avoid duplicates if rerun
INSERT INTO plans (name, price_monthly, price_yearly, commission_rate, features, target_role)
SELECT 'Free', 0, 0, 0, '{"max_active_appointments": 2, "notifications": ["email"], "priority": false, "reschedule_limit": 0}', 'user'
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Free' AND target_role = 'user');

INSERT INTO plans (name, price_monthly, price_yearly, commission_rate, features, target_role)
SELECT 'Standard', 99, 990, 0, '{"max_active_appointments": 5, "notifications": ["email", "push"], "priority": false, "reschedule_limit": 1}', 'user'
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Standard' AND target_role = 'user');

INSERT INTO plans (name, price_monthly, price_yearly, commission_rate, features, target_role)
SELECT 'Premium', 249, 2490, 0, '{"max_active_appointments": 999, "notifications": ["email", "push", "sms"], "priority": true, "reschedule_limit": 999}', 'user'
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Premium' AND target_role = 'user');

-- 4. Assign the 'Free' plan to all existing users who don't have one
UPDATE users u
SET plan_id = p.id
FROM plans p
WHERE u.role = 'user' 
  AND u.plan_id IS NULL 
  AND p.name = 'Free' 
  AND p.target_role = 'user';
