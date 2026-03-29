const { pool } = require('./src/config/db');

async function checkSchema() {
    try {
        console.log('Checking tables...');
        const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log('Tables:', tables.rows.map(r => r.table_name));

        const apptCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'appointments'");
        console.log('Appointments Columns:', apptCols.rows.map(r => r.column_name));

        const servicesCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'services'");
        console.log('Services Columns:', servicesCols.rows.map(r => r.column_name));

        const walletsCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'wallets'");
        console.log('Wallets Columns:', walletsCols.rows.map(r => r.column_name));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkSchema();
