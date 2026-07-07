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
    await pool.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;');
    console.log('Successfully added updated_at column.');
  } catch (err) {
    console.error('Error adding updated_at column:', err);
  } finally {
    pool.end();
  }
}

run();
