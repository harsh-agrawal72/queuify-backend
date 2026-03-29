const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  ssl: {
    rejectUnauthorized: false
  }
});

async function runMigration() {
  const sqlPath = path.join(__dirname, 'src', 'database', 'migrations', '20260330_add_otp_column.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  
  console.log('Running migration...');
  try {
    const res = await pool.query(sql);
    console.log('Migration successful!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

runMigration();
