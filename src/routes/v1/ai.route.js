const express = require('express');
const { chat } = require('../../controllers/aiChat.controller');
const aiRateLimiter = require('../../middlewares/aiRateLimiter');

const router = express.Router();

// Apply rate limiter to all AI chat requests
router.post('/chat', aiRateLimiter, chat);

module.exports = router;
