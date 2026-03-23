const { pool } = require('../config/db');

const migrate = async () => {
    try {
        console.log('Migration 4: Adding phone column to users table...');

        await pool.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS phone VARCHAR(20)
        `);

        console.log('Migration 4: Completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration 4 failed!', error.message);
        process.exit(1);
    }
};

migrate();
