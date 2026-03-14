const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limit tracking ───────────────────────────────────────────────────────
const requestQueue = [];
let processing = false;
let requestsThisMinute = 0;
let minuteStart = Date.now();

function resetMinuteIfNeeded() {
  if (Date.now() - minuteStart > 60000) {
    requestsThisMinute = 0;
    minuteStart = Date.now();
  }
}

// ── AI Proxy with retry + queue ───────────────────────────────────────────────
app.post('/api/ai', async (req, res) => {
  const { system, user } = req.body;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured on server.' });
  if (!system || !user) return res.status(400).json({ error: 'Missing system or user prompt.' });

  resetMinuteIfNeeded();

  // If rate limit close, add small delay
  if (requestsThisMinute >= 25) {
    const wait = 60000 - (Date.now() - minuteStart) + 500;
    await new Promise(r => setTimeout(r, wait));
    resetMinuteIfNeeded();
  }

  const attemptGroq = async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user }
            ],
            temperature: 0.4,
            max_tokens: 4000,
            stream: true
          })
        });

        if (groqRes.status === 429) {
          // Rate limited — wait and retry
          const retryAfter = parseInt(groqRes.headers.get('retry-after') || '10') * 1000;
          await new Promise(r => setTimeout(r, retryAfter));
          continue;
        }

        if (!groqRes.ok) {
          const err = await groqRes.json();
          throw new Error(err.error?.message || `Groq error ${groqRes.status}`);
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
    groqRes.body.pipe(res);

    groqRes.body.on('error', (err) => {
      console.error('Stream error:', err.message);
      res.end();
    });
  } catch (err) {
    console.error('AI proxy error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// ── Nigerian Case Law Search (AfricanLII + Nigeria LII) ───────────────────────
app.get('/api/cases/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [], error: 'No query provided' });

  const results = [];

  // 1. Try AfricanLII search (Nigerian cases)
  try {
    const afUrl = `https://africanlii.org/search?q=${encodeURIComponent(q)}&jurisdiction=ng&type=judgment`;
    const afRes = await fetch(afUrl, {
      headers: {
        'Accept': 'text/html,application/json',
        'User-Agent': 'VerdictAI/1.0'
      },
      timeout: 8000
    });

    if (afRes.ok) {
      const contentType = afRes.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const data = await afRes.json();
        const items = data.results || data.items || data.hits || [];
        items.slice(0, 10).forEach(item => {
          results.push({
            title: item.title || item.name || 'Untitled',
            court: item.court || item.jurisdiction || 'Nigerian Court',
            year: item.year || item.date || '',
            url: item.url || item.link || `https://africanlii.org/ng/judgment`,
            snippet: item.snippet || item.summary || item.description || '',
            source: 'AfricanLII'
          });
        });
      }
    }
  } catch (e) {
    console.log('AfricanLII error:', e.message);
  }

  // 2. Try Nigeria LII directly
  try {
    const ngUrl = `https://nigerialii.org/search?q=${encodeURIComponent(q)}`;
    const ngRes = await fetch(ngUrl, {
      headers: { 'User-Agent': 'VerdictAI/1.0', 'Accept': 'application/json' },
      timeout: 8000
    });
    if (ngRes.ok) {
      const ct = ngRes.headers.get('content-type') || '';
      if (ct.includes('json')) {
        const data = await ngRes.json();
        const items = data.results || data.hits || [];
        items.slice(0, 5).forEach(item => {
          results.push({
            title: item.title || 'Untitled',
            court: item.court || 'Nigerian Court',
            year: item.year || '',
            url: item.url || 'https://nigerialii.org',
            snippet: item.snippet || '',
            source: 'NigeriaLII'
          });
        });
      }
    }
  } catch (e) {
    console.log('NigeriaLII error:', e.message);
  }

  // 3. Always return suggested search links regardless
  const searchLinks = [
    {
      title: `Search "${q}" on AfricanLII`,
      court: 'External Database',
      year: '',
      url: `https://africanlii.org/search?q=${encodeURIComponent(q)}&jurisdiction=ng`,
      snippet: 'Click to search AfricanLII — free Nigerian case law database',
      source: 'AfricanLII',
      isLink: true
    },
    {
      title: `Search "${q}" on PrimsCol`,
      court: 'LawPavilion Database',
      year: '',
      url: `https://primsol.lawpavilion.com`,
      snippet: 'Click to search PrimsCol — comprehensive Nigerian cases from 1960 to present (subscription required)',
      source: 'PrimsCol',
      isLink: true
    }
  ];

  res.json({
    results: [...results, ...searchLinks],
    count: results.length,
    source: results.length > 0 ? 'live' : 'links_only'
  });
});

// ── PDF text extraction proxy ─────────────────────────────────────────────────
// Allows fetching public PDFs server-side to avoid CORS issues
app.get('/api/fetch-pdf', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'No URL provided' });

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'VerdictAI/1.0' },
      timeout: 15000
    });
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
    const buffer = await response.buffer();
    res.setHeader('Content-Type', 'application/pdf');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', timestamp: new Date().toISOString() });
});

// ── Serve frontend for all other routes ──────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Verdict AI v2.0 running on port ${PORT}`);
});
