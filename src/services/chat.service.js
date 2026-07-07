const Chat = require('../models/chat.model');
const { getIO } = require('../socket/index');
const { pool } = require('../config/db');


const ChatService = {
    async getUserConversations(userId) {
        return await Chat.getUserConversations(userId);
    },

    async getOrgConversations(orgId) {
        return await Chat.getOrgConversations(orgId);
    },

    async getMessages(conversationId, limit, offset, senderType = null) {
        return await Chat.getMessages(conversationId, limit, offset, senderType);
    },

    async initiateConversation(orgId, userId) {
        // Find existing or create new
        return await Chat.createConversation(orgId, userId);
    },

    async sendMessage(conversationId, senderType, senderId, content, replyToId = null) {
        // Validate conversation exists
        const conversation = await Chat.getConversationById(conversationId);
        if (!conversation) {
            throw new Error('Conversation not found');
        }

        // Validate sender
        if (senderType === 'user' && conversation.user_id !== senderId) {
            throw new Error('Unauthorized sender');
        }

        // Validate block status
        if (conversation.is_blocked_by_user || conversation.is_blocked_by_admin) {
            throw new Error('Cannot send message. This chat is blocked.');
        }

        const message = await Chat.addMessage(conversationId, senderType, senderId, content, replyToId);

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
        const readMessages = await Chat.markMessagesAsRead(conversationId, readerType);
        
        try {
            if (readMessages && readMessages.length > 0) {
                const { getIO } = require('../socket/index');
                const io = getIO();
                const roomName = `chat_${conversationId}`;
                io.to(roomName).emit('messages_read', {
                    conversationId,
                    readerType,
                    readAt: new Date().toISOString(),
                    messageIds: readMessages.map(m => m.id)
                });
            }
        } catch (error) {
            console.error('Socket IO error in markAsRead:', error);
        }
    },

    async getPresence(id) {
        const { isOnline } = require('../socket/index');
        const online = isOnline(id);
        const lastSeen = online ? null : await Chat.getLastSeen(id);
        return { online, lastSeen };
    },

    async toggleReaction(messageId, userId, emoji) {
        const existing = await Chat.getReaction(messageId, userId);
        if (existing) {
            if (existing.emoji === emoji) {
                await Chat.deleteReaction(messageId, userId);
            } else {
                await Chat.upsertReaction(messageId, userId, emoji);
            }
        } else {
            await Chat.upsertReaction(messageId, userId, emoji);
        }

        const message = await Chat.getMessageById(messageId);
        if (message) {
            try {
                const io = getIO();
                const roomName = `chat_${message.conversation_id}`;
                io.to(roomName).emit('message_reaction_update', {
                    messageId: message.id,
                    reactions: message.reactions
                });
            } catch (error) {
                console.error('Socket IO error in toggleReaction:', error);
            }
        }
        return message;
    },

    async sendAttachment(conversationId, senderType, senderId, fileName, mimeType, fileData) {
        const conversation = await Chat.getConversationById(conversationId);
        if (!conversation) {
            throw new Error('Conversation not found');
        }

        if (senderType === 'user' && conversation.user_id !== senderId) {
            throw new Error('Unauthorized sender');
        }

        // Validate block status
        if (conversation.is_blocked_by_user || conversation.is_blocked_by_admin) {
            throw new Error('Cannot send message. This chat is blocked.');
        }

        const message = await Chat.addAttachmentMessage(conversationId, senderType, senderId, fileName, mimeType, fileData);

        try {
            const io = getIO();
            const roomName = `chat_${conversationId}`;
            io.to(roomName).emit('new_message', {
                ...message,
                conversation_id: conversationId
            });
            
            if (senderType === 'user') {
                io.to(conversation.org_id).emit('chat_notification', message);
            } else {
                io.to(conversation.user_id).emit('chat_notification', message);
            }
        } catch (error) {
            console.error('Socket IO error:', error);
        }

        return message;
    },

    async getAttachment(id) {
        return await Chat.getAttachment(id);
    },

    async updateDisappearing(conversationId, duration, senderType, senderId) {
        const conversation = await Chat.getConversationById(conversationId);
        if (!conversation) {
            throw new Error('Conversation not found');
        }

        await Chat.updateDisappearingDuration(conversationId, duration);

        let durationText = '';
        if (duration === 0) {
            durationText = 'off';
        } else if (duration === 86400) {
            durationText = 'to 24 hours';
        } else if (duration === 604800) {
            durationText = 'to 7 days';
        } else if (duration === 7776000) {
            durationText = 'to 90 days';
        } else {
            durationText = `to ${Math.round(duration / 86400)} days`;
        }

        const party = senderType === 'admin' ? 'Admin' : 'User';
        const systemMsgText = `$$SYSTEM$$:${party} set disappearing messages ${durationText}.`;

        const systemMessage = await Chat.addMessage(conversationId, senderType, senderId, systemMsgText);

        try {
            const io = getIO();
            const roomName = `chat_${conversationId}`;
            io.to(roomName).emit('disappearing_update', {
                conversationId,
                disappearing_duration: duration,
                systemMessage
            });
        } catch (error) {
            console.error('Socket IO error in updateDisappearing:', error);
        }

        return { disappearing_duration: duration, systemMessage };
    },

    async toggleStarMessage(messageId) {
        const message = await Chat.toggleStarMessage(messageId);
        
        try {
            const { getIO } = require('../socket/index');
            const io = getIO();
            const roomName = `chat_${message.conversation_id}`;
            io.to(roomName).emit('message_star_update', {
                messageId: message.id,
                is_starred: message.is_starred
            });
        } catch (error) {
            console.error('Socket IO error in toggleStarMessage:', error);
        }

        return message;
    },

    async togglePinMessage(messageId) {
        const message = await Chat.togglePinMessage(messageId);
        
        try {
            const { getIO } = require('../socket/index');
            const io = getIO();
            const roomName = `chat_${message.conversation_id}`;
            io.to(roomName).emit('message_pin_update', {
                messageId: message.id,
                is_pinned: message.is_pinned
            });
        } catch (error) {
            console.error('Socket IO error in togglePinMessage:', error);
        }

        return message;
    },

    async clearChat(conversationId, senderType, senderId) {
        const conversation = await Chat.getConversationById(conversationId);
        if (!conversation) {
            throw new Error('Conversation not found');
        }

        // 1. Wipe messages and attachments
        await Chat.clearConversationMessages(conversationId);

        // 2. Add system message for clear chat
        const party = senderType === 'admin' ? 'Support' : 'User';
        const systemMsgText = `$$SYSTEM$$:${party} cleared the chat history.`;
        const systemMessage = await Chat.addMessage(conversationId, 'system', senderId, systemMsgText);

        // 3. Emit socket events
        try {
            const { getIO } = require('../socket/index');
            const io = getIO();
            const roomName = `chat_${conversationId}`;

            // Emit clear event to empty messages array
            io.to(roomName).emit('chat_cleared', {
                conversationId,
                clearedBy: senderType
            });

            // Emit the system message so it shows up as the first message
            io.to(roomName).emit('new_message', {
                ...systemMessage,
                conversation_id: conversationId
            });
        } catch (error) {
            console.error('Socket IO error in clearChat:', error);
        }

        return { systemMessage };
    },

    async getStarredMessages(conversationId) {
        return await Chat.getStarredMessages(conversationId);
    },

    async toggleConversationFlag(conversationId, flagType, senderType) {
        const conversation = await Chat.toggleConversationFlag(conversationId, flagType, senderType);
        
        try {
            const { getIO } = require('../socket/index');
            const io = getIO();
            const roomName = `chat_${conversationId}`;
            const column = `is_${flagType}_by_${senderType}`;
            const newValue = conversation[column];
            
            io.to(roomName).emit('conversation_flag_update', {
                conversationId,
                flagType,
                senderType,
                value: newValue
            });

            // Emit to both user and organization to update lists in real time
            io.to(conversation.user_id).emit('conversation_list_flag_update', {
                conversationId,
                flagType,
                senderType,
                value: newValue
            });
            io.to(conversation.org_id).emit('conversation_list_flag_update', {
                conversationId,
                flagType,
                senderType,
                value: newValue
            });
        } catch (error) {
            console.error('Socket IO error in toggleConversationFlag:', error);
        }

        return conversation;
    },

    async editMessage(messageId, senderType, senderId, newContent) {
        // Fetch directly from DB without disappearing filter
        const msgResult = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
        const message = msgResult.rows[0];
        if (!message) throw new Error('Message not found');

        // Validate ownership by sender_id
        if (message.sender_id !== senderId) throw new Error('Unauthorized: you can only edit your own messages');
        if (message.is_deleted) throw new Error('Cannot edit a deleted message');

        const updatedMessage = await Chat.editMessage(messageId, newContent);
        
        // Fetch full message to send in socket
        const fullMessage = await Chat.getMessageById(messageId) || updatedMessage;

        try {
            const { getIO } = require('../socket/index');
            const io = getIO();
            const roomName = `chat_${message.conversation_id}`;
            io.to(roomName).emit('message_edited', {
                ...fullMessage,
                conversation_id: message.conversation_id
            });
        } catch (error) {
            console.error('Socket IO error in editMessage:', error);
        }

        return fullMessage;
    },

    async deleteMessage(messageId, senderType, senderId, deleteType = 'for_everyone') {
        // Fetch directly from DB without disappearing filter
        const msgResult = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
        const message = msgResult.rows[0];
        if (!message) throw new Error('Message not found');

        // Validate ownership by sender_id
        if (message.sender_id !== senderId) throw new Error('Unauthorized: you can only delete your own messages');

        if (deleteType === 'for_me') {
            // Soft delete — only hides from sender's view
            await Chat.deleteMessageForSender(messageId);
            // No socket broadcast needed — only affects the sender locally
            return { id: messageId, deleted_for_sender: true, deleteType: 'for_me' };
        } else {
            // Delete for everyone — marks as deleted for all
            const deletedMessage = await Chat.deleteMessage(messageId);
            const fullMessage = await Chat.getMessageById(messageId) || deletedMessage;

            try {
                const { getIO } = require('../socket/index');
                const io = getIO();
                const roomName = `chat_${message.conversation_id}`;
                io.to(roomName).emit('message_deleted', {
                    messageId: message.id,
                    conversationId: message.conversation_id,
                    content: 'This message was deleted',
                    deleteType: 'for_everyone'
                });
            } catch (error) {
                console.error('Socket IO error in deleteMessage:', error);
            }

            return fullMessage;
        }
    }
};

module.exports = ChatService;
