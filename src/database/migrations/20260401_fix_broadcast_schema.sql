-- ═══════════════════════════════════════
-- BROADCAST SCHEMA FIX-UP
-- ═══════════════════════════════════════

-- 1. Ensure broadcast_logs table exists and is correct
CREATE TABLE IF NOT EXISTS broadcast_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'info',
    link VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Ensure notifications table has the 'link' column and 'type' column
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'link') THEN
        ALTER TABLE notifications ADD COLUMN link VARCHAR(255);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'type') THEN
        ALTER TABLE notifications ADD COLUMN type VARCHAR(50) DEFAULT 'system';
    END IF;
END $$;

-- 3. Ensure users table has 'notification_enabled' and 'email_notification_enabled'
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'notification_enabled') THEN
        ALTER TABLE users ADD COLUMN notification_enabled BOOLEAN DEFAULT true;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_notification_enabled') THEN
        ALTER TABLE users ADD COLUMN email_notification_enabled BOOLEAN DEFAULT true;
    END IF;
END $$;

-- 4. Backfill any NULL values to prevent exclusions in WHERE checks
UPDATE users SET notification_enabled = true WHERE notification_enabled IS NULL;
UPDATE users SET email_notification_enabled = true WHERE email_notification_enabled IS NULL;

-- 5. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_broadcast_logs_sender ON broadcast_logs(sender_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
