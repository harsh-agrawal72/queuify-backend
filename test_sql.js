const { pool } = require('./src/config/db');

async function testQuery() {
    const id = '425dc383-b207-4807-aaf8-8547711fb4b4';
    try {
        console.log('--- RAW QUERY TEST ---');
        const rawRes = await pool.query('SELECT id FROM appointments WHERE id = $1', [id]);
        console.log('Raw ID Query Rows:', rawRes.rows.length);

        console.log('--- MODEL QUERY TEST (EMULATED) ---');
        const modelRes = await pool.query(`
            SELECT a.*, 
                    0 as queue_number,
                    s.name as service_name, s.queue_scope,
                    r.name as resource_name
            FROM appointments a
            LEFT JOIN services s ON a.service_id = s.id
            LEFT JOIN resources r ON a.resource_id = r.id
            WHERE a.id = $1
        `, [id]);
        console.log('Model Query Rows:', modelRes.rows.length);
        if (modelRes.rows.length > 0) {
            console.log('Data:', JSON.stringify(modelRes.rows[0], null, 2));
        }

    } catch (err) {
        console.error('ERROR:', err.message);
    } finally {
        await pool.end();
    }
}

testQuery();
