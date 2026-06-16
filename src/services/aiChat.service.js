const { OpenAI } = require('openai');
const config = require('../config/config');

// Initialize OpenAI client using API key from environment
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Calls OpenAI GPT‑4o model with the provided user prompt.
 * @param {string} prompt - The user's query.
 * @returns {Promise<string>} - The AI generated response text.
 */
async function getAIResponse(prompt) {
  if (!prompt) {
    throw new Error('Prompt is required');
  }
  const response = await openai.createChatCompletion({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });
  const content = response?.data?.choices?.[0]?.message?.content;
  return content || '';
}

module.exports = { getAIResponse };
