-- Add keywords to organization_profiles table
ALTER TABLE organization_profiles ADD COLUMN IF NOT EXISTS keywords TEXT;

-- Optional: Add a comment
COMMENT ON COLUMN organization_profiles.keywords IS 'Comma-separated keywords and hashtags for SEO and deep search accuracy';
