-- Migration: Add is_setup_completed column to organizations table
-- Description: This column tracks whether an organization has finished their onboarding setup.

ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS is_setup_completed BOOLEAN DEFAULT FALSE;

-- Update existing organizations to TRUE if they were already active (optional, but safer)
-- UPDATE organizations SET is_setup_completed = TRUE WHERE status = 'active';
