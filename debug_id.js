const { pool } = require('./src/config/db');

async function debugAppointment() {
    const id = '425dc383-b207-4807-aaf8-8547711fb4b4';
    try {
        console.log('--- DEBUGGING APPOINTMENT ID:', id, '---');
        
        // 1. Check if ID exists in appointments
        const appt = await pool.query('SELECT * FROM appointments WHERE id = $1', [id]);
        console.log('Found in appointments:', appt.rows.length > 0 ? 'YES' : 'NO');
        if (appt.rows.length > 0) {
            console.log('Appointment Data:', JSON.stringify(appt.rows[0], null, 2));
        }

        // 2. Try the model function
        const appointmentModel = require('./src/models/appointment.model');
        console.log('Calling appointmentModel.getAppointmentById...');
        const detailedAppt = await appointmentModel.getAppointmentById(id);
        console.log('Model Result:', detailedAppt ? 'SUCCESS' : 'NULL');

    } catch (err) {
        console.error('CRASH DETECTED:');
        console.error('Message:', err.message);
        console.error('Stack:', err.stack);
        if (err.hint) console.error('Hint:', err.hint);
        if (err.detail) console.error('Detail:', err.detail);
    } finally {
        await pool.end();
    }
}

debugAppointment();
