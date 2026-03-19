app.post('/api/ai', requireAuth, async (req, res) => {
  const { system, user } = req.body;
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'AI not configured' });
  }

  if (!system || !user) {
    return res.status(400).json({ error: 'Missing system or user input' });
  }

  resetMinuteIfNeeded();

  if (requestsThisMinute >= 25) {
    return res.status(429).json({
      error: 'RATE_LIMIT',
      message: 'Too many requests. Try again in a few seconds.'
    });
  }

  // ── Usage Tracking ─────────────────────────────────────────────
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('tier, usage_count, usage_reset_date')
      .eq('id', req.user.id)
      .single();

    if (profile) {
      const resetDate = new Date(profile.usage_reset_date || 0);
      const now = new Date();

      if (
        now.getMonth() !== resetDate.getMonth() ||
        now.getFullYear() !== resetDate.getFullYear()
      ) {
        await supabase
          .from('profiles')
          .update({
            usage_count: 0,
            usage_reset_date: now.toISOString()
          })
          .eq('id', req.user.id);

        profile.usage_count = 0;
      }

      if (profile.tier === 'free' && profile.usage_count >= 7) {
        return res.status(403).json({
          error: 'FREE_LIMIT_REACHED',
          message: 'Free limit reached. Upgrade to continue.'
        });
      }

      await supabase
        .from('profiles')
        .update({
          usage_count: (profile.usage_count || 0) + 1
        })
        .eq('id', req.user.id);
    }
  } catch (e) {
    console.log('Usage tracking error:', e.message);
  }

  // ── AI CALL ───────────────────────────────────────────────────
  const attemptGroq = async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              messages: [
                {
                  role: 'system',
                  content: system + '\n\nBe structured, precise, and professional. No fluff.'
                },
                {
                  role: 'user',
                  content: user
                }
              ],
              temperature: 0.25,
              max_tokens: 8000,
              stream: true
            })
          }
        );

        if (response.status === 429) {
          await new Promise(r => setTimeout(r, 2000 * (i + 1)));
          continue;
        }

        if (!response.ok) {
          const err = await response.text();
          throw new Error(err);
        }

        requestsThisMinute++;
        return response;

      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(r => setTimeout(r, 1500 * (i + 1)));
      }
    }
  };

  // ── STREAM RESPONSE ───────────────────────────────────────────
  try {
    const aiRes = await attemptGroq();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    aiRes.body.pipe(res);

    aiRes.body.on('end', () => {
      res.end();
    });

    aiRes.body.on('error', () => {
      res.end();
    });

  } catch (err) {
    console.error('AI ERROR:', err.message);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'AI_FAILED',
        message: 'Something went wrong generating response'
      });
    }
  }
});
