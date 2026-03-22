-- Add preferred_date to appointments to track the intended date even when waitlisted
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS preferred_date DATE;

-- Initialize preferred_date for existing appointments that have a slot
UPDATE appointments a
SET preferred_date = DATE(s.start_time)
FROM slots s
WHERE a.slot_id = s.id AND a.preferred_date IS NULL;

-- For those without a slot (if any were already waitlisted), use created_at as a fallback
UPDATE appointments
SET preferred_date = DATE(created_at)
WHERE preferred_date IS NULL;
