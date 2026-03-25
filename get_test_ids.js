const { pool } = require('./src/config/db');
const fs = require('fs');

async function run() {
    try {
        const org = await pool.query('SELECT id FROM organizations LIMIT 1');
        const orgId = org.rows[0].id;
        const svc = await pool.query('SELECT id FROM services WHERE org_id = $1 LIMIT 1', [orgId]);
        const svcId = svc.rows[0].id;
        const res = await pool.query('SELECT id FROM resources WHERE org_id = $1 LIMIT 1', [orgId]);
        const resId = res.rows[0].id;
        const user = await pool.query('SELECT id FROM users LIMIT 1');
        const userId = user.rows[0].id;

        const data = { orgId, svcId, resId, userId };
        fs.writeFileSync('test_ids.json', JSON.stringify(data));
        console.log('IDs saved to test_ids.json');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
run();
