-- Migration for Win-Win Rescheduling (Proposal System)
DO $$ 
BEGIN 
    -- Add proposed_slot_id for suggestions
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='proposed_slot_id') THEN
        ALTER TABLE appointments ADD COLUMN proposed_slot_id UUID REFERENCES slots(id);
    END IF;

    -- Add reschedule_status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='reschedule_status') THEN
        ALTER TABLE appointments ADD COLUMN reschedule_status VARCHAR(20) DEFAULT 'none';
    END IF;

    -- Add reschedule_reason
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='reschedule_reason') THEN
        ALTER TABLE appointments ADD COLUMN reschedule_reason TEXT;
    END IF;

    -- Add is_priority flag
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='is_priority') THEN
        ALTER TABLE appointments ADD COLUMN is_priority BOOLEAN DEFAULT FALSE;
    END IF;
END $$;
