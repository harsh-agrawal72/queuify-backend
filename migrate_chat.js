const { Pool } = require('pg');
require('dotenv').config({ path: './.env' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function runMigration() {
    let client;
    try {
        console.log('Starting chat tables migration...');
        client = await pool.connect();

        await client.query('BEGIN');

        // Create conversations table
        console.log('Creating conversations table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'closed')),
                last_message_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(org_id, user_id)
            );
        `);

        // Create messages table
        console.log('Creating messages table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                sender_type VARCHAR(50) NOT NULL CHECK (sender_type IN ('user', 'admin')),
                sender_id UUID NOT NULL,
                content TEXT NOT NULL,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Create indexes for performance
        console.log('Creating indexes for chat tables...');
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_conversations_org_id ON conversations(org_id);
            CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
            CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
        `);

        await client.query('COMMIT');
        console.log('Migration completed successfully!');

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Migration failed:', error);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

runMigration();
