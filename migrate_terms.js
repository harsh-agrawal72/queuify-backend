const { Client } = require('pg');
const connectionString = 'postgresql://postgres.clnmtclmtyuxvswsteyj:Queuify_Password_123@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';

async function run() {
    console.log('Connecting to database...');
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false } // Required for some Supabase connections
    });
    
    try {
        await client.connect();
        console.log('Connected. Running ALTER TABLE...');
        await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN DEFAULT FALSE;');
        await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;');
        console.log('SUCCESS: added terms columns to users table.');
    } catch (e) {
        console.error('ERROR:', e.message);
    } finally {
        await client.end();
    }
}
run();
