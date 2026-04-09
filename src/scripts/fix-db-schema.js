const { pool } = require('../config/db');

async function fixSchema() {
    console.log('🚀 Starting Database Schema Fix...');
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('--- Checking Organizations Table ---');
        // Add is_setup_completed to organizations
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='is_setup_completed') THEN
                    ALTER TABLE organizations ADD COLUMN is_setup_completed BOOLEAN DEFAULT FALSE;
                    RAISE NOTICE 'Added is_setup_completed to organizations';
                END IF;
            END $$;
        `);

        // Add is_onboarded to organizations
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='is_onboarded') THEN
                    ALTER TABLE organizations ADD COLUMN is_onboarded BOOLEAN DEFAULT FALSE;
                    RAISE NOTICE 'Added is_onboarded to organizations';
                END IF;
            END $$;
        `);

        // Add subscription_expiry to organizations
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='subscription_expiry') THEN
                    ALTER TABLE organizations ADD COLUMN subscription_expiry TIMESTAMP WITH TIME ZONE;
                    RAISE NOTICE 'Added subscription_expiry to organizations';
                END IF;
            END $$;
        `);

        console.log('--- Checking Users Table ---');
        // Add plan_id to users
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='plan_id') THEN
                    ALTER TABLE users ADD COLUMN plan_id UUID;
                    RAISE NOTICE 'Added plan_id to users';
                END IF;
            END $$;
        `);

        // Add subscription_expiry to users
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='subscription_expiry') THEN
                    ALTER TABLE users ADD COLUMN subscription_expiry TIMESTAMP WITH TIME ZONE;
                    RAISE NOTICE 'Added subscription_expiry to users';
                END IF;
            END $$;
        `);

        // Add subscription_status to users
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='subscription_status') THEN
                    ALTER TABLE users ADD COLUMN subscription_status VARCHAR(20) DEFAULT 'active';
                    RAISE NOTICE 'Added subscription_status to users';
                END IF;
            END $$;
        `);

        await client.query('COMMIT');
        console.log('✅ Database Schema Fix Completed Successfully!');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error fixing schema:', err.message);
    } finally {
        client.release();
        process.exit();
    }
}

fixSchema();
