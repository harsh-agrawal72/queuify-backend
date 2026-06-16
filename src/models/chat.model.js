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
                o.last_seen_at as org_last_seen,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_type = 'admin' AND m.is_read = FALSE) as unread_count,
                (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
            FROM conversations c
            JOIN organizations o ON c.org_id = o.id
            LEFT JOIN organization_images oi ON o.id = oi.org_id AND oi.image_type = 'logo'
            WHERE c.user_id = $1 AND c.is_deleted_by_user = FALSE
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
                u.last_seen_at as user_last_seen,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_type = 'user' AND m.is_read = FALSE) as unread_count,
                (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message
            FROM conversations c
            JOIN users u ON c.user_id = u.id
            WHERE c.org_id = $1 AND c.is_deleted_by_admin = FALSE
            ORDER BY c.last_message_at DESC;
        `;
        const result = await pool.query(query, [orgId]);
        return result.rows;
    },

    async getMessageById(id) {
        const query = `
            SELECT m.*, rm.content as reply_to_content, rm.sender_type as reply_to_sender_type,
                   COALESCE(
                       (SELECT json_agg(json_build_object('id', r.id, 'user_id', r.user_id, 'emoji', r.emoji, 'user_name', ru.name))
                        FROM message_reactions r
                        JOIN users ru ON r.user_id = ru.id
                        WHERE r.message_id = m.id),
                       '[]'::json
                   ) as reactions,
                   COALESCE(
                       (SELECT json_agg(json_build_object('id', ma.id, 'file_name', ma.file_name, 'mime_type', ma.mime_type))
                        FROM message_attachments ma
                        WHERE ma.message_id = m.id),
                       '[]'::json
                   ) as attachments
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            LEFT JOIN messages rm ON m.reply_to_id = rm.id
            WHERE m.id = $1
              AND (c.disappearing_duration = 0 OR m.created_at >= NOW() - (c.disappearing_duration || ' second')::INTERVAL);
        `;
        const result = await pool.query(query, [id]);
        return result.rows[0];
    },

    async addMessage(conversationId, senderType, senderId, content, replyToId = null) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const insertQuery = `
                INSERT INTO messages (conversation_id, sender_type, sender_id, content, reply_to_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *;
            `;
            const msgResult = await client.query(insertQuery, [conversationId, senderType, senderId, content, replyToId]);
            const insertedMsg = msgResult.rows[0];

            const updateConvQuery = `
                UPDATE conversations 
                SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, is_deleted_by_user = FALSE, is_deleted_by_admin = FALSE
                WHERE id = $1;
            `;
            await client.query(updateConvQuery, [conversationId]);

            await client.query('COMMIT');

            // Fetch fully populated message with reply_to_content and reply_to_sender_type
            const fullMessage = await this.getMessageById(insertedMsg.id);
            return fullMessage;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    async addAttachmentMessage(conversationId, senderType, senderId, fileName, mimeType, fileData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const insertMsgQuery = `
                INSERT INTO messages (conversation_id, sender_type, sender_id, content)
                VALUES ($1, $2, $3, $4)
                RETURNING *;
            `;
            const msgResult = await client.query(insertMsgQuery, [conversationId, senderType, senderId, `[Media] ${fileName}`]);
            const insertedMsg = msgResult.rows[0];

            const insertAttachmentQuery = `
                INSERT INTO message_attachments (message_id, file_name, mime_type, file_data)
                VALUES ($1, $2, $3, $4)
                RETURNING id;
            `;
            await client.query(insertAttachmentQuery, [insertedMsg.id, fileName, mimeType, fileData]);

            const updateConvQuery = `
                UPDATE conversations 
                SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, is_deleted_by_user = FALSE, is_deleted_by_admin = FALSE
                WHERE id = $1;
            `;
            await client.query(updateConvQuery, [conversationId]);

            await client.query('COMMIT');

            // Retrieve fully populated message
            const fullMessage = await this.getMessageById(insertedMsg.id);
            return fullMessage;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    async getMessages(conversationId, limit = 50, offset = 0) {
        const query = `
            SELECT m.*, rm.content as reply_to_content, rm.sender_type as reply_to_sender_type,
                   COALESCE(
                       (SELECT json_agg(json_build_object('id', r.id, 'user_id', r.user_id, 'emoji', r.emoji, 'user_name', ru.name))
                        FROM message_reactions r
                        JOIN users ru ON r.user_id = ru.id
                        WHERE r.message_id = m.id),
                       '[]'::json
                   ) as reactions,
                   COALESCE(
                       (SELECT json_agg(json_build_object('id', ma.id, 'file_name', ma.file_name, 'mime_type', ma.mime_type))
                        FROM message_attachments ma
                        WHERE ma.message_id = m.id),
                       '[]'::json
                   ) as attachments
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            LEFT JOIN messages rm ON m.reply_to_id = rm.id
            WHERE m.conversation_id = $1 
              AND (c.disappearing_duration = 0 OR m.created_at >= NOW() - (c.disappearing_duration || ' second')::INTERVAL)
            ORDER BY m.created_at DESC 
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
            SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
            WHERE conversation_id = $1 AND sender_type = $2 AND is_read = FALSE
            RETURNING *;
        `;
        const result = await pool.query(query, [conversationId, senderTypeToUpdate]);
        return result.rows;
    },

    async updateLastSeen(id, type, timestamp) {
        const table = type === 'org' ? 'organizations' : 'users';
        const query = `UPDATE ${table} SET last_seen_at = $2 WHERE id = $1;`;
        await pool.query(query, [id, timestamp]);
    },

    async getLastSeen(id) {
        const userQuery = `SELECT last_seen_at FROM users WHERE id = $1`;
        const userResult = await pool.query(userQuery, [id]);
        if (userResult.rows.length > 0) {
            return userResult.rows[0].last_seen_at;
        }
        
        const orgQuery = `SELECT last_seen_at FROM organizations WHERE id = $1`;
        const orgResult = await pool.query(orgQuery, [id]);
        if (orgResult.rows.length > 0) {
            return orgResult.rows[0].last_seen_at;
        }
        
        return null;
    },

    async upsertReaction(messageId, userId, emoji) {
        const query = `
            INSERT INTO message_reactions (message_id, user_id, emoji)
            VALUES ($1, $2, $3)
            ON CONFLICT (message_id, user_id) 
            DO UPDATE SET emoji = $3, created_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;
        const result = await pool.query(query, [messageId, userId, emoji]);
        return result.rows[0];
    },

    async deleteReaction(messageId, userId) {
        const query = `
            DELETE FROM message_reactions 
            WHERE message_id = $1 AND user_id = $2
            RETURNING *;
        `;
        const result = await pool.query(query, [messageId, userId]);
        return result.rows[0];
    },

    async getReaction(messageId, userId) {
        const query = `
            SELECT * FROM message_reactions 
            WHERE message_id = $1 AND user_id = $2;
        `;
        const result = await pool.query(query, [messageId, userId]);
        return result.rows[0];
    },

    async getAttachment(id) {
        const query = `
            SELECT * FROM message_attachments WHERE id = $1;
        `;
        const result = await pool.query(query, [id]);
        return result.rows[0];
    },

    async updateDisappearingDuration(conversationId, duration) {
        const query = `
            UPDATE conversations 
            SET disappearing_duration = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *;
        `;
        const result = await pool.query(query, [conversationId, duration]);
        return result.rows[0];
    },

    async toggleStarMessage(messageId) {
        const selectQuery = 'SELECT is_starred FROM messages WHERE id = $1;';
        const selectRes = await pool.query(selectQuery, [messageId]);
        if (selectRes.rows.length === 0) {
            throw new Error('Message not found');
        }
        const newStarred = !selectRes.rows[0].is_starred;
        const updateQuery = 'UPDATE messages SET is_starred = $2 WHERE id = $1 RETURNING *;';
        const updateRes = await pool.query(updateQuery, [messageId, newStarred]);
        return updateRes.rows[0];
    },

    async getStarredMessages(conversationId) {
        const query = `
            SELECT m.*, rm.content as reply_to_content, rm.sender_type as reply_to_sender_type,
                   COALESCE(
                       (SELECT json_agg(json_build_object('id', r.id, 'user_id', r.user_id, 'emoji', r.emoji, 'user_name', ru.name))
                        FROM message_reactions r
                        JOIN users ru ON r.user_id = ru.id
                        WHERE r.message_id = m.id),
                       '[]'::json
                   ) as reactions,
                   COALESCE(
                       (SELECT json_agg(json_build_object('id', ma.id, 'file_name', ma.file_name, 'mime_type', ma.mime_type))
                        FROM message_attachments ma
                        WHERE ma.message_id = m.id),
                       '[]'::json
                   ) as attachments
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            LEFT JOIN messages rm ON m.reply_to_id = rm.id
            WHERE m.conversation_id = $1 
              AND m.is_starred = TRUE
              AND (c.disappearing_duration = 0 OR m.created_at >= NOW() - (c.disappearing_duration || ' second')::INTERVAL)
            ORDER BY m.created_at DESC;
        `;
        const result = await pool.query(query, [conversationId]);
        return result.rows.reverse();
    },

    async toggleConversationFlag(conversationId, flagType, senderType) {
        const column = `is_${flagType}_by_${senderType}`;
        const validFlags = ['starred', 'blocked', 'reported', 'deleted'];
        const validSenders = ['user', 'admin'];
        if (!validFlags.includes(flagType) || !validSenders.includes(senderType)) {
            throw new Error('Invalid flag type or sender type');
        }

        const selectQuery = `SELECT ${column} FROM conversations WHERE id = $1;`;
        const selectRes = await pool.query(selectQuery, [conversationId]);
        if (selectRes.rows.length === 0) {
            throw new Error('Conversation not found');
        }
        
        const newValue = !selectRes.rows[0][column];
        const updateQuery = `UPDATE conversations SET ${column} = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *;`;
        const updateRes = await pool.query(updateQuery, [conversationId, newValue]);
        return updateRes.rows[0];
    },

    async clearConversationMessages(conversationId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const deleteAttachmentsQuery = `
                DELETE FROM message_attachments 
                WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = $1);
            `;
            await client.query(deleteAttachmentsQuery, [conversationId]);

            const deleteReactionsQuery = `
                DELETE FROM message_reactions 
                WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = $1);
            `;
            await client.query(deleteReactionsQuery, [conversationId]);

            const deleteMessagesQuery = 'DELETE FROM messages WHERE conversation_id = $1;';
            await client.query(deleteMessagesQuery, [conversationId]);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
};

module.exports = Chat;
