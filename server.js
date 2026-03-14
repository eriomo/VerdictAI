const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Proxy: AfricanLII / Nigeria LII case search ───────────────────────────
// AfricanLII has a public search endpoint for Nigerian cases
app.get('/api/cases/search', async (req, res) => {
  const { q, jurisdiction = 'ng' } = req.query;
  if (!q) return res.json({ results: [], error: 'No query provided' });

  try {
    // AfricanLII public search API
    const url = `https://africanlii.org/search?q=${encodeURIComponent(q)}&jurisdiction=${jurisdiction}&type=judgment&format=json`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'VerdictAI/1.0 (legal research tool)'
      }
    });

    if (response.ok) {
      const data = await response.json();
      return res.json({ results: data.results || data.items || [], source: 'africanlii' });
    }

    // Fallback: Nigeria LII (nigerialii.org) 
    const fallbackUrl = `https://nigerialii.org/search?q=${encodeURIComponent(q)}&format=json`;
    const fallback = await fetch(fallbackUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (fallback.ok) {
      const fdata = await fallback.json();
      return res.json({ results: fdata.results || [], source: 'nigerialii' });
    }

    return res.json({ results: [], source: 'none', message: 'Search services temporarily unavailable' });
  } catch (err) {
    console.error('Case search error:', err.message);
    res.json({ results: [], error: err.message });
  }
});

// ── Proxy: Groq API (keeps API key server-side, not exposed in browser) ───
app.post('/api/ai', async (req, res) => {
  const { system, user, stream } = req.body;
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

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

    if (!groqRes.ok) {
      const err = await groqRes.json();
      return res.status(groqRes.status).json({ error: err.error?.message || 'Groq API error' });
    }

    // Stream the response back to the client
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    groqRes.body.pipe(res);
  } catch (err) {
    console.error('AI proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Serve app for all other routes ───────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Verdict AI running on port ${PORT}`);
});
