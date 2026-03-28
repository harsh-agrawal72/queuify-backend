-- Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_appointments_org_status ON appointments(org_id, status);
CREATE INDEX IF NOT EXISTS idx_appointments_org_created_at ON appointments(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_slots_org_start_time ON slots(org_id, start_time);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_appointments_preferred_date_org ON appointments(org_id, preferred_date);
