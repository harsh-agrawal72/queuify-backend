const { pool } = require('../config/db');

const migrate = async () => {
    try {
        console.log('Migration 3: Adding missing columns to organization_profiles...');

        await pool.query(`
            ALTER TABLE organization_profiles
            ADD COLUMN IF NOT EXISTS city VARCHAR(100),
            ADD COLUMN IF NOT EXISTS state VARCHAR(100),
            ADD COLUMN IF NOT EXISTS pincode VARCHAR(20),
            ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255),
            ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50),
            ADD COLUMN IF NOT EXISTS website_url VARCHAR(255),
            ADD COLUMN IF NOT EXISTS working_hours JSONB,
            ADD COLUMN IF NOT EXISTS gst_number VARCHAR(100),
            ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100),
            ADD COLUMN IF NOT EXISTS established_year INTEGER,
            ADD COLUMN IF NOT EXISTS total_staff INTEGER,
            ADD COLUMN IF NOT EXISTS facebook_url VARCHAR(255),
            ADD COLUMN IF NOT EXISTS instagram_url VARCHAR(255),
            ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(255),
            ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false
        `);

        console.log('Migration 3: Completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration 3 failed!', error.message);
        process.exit(1);
    }
};

migrate();
