-- Ensure all organizations have a unique slug
-- 1. Add slug column if it doesn't exist (it should, but just in case)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='slug') THEN
        ALTER TABLE organizations ADD COLUMN slug VARCHAR(255) UNIQUE;
    END IF;
END $$;

-- 2. Populate missing slugs based on name
-- We use a simple slugify logic: lower case, replace non-alphanumeric with hyphens
UPDATE organizations 
SET slug = LTRIM(RTRIM(LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')), '-'), '-')
WHERE slug IS NULL OR slug = '';

-- 3. Ensure slugs are unique by appending ID if necessary (edge case)
UPDATE organizations o1
SET slug = slug || '-' || id::text
WHERE EXISTS (
    SELECT 1 FROM organizations o2 
    WHERE o1.slug = o2.slug AND o1.id <> o2.id
);
