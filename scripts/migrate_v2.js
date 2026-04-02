const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const config = {
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl: { rejectUnauthorized: false }
};

const pool = new Pool(config);

async function run() {
    try {
        console.log('Connecting to database...');
        const client = await pool.connect();
        console.log('Connected.');
        console.log('Executing ALTER TABLE...');
        await client.query('ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_setup_completed BOOLEAN DEFAULT FALSE;');
        console.log('ALTER TABLE successful.');
        client.release();
    } catch (err) {
        console.error('ERROR:', err.message);
        console.error('FULL ERROR:', err);
    } finally {
        await pool.end();
    }
}

run();
