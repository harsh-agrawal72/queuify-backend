const ChatService = require('../services/chat.service');

const ChatController = {
    async getUserConversations(req, res) {
        try {
            const userId = req.user.id;
            const conversations = await ChatService.getUserConversations(userId);
            res.status(200).json(conversations);
        } catch (error) {
            console.error('Error fetching user conversations:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async getOrgConversations(req, res) {
        try {
            const orgId = req.user.org_id;
            const conversations = await ChatService.getOrgConversations(orgId);
            res.status(200).json(conversations);
        } catch (error) {
            console.error('Error fetching org conversations:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async getMessages(req, res) {
        try {
            const { conversationId } = req.params;
            const limit = parseInt(req.query.limit) || 50;
            const offset = parseInt(req.query.offset) || 0;

            const messages = await ChatService.getMessages(conversationId, limit, offset);
            res.status(200).json(messages);
        } catch (error) {
            console.error('Error fetching messages:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async initiateConversation(req, res) {
        try {
            const { orgId } = req.body;
            const userId = req.user.id;
            
            const conversation = await ChatService.initiateConversation(orgId, userId);
            res.status(200).json(conversation);
        } catch (error) {
            console.error('Error initiating conversation:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async sendMessage(req, res) {
        try {
            const { conversationId } = req.params;
            const { content, senderType, replyToId } = req.body;
            // senderType expects 'user' or 'admin' 
            const senderId = senderType === 'user' ? req.user.id : req.user.org_id;

            const message = await ChatService.sendMessage(conversationId, senderType, senderId, content, replyToId);
            res.status(201).json(message);
        } catch (error) {
            console.error('Error sending message:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async markAsRead(req, res) {
        try {
            const { conversationId } = req.params;
            const { readerType } = req.body; // 'user' or 'admin'

            await ChatService.markAsRead(conversationId, readerType);
            res.status(200).json({ message: 'Messages marked as read' });
        } catch (error) {
            console.error('Error marking messages as read:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async getPresence(req, res) {
        try {
            const { id } = req.params;
            const presence = await ChatService.getPresence(id);
            res.status(200).json(presence);
        } catch (error) {
            console.error('Error fetching presence:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async toggleReaction(req, res) {
        try {
            const { messageId } = req.params;
            const { emoji } = req.body;
            const userId = req.user.id;

            if (!emoji) {
                return res.status(400).json({ message: 'Emoji is required' });
            }

            const updatedMessage = await ChatService.toggleReaction(messageId, userId, emoji);
            res.status(200).json(updatedMessage);
        } catch (error) {
            console.error('Error toggling reaction:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async sendAttachment(req, res) {
        try {
            const { conversationId } = req.params;
            const { senderType } = req.body;
            const senderId = senderType === 'user' ? req.user.id : req.user.org_id;

            if (!req.file) {
                return res.status(400).json({ message: 'No file uploaded' });
            }

            const fileName = req.file.originalname;
            const mimeType = req.file.mimetype;
            const fileData = req.file.buffer;

            const message = await ChatService.sendAttachment(conversationId, senderType, senderId, fileName, mimeType, fileData);
            res.status(201).json(message);
        } catch (error) {
            console.error('Error sending attachment:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async getAttachment(req, res) {
        try {
            const { id } = req.params;
            const attachment = await ChatService.getAttachment(id);
            if (!attachment) {
                return res.status(404).json({ message: 'Attachment not found' });
            }

            res.setHeader('Content-Type', attachment.mime_type);
            res.setHeader('Content-Disposition', `inline; filename="${attachment.file_name}"`);
            return res.send(attachment.file_data);
        } catch (error) {
            console.error('Error fetching attachment:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async updateDisappearing(req, res) {
        try {
            const { conversationId } = req.params;
            const { duration, senderType } = req.body;
            const senderId = senderType === 'user' ? req.user.id : req.user.org_id;

            if (duration === undefined) {
                return res.status(400).json({ message: 'Duration is required' });
            }

            const result = await ChatService.updateDisappearing(conversationId, parseInt(duration), senderType, senderId);
            res.status(200).json(result);
        } catch (error) {
            console.error('Error updating disappearing messages settings:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async toggleStarMessage(req, res) {
        try {
            const { messageId } = req.params;
            const updatedMessage = await ChatService.toggleStarMessage(messageId);
            res.status(200).json(updatedMessage);
        } catch (error) {
            console.error('Error toggling star message:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async clearChat(req, res) {
        try {
            const { conversationId } = req.params;
            const { senderType } = req.body;
            const senderId = senderType === 'user' ? req.user.id : req.user.org_id;

            const result = await ChatService.clearChat(conversationId, senderType, senderId);
            res.status(200).json(result);
        } catch (error) {
            console.error('Error clearing chat:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async getStarredMessages(req, res) {
        try {
            const { conversationId } = req.params;
            const messages = await ChatService.getStarredMessages(conversationId);
            res.status(200).json(messages);
        } catch (error) {
            console.error('Error fetching starred messages:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    async toggleConversationFlag(req, res) {
        try {
            const { conversationId } = req.params;
            const { flagType, senderType } = req.body;

            if (!flagType || !senderType) {
                return res.status(400).json({ message: 'flagType and senderType are required' });
            }

            const updatedConv = await ChatService.toggleConversationFlag(conversationId, flagType, senderType);
            res.status(200).json(updatedConv);
        } catch (error) {
            console.error('Error toggling conversation flag:', error);
            res.status(500).json({ message: error.message || 'Internal server error' });
        }
    }
};

module.exports = ChatController;
