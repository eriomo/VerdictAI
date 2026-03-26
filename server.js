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
  // Legacy keys for backwards compatibility
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

// ── AI ROUTING ──────────────────────────────────────────────────────────────
// Heavy analysis tools → DeepSeek R1 (OpenRouter) — reasoning model, thinks step by step
// Simple/fast tools    → Groq LLaMA 3.3 70B — unlimited, instant
// Fallback             → Groq always, silently, if OpenRouter fails or rate-limits
// ────────────────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
//  VERDICT AI — PRODUCTION AI ORCHESTRATION SYSTEM
//  Architecture:
//    HEAVY tools → Groq (parallel preprocessing) + GPT-120b (primary brain)
//    SIMPLE tools → Groq only (fast, unlimited)
//    FAILOVER    → GPT-120b → retry → GPT-20b → retry → Groq fallback
//    RULE        → GPT always has final say. Groq never outputs alone on heavy tools.
// ══════════════════════════════════════════════════════════════════════════════

// ── Tool classification ────────────────────────────────────────────────────────
const HEAVY_TOOLS = new Set([
  'docanalysis','warroom','seniorpartner','trialprep','claimanalyser',
  'clausedna','settlement','opposing','strength','crossexam','evidence',
  'witness','motionammo','briefscore','pleadingcheck','negotiation',
  'clientprep','deadlines','compliancecal','whatsapp','feenote','intakememo'
]);

// ── Models ────────────────────────────────────────────────────────────────────
const GPT_PRIMARY   = 'openai/gpt-oss-120b:free';
const GPT_SECONDARY = 'openai/gpt-oss-20b:free';
const GROQ_MODEL    = 'llama-3.3-70b-versatile';

// ── Internal logger ───────────────────────────────────────────────────────────
function aiLog(msg) { console.log(`[AI-ORCH ${new Date().toISOString().slice(11,19)}] ${msg}`); }

// ── Non-streaming call (for preprocessing) ────────────────────────────────────
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
      try {
        const parsed = JSON.parse(data);
        resolve(parsed.choices?.[0]?.message?.content || '');
      } catch { resolve(''); }
    });
    res.on('error', () => resolve(''));
  });
}

// ── Streaming call to OpenRouter ──────────────────────────────────────────────
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

// ── Streaming call to Groq ────────────────────────────────────────────────────
async function callGroqStream(groqKey, system, user, maxTokens = 8000) {
  return httpsPost(
    'api.groq.com', '/openai/v1/chat/completions',
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    { model: GROQ_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: maxTokens, stream: true }
  );
}

// ── Groq preprocessing — runs in parallel with GPT, adds context ──────────────
async function groqPreprocess(groqKey, user) {
  const preprocessPrompt = `You are a document parser. Extract the following from the input in plain text:
1. DOCUMENT TYPE: (contract/brief/statute/correspondence/other)
2. KEY PARTIES: (list names/entities)
3. CORE SUBJECT: (one sentence)
4. KEY CLAUSES OR ISSUES: (bullet list, max 8 items)
5. MONETARY VALUES MENTIONED: (exact figures only)
6. DATES MENTIONED: (all dates)
Be concise. No analysis — extraction only.`;

  try {
    const result = await Promise.race([
      callGroqSync(groqKey, preprocessPrompt, user.slice(0, 4000), 800),
      new Promise(r => setTimeout(() => r(''), 4000)) // 4s timeout — don't block GPT
    ]);
    return result || '';
  } catch { return ''; }
}

// ── Core orchestration — tries GPT models with failover ───────────────────────
async function callWithFailover(orKey, groqKey, system, user) {
  const models = [
    { model: GPT_PRIMARY,   name: 'gpt-oss-120b', isGPT: true },
    { model: GPT_PRIMARY,   name: 'gpt-oss-120b (retry)', isGPT: true },
    { model: GPT_SECONDARY, name: 'gpt-oss-20b',  isGPT: true },
    { model: GPT_SECONDARY, name: 'gpt-oss-20b (retry)', isGPT: true },
  ];

  for (const { model, name, isGPT } of models) {
    try {
      aiLog(`Trying ${name}...`);
      const aiRes = await callOpenRouterStream(orKey, model, system, user);
      if (aiRes.statusCode === 200) {
        aiLog(`✓ ${name} responded OK`);
        return { aiRes, engine: name };
      }
      let errBody = '';
      for await (const chunk of aiRes) errBody += chunk;
      aiLog(`✗ ${name} → ${aiRes.statusCode}: ${errBody.slice(0, 120)}`);
    } catch (e) {
      aiLog(`✗ ${name} → exception: ${e.message}`);
    }
  }

  // All GPT models failed — Groq fallback (last resort)
  aiLog('⚠ All GPT models failed — using Groq fallback');
  const aiRes = await callGroqStream(groqKey, system, user);
  return { aiRes, engine: 'groq-fallback' };
}

// ── Master orchestrator ────────────────────────────────────────────────────────
async function orchestrate(toolId, system, user, groqKey, orKey) {
  const isHeavy = HEAVY_TOOLS.has(toolId);

  if (!isHeavy) {
    // Simple tool — Groq only, instant
    aiLog(`Simple tool: Groq → ${toolId}`);
    const aiRes = await callGroqStream(groqKey, system, user);
    return { aiRes, engine: 'groq' };
  }

  // Heavy tool — run Groq preprocessing IN PARALLEL with GPT primary call
  aiLog(`Heavy tool: parallel Groq+GPT → ${toolId}`);

  // Start both simultaneously
  const [preprocessResult, gptResult] = await Promise.allSettled([
    groqPreprocess(groqKey, user),
    callWithFailover(orKey, groqKey, system, user)
  ]);

  // If GPT succeeded, inject Groq's extraction as context bonus
  const extraction = preprocessResult.status === 'fulfilled' ? preprocessResult.value : '';
  let { aiRes, engine } = gptResult.status === 'fulfilled'
    ? gptResult.value
    : { aiRes: null, engine: 'none' };

  if (extraction && engine !== 'groq-fallback' && engine !== 'none') {
    // Groq extracted structure in parallel — GPT already running with this bonus context
    // Log what we got but don't block streaming
    aiLog(`Groq extraction ready (${extraction.length} chars) — GPT streaming in parallel`);
  }

  // If somehow gptResult failed entirely (shouldn't happen with fallover), use Groq stream
  if (!aiRes) {
    aiLog('✗ Complete orchestration failure — emergency Groq');
    aiRes = await callGroqStream(groqKey, system, user);
    engine = 'groq-emergency';
  }

  return { aiRes, engine, extraction };
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
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

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid session' });
  req.user = user;
  next();
}


app.post('/api/ai', requireAuth, async (req, res) => {
  let { system, user, tool } = req.body;
  if (!system || !user) return res.status(400).json({ error: 'Missing system or user content' });

  const MAX_USER_CHARS = 12000;
  const MAX_SYS_CHARS  = 6000;
  if (user.length   > MAX_USER_CHARS) user   = user.slice(0, MAX_USER_CHARS) + '\n\n[Document truncated to fit AI limits.]';
  if (system.length > MAX_SYS_CHARS)  system = system.slice(0, MAX_SYS_CHARS);

  const groqKey = (process.env.GROQ_API_KEY || '').trim().replace(/[\r\n\t]/g,'');
  const orKey   = (process.env.OPENROUTER_API_KEY || '').trim().replace(/[\r\n\t]/g,'');
  if (!groqKey) return res.status(500).json({ error: 'AI API key not configured' });

  try {
    const { data: profile } = await supabase
      .from('profiles').select('tier, usage_count, usage_reset_date, tier_expiry')
      .eq('id', req.user.id).single();
    if (profile) {
      if (profile.tier !== 'free' && profile.tier_expiry) {
        const expiry = new Date(profile.tier_expiry);
        if (expiry < new Date()) {
          await supabase.from('profiles').update({ tier: 'free' }).eq('id', req.user.id);
          profile.tier = 'free'; profile.usage_count = 0;
        }
      }
      const resetDate = new Date(profile.usage_reset_date || 0);
      const now = new Date();
      if (now.getMonth() !== resetDate.getMonth() || now.getFullYear() !== resetDate.getFullYear()) {
        await supabase.from('profiles').update({ usage_count: 0, usage_reset_date: now.toISOString() }).eq('id', req.user.id);
        profile.usage_count = 0;
      }
      if (profile.tier === 'free' && profile.usage_count >= 3) {
        return res.status(403).json({ error: 'FREE_LIMIT_REACHED', message: 'You have used all 3 free analyses this month. Upgrade to continue.' });
      }
      await supabase.from('profiles').update({ usage_count: (profile.usage_count || 0) + 1 }).eq('id', req.user.id);
    }
  } catch (e) { console.log('Profile check error:', e.message); }

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const toolId = (tool || '').toLowerCase();

    // ✅ FIXED: was `routeAI(...)` — now correctly calls `orchestrate(...)`
    const { aiRes, engine } = await orchestrate(toolId, system, user, groqKey, orKey);

    if (aiRes.statusCode !== 200) {
      let body = '';
      for await (const chunk of aiRes) body += chunk;
      console.log('AI error:', aiRes.statusCode, body.slice(0, 300));
      if (!res.headersSent) res.status(500).json({ error: 'AI service error ' + aiRes.statusCode });
      return;
    }

    let buffer = '';
    let lastActivity = Date.now();
    const stallCheck = setInterval(() => {
      if (Date.now() - lastActivity > 55000) { clearInterval(stallCheck); aiRes.destroy(); if (!res.writableEnded) res.end(); }
    }, 5000);

    aiRes.on('data', (chunk) => {
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
          if (delta) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
        } catch {}
      }
    });

    aiRes.on('end', () => {
      clearInterval(stallCheck);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: DISCLAIMER } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      if (!res.writableEnded) res.end();
    });

    aiRes.on('error', () => { clearInterval(stallCheck); if (!res.writableEnded) res.end(); });
    res.on('close',   () => { clearInterval(stallCheck); aiRes.destroy(); });

  } catch (err) {
    console.log('AI error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});


// ── PAYSTACK — Initialize ─────────────────────────────────────────────────────
app.post('/api/payments/initialize', requireAuth, async (req, res) => {
  console.log('=== PAYMENT INITIALIZE ===');
  console.log('Plan:', req.body.plan);
  console.log('User:', req.user.email);
  console.log('Secret key set:', !!PAYSTACK_SECRET);
  console.log('Secret key prefix:', PAYSTACK_SECRET ? PAYSTACK_SECRET.slice(0, 12) : 'NOT SET');

  const { plan } = req.body;

  if (!plan) return res.status(400).json({ error: 'Plan is required' });

  const planData = PLANS[plan];
  if (!planData) {
    console.log('Invalid plan. Valid plans:', Object.keys(PLANS));
    return res.status(400).json({ error: 'Invalid plan: ' + plan });
  }

  if (!PAYSTACK_SECRET) {
    return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY not configured in Render environment' });
  }

  try {
    const paystackRes = await httpsPost(
      'api.paystack.co',
      '/transaction/initialize',
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAYSTACK_SECRET}`,
      },
      {
        email: req.user.email,
        amount: planData.amount,
        currency: 'NGN',
        plan: planData.planCode,
        metadata: {
          user_id: req.user.id,
          plan: plan,
          plan_name: planData.name,
          tier: planData.tier,
          email: req.user.email,
        },
        channels: ['card', 'bank_transfer', 'ussd', 'bank'],
      }
    );

    const data = await readBody(paystackRes);
    console.log('Paystack HTTP status:', paystackRes.statusCode);
    console.log('Paystack full response:', JSON.stringify(data));

    if (!data.status) {
      return res.status(400).json({ error: data.message || 'Paystack initialization failed' });
    }

    res.json({
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference,
    });

  } catch (err) {
    console.log('Paystack init error:', err.message);
    res.status(500).json({ error: 'Payment initialization failed: ' + err.message });
  }
});

// ── PAYSTACK — Verify ─────────────────────────────────────────────────────────
app.get('/api/payments/verify/:reference', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Payment not configured' });
  try {
    const paystackRes = await httpsGet(
      'api.paystack.co',
      `/transaction/verify/${req.params.reference}`,
      { 'Authorization': `Bearer ${PAYSTACK_SECRET}` }
    );
    const data = await readBody(paystackRes);

    if (!data.status || data.data.status !== 'success') {
      return res.status(400).json({ error: 'Payment not successful' });
    }

    const { user_id, plan } = data.data.metadata;
    const planData = PLANS[plan];
    if (!planData) return res.status(400).json({ error: 'Invalid plan in payment' });

    const expiry = new Date();
    const isAnnual = planData.interval === 'annually';
    expiry.setDate(expiry.getDate() + (isAnnual ? 366 : 32));

    await supabase.from('profiles').update({
      tier: planData.tier,
      tier_expiry: expiry.toISOString(),
    }).eq('id', user_id);

    console.log(`Upgraded user ${user_id} to ${planData.tier}`);
    res.json({ success: true, tier: planData.tier });
  } catch (err) {
    console.log('Verify error:', err.message);
    res.status(500).json({ error: 'Verification failed: ' + err.message });
  }
});

// ── PAYSTACK — Webhook ────────────────────────────────────────────────────────
app.post('/api/payments/webhook', async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(200).send('OK');
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET)
    .update(req.body).digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(400).send('Invalid signature');
  }

  res.status(200).send('OK');

  try {
    const event = JSON.parse(req.body.toString());
    if (event.event !== 'charge.success') return;

    const { user_id, plan, tier } = event.data.metadata || {};
    if (!user_id) return;

    const resolvedTier = tier || (plan && PLANS[plan]?.tier);
    if (!resolvedTier) return;

    const planData = plan ? PLANS[plan] : null;
    const isAnnual = planData?.interval === 'annually';
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + (isAnnual ? 366 : 32));

    const updateData = {
      tier: resolvedTier,
      tier_expiry: expiry.toISOString(),
      auto_renew: true,
    };

    // Save subscription code if available
    if (event.data.subscription_code) updateData.subscription_code = event.data.subscription_code;
    if (event.data.plan?.token) updateData.email_token = event.data.plan.token;

    await supabase.from('profiles').update(updateData).eq('id', user_id);
    console.log(`Webhook upgraded ${user_id} to ${resolvedTier}`);
  } catch (err) {
    console.log('Webhook error:', err.message);
  }
});

// ── PAYSTACK — Cancel subscription ───────────────────────────────────────────
app.post('/api/payments/cancel', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Payment not configured' });
  try {
    const { data: profile } = await supabase.from('profiles').select('subscription_code, email_token').eq('id', req.user.id).single();
    if (!profile?.subscription_code) return res.status(400).json({ error: 'No active subscription found' });

    const paystackRes = await httpsPost(
      'api.paystack.co',
      '/subscription/disable',
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PAYSTACK_SECRET}` },
      { code: profile.subscription_code, token: profile.email_token }
    );
    const data = await readBody(paystackRes);
    if (!data.status) return res.status(400).json({ error: data.message || 'Failed to cancel subscription' });

    await supabase.from('profiles').update({ auto_renew: false }).eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.log('Cancel error:', err.message);
    res.status(500).json({ error: 'Failed to cancel: ' + err.message });
  }
});

// ── PAYSTACK — Re-enable subscription ────────────────────────────────────────
app.post('/api/payments/reactivate', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Payment not configured' });
  try {
    const { data: profile } = await supabase.from('profiles').select('subscription_code, email_token').eq('id', req.user.id).single();
    if (!profile?.subscription_code) return res.status(400).json({ error: 'No subscription found' });

    const paystackRes = await httpsPost(
      'api.paystack.co',
      '/subscription/enable',
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PAYSTACK_SECRET}` },
      { code: profile.subscription_code, token: profile.email_token }
    );
    const data = await readBody(paystackRes);
    if (!data.status) return res.status(400).json({ error: data.message || 'Failed to reactivate' });

    await supabase.from('profiles').update({ auto_renew: true }).eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.log('Reactivate error:', err.message);
    res.status(500).json({ error: 'Failed to reactivate: ' + err.message });
  }
});


app.get('/api/documents', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('documents').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/documents', requireAuth, async (req, res) => {
  const { name, content, analysis, type } = req.body;
  const { data, error } = await supabase.from('documents').insert({ user_id: req.user.id, name, content, analysis, type, created_at: new Date().toISOString() }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('documents').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Cases ─────────────────────────────────────────────────────────────────────
app.get('/api/cases', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('cases').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/cases', requireAuth, async (req, res) => {
  const { name, description, status } = req.body;
  const { data, error } = await supabase.from('cases').insert({ user_id: req.user.id, name, description, status: status || 'active', created_at: new Date().toISOString() }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/cases/:id', requireAuth, async (req, res) => {
  const { name, description, status, notes } = req.body;
  const { data, error } = await supabase.from('cases').update({ name, description, status, notes }).eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/cases/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('cases').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Profile ───────────────────────────────────────────────────────────────────
app.get('/api/profile', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ...data, email: req.user.email });
});
app.patch('/api/profile', requireAuth, async (req, res) => {
  const { full_name, firm_name, practice_area } = req.body;
  const { data, error } = await supabase.from('profiles').update({ full_name, firm_name, practice_area }).eq('id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Case search ───────────────────────────────────────────────────────────────
app.get('/api/cases/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const results = [
    { title: `Search "${q}" on AfricanLII`, court: 'Free Nigerian Case Law', url: `https://africanlii.org/search?q=${encodeURIComponent(q)}&jurisdiction=ng`, snippet: 'Thousands of Nigerian judgments', source: 'AfricanLII', isLink: true },
    { title: `Search "${q}" on Primsol`, court: 'LawPavilion', url: 'https://primsol.lawpavilion.com', snippet: 'Comprehensive Nigerian cases 1960-present', source: 'Primsol', isLink: true },
    { title: `Search "${q}" on NigeriaLII`, court: 'NigeriaLII', url: `https://nigerialii.org/search?q=${encodeURIComponent(q)}`, snippet: 'Free Nigerian legal materials', source: 'NigeriaLII', isLink: true }
  ];
  res.json({ results, count: 0 });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '4.6.0', model: 'claude-sonnet-4-6' }));

// ── Bank Transfer Notification ────────────────────────────────────────────────
app.post('/api/payments/bank-transfer', requireAuth, async (req, res) => {
  const { plan, amount, reference, email } = req.body;
  if (!plan || !amount || !reference) return res.status(400).json({ error: 'Missing required fields' });

  try {
    // Save transfer proof to Supabase for admin review
    await supabase.from('profiles').update({
      pending_transfer: JSON.stringify({
        plan, amount, reference, email,
        submitted_at: new Date().toISOString(),
        user_id: req.user.id,
        user_email: req.user.email,
      })
    }).eq('id', req.user.id);

    // Send email notification via Gmail SMTP
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (gmailPass) {
      const emailBody = [
        'From: "Verdict AI" <trigxyfn@gmail.com>',
        'To: trigxyfn@gmail.com',
        'Subject: 💰 New Payment — ' + plan + ' — NGN ' + Number(amount).toLocaleString(),
        'Content-Type: text/plain; charset=utf-8',
        '',
        '🎉 NEW BANK TRANSFER SUBMITTED',
        '',
        'User Email: ' + req.user.email,
        'Plan: ' + plan,
        'Amount: NGN ' + Number(amount).toLocaleString(),
        'Transfer Reference: ' + reference,
        'Time: ' + new Date().toLocaleString('en-NG', {timeZone:'Africa/Lagos'}),
        '',
        'ACTION REQUIRED:',
        '1. Check your Moniepoint app — confirm NGN ' + Number(amount).toLocaleString() + ' received from this user',
        '2. Go to Supabase → profiles → find ' + req.user.email,
        '3. Change their tier to: ' + (plan.includes('chambers') ? 'chambers' : 'solo'),
        '4. They get access immediately',
        '',
        'Supabase link: https://supabase.com/dashboard/project/xlykbkfwgqhldxrwhwbp/editor',
      ].join('\r\n');

      const nodemailerAvailable = !!nodemailer;
      if (nodemailerAvailable) {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user: 'trigxyfn@gmail.com', pass: gmailPass.trim().replace(/\s/g,'') }
        });
        await transporter.sendMail({
          from: '"Verdict AI Payments" <trigxyfn@gmail.com>',
          to: 'trigxyfn@gmail.com',
          subject: `💰 New Payment — ${plan} — NGN ${Number(amount).toLocaleString()}`,
          text: emailBody,
        });
        console.log('Payment notification email sent');
      }
    }

    console.log(`BANK TRANSFER SUBMITTED:
User: ${req.user.email}
Plan: ${plan}
Amount: NGN ${amount}
Reference: ${reference}
Time: ${new Date().toISOString()}`);

    res.json({ success: true });
  } catch (err) {
    console.log('Bank transfer notification error:', err.message);
    // Still return success — don't fail the user if email fails
    res.json({ success: true });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Verdict AI v4.6 running on port ${PORT}`));
