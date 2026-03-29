const { pool } = require('./src/config/db');

async function run() {
    try {
        const u = await pool.query("SELECT email, role FROM users WHERE role = 'user' LIMIT 1");
        const a = await pool.query("SELECT email, role FROM users WHERE role = 'admin' LIMIT 1");
        const o = await pool.query("SELECT name, id FROM organizations LIMIT 1");
        console.log(JSON.stringify({
            user: u.rows[0],
            admin: a.rows[0],
            org: o.rows[0]
        }));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
