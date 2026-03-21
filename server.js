const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
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

const DISCLAIMER = '\n\nDISCLAIMER: This analysis is for informational purposes only and does not constitute legal advice. Verify all legal authorities on PrimsCol or current Nigerian law reports before relying on them in proceedings.';

const PLANS = {
  solo:     { amount: 1200000, name: 'Solo',     tier: 'solo' },
  chambers: { amount: 2000000, name: 'Chambers', tier: 'chambers' },
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

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid session' });
  req.user = user;
  next();
}

let requestsThisMinute = 0;
let minuteStart = Date.now();
function resetMinute() {
  if (Date.now() - minuteStart > 60000) { requestsThisMinute = 0; minuteStart = Date.now(); }
}

// ── AI ────────────────────────────────────────────────────────────────────────
app.post('/api/ai', requireAuth, async (req, res) => {
  const { system, user } = req.body;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const { data: profile } = await supabase
      .from('profiles').select('tier, usage_count, usage_reset_date')
      .eq('id', req.user.id).single();
    if (profile) {
      const resetDate = new Date(profile.usage_reset_date || 0);
      const now = new Date();
      if (now.getMonth() !== resetDate.getMonth() || now.getFullYear() !== resetDate.getFullYear()) {
        await supabase.from('profiles').update({ usage_count: 0, usage_reset_date: now.toISOString() }).eq('id', req.user.id);
        profile.usage_count = 0;
      }
      if (profile.tier === 'free' && profile.usage_count >= 7) {
        return res.status(403).json({ error: 'FREE_LIMIT_REACHED', message: 'You have used all 7 free analyses this month. Upgrade to Solo to continue.' });
      }
      await supabase.from('profiles').update({ usage_count: (profile.usage_count || 0) + 1 }).eq('id', req.user.id);
    }
  } catch (e) { console.log('Profile check error:', e.message); }

  resetMinute();
  if (requestsThisMinute >= 25) {
    const wait = 60000 - (Date.now() - minuteStart) + 500;
    await new Promise(r => setTimeout(r, wait));
    resetMinute();
  }

  const attemptGroq = async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const groqRes = await httpsPost(
          'api.groq.com', '/openai/v1/chat/completions',
          { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          { model: 'llama-3.3-70b-versatile', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: 8000, stream: true }
        );
        if (groqRes.statusCode === 429) {
          const retryAfter = parseInt(groqRes.headers['retry-after'] || '10') * 1000;
          groqRes.resume();
          if (retryAfter > 30000) throw new Error('DAILY_LIMIT');
          await new Promise(r => setTimeout(r, retryAfter));
          continue;
        }
        if (groqRes.statusCode !== 200) {
          let body = '';
          for await (const chunk of groqRes) body += chunk;
          throw new Error(`Groq error ${groqRes.statusCode}: ${body.slice(0, 200)}`);
        }
        requestsThisMinute++;
        return groqRes;
      } catch (err) {
        if (err.message === 'DAILY_LIMIT') throw err;
        if (i === retries - 1) throw err;
        await new Promise(r => setTimeout(r, 2000 * (i + 1)));
      }
    }
  };

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const groqRes = await attemptGroq();
    let fullText = '';
    let buffer = '';

    let lastActivity = Date.now();
    const stallCheck = setInterval(() => {
      if (Date.now() - lastActivity > 30000) {
        clearInterval(stallCheck);
        groqRes.destroy();
        if (!res.writableEnded) res.end();
      }
    }, 5000);

    groqRes.on('data', (chunk) => {
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
          const delta = JSON.parse(data).choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
          }
        } catch {}
      }
    });

    groqRes.on('end', () => {
      clearInterval(stallCheck);
      const stripped = fullText.replace(/DISCLAIMER[\s\S]*$/i, '').trimEnd();
      const disclaimerChunk = JSON.stringify({ choices: [{ delta: { content: DISCLAIMER } }] });
      res.write(`data: ${disclaimerChunk}\n\n`);
      res.write('data: [DONE]\n\n');
      if (!res.writableEnded) res.end();
    });

    groqRes.on('error', () => { clearInterval(stallCheck); if (!res.writableEnded) res.end(); });
    res.on('close', () => { clearInterval(stallCheck); groqRes.destroy(); });

  } catch (err) {
    console.log('AI error:', err.message);
    if (!res.headersSent) {
      if (err.message === 'DAILY_LIMIT') return res.status(429).json({ error: 'Daily limit reached. Resets at midnight UTC.' });
      res.status(500).json({ error: err.message });
    } else res.end();
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
        metadata: {
          user_id: req.user.id,
          plan: plan,
          plan_name: planData.name,
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
    expiry.setDate(expiry.getDate() + 31);

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
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET)
    .update(req.body).digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(400).send('Invalid signature');
  }

  res.status(200).send('OK');

  try {
    const event = JSON.parse(req.body.toString());
    if (event.event !== 'charge.success') return;

    const { user_id, plan } = event.data.metadata || {};
    if (!user_id || !plan) return;

    const planData = PLANS[plan];
    if (!planData) return;

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 31);

    await supabase.from('profiles').update({
      tier: planData.tier,
      tier_expiry: expiry.toISOString(),
    }).eq('id', user_id);

    console.log(`Webhook upgraded ${user_id} to ${planData.tier}`);
  } catch (err) {
    console.log('Webhook error:', err.message);
  }
});

// ── Documents ─────────────────────────────────────────────────────────────────
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
    { title: `Search "${q}" on PrimsCol`, court: 'LawPavilion', url: 'https://primsol.lawpavilion.com', snippet: 'Comprehensive Nigerian cases 1960-present', source: 'PrimsCol', isLink: true },
    { title: `Search "${q}" on NigeriaLII`, court: 'NigeriaLII', url: `https://nigerialii.org/search?q=${encodeURIComponent(q)}`, snippet: 'Free Nigerian legal materials', source: 'NigeriaLII', isLink: true }
  ];
  res.json({ results, count: 0 });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '4.5.0', model: 'llama-3.3-70b-versatile' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Verdict AI v4.5 running on port ${PORT}`));
