const { pool } = require('../config/db');

const ChatCleanupService = {
    async init() {
        console.log('[ChatCleanup] Checking for expired disappearing messages...');
        
        // Run every hour
        setInterval(async () => {
            await this.cleanupExpiredMessages();
        }, 1000 * 60 * 60); // 1 hour

        // Run immediately on start
        await this.cleanupExpiredMessages();
    },

    async cleanupExpiredMessages() {
        console.log('[ChatCleanup] Cleanup cycle started...');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Find expired messages
            const selectQuery = `
                SELECT m.id 
                FROM messages m
                JOIN conversations c ON m.conversation_id = c.id
                WHERE c.disappearing_duration > 0
                  AND m.is_starred = FALSE 
                  AND m.created_at < NOW() - (c.disappearing_duration || ' second')::INTERVAL;
            `;
            const result = await client.query(selectQuery);
            const expiredIds = result.rows.map(row => row.id);

            if (expiredIds.length > 0) {
                // Delete attachments
                await client.query('DELETE FROM message_attachments WHERE message_id = ANY($1::uuid[])', [expiredIds]);
                // Delete reactions
                await client.query('DELETE FROM message_reactions WHERE message_id = ANY($1::uuid[])', [expiredIds]);
                // Delete messages
                await client.query('DELETE FROM messages WHERE id = ANY($1::uuid[])', [expiredIds]);
                console.log(`[ChatCleanup] Deleted ${expiredIds.length} expired messages.`);
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('[ChatCleanup] Error cleaning up messages:', error);
        } finally {
            client.release();
            console.log('[ChatCleanup] Cleanup cycle completed.');
        }
    }
};

module.exports = ChatCleanupService;
