const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── Simple HTTPS request helper — no external dependencies ───────────────────
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 50000
    };
    const req = https.request(options, (res) => {
      resolve(res);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

// ── Auth middleware ───────────────────────────────────────────────────────────
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
function resetMinuteIfNeeded() {
  if (Date.now() - minuteStart > 60000) { requestsThisMinute = 0; minuteStart = Date.now(); }
}

// ── AI Proxy ──────────────────────────────────────────────────────────────────
app.post('/api/ai', requireAuth, async (req, res) => {
  const { system, user } = req.body;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // ── Usage check ───────────────────────────────────────────────────────────
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('tier, usage_count, usage_reset_date')
      .eq('id', req.user.id)
      .single();

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

  // ── Rate limit ────────────────────────────────────────────────────────────
  resetMinuteIfNeeded();
  if (requestsThisMinute >= 25) {
    const wait = 60000 - (Date.now() - minuteStart) + 500;
    await new Promise(r => setTimeout(r, wait));
    resetMinuteIfNeeded();
  }

  // ── Stream from Groq ──────────────────────────────────────────────────────
  const attemptGroq = async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const groqRes = await httpsPost(
          'api.groq.com',
          '/openai/v1/chat/completions',
          {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          {
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user }
            ],
            temperature: 0.2,
            max_tokens: 8000,
            stream: true
          }
        );

        if (groqRes.statusCode === 429) {
          const retryAfter = parseInt(groqRes.headers['retry-after'] || '10') * 1000;
          groqRes.resume();
          // If Groq wants us to wait more than 30s, the daily limit is hit — tell user immediately
          if (retryAfter > 30000) {
            console.log(`Groq daily limit hit — retry-after: ${retryAfter}ms`);
            throw new Error('DAILY_LIMIT');
          }
          console.log(`Groq 429 — waiting ${retryAfter}ms`);
          await new Promise(r => setTimeout(r, retryAfter));
          continue;
        }

        if (groqRes.statusCode !== 200) {
          let errBody = '';
          for await (const chunk of groqRes) errBody += chunk;
          throw new Error(`Groq error ${groqRes.statusCode}: ${errBody.slice(0, 200)}`);
        }

        requestsThisMinute++;
        return groqRes;
      } catch (err) {
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

    // Kill stalled stream after 30s of no data
    let lastActivity = Date.now();
    const stallCheck = setInterval(() => {
      if (Date.now() - lastActivity > 30000) {
        clearInterval(stallCheck);
        console.log('Stream stalled — terminating');
        groqRes.destroy();
        if (!res.writableEnded) res.end();
      }
    }, 5000);

    groqRes.on('data', (chunk) => {
      lastActivity = Date.now();
      res.write(chunk);
    });

    groqRes.on('end', () => {
      clearInterval(stallCheck);
      if (!res.writableEnded) res.end();
    });

    groqRes.on('error', (err) => {
      clearInterval(stallCheck);
      console.log('Stream error:', err.message);
      if (!res.writableEnded) res.end();
    });

    res.on('close', () => {
      clearInterval(stallCheck);
      groqRes.destroy();
    });

  } catch (err) {
    console.log('AI error:', err.message);
    if (!res.headersSent) {
      if (err.message === 'DAILY_LIMIT') {
        return res.status(429).json({ error: 'The AI service has reached its daily limit. Usage resets at midnight. Please try again later or upgrade your Groq API plan at console.groq.com.' });
      }
      res.status(500).json({ error: err.message });
    } else res.end();
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

// ── Case Search ───────────────────────────────────────────────────────────────
app.get('/api/cases/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const results = [];
  results.push(
    { title: `Search "${q}" on AfricanLII`, court: 'Free Nigerian Case Law', url: `https://africanlii.org/search?q=${encodeURIComponent(q)}&jurisdiction=ng`, snippet: 'Thousands of Nigerian judgments — free access', source: 'AfricanLII', isLink: true },
    { title: `Search "${q}" on PrimsCol`, court: 'LawPavilion', url: 'https://primsol.lawpavilion.com', snippet: 'Comprehensive Nigerian cases 1960-present (subscription required)', source: 'PrimsCol', isLink: true },
    { title: `Search "${q}" on NigeriaLII`, court: 'NigeriaLII', url: `https://nigerialii.org/search?q=${encodeURIComponent(q)}`, snippet: 'Free Nigerian legal materials', source: 'NigeriaLII', isLink: true }
  );
  res.json({ results, count: 0 });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '4.2.0', model: 'llama-3.3-70b-versatile' }));

// ── Frontend ──────────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Verdict AI v4.2 running on port ${PORT}`));
