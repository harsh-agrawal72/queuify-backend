-- Add email_verified to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
