'use strict';

/**
 * VERDICT AI — AI MODEL SERVICES
 * Groq, OpenRouter, and self-hosted model API calls.
 * services/groq.js / openrouter.js / selfhosted.js (combined for simplicity)
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GPT_PRIMARY = 'openai/gpt-oss-120b:free';
const GPT_SECONDARY = 'openai/gpt-oss-20b:free';

function aiLog(msg) {
  console.log(`[AI ${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function httpsPost(hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request({
      hostname, path: urlPath, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 60000,
    }, resolve);
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

function httpsGet(hostname, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: urlPath, method: 'GET', headers, timeout: 30000 }, resolve);
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

function requestJsonStream(rawUrl, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(rawUrl);
    const transport = target.protocol === 'http:' ? http : https;
    const bodyStr = JSON.stringify(body);
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 90000,
    }, resolve);
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

async function readBody(res) {
  return new Promise((resolve) => {
    let data = '';
    res.on('data', chunk => (data += chunk));
    res.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

// ── Groq ──────────────────────────────────────────────────────────────────────
function getGroqKey() {
  return (process.env.GROQ_API_KEY || '').trim().replace(/[\r\n\t]/g, '');
}

async function groqSync(system, user, maxTokens = 1500) {
  const key = getGroqKey();
  if (!key) return '';
  const res = await httpsPost(
    'api.groq.com', '/openai/v1/chat/completions',
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    { model: GROQ_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.1, max_tokens: maxTokens, stream: false }
  );
  return new Promise((resolve) => {
    let data = '';
    res.on('data', c => (data += c));
    res.on('end', () => {
      try { resolve(JSON.parse(data).choices?.[0]?.message?.content || ''); }
      catch { resolve(''); }
    });
    res.on('error', () => resolve(''));
  });
}

async function groqStream(system, user, maxTokens = 8000) {
  const key = getGroqKey();
  return httpsPost(
    'api.groq.com', '/openai/v1/chat/completions',
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    { model: GROQ_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: maxTokens, stream: true }
  );
}

// ── OpenRouter ────────────────────────────────────────────────────────────────
function getOrKey() {
  return (process.env.OPENROUTER_API_KEY || '').trim().replace(/[\r\n\t]/g, '');
}

async function openRouterStream(model, system, user, maxTokens = 8000) {
  const key = getOrKey();
  return httpsPost(
    'openrouter.ai', '/api/v1/chat/completions',
    {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': 'https://verdictai.com.ng',
      'X-Title': 'Verdict AI',
    },
    { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.15, max_tokens: maxTokens, stream: true }
  );
}

// ── Self-hosted ───────────────────────────────────────────────────────────────
function getSelfHostedConfig() {
  return {
    url: (process.env.SELF_HOSTED_MODEL_URL || '').trim(),
    name: (process.env.SELF_HOSTED_MODEL_NAME || 'verdict-private-legal').trim(),
    key: (process.env.SELF_HOSTED_MODEL_API_KEY || '').trim(),
  };
}

function hasSelfHostedModel() {
  const { url } = getSelfHostedConfig();
  return !!url;
}

async function selfHostedStream(system, user, maxTokens = 8000) {
  const { url, name, key } = getSelfHostedConfig();
  return requestJsonStream(
    url,
    { 'Content-Type': 'application/json', ...(key ? { 'Authorization': `Bearer ${key}` } : {}) },
    { model: name, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.1, max_tokens: maxTokens, stream: true }
  );
}

// ── Failover ──────────────────────────────────────────────────────────────────
async function callWithFailover(system, user) {
  const groqKey = getGroqKey();
  const orKey = getOrKey();

  if (hasSelfHostedModel()) {
    try {
      aiLog(`Trying self-hosted model...`);
      const res = await selfHostedStream(system, user);
      if (res.statusCode === 200) return { aiRes: res, engine: `self-hosted:${getSelfHostedConfig().name}` };
      let err = ''; for await (const c of res) err += c;
      aiLog(`Self-hosted failed ${res.statusCode}: ${err.slice(0, 80)}`);
    } catch (e) { aiLog(`Self-hosted error: ${e.message}`); }
  }

  if (!orKey) {
    if (!groqKey) throw new Error('No AI engine configured');
    aiLog('No OpenRouter key — Groq direct');
    return { aiRes: await groqStream(system, user), engine: 'groq-direct' };
  }

  const models = [
    { model: GPT_PRIMARY, name: 'gpt-120b' },
    { model: GPT_PRIMARY, name: 'gpt-120b-retry' },
    { model: GPT_SECONDARY, name: 'gpt-20b' },
    { model: GPT_SECONDARY, name: 'gpt-20b-retry' },
  ];

  for (const { model, name } of models) {
    try {
      aiLog(`Trying ${name}...`);
      const res = await openRouterStream(model, system, user);
      if (res.statusCode === 200) return { aiRes: res, engine: name };
      let err = ''; for await (const c of res) err += c;
      aiLog(`${name} failed ${res.statusCode}: ${err.slice(0, 80)}`);
      if (/guardrail|No endpoints/i.test(err) && groqKey) {
        aiLog('OpenRouter blocked — Groq policy fallback');
        return { aiRes: await groqStream(system, user), engine: 'groq-policy-fallback' };
      }
    } catch (e) { aiLog(`${name} error: ${e.message}`); }
  }

  if (!groqKey) throw new Error('All AI engines failed');
  aiLog('All GPT routes failed — Groq fallback');
  return { aiRes: await groqStream(system, user), engine: 'groq-fallback' };
}

module.exports = {
  groqSync,
  groqStream,
  openRouterStream,
  selfHostedStream,
  callWithFailover,
  hasSelfHostedModel,
  getGroqKey,
  getOrKey,
  httpsPost,
  httpsGet,
  readBody,
  aiLog,
  GPT_PRIMARY,
  GPT_SECONDARY,
  GROQ_MODEL,
};
