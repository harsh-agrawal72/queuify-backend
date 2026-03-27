-- Performance Optimization Indexes

-- 1. Appointments: Search and Analytics
CREATE INDEX IF NOT EXISTS idx_appointments_customer_phone ON appointments(customer_phone);
CREATE INDEX IF NOT EXISTS idx_appointments_customer_name ON appointments(customer_name);
CREATE INDEX IF NOT EXISTS idx_appointments_token_number ON appointments(token_number);
CREATE INDEX IF NOT EXISTS idx_appointments_created_at ON appointments(created_at);

-- 2. Organizations: Industry Distribution
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(type);

-- 3. Logs: Real-time Monitor and Audit Trail
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);

-- 4. Traffic & Error Analytics
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_org_id ON request_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at);

-- 5. Chat: Performance
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
