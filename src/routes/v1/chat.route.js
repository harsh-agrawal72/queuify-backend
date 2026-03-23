const express = require('express');
const { auth } = require('../../middlewares/auth.middleware');
const chatController = require('../../controllers/chat.controller');

const router = express.Router();

// User Routes
router.get('/user', auth('user'), chatController.getUserConversations);
router.post('/initiate', auth('user'), chatController.initiateConversation);

// Admin Routes (Org)
router.get('/admin', auth('admin'), chatController.getOrgConversations);

// Shared Routes (Both users and admins can hit these, differentiation is done inside the controller via auth middleware)
// For these, we will use a generic validation or just `auth` which allows any valid JWT
router.get('/:conversationId/messages', auth(), chatController.getMessages);
router.post('/:conversationId/messages', auth(), chatController.sendMessage);
router.patch('/:conversationId/read', auth(), chatController.markAsRead);

module.exports = router;
