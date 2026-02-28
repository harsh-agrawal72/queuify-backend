const { pool } = require('../config/db');

const migrate = async () => {
    try {
        console.log('Starting migration: Create organization profile tables...');

        console.log('Step 1: Creating organization_profiles table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS organization_profiles (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
                description TEXT,
                address TEXT,
                city VARCHAR(100),
                state VARCHAR(100),
                pincode VARCHAR(20),
                contact_email VARCHAR(255),
                contact_phone VARCHAR(50),
                website_url VARCHAR(255),
                working_hours JSONB,
                gst_number VARCHAR(100),
                registration_number VARCHAR(100),
                established_year INTEGER,
                total_staff INTEGER,
                facebook_url VARCHAR(255),
                instagram_url VARCHAR(255),
                linkedin_url VARCHAR(255),
                verified BOOLEAN DEFAULT false,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('Step 2: Creating organization_images table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS organization_images (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                image_url TEXT NOT NULL,
                image_type VARCHAR(50) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed!');
        console.error('Error Code:', error.code);
        console.error('Error Message:', error.message);
        if (error.detail) console.error('Error Detail:', error.detail);
        if (error.hint) console.error('Error Hint:', error.hint);
        if (error.stack) console.error(error.stack);
        process.exit(1);
    }
};

migrate();
