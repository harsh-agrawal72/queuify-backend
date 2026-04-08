-- 18-remove-refund-protection.sql
-- Removes the refund_protection key from the features JSON column in the plans table

UPDATE plans 
SET features = features - 'refund_protection'
WHERE target_role = 'user';
