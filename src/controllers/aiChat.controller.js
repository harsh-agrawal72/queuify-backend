const aiChatService = require('../services/aiChat.service');
const ChatService = require('../services/chat.service');

/**
 * POST /v1/ai/chat
 * Body: { prompt: string }
 * Returns AI response. Optionally stores the AI message in the conversation.
 */
async function chat(req, res) {
  try {
    const { prompt, conversationId } = req.body;
    if (!prompt) {
      return res.status(400).json({ message: 'Prompt is required' });
    }
    // Get AI response
    const aiResponse = await aiChatService.getAIResponse(prompt);

    // If conversationId provided, store as a message with sender_type 'ai'
    if (conversationId) {
      // Use existing ChatService to add message with sender_type 'ai' and senderId null
      await ChatService.sendMessage(conversationId, 'ai', null, aiResponse);
    }

    return res.status(200).json({ response: aiResponse });
  } catch (error) {
    console.error('AI chat error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = { chat };
