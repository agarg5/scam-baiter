import 'dotenv/config';
import OpenAI from 'openai';
import { getPersona } from '../prompts/personas';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Generate a persona-styled SMS reply using GPT-4o.
 * @param incomingText - The scammer's SMS message
 * @param history - Prior messages [{role, content}]
 * @param personaId - Persona id (defaults to DEFAULT_PERSONA / 'tyler')
 */
async function generateSmsReply(
  incomingText: string,
  history: ChatMessage[] = [],
  personaId?: string
): Promise<string> {
  const persona = getPersona(personaId);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
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

  return (response.choices[0].message.content || '').trim();
}

export { generateSmsReply };
