require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function deepDebug() {
  try {
    const res = await pool.query(`
      SELECT a.id, a.status, a.payment_status, a.price, a.created_at, s.name as service_name
      FROM appointments a
      JOIN services s ON a.service_id = s.id
      JOIN users u ON a.user_id = u.id
      WHERE u.email = 'alokkagrawal18923@gmail.com'
      ORDER BY a.created_at DESC
    `);
    console.log('--- ALL APPOINTMENTS FOR ALOKK ---');
    console.table(res.rows);
    
    const countRes = await pool.query(`
      SELECT status, count(*) 
      FROM appointments a
      JOIN users u ON a.user_id = u.id
      WHERE u.email = 'alokkagrawal18923@gmail.com'
      GROUP BY status
    `);
    console.log('--- STATUS SUMMARY ---');
    console.table(countRes.rows);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
deepDebug();
