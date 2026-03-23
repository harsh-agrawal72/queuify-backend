const { pool } = require('../config/db');

const migrate = async () => {
    try {
        console.log('Migration 5: Creating conversations and messages tables...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(50) DEFAULT 'active',
                last_message_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (org_id, user_id)
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('user', 'admin')),
                sender_id UUID NOT NULL,
                content TEXT NOT NULL,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversations_org ON conversations(org_id);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);`);

        console.log('Migration 5: Completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration 5 failed!', err.message);
        process.exit(1);
    }
};

migrate();
