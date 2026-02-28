-- PHASE 1: DATABASE MIGRATION
-- Filename: 20240217-refactor-queue-model.sql

BEGIN;

-- 1. Create New Enum Types
DO $$ BEGIN
    CREATE TYPE queue_type AS ENUM ('STATIC', 'DYNAMIC');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE queue_scope AS ENUM ('PER_RESOURCE', 'CENTRAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Update Organizations table
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS queue_mode_default queue_scope DEFAULT 'CENTRAL';

-- 3. Update Services table
ALTER TABLE services 
ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS base_price DECIMAL(10, 2) DEFAULT 0.00,
ADD COLUMN IF NOT EXISTS queue_type queue_type DEFAULT 'DYNAMIC',
ADD COLUMN IF NOT EXISTS estimated_service_time INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS queue_scope queue_scope DEFAULT 'CENTRAL';

-- 4. Create resource_services mapping table for Many-to-Many
CREATE TABLE IF NOT EXISTS resource_services (
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (resource_id, service_id)
);

-- 5. Data Migration: Move existing resource -> service links to the mapping table
INSERT INTO resource_services (resource_id, service_id)
SELECT id, service_id FROM resources 
WHERE service_id IS NOT NULL
ON CONFLICT (resource_id, service_id) DO NOTHING;

-- 6. Update Resources table
ALTER TABLE resources 
ADD COLUMN IF NOT EXISTS concurrent_capacity INTEGER DEFAULT 1;

-- Safely remove old columns from resources after data migration
ALTER TABLE resources DROP COLUMN IF EXISTS price;
ALTER TABLE resources DROP COLUMN IF EXISTS duration_minutes;
-- We keep service_id for a moment and make it nullable to avoid breaking existing queries until Phase 2
ALTER TABLE resources ALTER COLUMN service_id DROP NOT NULL;

-- 7. Update Appointments table
-- Make resource_id nullable for Central Queues
ALTER TABLE appointments ALTER COLUMN resource_id DROP NOT NULL;
ALTER TABLE appointments ALTER COLUMN slot_id DROP NOT NULL;

-- Safely remove stored queue/token numbers (now calculated dynamically)
ALTER TABLE appointments DROP COLUMN IF EXISTS queue_number;
ALTER TABLE appointments DROP COLUMN IF EXISTS token_number;

-- 8. Performance Indexes for Ranking Logic
-- Index for quick ranking by service (Central)
CREATE INDEX IF NOT EXISTS idx_appointments_central_ranking 
ON appointments (service_id, created_at) 
WHERE status IN ('pending', 'confirmed');

-- Index for quick ranking by resource (Per-Resource)
CREATE INDEX IF NOT EXISTS idx_appointments_resource_ranking 
ON appointments (service_id, resource_id, created_at) 
WHERE status IN ('pending', 'confirmed');

-- Index for many-to-many lookup
CREATE INDEX IF NOT EXISTS idx_resource_services_service_id ON resource_services(service_id);

COMMIT;
