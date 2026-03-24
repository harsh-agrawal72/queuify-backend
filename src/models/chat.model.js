const { pool } = require('../config/db');

const Chat = {
    async createConversation(orgId, userId) {
        const query = `
            INSERT INTO conversations (org_id, user_id, status)
            VALUES ($1, $2, 'active')
            ON CONFLICT (org_id, user_id) 
            DO UPDATE SET status = 'active', updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;
        const result = await pool.query(query, [orgId, userId]);
        return result.rows[0];
    },

    async getConversationByUserAndOrg(userId, orgId) {
        const query = `SELECT * FROM conversations WHERE user_id = $1 AND org_id = $2`;
        const result = await pool.query(query, [userId, orgId]);
        return result.rows[0];
    },

    async getConversationById(id) {
        const query = `SELECT * FROM conversations WHERE id = $1`;
        const result = await pool.query(query, [id]);
        return result.rows[0];
    },

    async getUserConversations(userId) {
        const query = `
            SELECT 
                c.*, 
                o.name as org_name, 
                oi.image_url as org_avatar,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_type = 'admin' AND m.is_read = FALSE) as unread_count,
                (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
            FROM conversations c
            JOIN organizations o ON c.org_id = o.id
            LEFT JOIN organization_images oi ON o.id = oi.org_id AND oi.image_type = 'logo'
            WHERE c.user_id = $1
            ORDER BY c.last_message_at DESC;
        `;
        const result = await pool.query(query, [userId]);
        return result.rows;
    },

    async getOrgConversations(orgId) {
        const query = `
            SELECT 
                c.*, 
                u.name as user_name, 
                u.email as user_email,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_type = 'user' AND m.is_read = FALSE) as unread_count,
                (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
            FROM conversations c
            JOIN users u ON c.user_id = u.id
            WHERE c.org_id = $1
            ORDER BY c.last_message_at DESC;
        `;
        const result = await pool.query(query, [orgId]);
        return result.rows;
    },

    async addMessage(conversationId, senderType, senderId, content) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const insertQuery = `
                INSERT INTO messages (conversation_id, sender_type, sender_id, content)
                VALUES ($1, $2, $3, $4)
                RETURNING *;
            `;
            const msgResult = await client.query(insertQuery, [conversationId, senderType, senderId, content]);
            const message = msgResult.rows[0];

            const updateConvQuery = `
                UPDATE conversations 
                SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = $1;
            `;
            await client.query(updateConvQuery, [conversationId]);

            await client.query('COMMIT');
            return message;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    async getMessages(conversationId, limit = 50, offset = 0) {
        const query = `
            SELECT * FROM messages 
            WHERE conversation_id = $1 
            ORDER BY created_at DESC 
            LIMIT $2 OFFSET $3;
        `;
        const result = await pool.query(query, [conversationId, limit, offset]);
        // Reverse to get chronological order for UI
        return result.rows.reverse();
    },

    async markMessagesAsRead(conversationId, readerType) {
        const senderTypeToUpdate = readerType === 'user' ? 'admin' : 'user';
        const query = `
            UPDATE messages 
            SET is_read = TRUE 
            WHERE conversation_id = $1 AND sender_type = $2 AND is_read = FALSE
            RETURNING *;
        `;
        await pool.query(query, [conversationId, senderTypeToUpdate]);
    }
};

module.exports = Chat;
