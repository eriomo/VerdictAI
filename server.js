'use strict';

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const path = require('path');

const { corsOptions } = require('./middleware/cors');
const { securityHeaders } = require('./middleware/security');
const { ipRateLimit } = require('./middleware/rateLimit');
const { ensureDataDir, reloadDiskCorpus, exportTrainingCorpus } = require('./services/corpus');
const { supabase, invalidateProfileCache } = require('./services/supabase');

const aiRoute = require('./routes/ai');
const documentsRoute = require('./routes/documents');
const casesRoute = require('./routes/cases');
const profileRouter = require('./routes/profile');
const paymentsModule = require('./routes/payments');
const paymentsRouter = paymentsModule.router;
const { PLANS } = paymentsModule;
const knowledgeRouter = require('./routes/knowledge');
const healthRouter = require('./routes/health');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(securityHeaders);
app.use('/api', ipRateLimit);

function splitName(fullName) {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
}

function buildUser(user, profile) {
  const fullName = profile?.full_name || user?.user_metadata?.full_name || '';
  const names = splitName(fullName);
  return {
    id: user?.id,
    email: user?.email,
    role: profile?.role || user?.user_metadata?.role || 'lawyer',
    full_name: fullName,
    firstName: names.firstName,
    lastName: names.lastName,
    tier: profile?.tier || 'free',
  };
}

app.post('/api/auth/login', express.json({ limit: '4mb' }), async (req, res) => {
  const email = (req.body?.email || '').trim();
  const password = req.body?.password || '';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.session?.access_token || !data?.user) {
    return res.status(401).json({ error: error?.message || 'Login failed' });
  }

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single();

  return res.json({
    token: data.session.access_token,
    user: buildUser(data.user, profile),
  });
});

app.post('/api/auth/register', express.json({ limit: '4mb' }), async (req, res) => {
  const firstName = (req.body?.firstName || '').trim();
  const lastName = (req.body?.lastName || '').trim();
  const email = (req.body?.email || '').trim();
  const password = req.body?.password || '';
  const role = (req.body?.role || 'lawyer').trim();

  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'First name, last name, email, and password are required' });
  }

  const fullName = `${firstName} ${lastName}`.trim();

  const created = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });

  if (created.error || !created.data?.user) {
    return res.status(400).json({ error: created.error?.message || 'Registration failed' });
  }

  await supabase.from('profiles').upsert({
    id: created.data.user.id,
    full_name: fullName,
    role,
  });

  const signedIn = await supabase.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data?.session?.access_token) {
    return res.status(200).json({
      user: buildUser(created.data.user, { full_name: fullName, role }),
      message: 'Account created. Please sign in.',
    });
  }

  return res.json({
    token: signedIn.data.session.access_token,
    user: buildUser(created.data.user, { full_name: fullName, role }),
  });
});

app.post('/api/auth/me', express.json({ limit: '4mb' }), async (req, res) => {
  const token = (req.body?.token || '').trim();
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data: authData, error } = await supabase.auth.getUser(token);
  if (error || !authData?.user) {
    return res.status(401).json({ error: 'Invalid session' });
  }

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', authData.user.id).single();

  return res.json({
    user: buildUser(authData.user, profile),
  });
});

app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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
    console.log(`[WEBHOOK] Upgraded ${user_id} -> ${resolvedTier}`);
  } catch (error) {
    console.log('[WEBHOOK] Error:', error.message);
  }
});

app.use(express.json({ limit: '4mb' }));

app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  return next(err);
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/ai', aiRoute);
app.use('/api/documents', documentsRoute);
app.use('/api/cases', casesRoute);
app.use('/api/profile', profileRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/knowledge', knowledgeRouter);
app.use('/api/health', healthRouter);
app.get('/api/config', (req, res) => res.json({ paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || '' }));

app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

app.get('*', (req, res) => {
  const accept = req.headers.accept || '';
  if (req.path !== '/' && !accept.includes('text/html')) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

ensureDataDir();
reloadDiskCorpus();
exportTrainingCorpus();

app.listen(PORT, () => {
  console.log(`Verdict AI v5.0.0 running on port ${PORT}`);
});
