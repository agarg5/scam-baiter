require('dotenv').config();
const OpenAI = require('openai');
const { getPersona } = require('../prompts/personas');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generate a persona-styled SMS reply using GPT-4o.
 * @param {string} incomingText - The scammer's SMS message
 * @param {Array} history - Prior messages [{role, content}]
 * @param {string} personaId - Persona id (defaults to DEFAULT_PERSONA / 'tyler')
 */
async function generateSmsReply(incomingText, history = [], personaId) {
  const persona = getPersona(personaId);

  const messages = [
    { role: 'system', content: persona.systemPrompt },
    ...history,
    { role: 'user', content: incomingText },
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages,
    max_tokens: 300,
    temperature: 0.9,
  });

  return response.choices[0].message.content.trim();
}

module.exports = { generateSmsReply };
