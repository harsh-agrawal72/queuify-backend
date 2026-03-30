const { pool } = require('./src/config/db');
async function check() {
  try {
    const tables = ['appointments', 'slots', 'users', 'organizations', 'services', 'resources', 'wallet_transactions'];
    const id = 'f9c03f2b-8714-49a7-925b-51a9b136e169'; // The mysterious ID from the logs

    for (const table of tables) {
      const res = await pool.query(`SELECT * FROM ${table} WHERE id::text = $1`, [id]);
      if (res.rows.length > 0) {
        console.log(`Found ID in table: ${table}`);
        console.log(JSON.stringify(res.rows[0], null, 2));
      }
    }

    // Also check reference_id in wallet_transactions
    const wtRes = await pool.query(`SELECT * FROM wallet_transactions WHERE reference_id::text = $1`, [id]);
    if (wtRes.rows.length > 0) {
      console.log(`Found ID as reference_id in wallet_transactions:`);
      console.log(JSON.stringify(wtRes.rows, null, 2));
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
check();
