const { pool } = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function seed() {
    try {
        const hashedPassword = await bcrypt.hash('Password123', 8);
        
        // 1. Create Organization
        const orgRes = await pool.query(
            "INSERT INTO organizations (name, slug, contact_email, org_code, status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            ['Verification Lab', 'verification-lab', 'testadmin@queuify.in', 'VER001', 'active']
        );
        const orgId = orgRes.rows[0].id;
        
        // 2. Create Admin
        await pool.query(
            "INSERT INTO users (name, email, password_hash, role, org_id, is_email_verified) VALUES ($1, $2, $3, $4, $5, $6)",
            ['Admin Test', 'testadmin@queuify.in', hashedPassword, 'admin', orgId, true]
        );
        
        // 3. Create User
        await pool.query(
            "INSERT INTO users (name, email, password_hash, role, is_email_verified) VALUES ($1, $2, $3, $4, $5)",
            ['User Test', 'testuser@queuify.in', hashedPassword, 'user', true]
        );
        
        // 4. Initialize Wallet
        await pool.query(
            "INSERT INTO wallets (org_id, total_balance, locked_funds, available_balance, disputed_balance) VALUES ($1, $2, $3, $4, $5)",
            [orgId, 0, 0, 0, 0]
        );

        console.log('Seed Complete');
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

seed();
