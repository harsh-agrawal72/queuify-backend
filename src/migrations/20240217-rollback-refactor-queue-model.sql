-- ROLLBACK: 20240217-refactor-queue-model.sql
-- WARNING: This will restore old structure but some data transformations (like many-to-many services) might be lossy if not handled carefully.

BEGIN;

-- 1. Restore Appointments columns
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS queue_number INTEGER;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS token_number INTEGER;
ALTER TABLE appointments ALTER COLUMN resource_id SET NOT NULL;
ALTER TABLE appointments ALTER COLUMN slot_id SET NOT NULL;

-- 2. Restore Resources columns
ALTER TABLE resources ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2) DEFAULT 0.00;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 30;

-- 3. Restore Resource -> Service single link
-- We'll try to restore the first service link found in resource_services
UPDATE resources r
SET service_id = (SELECT service_id FROM resource_services rs WHERE rs.resource_id = r.id LIMIT 1);

-- 4. Drop new table
DROP TABLE IF EXISTS resource_services;

-- 5. Remove new columns from Services
ALTER TABLE services 
DROP COLUMN IF EXISTS is_paid,
DROP COLUMN IF EXISTS base_price,
DROP COLUMN IF EXISTS queue_type,
DROP COLUMN IF EXISTS estimated_service_time,
DROP COLUMN IF EXISTS queue_scope;

-- 6. Remove new columns from Organizations
ALTER TABLE organizations DROP COLUMN IF EXISTS queue_mode_default;

-- 7. Drop Indexes
DROP INDEX IF EXISTS idx_appointments_central_ranking;
DROP INDEX IF EXISTS idx_appointments_resource_ranking;
DROP INDEX IF EXISTS idx_resource_services_service_id;

-- 8. Drop Enum Types (Optional, can keep them for future)
-- DROP TYPE IF EXISTS queue_type;
-- DROP TYPE IF EXISTS queue_scope;

COMMIT;
