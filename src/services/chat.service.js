const Chat = require('../models/chat.model');
const { getIO } = require('../socket/index');

const ChatService = {
    async getUserConversations(userId) {
        return await Chat.getUserConversations(userId);
    },

    async getOrgConversations(orgId) {
        return await Chat.getOrgConversations(orgId);
    },

    async getMessages(conversationId, limit, offset) {
        return await Chat.getMessages(conversationId, limit, offset);
    },

    async initiateConversation(orgId, userId) {
        // Find existing or create new
        return await Chat.createConversation(orgId, userId);
    },

    async sendMessage(conversationId, senderType, senderId, content) {
        // Validate conversation exists
        const conversation = await Chat.getConversationById(conversationId);
        if (!conversation) {
            throw new Error('Conversation not found');
        }

        // Validate sender
        if (senderType === 'user' && conversation.user_id !== senderId) {
            throw new Error('Unauthorized sender');
        }

        const message = await Chat.addMessage(conversationId, senderType, senderId, content);

        // Emit socket event to the conversation room
        try {
            const io = getIO();
            const roomName = `chat_${conversationId}`;
            io.to(roomName).emit('new_message', {
                ...message,
                conversation_id: conversationId
            });
            
            // Also emit a general notification event to the target user/org if they are not in the room
            if (senderType === 'user') {
                io.to(conversation.org_id).emit('chat_notification', message);
            } else {
                io.to(conversation.user_id).emit('chat_notification', message);
            }
        } catch (error) {
            console.error('Socket IO error:', error);
            // Non-blocking error
        }

        return message;
    },

    async markAsRead(conversationId, readerType) {
        await Chat.markMessagesAsRead(conversationId, readerType);
    }
};

module.exports = ChatService;
