require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function debug() {
  try {
    const res = await pool.query(`
      SELECT a.id, a.status, a.payment_status, a.price, a.user_id, u.name as user_name
      FROM appointments a
      JOIN users u ON a.user_id = u.id
      WHERE u.email = 'alokkagrawal18923@gmail.com'
      ORDER BY a.created_at DESC
    `);
    console.log('--- Current Appointments for Alokk ---');
    console.table(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
debug();
