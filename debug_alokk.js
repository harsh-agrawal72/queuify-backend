const { pool } = require('./src/config/db');
async function check() {
  try {
    const res = await pool.query(`
      SELECT a.id, a.status, a.payment_status, a.price, u.name 
      FROM appointments a 
      JOIN users u ON a.user_id = u.id 
      WHERE u.name ILIKE '%Alokk%'
    `);
    console.log('--- APPOINTMENTS FOR ALOKK ---');
    console.log(JSON.stringify(res.rows, null, 2));
    
    const tx = await pool.query(`
      SELECT amount, type, status, reference_id, description, created_at
      FROM wallet_transactions
      WHERE description ILIKE '%Alokk%' OR reference_id::text IN (SELECT id::text FROM appointments WHERE user_id IN (SELECT id FROM users WHERE name ILIKE '%Alokk%'))
      ORDER BY created_at DESC
    `);
    console.log('--- WALLET TRANSACTIONS ---');
    console.log(JSON.stringify(tx.rows, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
check();
