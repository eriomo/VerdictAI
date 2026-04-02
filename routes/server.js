'use strict';

/**
 * VERDICT AI SERVER v5.0
 * ─────────────────────────────────────────────
 * This file is intentionally thin.
 * All logic lives in services/, routes/, prompts/, and middleware/.
 *
 * DROP ORDER: Drop all other files FIRST, then this file last.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

const { corsOptions, securityHeaders, ipRateLimit } = require('./middleware');
const { ensureDataDir, reloadDiskCorpus, exportTrainingCorpus } = require('./services/corpus');

const aiRoute = require('./routes/ai');
const documentsRoute = require('./routes/documents');
const casesRoute = require('./routes/cases');
const { profileRouter, paymentsRouter, knowledgeRouter, healthRouter } = require('./routes/index');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// ── CORS — must be first ──────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ── Security headers ──────────────────────────────────────────────────────────
app.use(securityHeaders);

// ── Rate limiting — all /api/* routes ────────────────────────────────────────
app.use('/api', ipRateLimit);

// ── Body parsing ──────────────────────────────────────────────────────────────
// Webhook route needs raw body — must come before express.json()
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const crypto = require('crypto');
  const { supabase } = require('./services/supabase');
  const { invalidateProfileCache } = require('./services/supabase');
  const { PLANS } = require('./routes/index');

  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return res.status(200).send('OK');

  const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');
  if (hash !== req.headers['x-paystack-signature']) return res.status(400).send('Invalid signature');

  res.status(200).send('OK');

  try {
    const event = JSON.parse(req.body.toString());
    if (event.event !== 'charge.success') return;
    const { user_id, plan, tier } = event.data.metadata || {};
    if (!user_id) return;
    const resolvedTier = tier || (plan && PLANS[plan]?.tier);
    if (!resolvedTier) return;
    const planData = plan ? PLANS[plan] : null;
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + (planData?.interval === 'annually' ? 366 : 32));
    const updateData = { tier: resolvedTier, tier_expiry: expiry.toISOString(), auto_renew: true };
    if (event.data.subscription_code) updateData.subscription_code = event.data.subscription_code;
    if (event.data.plan?.token) updateData.email_token = event.data.plan.token;
    await supabase.from('profiles').update(updateData).eq('id', user_id);
    invalidateProfileCache(user_id);
    console.log(`[WEBHOOK] Upgraded ${user_id} → ${resolvedTier}`);
  } catch (err) {
    console.log('[WEBHOOK] Error:', err.message);
  }
});

app.use(express.json({ limit: '4mb' }));

// ── Error handler for malformed JSON ─────────────────────────────────────────
app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  return next(err);
});

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/ai', aiRoute);
app.use('/api/documents', documentsRoute);
app.use('/api/cases', casesRoute);
app.use('/api/profile', profileRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/cases', casesRoute);        // search endpoint lives here too
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/health', healthRouter);
app.get('/api/config', (req, res) => res.json({ paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || '' }));

// ── API 404 ───────────────────────────────────────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// ── SPA catch-all ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  const accept = req.headers.accept || '';
  if (req.path !== '/' && !accept.includes('text/html')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Boot ──────────────────────────────────────────────────────────────────────
ensureDataDir();
reloadDiskCorpus();
exportTrainingCorpus();

app.listen(PORT, () => {
  console.log(`Verdict AI v5.0.0 running on port ${PORT}`);
});
