const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, 'backend/.env') });

async function resetAdminPassword() {
    const client = new Client({
        host: process.env.POSTGRES_HOST,
        port: process.env.POSTGRES_PORT,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB,
    });

    try {
        await client.connect();
        const hashedPassword = await bcrypt.hash('Admin@123', 10);
        await client.query("UPDATE users SET password = $1 WHERE email = 'agrawaly406@gmail.com'", [hashedPassword]);
        console.log("Password updated for agrawaly406@gmail.com");
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}

resetAdminPassword();
