'use strict';

/**
 * VERDICT AI — CACHE SERVICE
 * AI response cache with TTL.
 * services/cache.js
 */

const crypto = require('crypto');

const aiResponseCache = new Map();
const AI_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

function getCachedAiResponse(cacheKey) {
  const cached = aiResponseCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    aiResponseCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedAiResponse(cacheKey, value) {
  if (!cacheKey || !value) return;
  aiResponseCache.set(cacheKey, { value, expiresAt: Date.now() + AI_CACHE_TTL });
}

function buildCacheKey(userId, toolId, system, user) {
  const normalizedUser = user.toLowerCase().replace(/\s+/g, ' ').trim();
  const hash = crypto.createHash('sha1').update(`${system}\n${normalizedUser}`).digest('hex');
  return `${userId}:${toolId}:${hash}`;
}

// Clean expired entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of aiResponseCache) {
    if (now > v.expiresAt) aiResponseCache.delete(k);
  }
}, 30 * 60_000);

module.exports = { getCachedAiResponse, setCachedAiResponse, buildCacheKey };
