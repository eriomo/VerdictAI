'use strict';

/**
 * VERDICT AI — REMAINING ROUTES
 * profile.js + payments.js + knowledge.js + health.js
 * routes/profile.js
 */

const express = require('express');
const crypto = require('crypto');

const { requireAuth, requireAdmin, isUuid, stringOrEmpty } = require('../middleware');
const { supabase, invalidateProfileCache } = require('../services/supabase');
const { httpsPost, httpsGet, readBody } = require('../services/ai-models');
const { sendPaymentNotification } = require('../services/email');
const { getUnifiedKnowledgeBank, reloadDiskCorpus, exportTrainingCorpus, appendCorpusRecords } = require('../services/corpus');
const { searchVerifiedCases, searchKnowledgeBank } = require('../services/grounding');

// ════════════════════════════════════════════════════════════════════════════
// PROFILE ROUTER
// ════════════════════════════════════════════════════════════════════════════
const profileRouter = express.Router();

profileRouter.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ...data, email: req.user.email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

profileRouter.patch('/', requireAuth, async (req, res) => {
  const { full_name, firm_name, practice_area, role, billing_interval, auto_renew } = req.body;
  const updateFields = {};
  if (full_name !== undefined) updateFields.full_name = full_name;
  if (firm_name !== undefined) updateFields.firm_name = firm_name;
  if (practice_area !== undefined) updateFields.practice_area = practice_area;
  if (role !== undefined) updateFields.role = role;
  if (billing_interval !== undefined) updateFields.billing_interval = billing_interval;
  if (auto_renew !== undefined) updateFields.auto_renew = auto_renew;

  if (!Object.keys(updateFields).length) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  let { data, error } = await supabase.from('profiles').update(updateFields).eq('id', req.user.id).select().single();

  // Handle missing role column gracefully
  if (error && role !== undefined && /Could not find the 'role' column/i.test(error.message || '')) {
    delete updateFields.role;
    if (!Object.keys(updateFields).length) {
      const retry = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
      if (retry.error) return res.status(500).json({ error: retry.error.message });
      return res.json({ ...retry.data, role });
    }
    const retry = await supabase.from('profiles').update(updateFields).eq('id', req.user.id).select().single();
    data = retry.data; error = retry.error;
    if (!error && data) data = { ...data, role };
  }

  if (error) return res.status(500).json({ error: error.message });
  invalidateProfileCache(req.user.id);
  res.json(data);
});

// ════════════════════════════════════════════════════════════════════════════
// PAYMENTS ROUTER
// ════════════════════════════════════════════════════════════════════════════
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';

const PLANS = {
  solo_monthly:     { amount: 1200000,  name: 'Solo Monthly',     tier: 'solo',     planCode: 'PLN_l7ult7t4qd7mn1u', interval: 'monthly' },
  solo_annual:      { amount: 12000000, name: 'Solo Annual',      tier: 'solo',     planCode: 'PLN_ffqekbbt68cyp7r', interval: 'annually' },
  chambers_monthly: { amount: 2000000,  name: 'Chambers Monthly', tier: 'chambers', planCode: 'PLN_45dm51knapwa3co', interval: 'monthly' },
  chambers_annual:  { amount: 20000000, name: 'Chambers Annual',  tier: 'chambers', planCode: 'PLN_wjq8pwccb97xnqw', interval: 'annually' },
  solo:     { amount: 1200000,  tier: 'solo',     planCode: 'PLN_l7ult7t4qd7mn1u', interval: 'monthly' },
  chambers: { amount: 2000000,  tier: 'chambers', planCode: 'PLN_45dm51knapwa3co', interval: 'monthly' },
};

const paymentsRouter = express.Router();

// Webhook must use raw body — registered separately in server.js
paymentsRouter.post('/webhook-handler', async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(200).send('OK');
  const hash = crypto.createHmac('sha512', PAYSTACK_SECRET).update(req.body).digest('hex');
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
    console.log(`Webhook upgraded ${user_id} to ${resolvedTier}`);
  } catch (err) { console.log('Webhook error:', err.message); }
});

paymentsRouter.post('/initialize', requireAuth, async (req, res) => {
  const { plan } = req.body;
  if (!plan) return res.status(400).json({ error: 'Plan is required' });
  const planData = PLANS[plan];
  if (!planData) return res.status(400).json({ error: 'Invalid plan: ' + plan });
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY not configured' });
  try {
    const paystackRes = await httpsPost('api.paystack.co', '/transaction/initialize',
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PAYSTACK_SECRET}` },
      { email: req.user.email, amount: planData.amount, currency: 'NGN', plan: planData.planCode, metadata: { user_id: req.user.id, plan, plan_name: planData.name, tier: planData.tier, email: req.user.email }, channels: ['card', 'bank_transfer', 'ussd', 'bank'] }
    );
    const data = await readBody(paystackRes);
    if (!data.status) return res.status(400).json({ error: data.message || 'Paystack initialization failed' });
    res.json({ authorization_url: data.data.authorization_url, access_code: data.data.access_code, reference: data.data.reference });
  } catch (err) { res.status(500).json({ error: 'Payment initialization failed: ' + err.message }); }
});

paymentsRouter.get('/verify/:reference', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Payment not configured' });
  try {
    const paystackRes = await httpsGet('api.paystack.co', `/transaction/verify/${req.params.reference}`, { 'Authorization': `Bearer ${PAYSTACK_SECRET}` });
    const data = await readBody(paystackRes);
    if (!data.status || data.data.status !== 'success') return res.status(400).json({ error: 'Payment not successful' });
    const { user_id, plan } = data.data.metadata;
    const planData = PLANS[plan];
    if (!planData) return res.status(400).json({ error: 'Invalid plan in payment' });
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + (planData.interval === 'annually' ? 366 : 32));
    await supabase.from('profiles').update({ tier: planData.tier, tier_expiry: expiry.toISOString() }).eq('id', user_id);
    invalidateProfileCache(user_id);
    res.json({ success: true, tier: planData.tier });
  } catch (err) { res.status(500).json({ error: 'Verification failed: ' + err.message }); }
});

paymentsRouter.post('/cancel', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Payment not configured' });
  try {
    const { data: profile } = await supabase.from('profiles').select('subscription_code, email_token').eq('id', req.user.id).single();
    if (!profile?.subscription_code) return res.status(400).json({ error: 'No active subscription found' });
    const paystackRes = await httpsPost('api.paystack.co', '/subscription/disable',
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PAYSTACK_SECRET}` },
      { code: profile.subscription_code, token: profile.email_token }
    );
    const data = await readBody(paystackRes);
    if (!data.status) return res.status(400).json({ error: data.message || 'Failed to cancel' });
    await supabase.from('profiles').update({ auto_renew: false }).eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to cancel: ' + err.message }); }
});

paymentsRouter.post('/reactivate', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Payment not configured' });
  try {
    const { data: profile } = await supabase.from('profiles').select('subscription_code, email_token').eq('id', req.user.id).single();
    if (!profile?.subscription_code) return res.status(400).json({ error: 'No subscription found' });
    const paystackRes = await httpsPost('api.paystack.co', '/subscription/enable',
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PAYSTACK_SECRET}` },
      { code: profile.subscription_code, token: profile.email_token }
    );
    const data = await readBody(paystackRes);
    if (!data.status) return res.status(400).json({ error: data.message || 'Failed to reactivate' });
    await supabase.from('profiles').update({ auto_renew: true }).eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to reactivate: ' + err.message }); }
});

paymentsRouter.post('/bank-transfer', requireAuth, async (req, res) => {
  const { plan, amount, reference, email } = req.body;
  if (!plan || !amount || !reference) return res.status(400).json({ error: 'Missing required fields' });
  try {
    await supabase.from('profiles').update({
      pending_transfer: JSON.stringify({ plan, amount, reference, email, submitted_at: new Date().toISOString(), user_id: req.user.id, user_email: req.user.email })
    }).eq('id', req.user.id);
    await sendPaymentNotification({ email: req.user.email, plan, amount, reference, userId: req.user.id });
    console.log(`BANK TRANSFER: ${req.user.email} | ${plan} | NGN ${amount} | ref: ${reference}`);
    res.json({ success: true });
  } catch (err) {
    console.log('Bank transfer error:', err.message);
    res.json({ success: true });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE ROUTER
// ════════════════════════════════════════════════════════════════════════════
const knowledgeRouter = express.Router();

knowledgeRouter.get('/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const dbResults = await searchVerifiedCases(q, 12);
  res.json({
    results: dbResults.map(item => ({
      title: item.title, court: item.court, url: '',
      snippet: item.summary, source: 'Verified Nigerian case law database',
      isLink: false, isLocal: true,
    }))
  });
});

knowledgeRouter.get('/admin/search', requireAdmin, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [], count: 0, bankSize: getUnifiedKnowledgeBank().length });
  const results = searchKnowledgeBank(q, 12);
  res.json({ results, count: results.length, bankSize: getUnifiedKnowledgeBank().length });
});

knowledgeRouter.get('/admin/stats', requireAdmin, async (req, res) => {
  const corpusEntries = reloadDiskCorpus();
  const exported = exportTrainingCorpus();
  res.json({
    corpusEntries: corpusEntries.length,
    totalEntries: getUnifiedKnowledgeBank().length,
    trainingRows: exported,
  });
});

knowledgeRouter.post('/admin/reload', requireAdmin, async (req, res) => {
  const corpusEntries = reloadDiskCorpus();
  const trainingRows = exportTrainingCorpus();
  res.json({ success: true, corpusEntries: corpusEntries.length, trainingRows });
});

knowledgeRouter.post('/admin/import', requireAdmin, async (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  if (!records.length) return res.status(400).json({ error: 'records array is required' });
  const imported = appendCorpusRecords(records);
  const trainingRows = exportTrainingCorpus();
  res.json({ success: true, imported, totalEntries: getUnifiedKnowledgeBank().length, trainingRows });
});

// ════════════════════════════════════════════════════════════════════════════
// HEALTH ROUTER
// ════════════════════════════════════════════════════════════════════════════
const healthRouter = express.Router();

healthRouter.get('/', (req, res) => res.json({ status: 'ok', version: '5.0.0' }));
healthRouter.get('/config', (req, res) => res.json({ paystackPublicKey: PAYSTACK_PUBLIC_KEY }));

module.exports = { profileRouter, paymentsRouter, knowledgeRouter, healthRouter, PLANS };
