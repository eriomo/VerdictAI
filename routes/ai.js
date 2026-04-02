'use strict';

/**
 * VERDICT AI — AI ROUTE
 * POST /api/ai — the core endpoint.
 * routes/ai.js
 */

const express = require('express');
const router = express.Router();

const { requireAuth, checkUserAiLimit, stringOrEmpty } = require('../middleware');
const { buildSystemPrompt } = require('../prompts');
const { getGroundingBundle } = require('../services/grounding');
const { orchestrate } = require('../services/orchestrator');
const { getCachedAiResponse, setCachedAiResponse, buildCacheKey } = require('../services/cache');
const { checkAndIncrementUsage } = require('../services/supabase');
const { verifyCitations, buildCitationNote } = require('../services/citation');
const { getMatterContext } = require('../services/matter');

const MAX_INPUT_CHARS = 14000;

function writeSse(res, text) {
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
}

router.post('/', requireAuth, async (req, res) => {
  const {
    user: rawUser,
    tool,
    role,
    courtId,
    matterId,
    matterContext: clientMatterContext,
  } = req.body || {};

  const user = stringOrEmpty(rawUser);
  const toolId = stringOrEmpty(tool).toLowerCase();
  const userRole = stringOrEmpty(role) || 'lawyer';
  const courtIdentifier = stringOrEmpty(courtId);

  if (!user) return res.status(400).json({ error: 'Missing user content' });

  // ── Per-user AI rate limit ──────────────────────────────────────────────────
  const { allowed: aiAllowed } = checkUserAiLimit(req.user.id);
  if (!aiAllowed) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(429).json({ error: 'AI rate limit reached. Max 30 requests per hour.' });
  }

  // ── Usage check + increment ─────────────────────────────────────────────────
  const usageResult = await checkAndIncrementUsage(req.user.id);
  if (!usageResult.allowed) {
    return res.status(403).json({
      error: 'FREE_LIMIT_REACHED',
      message: 'You have used all 3 free analyses this month. Upgrade to continue.',
    });
  }

  // ── Grounding — database retrieval ─────────────────────────────────────────
  const grounding = await getGroundingBundle(user, toolId);
  const groundingContext = grounding.context;

  // ── Matter context — from DB or client ────────────────────────────────────
  let matterContext = null;
  if (matterId) {
    matterContext = await getMatterContext(matterId, req.user.id);
  } else if (clientMatterContext && clientMatterContext.name) {
    matterContext = clientMatterContext;
  }

  // ── Build system prompt from layered architecture ──────────────────────────
  const system = buildSystemPrompt(userRole, toolId, groundingContext, matterContext, courtIdentifier);

  // ── Truncate user input ────────────────────────────────────────────────────
  let processedUser = user;
  if (processedUser.length > MAX_INPUT_CHARS) {
    processedUser = processedUser.slice(0, MAX_INPUT_CHARS) + '\n\n[Document truncated to fit context limits.]';
  }

  // ── Cache check ────────────────────────────────────────────────────────────
  const cacheKey = buildCacheKey(req.user.id, toolId, system, processedUser);
  const cached = getCachedAiResponse(cacheKey);

  // ── SSE headers ────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (cached) {
    writeSse(res, cached);
    res.write('data: [DONE]\n\n');
    if (!res.writableEnded) res.end();
    return;
  }

  try {
    const { aiRes, engine } = await orchestrate(toolId, system, processedUser);

    if (aiRes.statusCode !== 200) {
      let body = '';
      for await (const chunk of aiRes) body += chunk;
      console.log(`[AI] Error ${aiRes.statusCode}:`, body.slice(0, 200));
      if (!res.headersSent) res.status(500).json({ error: `AI service error ${aiRes.statusCode}` });
      return;
    }

    let buffer = '';
    let finalText = '';
    let lastActivity = Date.now();

    // Stall detection
    const stallCheck = setInterval(() => {
      if (Date.now() - lastActivity > 55000) {
        clearInterval(stallCheck);
        aiRes.destroy();
        if (!res.writableEnded) res.end();
      }
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
          const delta = JSON.parse(data).choices?.[0]?.delta?.content || '';
          if (delta) {
            finalText += delta;
            writeSse(res, delta);
          }
        } catch {}
      }
    });

    aiRes.on('end', async () => {
      clearInterval(stallCheck);

      // Citation verification — async, does not block user
      let citationNote = '';
      if (finalText.length > 200) {
        try {
          const verification = await verifyCitations(finalText, groundingContext);
          citationNote = buildCitationNote(verification);
        } catch {}
      }

      const fullOutput = finalText + citationNote;

      // Cache the complete output
      setCachedAiResponse(cacheKey, fullOutput);

      // Send citation note if any
      if (citationNote) writeSse(res, citationNote);

      res.write('data: [DONE]\n\n');
      if (!res.writableEnded) res.end();
    });

    aiRes.on('error', () => {
      clearInterval(stallCheck);
      if (!res.writableEnded) res.end();
    });

    res.on('close', () => {
      clearInterval(stallCheck);
      try { aiRes.destroy(); } catch {}
    });

  } catch (err) {
    console.log('[AI] Route error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else if (!res.writableEnded) res.end();
  }
});

module.exports = router;
