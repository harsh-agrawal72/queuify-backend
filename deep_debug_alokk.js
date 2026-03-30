const { pool } = require('./src/config/db');
async function check() {
  try {
    // 1. Get User ID for Alokk
    const userRes = await pool.query("SELECT id, name FROM users WHERE name ILIKE '%Alokk%'");
    if (userRes.rows.length === 0) {
      console.log('User Alokk not found');
      process.exit(0);
    }
    const user = userRes.rows[0];
    console.log(`Checking data for User: ${user.name} (${user.id})`);

    // 2. Get All Appointments for this user
    const appts = await pool.query("SELECT * FROM appointments WHERE user_id = $1", [user.id]);
    console.log('\n--- ALL APPOINTMENTS IN DB ---');
    console.log(JSON.stringify(appts.rows, null, 2));

    // 3. Get All Wallet Transactions related to these appointments OR this user
    const txs = await pool.query(`
      SELECT wt.*, w.org_id
      FROM wallet_transactions wt
      JOIN wallets w ON wt.wallet_id = w.id
      WHERE wt.reference_id::text IN (SELECT id::text FROM appointments WHERE user_id = $1)
         OR wt.description ILIKE $2
      ORDER BY wt.created_at ASC
    `, [user.id, `%${user.name}%`]);
    console.log('\n--- RELEVANT WALLET TRANSACTIONS ---');
    console.log(JSON.stringify(txs.rows, null, 2));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
check();
