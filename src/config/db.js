const { Pool } = require('pg');
const config = require('./config');

const poolConfig = {
    host: config.postgres.host,
    port: config.postgres.port,
    user: config.postgres.user,
    password: config.postgres.password,
    database: config.postgres.database,
    ssl: { rejectUnauthorized: false }, // Required for Render PostgreSQL
    // Pool tuning — prevents connection starvation under concurrent load
    max: 10,                        // max 10 concurrent DB connections
    idleTimeoutMillis: 30000,       // release idle connections after 30s
    connectionTimeoutMillis: 5000,  // fail fast if no connection available in 5s
    statement_timeout: 30000,       // kill runaway queries after 30s
};

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err.message);
    // Don't exit — let the server keep running
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
};
