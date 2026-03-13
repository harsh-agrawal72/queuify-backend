const { pool } = require('./src/config/db');

const testAppointmentsLogic = async () => {
    try {
        const queryText = `
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
        ORDER BY a.created_at DESC LIMIT 10
        `;
        const res = await pool.query(queryText);

        const formattedAppointments = res.rows.map(apt => {
            let displayToken = apt.token_number;
            if (!displayToken) {
                const dateStr = new Date(apt.created_at).toISOString().slice(0, 10).replace(/-/g, '');
                const suffix = apt.id.slice(-3).toUpperCase();
                displayToken = `TOKEN-${dateStr}-${suffix}`;
            }
            return {
                ...apt,
                token_number: displayToken
            };
        });

        console.log("Success! Rows:", formattedAppointments.length);
    } catch (error) {
        console.error("Javascript Error:", error.stack);
    } finally {
        process.exit(0);
    }
};

testAppointmentsLogic();
