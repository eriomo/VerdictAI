'use strict';

const https = require('https');

const GROQ_MODEL = 'llama-3.3-70b-versatile';

function aiLog(message) {
  console.log(`[AI ${new Date().toISOString().slice(11, 19)}] ${message}`);
}

function httpsPost(hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname,
      path: urlPath,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 60000,
    }, resolve);
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.write(bodyStr);
    req.end();
  });
}

function httpsGet(hostname, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path: urlPath,
      method: 'GET',
      headers,
      timeout: 30000,
    }, resolve);
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.end();
  });
}

async function readBody(res) {
  return new Promise((resolve) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function getGroqKey() {
  return (process.env.GROQ_API_KEY || '').trim().replace(/[\r\n\t]/g, '');
}

async function groqSync(system, user, maxTokens = 1500) {
  const key = getGroqKey();
  if (!key) return '';

  const res = await httpsPost(
    'api.groq.com',
    '/openai/v1/chat/completions',
    { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    {
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
      max_tokens: maxTokens,
      stream: false,
    }
  );

  return new Promise((resolve) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      try {
        resolve(JSON.parse(data).choices?.[0]?.message?.content || '');
      } catch {
        resolve('');
      }
    });
    res.on('error', () => resolve(''));
  });
}

async function groqStream(system, user, maxTokens = 8000) {
  const key = getGroqKey();
  return httpsPost(
    'api.groq.com',
    '/openai/v1/chat/completions',
    { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    {
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
      stream: true,
    }
  );
}

module.exports = {
  GROQ_MODEL,
  aiLog,
  httpsPost,
  httpsGet,
  readBody,
  getGroqKey,
  groqSync,
  groqStream,
};
