-- 19-add-reschedule-limits.sql
-- Updates existing plans with the new reschedule_limit feature

UPDATE plans 
SET features = jsonb_set(features::jsonb, '{reschedule_limit}', '0')
WHERE name = 'Free' AND target_role = 'user';

UPDATE plans 
SET features = jsonb_set(features::jsonb, '{reschedule_limit}', '1')
WHERE name = 'Standard' AND target_role = 'user';

UPDATE plans 
SET features = jsonb_set(features::jsonb, '{reschedule_limit}', '999')
WHERE name = 'Premium' AND target_role = 'user';
