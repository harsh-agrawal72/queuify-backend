const { Pool } = require('pg');
const config = require('./config');

const poolConfig = {
    host: config.postgres.host,
    port: config.postgres.port,
    user: config.postgres.user,
    password: config.postgres.password,
    database: config.postgres.database,
};

// Enable SSL for Render database connections
poolConfig.ssl = { rejectUnauthorized: false };

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err.message);
    // Don't exit — let the server keep running
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
};
