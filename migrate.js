const pool = require('./src/config/db');

async function migrate() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Add token_number to appointments
        await client.query(`
            ALTER TABLE appointments ADD COLUMN IF NOT EXISTS token_number VARCHAR(50)
        `);
        console.log('Added token_number column');

        // 2. Add index on token_number
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_appointments_token ON appointments(token_number)
        `);
        console.log('Added token_number index');

        // 3. Update check_org_id constraint — users can have NULL org_id
        await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS check_org_id');
        await client.query(`
            ALTER TABLE users ADD CONSTRAINT check_org_id CHECK (
                (role = 'superadmin' AND org_id IS NULL) OR
                (role = 'admin' AND org_id IS NOT NULL) OR
                (role = 'user')
            )
        `);
        console.log('Updated check_org_id constraint');

        // 4. Add preferred_date to appointments
        await client.query(`
            ALTER TABLE appointments ADD COLUMN IF NOT EXISTS preferred_date DATE
        `);
        console.log('Added preferred_date column');

        // 5. Initialize preferred_date for existing data
        await client.query(`
            UPDATE appointments a
            SET preferred_date = DATE(s.start_time)
            FROM slots s
            WHERE a.slot_id = s.id AND a.preferred_date IS NULL
        `);
        await client.query(`
            UPDATE appointments
            SET preferred_date = DATE(created_at)
            WHERE preferred_date IS NULL
        `);
        console.log('Initialized preferred_date for existing data');

        await client.query('COMMIT');
        console.log('Migration complete!');
        process.exit(0);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', e.message);
        process.exit(1);
    } finally {
        client.release();
    }
}

migrate();
