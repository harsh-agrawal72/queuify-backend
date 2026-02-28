const { pool } = require('../config/db');

const migrate = async () => {
    try {
        console.log('Starting migration: Add binary image data columns...');

        await pool.query(`
            ALTER TABLE organization_images 
            ADD COLUMN IF NOT EXISTS image_data BYTEA,
            ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100),
            ALTER COLUMN image_url DROP NOT NULL;
        `);

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed!');
        console.error(error);
        process.exit(1);
    }
};

migrate();
