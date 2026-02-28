const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    user: config.postgres.user,
    password: config.postgres.password,
    database: config.postgres.database,
    ssl: {
        rejectUnauthorized: false
    }
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err.message);
    // Don't exit — let the server keep running
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
};
