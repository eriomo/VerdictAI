'use strict';

const { httpsPost } = require('./groq');

const GPT_PRIMARY = 'openai/gpt-oss-120b:free';
const GPT_SECONDARY = 'openai/gpt-oss-20b:free';

function getOrKey() {
  return (process.env.OPENROUTER_API_KEY || '').trim().replace(/[\r\n\t]/g, '');
}

async function openRouterStream(model, system, user, maxTokens = 8000) {
  const key = getOrKey();
  return httpsPost(
    'openrouter.ai',
    '/api/v1/chat/completions',
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'https://verdictai.com.ng',
      'X-Title': 'Verdict AI',
    },
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.15,
      max_tokens: maxTokens,
      stream: true,
    }
  );
}

module.exports = {
  GPT_PRIMARY,
  GPT_SECONDARY,
  getOrKey,
  openRouterStream,
};
