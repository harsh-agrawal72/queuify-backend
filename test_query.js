const { pool } = require('./src/config/db');
const fs = require('fs');

const testQuery = async () => {
    try {
        const query = `
        SELECT 
            a.id, 
            a.status, 
            a.cancelled_by,
            a.created_at, 
            a.token_number,
            a.queue_number,
            u.name as user_name, 
            u.email as user_email, 
            s.start_time, 
            s.end_time,
            svc.name as service_name,
            r.name as resource_name
        FROM appointments a
        LEFT JOIN users u ON a.user_id = u.id
        LEFT JOIN slots s ON a.slot_id = s.id
        LEFT JOIN services svc ON a.service_id = svc.id
        LEFT JOIN resources r ON a.resource_id = r.id
        WHERE a.org_id = $1
        ORDER BY a.created_at DESC LIMIT $2 OFFSET $3
        `;
        const values = ['d1d347ad-423e-42b9-86a8-9ffe3e4edf0b', '10', 0];
        
        fs.writeFileSync('error_log.txt', "Executing...\n");
        const res = await pool.query(query, values);
        fs.appendFileSync('error_log.txt', "Query succeeded! Rows: " + res.rows.length);
    } catch (error) {
        fs.appendFileSync('error_log.txt', "Database Error: " + error.message);
    } finally {
        process.exit(0);
    }
};

testQuery();
