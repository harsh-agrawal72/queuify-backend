-- 20260329_service_base_price.sql
-- Add Base Price to Services table
ALTER TABLE services 
ADD COLUMN IF NOT EXISTS price DECIMAL(12, 2) DEFAULT 0;
