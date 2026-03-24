const { pool } = require('./src/config/db');

async function migrate() {
    try {
        console.log('Starting migration...');
        
        // 1. Add profile_picture_url to users table
        console.log('Adding profile_picture_url to users...');
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_url TEXT');
        
        // 2. Ensure user_images table exists (just in case)
        console.log('Ensuring user_images table exists...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_images (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                image_data BYTEA,
                mime_type VARCHAR(100),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
