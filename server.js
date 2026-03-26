// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Webhook needs raw body — must be BEFORE express.json()
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

const DISCLAIMER = '\n\nDISCLAIMER: This analysis is for informational purposes only and does not constitute legal advice. Verify all legal authorities on Primsol or current Nigerian law reports before relying on them in proceedings.';

const PLANS = {
  solo_monthly:     { amount: 1200000,  name: 'Solo Monthly',     tier: 'solo',     planCode: 'PLN_hu4h4wc91ytd9pr', interval: 'monthly' },
  solo_annual:      { amount: 12000000, name: 'Solo Annual',      tier: 'solo',     planCode: 'PLN_leetl92la6olnpi', interval: 'annually' },
  chambers_monthly: { amount: 2000000,  name: 'Chambers Monthly', tier: 'chambers', planCode: 'PLN_4o67le1fhg5acpp', interval: 'monthly' },
  chambers_annual:  { amount: 20000000, name: 'Chambers Annual',  tier: 'chambers', planCode: 'PLN_kigvazgutnu4bww', interval: 'annually' },
  solo:     { amount: 1200000,  name: 'Solo Monthly',     tier: 'solo',     planCode: 'PLN_hu4h4wc91ytd9pr', interval: 'monthly' },
  chambers: { amount: 2000000,  name: 'Chambers Monthly', tier: 'chambers', planCode: 'PLN_4o67le1fhg5acpp', interval: 'monthly' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function httpsPost(hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname, path: urlPath, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 50000,
    };
    const req = https.request(options, resolve);
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

function httpsGet(hostname, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path: urlPath, method: 'GET', headers, timeout: 30000 };
    const req = https.request(options, resolve);
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

async function readBody(res) {
  return new Promise((resolve) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

function aiLog(msg) { console.log(`[AI-ORCH ${new Date().toISOString().slice(11,19)}] ${msg}`); }

// ── AI Models & Orchestration ────────────────────────────────────────────────
const HEAVY_TOOLS = new Set([
  'docanalysis','warroom','seniorpartner','trialprep','claimanalyser',
  'clausedna','settlement','opposing','strength','crossexam','evidence',
  'witness','motionammo','briefscore','pleadingcheck','negotiation',
  'clientprep','deadlines','compliancecal','whatsapp','feenote','intakememo'
]);

const GPT_PRIMARY   = 'openai/gpt-oss-120b:free';
const GPT_SECONDARY = 'openai/gpt-oss-20b:free';
const GROQ_MODEL    = 'llama-3.3-70b-versatile';

async function callGroqSync(groqKey, system, user, maxTokens = 1500) {
  const res = await httpsPost(
    'api.groq.com', '/openai/v1/chat/completions',
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    { model: GROQ_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.1, max_tokens: maxTokens, stream: false }
  );
  return new Promise((resolve) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try { const parsed = JSON.parse(data); resolve(parsed.choices?.[0]?.message?.content || ''); }
      catch { resolve(''); }
    });
    res.on('error', () => resolve(''));
  });
}

async function callOpenRouterStream(orKey, model, system, user, maxTokens = 8000) {
  return httpsPost(
    'openrouter.ai', '/api/v1/chat/completions',
    {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${orKey}`,
      'HTTP-Referer': 'https://verdictai.com.ng',
      'X-Title': 'Verdict AI',
    },
    { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.15, max_tokens: maxTokens, stream: true }
  );
}

async function callGroqStream(groqKey, system, user, maxTokens = 8000) {
  return httpsPost(
    'api.groq.com', '/openai/v1/chat/completions',
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    { model: GROQ_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: maxTokens, stream: true }
  );
}

async function groqPreprocess(groqKey, user) {
  const preprocessPrompt = `Extract from input:
1. DOCUMENT TYPE
2. KEY PARTIES
3. CORE SUBJECT
4. KEY CLAUSES OR ISSUES (max 8)
5. MONETARY VALUES
6. DATES

Plain text only. No analysis.`;
  try {
    const result = await Promise.race([
      callGroqSync(groqKey, preprocessPrompt, user.slice(0,4000), 800),
      new Promise(r => setTimeout(() => r(''), 4000))
    ]);
    return result || '';
  } catch { return ''; }
}

async function callWithFailover(orKey, groqKey, system, user) {
  const models = [
    { model: GPT_PRIMARY,   name: 'gpt-oss-120b', isGPT: true },
    { model: GPT_PRIMARY,   name: 'gpt-oss-120b (retry)', isGPT: true },
    { model: GPT_SECONDARY, name: 'gpt-oss-20b',  isGPT: true },
    { model: GPT_SECONDARY, name: 'gpt-oss-20b (retry)', isGPT: true },
  ];

  for (const { model, name } of models) {
    try {
      aiLog(`Trying ${name}...`);
      const aiRes = await callOpenRouterStream(orKey, model, system, user);
      if (aiRes.statusCode === 200) return { aiRes, engine: name };
    } catch (e) { aiLog(`✗ ${name} → exception: ${e.message}`); }
  }

  aiLog('⚠ All GPT models failed — using Groq fallback');
  const aiRes = await callGroqStream(groqKey, system, user);
  return { aiRes, engine: 'groq-fallback' };
}

async function orchestrate(toolId, system, user, groqKey, orKey) {
  const isHeavy = HEAVY_TOOLS.has(toolId);

  if (!isHeavy) {
    aiLog(`Simple tool: Groq → ${toolId}`);
    const aiRes = await callGroqStream(groqKey, system, user);
    return { aiRes, engine: 'groq' };
  }

  aiLog(`Heavy tool: parallel Groq+GPT → ${toolId}`);
  const [preprocessResult, gptResult] = await Promise.allSettled([
    groqPreprocess(groqKey, user),
    callWithFailover(orKey, groqKey, system, user)
  ]);

  const extraction = preprocessResult.status === 'fulfilled' ? preprocessResult.value : '';
  let { aiRes, engine } = gptResult.status === 'fulfilled' ? gptResult.value : { aiRes: null, engine: 'none' };

  if (!aiRes) { aiRes = await callGroqStream(groqKey, system, user); engine = 'groq-emergency'; }
  return { aiRes, engine, extraction };
}

// ── Auth Middleware ─────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ','');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid session' });
  req.user = user;
  next();
}

// ── AI Endpoint ─────────────────────────────────────────────────────────────
app.post('/api/ai', requireAuth, async (req, res) => {
  let { system, user, tool } = req.body;
  if (!system || !user) return res.status(400).json({ error: 'Missing system or user content' });

  const MAX_USER_CHARS = 12000;
  const MAX_SYS_CHARS  = 6000;
  if (user.length > MAX_USER_CHARS) user = user.slice(0, MAX_USER_CHARS) + '\n\n[Document truncated]';
  if (system.length > MAX_SYS_CHARS) system = system.slice(0, MAX_SYS_CHARS);

  const groqKey = (process.env.GROQ_API_KEY || '').trim().replace(/[\r\n\t]/g,'');
  const orKey   = (process.env.OPENROUTER_API_KEY || '').trim().replace(/[\r\n\t]/g,'');
  if (!groqKey) return res.status(500).json({ error: 'AI API key not configured' });

  try {
    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('Connection','keep-alive');
    res.setHeader('X-Accel-Buffering','no');

    const toolId = (tool || '').toLowerCase();
    // ← FIX: replaced routeAI with orchestrate
    const { aiRes, engine } = await orchestrate(toolId, system, user, groqKey, orKey);

    if (aiRes.statusCode !== 200) {
      let body = '';
      for await (const chunk of aiRes) body += chunk;
      console.log('AI error:', aiRes.statusCode, body.slice(0,300));
      if (!res.headersSent) res.status(500).json({ error: 'AI service error ' + aiRes.statusCode });
      return;
    }

    let buffer = '';
    let lastActivity = Date.now();
    const stallCheck = setInterval(() => {
      if (Date.now() - lastActivity > 55000) { clearInterval(stallCheck); aiRes.destroy(); if (!res.writableEnded) res.end(); }
    }, 5000);

    aiRes.on('data', chunk => {
      lastActivity = Date.now();
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) res.write(`data: ${JSON.stringify({ choices:[{ delta:{ content: delta } }] })}\n\n`);
        } catch {}
      }
    });

    aiRes.on('end', () => {
      clearInterval(stallCheck);
      res.write(`data: ${JSON.stringify({ choices:[{ delta:{ content: DISCLAIMER } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      if (!res.writableEnded) res.end();
    });

    aiRes.on('error', () => { clearInterval(stallCheck); if (!res.writableEnded) res.end(); });
    res.on('close', () => { clearInterval(stallCheck); aiRes.destroy(); });

  } catch (err) {
    console.log('AI error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// ── The rest of your payment, documents, cases, profile, search routes remain the same ──
// Copy everything from your previous server file below this line (Paystack, Supabase, bank transfer, documents, cases, profile, etc.)

app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT, () => console.log(`Verdict AI v4.6 running on port ${PORT}`));
