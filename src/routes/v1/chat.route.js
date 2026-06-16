const express = require('express');
const auth = require('../../middlewares/auth');
const chatController = require('../../controllers/chat.controller');
const multer = require('multer');

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
});

// User Routes
router.get('/user', auth('user'), chatController.getUserConversations);
router.post('/initiate', auth('user'), chatController.initiateConversation);

// Admin Routes (Org)
router.get('/admin', auth('admin'), chatController.getOrgConversations);

// Shared Routes (Both users and admins can hit these, differentiation is done inside the controller via auth middleware)
router.post('/messages/:messageId/react', auth(), chatController.toggleReaction);
router.post('/messages/:messageId/star', auth(), chatController.toggleStarMessage);
router.get('/messages/attachment/:id', chatController.getAttachment);
router.post('/:conversationId/messages/attachment', auth(), upload.single('file'), chatController.sendAttachment);
router.patch('/:conversationId/disappearing', auth(), chatController.updateDisappearing);
router.delete('/:conversationId/clear', auth(), chatController.clearChat);

router.get('/:conversationId/messages', auth(), chatController.getMessages);
router.get('/:conversationId/starred', auth(), chatController.getStarredMessages);
router.post('/:conversationId/flag', auth(), chatController.toggleConversationFlag);
router.post('/:conversationId/messages', auth(), chatController.sendMessage);
router.patch('/:conversationId/read', auth(), chatController.markAsRead);
router.get('/presence/:id', auth(), chatController.getPresence);

module.exports = router;
