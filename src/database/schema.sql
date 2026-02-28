-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums
CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'user');
CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed', 'serving', 'no_show');
CREATE TYPE organization_status AS ENUM ('pending', 'active', 'rejected', 'disabled');

-- ═══════════════════════════════════════
-- 1. Organizations
-- ═══════════════════════════════════════
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    contact_email VARCHAR(255),
    org_code VARCHAR(10) UNIQUE,
    industry_type VARCHAR(100) DEFAULT 'general',
    status organization_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════
-- 2. Users
-- ═══════════════════════════════════════
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'user',
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT check_org_id CHECK (
        (role = 'superadmin' AND org_id IS NULL) OR
        (role = 'user' AND org_id IS NULL) OR
        (role = 'admin' AND org_id IS NOT NULL)
    )
);

-- ═══════════════════════════════════════
-- 3. Services (what type of work)
-- ═══════════════════════════════════════
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ═══════════════════════════════════════
-- 4. Resources (who/what performs a service)
-- ═══════════════════════════════════════
CREATE TABLE resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) DEFAULT 'staff',
    description TEXT,
    price DECIMAL(10, 2) DEFAULT 0.00,
    duration_minutes INTEGER DEFAULT 30,
    capacity INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ═══════════════════════════════════════
-- 5. Slots (time blocks per resource)
-- ═══════════════════════════════════════
CREATE TABLE slots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    max_capacity INTEGER NOT NULL DEFAULT 1,
    booked_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT check_times CHECK (end_time > start_time),
    CONSTRAINT check_capacity CHECK (booked_count <= max_capacity)
);

-- ═══════════════════════════════════════
-- 6. Appointments
-- ═══════════════════════════════════════
CREATE TABLE appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    resource_id UUID REFERENCES resources(id) ON DELETE SET NULL,
    status appointment_status NOT NULL DEFAULT 'pending',
    queue_number INTEGER,
    token_number INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reminder_sent BOOLEAN DEFAULT FALSE
);

-- ═══════════════════════════════════════
-- Indexes
-- ═══════════════════════════════════════
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_services_org ON services(org_id);
CREATE INDEX idx_resources_org ON resources(org_id);
CREATE INDEX idx_resources_service ON resources(service_id);
CREATE INDEX idx_slots_org_id ON slots(org_id);
CREATE INDEX idx_slots_resource ON slots(resource_id);
CREATE INDEX idx_slots_service ON slots(service_id);
CREATE INDEX idx_slots_times ON slots(start_time, end_time);
CREATE INDEX idx_appointments_org_id ON appointments(org_id);
CREATE INDEX idx_appointments_user_id ON appointments(user_id);
CREATE INDEX idx_appointments_slot_id ON appointments(slot_id);
CREATE INDEX idx_appointments_service ON appointments(service_id);
CREATE INDEX idx_appointments_status ON appointments(status);

-- ═══════════════════════════════════════
-- Auto-update timestamps trigger
-- ═══════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_slots_updated_at BEFORE UPDATE ON slots FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════
-- 7. Reviews
-- ═══════════════════════════════════════
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reviews_org_id ON reviews(org_id);
CREATE INDEX idx_reviews_user_id ON reviews(user_id);
CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════
-- 8. Organization Images
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS organization_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    image_url TEXT,
    image_data BYTEA,
    mime_type VARCHAR(100),
    image_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_org_images_org_id ON organization_images(org_id);
