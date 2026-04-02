'use strict';

/**
 * VERDICT AI — MIDDLEWARE
 * middleware/auth.js + rateLimit.js + cors.js + security.js
 * All combined into one file for simplicity.
 * Import what you need: const { requireAuth, rateLimit, corsOptions, securityHeaders } = require('./middleware');
 */

const { supabase } = require('../services/supabase');

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsOptions = {
  origin: true,
  credentials: true,
  methods: 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type,Authorization',
};

// ── Security headers ──────────────────────────────────────────────────────────
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://js.paystack.co; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://paystack.com; style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://paystack.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https: blob:; manifest-src 'self'; connect-src 'self' https://api.groq.com https://openrouter.ai https://api.anthropic.com https://verdictai.com.ng https://api.paystack.co https://checkout.paystack.com https://*.supabase.co wss://*.supabase.co https://unpkg.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; frame-src 'self' https://js.paystack.co https://checkout.paystack.com; worker-src 'self' blob:;"
  );
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

// ── Rate limiting ─────────────────────────────────────────────────────────────
const ipRequests = new Map();
const userAiCalls = new Map();

function getIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0] : req.socket?.remoteAddress || 'unknown').trim();
}

function checkRateLimit(store, key, limit, windowMs) {
  const now = Date.now();
  let r = store.get(key);
  if (!r || now > r.resetAt) { r = { count: 0, resetAt: now + windowMs }; store.set(key, r); }
  r.count++;
  return { allowed: r.count <= limit, count: r.count, limit };
}

function ipRateLimit(req, res, next) {
  const ip = getIP(req);
  const { allowed } = checkRateLimit(ipRequests, `ip:${ip}`, 240, 60_000);
  if (!allowed) {
    res.setHeader('Retry-After', '60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
  }
  next();
}

function checkUserAiLimit(userId) {
  return checkRateLimit(userAiCalls, `user:${userId}`, 30, 3_600_000);
}

// Clean stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ipRequests) if (now > v.resetAt) ipRequests.delete(k);
  for (const [k, v] of userAiCalls) if (now > v.resetAt) userAiCalls.delete(k);
}, 5 * 60_000);

// ── Auth ──────────────────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid session' });
  req.user = user;
  next();
}

// ── Admin auth ────────────────────────────────────────────────────────────────
const ADMIN_SECRET = (process.env.ADMIN_SECRET || '').trim();

function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET) return res.status(503).json({ error: 'ADMIN_SECRET not configured' });
  const provided = (req.headers['x-admin-secret'] || '').trim();
  if (!provided || provided !== ADMIN_SECRET) return res.status(403).json({ error: 'Admin access denied' });
  next();
}

// ── UUID validation ───────────────────────────────────────────────────────────
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function stringOrEmpty(v) { return typeof v === 'string' ? v.trim() : ''; }

module.exports = {
  corsOptions,
  securityHeaders,
  ipRateLimit,
  checkUserAiLimit,
  requireAuth,
  requireAdmin,
  isUuid,
  stringOrEmpty,
};
