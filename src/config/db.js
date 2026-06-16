const { Pool } = require('pg');
const config = require('./config');

const poolConfig = {
    host: config.postgres.host || (config.fallback && config.fallback.host) || 'localhost',
    port: config.postgres.port,
    user: config.postgres.user,
    password: config.postgres.password,
    database: config.postgres.database,
    ssl: { rejectUnauthorized: false }, // Required for Render PostgreSQL
    // Pool tuning — prevents connection starvation under concurrent load
    max: 15,                        // max 15 concurrent DB connections (up from 10)
    idleTimeoutMillis: 30000,       // release idle connections after 30s
    connectionTimeoutMillis: 5000,  // fail fast if no connection available in 5s
    statement_timeout: 30000,       // kill runaway queries after 30s
    keepAlive: true,                // TCP keepalive prevents silent drops on cloud networks
    keepAliveInitialDelayMillis: 10000, // Start keepalive pings after 10s idle
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
