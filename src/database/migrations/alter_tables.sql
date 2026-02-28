-- Note: You should back up your database before running these.
-- These commands will add the missing columns to existing tables
-- without dropping or deleting the existing data.

-- ═══════════════════════════════════════
-- 1. Organizations
-- ═══════════════════════════════════════
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS plan VARCHAR(50) DEFAULT 'basic',
ADD COLUMN IF NOT EXISTS type VARCHAR(100) DEFAULT 'Clinic',
ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'active',
ADD COLUMN IF NOT EXISTS plan_id UUID;

-- ═══════════════════════════════════════
-- 2. Users
-- ═══════════════════════════════════════
-- Optional: If you had password_hash as NOT NULL and want to allow Google login
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS is_password_set BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'local',
ADD COLUMN IF NOT EXISTS google_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;

-- ═══════════════════════════════════════
-- 3. Services
-- ═══════════════════════════════════════
ALTER TABLE services
ADD COLUMN IF NOT EXISTS queue_type VARCHAR(50) DEFAULT 'DYNAMIC',
ADD COLUMN IF NOT EXISTS estimated_service_time INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS queue_scope VARCHAR(50) DEFAULT 'CENTRAL',
ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════
-- 4. Resources
-- ═══════════════════════════════════════
ALTER TABLE resources RENAME COLUMN capacity TO concurrent_capacity;
ALTER TABLE resources ALTER COLUMN service_id DROP NOT NULL;

-- ═══════════════════════════════════════
-- 5. Slots
-- ═══════════════════════════════════════
ALTER TABLE slots ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';

-- ═══════════════════════════════════════
-- 6. New Missing Tables
-- ═══════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_org_images_org_id ON organization_images(org_id);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'system',
    link VARCHAR(255),
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

CREATE TABLE IF NOT EXISTS organization_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    description TEXT,
    logo_url TEXT,
    website VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    established_year INTEGER,
    total_staff INTEGER,
    "isVerified" BOOLEAN DEFAULT false,
    "trustScore" INTEGER DEFAULT 0,
    images JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_org_profiles_updated_at') THEN CREATE TRIGGER update_org_profiles_updated_at BEFORE UPDATE ON organization_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;

CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    price_monthly DECIMAL(10, 2) NOT NULL,
    price_yearly DECIMAL(10, 2) NOT NULL,
    commission_rate DECIMAL(5, 2) DEFAULT 0.00,
    features JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_plans_updated_at') THEN CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;

CREATE TABLE IF NOT EXISTS resource_services (
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    PRIMARY KEY (resource_id, service_id)
);

CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    details JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);

CREATE TABLE IF NOT EXISTS admin_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(255) NOT NULL,
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_activity_logs_admin_id ON admin_activity_logs(admin_id);

CREATE TABLE IF NOT EXISTS request_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route VARCHAR(255),
    method VARCHAR(10),
    status INTEGER,
    response_time DECIMAL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message TEXT,
    stack TEXT,
    route VARCHAR(255),
    method VARCHAR(10),
    status_code INTEGER,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
