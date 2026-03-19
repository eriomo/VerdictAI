const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid session' });
  req.user = user;
  next();
}

app.post('/api/ai', requireAuth, async (req, res) => {
  const { system, user } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const { data: profile } = await supabase.from('profiles').select('tier, usage_count, usage_reset_date').eq('id', req.user.id).single();
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

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => { controller.abort(); }, 55000);

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

  let geminiRes;
  try {
    geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192, candidateCount: 1 },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
      })
    });
    clearTimeout(fetchTimeout);
  } catch (err) {
    clearTimeout(fetchTimeout);
    if (!res.headersSent) {
      if (err.name === 'AbortError') return res.status(504).json({ error: 'Request timed out. Please try again.' });
      return res.status(500).json({ error: err.message });
    }
    return;
  }

  if (!geminiRes.ok) {
    let errMsg = `Gemini error ${geminiRes.status}`;
    try {
      const errBody = await geminiRes.json();
      errMsg = errBody.error?.message || errMsg;
      if (geminiRes.status === 429) errMsg = 'Rate limit reached. Please wait a moment and try again.';
    } catch {}
    console.log('Gemini error:', errMsg);
    if (!res.headersSent) return res.status(geminiRes.status === 429 ? 429 : 500).json({ error: errMsg });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  let lastActivity = Date.now();
  const streamTimeout = setInterval(() => {
    if (Date.now() - lastActivity > 30000) {
      clearInterval(streamTimeout);
      try { geminiRes.body.destroy(); } catch {}
      if (!res.writableEnded) res.end();
    }
  }, 5000);

  let buffer = '';

  geminiRes.body.on('data', (chunk) => {
    lastActivity = Date.now();
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
      try {
        const parsed = JSON.parse(dataStr);
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      } catch {}
    }
  });

  geminiRes.body.on('end', () => {
    clearInterval(streamTimeout);
    if (buffer.trim().startsWith('data:')) {
      try {
        const parsed = JSON.parse(buffer.trim().slice(5).trim());
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      } catch {}
    }
    res.write('data: [DONE]\n\n');
    if (!res.writableEnded) res.end();
  });

  geminiRes.body.on('error', (err) => {
    clearInterval(streamTimeout);
    if (!res.writableEnded) res.end();
  });

  res.on('close', () => {
    clearInterval(streamTimeout);
    try { geminiRes.body.destroy(); } catch {}
  });
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

app.get('/api/cases/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const results = [];
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    const afRes = await fetch(`https://africanlii.org/search?q=${encodeURIComponent(q)}&jurisdiction=ng&type=judgment`, { headers: { 'User-Agent': 'VerdictAI/4.2' }, signal: ctrl.signal });
    if (afRes.ok) {
      const ct = afRes.headers.get('content-type') || '';
      if (ct.includes('json')) {
        const data = await afRes.json();
        (data.results || data.items || []).slice(0, 8).forEach(item => {
          results.push({ title: item.title || 'Untitled Case', court: item.court || 'Nigerian Court', year: item.year || '', url: item.url || 'https://africanlii.org', snippet: item.snippet || '', source: 'AfricanLII' });
        });
      }
    }
  } catch (e) {}
  results.push(
    { title: `Search "${q}" on AfricanLII`, court: 'External', year: '', url: `https://africanlii.org/search?q=${encodeURIComponent(q)}&jurisdiction=ng`, snippet: 'Free Nigerian case law database', source: 'AfricanLII', isLink: true },
    { title: `Search "${q}" on PrimsCol`, court: 'LawPavilion', year: '', url: 'https://primsol.lawpavilion.com', snippet: 'Comprehensive Nigerian cases 1960-present (subscription required)', source: 'PrimsCol', isLink: true }
  );
  res.json({ results, count: results.filter(r => !r.isLink).length });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '4.2.0', model: 'gemini-2.0-flash' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Verdict AI v4.2 — Gemini 2.0 Flash — port ${PORT}`));
