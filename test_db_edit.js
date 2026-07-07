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
    // try editing the most recent message
    const res = await pool.query('SELECT id, conversation_id, content FROM messages ORDER BY created_at DESC LIMIT 1;');
    if (res.rows.length === 0) {
      console.log('No messages found');
      return;
    }
    const msgId = res.rows[0].id;
    console.log('Editing message ID:', msgId);
    
    const updateRes = await pool.query(`
        UPDATE messages 
        SET content = $2, is_edited = TRUE, edited_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *;
    `, [msgId, 'Test edit']);
    
    console.log('Edit result:', updateRes.rows[0]);
    
  } catch (err) {
    console.error('Error during edit test:', err);
  } finally {
    pool.end();
  }
}

run();
