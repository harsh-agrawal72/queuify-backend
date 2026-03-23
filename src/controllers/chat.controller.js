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
            const { content, senderType } = req.body;
            // senderType expects 'user' or 'admin' 
            const senderId = senderType === 'user' ? req.user.id : req.user.org_id;

            const message = await ChatService.sendMessage(conversationId, senderType, senderId, content);
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
    }
};

module.exports = ChatController;
