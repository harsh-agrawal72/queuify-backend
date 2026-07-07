const { pool } = require('../config/db');

async function up() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        console.log('Adding is_deleted and is_edited columns to messages table...');
        
        await client.query(`
            ALTER TABLE messages 
            ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE;
        `);

        await client.query('COMMIT');
        console.log('Migration completed successfully.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        client.release();
        process.exit(0);
    }
}

up();
