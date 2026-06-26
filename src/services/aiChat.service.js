const { OpenAI } = require('openai');
const config = require('../config/config');

// Lazy-initialize OpenAI client — avoids crashing the server if the key is missing
let openai = null;
function getClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

/**
 * Calls OpenAI GPT‑4o model with the provided user prompt.
 * @param {string} prompt - The user's query.
 * @returns {Promise<string>} - The AI generated response text.
 */
async function getAIResponse(prompt) {
  if (!prompt) {
    throw new Error('Prompt is required');
  }
  const client = getClient();
  const response = await client.createChatCompletion({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
  });
  const content = response?.data?.choices?.[0]?.message?.content;
  return content || '';
}

module.exports = { getAIResponse };
