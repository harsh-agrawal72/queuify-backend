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
    const res = await pool.query('SELECT id, created_at, sender_type FROM messages ORDER BY created_at DESC LIMIT 5;');
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

run();
