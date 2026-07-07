const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, 'backend/.env') });

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'dpg-d8nr6ac8aovs739h4gqg-a.oregon-postgres.render.com',
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER || 'queuify_x2bz_user',
  password: process.env.POSTGRES_PASSWORD || 'HLzCZnWM1jrAYR9iD4CO45jLwC5y7Buu',
  database: process.env.POSTGRES_DB || 'queuify_x2bz',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP;');
    console.log('Successfully added edited_at column.');
    
    await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;');
    console.log('Successfully added is_deleted column.');
  } catch (err) {
    console.error('Error adding columns:', err);
  } finally {
    pool.end();
  }
}

run();
