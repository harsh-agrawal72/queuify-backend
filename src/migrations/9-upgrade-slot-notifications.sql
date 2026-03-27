-- Migration 9: Upgrade slot_notifications table for Auto-Booking
DO $$ 
BEGIN 
    -- 1. Ensure table exists (if 6-create didn't run)
    CREATE TABLE IF NOT EXISTS slot_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
        desired_time TIMESTAMP WITH TIME ZONE NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- 2. Add auto_book column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='slot_notifications' AND column_name='auto_book') THEN
        ALTER TABLE slot_notifications ADD COLUMN auto_book BOOLEAN DEFAULT FALSE;
    END IF;

    -- 3. Add service_id column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='slot_notifications' AND column_name='service_id') THEN
        ALTER TABLE slot_notifications ADD COLUMN service_id UUID REFERENCES services(id) ON DELETE SET NULL;
    END IF;

    -- 4. Add resource_id column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='slot_notifications' AND column_name='resource_id') THEN
        ALTER TABLE slot_notifications ADD COLUMN resource_id UUID REFERENCES resources(id) ON DELETE SET NULL;
    END IF;

    -- 5. Add customer_phone column (for auto-booking validation)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='slot_notifications' AND column_name='customer_phone') THEN
        ALTER TABLE slot_notifications ADD COLUMN customer_phone VARCHAR(20);
    END IF;

END $$;
