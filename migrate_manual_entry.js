const { pool } = require('./src/config/db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log('Altering appointments table...');
    
    // 1. Make user_id nullable
    await client.query('ALTER TABLE appointments ALTER COLUMN user_id DROP NOT NULL');
    console.log('user_id is now nullable.');

    // 2. Add customer_name
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='customer_name') THEN
          ALTER TABLE appointments ADD COLUMN customer_name VARCHAR(255);
        END IF;
      END $$;
    `);
    console.log('customer_name column added.');

    // 3. Add customer_phone
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='customer_phone') THEN
          ALTER TABLE appointments ADD COLUMN customer_phone VARCHAR(50);
        END IF;
      END $$;
    `);
    console.log('customer_phone column added.');

    await client.query('COMMIT');
    console.log('Migration successful!');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

migrate();
