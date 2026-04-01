'use strict';

const express = require('express');
const crypto = require('crypto');

const { requireAuth } = require('../middleware/auth');
const { supabase, invalidateProfileCache } = require('../services/supabase');
const { httpsPost, httpsGet, readBody } = require('../services/groq');
const { sendPaymentNotification } = require('../services/email');

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

const PLANS = {
  solo_monthly: { amount: 1200000, name: 'Solo Monthly', tier: 'solo', planCode: 'PLN_l7ult7t4qd7mn1u', interval: 'monthly' },
  solo_annual: { amount: 12000000, name: 'Solo Annual', tier: 'solo', planCode: 'PLN_ffqekbbt68cyp7r', interval: 'annually' },
  chambers_monthly: { amount: 2000000, name: 'Chambers Monthly', tier: 'chambers', planCode: 'PLN_45dm51knapwa3co', interval: 'monthly' },
  chambers_annual: { amount: 20000000, name: 'Chambers Annual', tier: 'chambers', planCode: 'PLN_wjq8pwccb97xnqw', interval: 'annually' },
  solo: { amount: 1200000, tier: 'solo', planCode: 'PLN_l7ult7t4qd7mn1u', interval: 'monthly' },
  chambers: { amount: 2000000, tier: 'chambers', planCode: 'PLN_45dm51knapwa3co', interval: 'monthly' },
};

const router = express.Router();

router.post('/webhook-handler', async (req, res) => {
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
  } catch (error) {
    console.log('Webhook error:', error.message);
  }
});

router.post('/initialize', requireAuth, async (req, res) => {
  const { plan } = req.body;
  if (!plan) return res.status(400).json({ error: 'Plan is required' });
  const planData = PLANS[plan];
  if (!planData) return res.status(400).json({ error: `Invalid plan: ${plan}` });
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY not configured' });

  try {
    const paystackRes = await httpsPost(
      'api.paystack.co',
      '/transaction/initialize',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${PAYSTACK_SECRET}` },
      {
        email: req.user.email,
        amount: planData.amount,
        currency: 'NGN',
        plan: planData.planCode,
        metadata: { user_id: req.user.id, plan, plan_name: planData.name, tier: planData.tier, email: req.user.email },
        channels: ['card', 'bank_transfer', 'ussd', 'bank'],
      }
    );
    const data = await readBody(paystackRes);
    if (!data.status) return res.status(400).json({ error: data.message || 'Paystack initialization failed' });
    return res.json({
      authorization_url: data.data.authorization_url,
      access_code: data.data.access_code,
      reference: data.data.reference,
    });
  } catch (error) {
    return res.status(500).json({ error: `Payment initialization failed: ${error.message}` });
  }
});

router.get('/verify/:reference', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Payment not configured' });
  try {
    const paystackRes = await httpsGet('api.paystack.co', `/transaction/verify/${req.params.reference}`, { Authorization: `Bearer ${PAYSTACK_SECRET}` });
    const data = await readBody(paystackRes);
    if (!data.status || data.data.status !== 'success') return res.status(400).json({ error: 'Payment not successful' });

    const { user_id, plan } = data.data.metadata;
    const planData = PLANS[plan];
    if (!planData) return res.status(400).json({ error: 'Invalid plan in payment' });

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + (planData.interval === 'annually' ? 366 : 32));
    await supabase.from('profiles').update({ tier: planData.tier, tier_expiry: expiry.toISOString() }).eq('id', user_id);
    invalidateProfileCache(user_id);
    return res.json({ success: true, tier: planData.tier });
  } catch (error) {
    return res.status(500).json({ error: `Verification failed: ${error.message}` });
  }
});

router.post('/cancel', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Payment not configured' });
  try {
    const { data: profile } = await supabase.from('profiles').select('subscription_code, email_token').eq('id', req.user.id).single();
    if (!profile?.subscription_code) return res.status(400).json({ error: 'No active subscription found' });

    const paystackRes = await httpsPost(
      'api.paystack.co',
      '/subscription/disable',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${PAYSTACK_SECRET}` },
      { code: profile.subscription_code, token: profile.email_token }
    );
    const data = await readBody(paystackRes);
    if (!data.status) return res.status(400).json({ error: data.message || 'Failed to cancel' });

    await supabase.from('profiles').update({ auto_renew: false }).eq('id', req.user.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: `Failed to cancel: ${error.message}` });
  }
});

router.post('/reactivate', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Payment not configured' });
  try {
    const { data: profile } = await supabase.from('profiles').select('subscription_code, email_token').eq('id', req.user.id).single();
    if (!profile?.subscription_code) return res.status(400).json({ error: 'No subscription found' });

    const paystackRes = await httpsPost(
      'api.paystack.co',
      '/subscription/enable',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${PAYSTACK_SECRET}` },
      { code: profile.subscription_code, token: profile.email_token }
    );
    const data = await readBody(paystackRes);
    if (!data.status) return res.status(400).json({ error: data.message || 'Failed to reactivate' });

    await supabase.from('profiles').update({ auto_renew: true }).eq('id', req.user.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: `Failed to reactivate: ${error.message}` });
  }
});

router.post('/bank-transfer', requireAuth, async (req, res) => {
  const { plan, amount, reference, email } = req.body;
  if (!plan || !amount || !reference) return res.status(400).json({ error: 'Missing required fields' });

  try {
    await supabase.from('profiles').update({
      pending_transfer: JSON.stringify({
        plan,
        amount,
        reference,
        email,
        submitted_at: new Date().toISOString(),
        user_id: req.user.id,
        user_email: req.user.email,
      }),
    }).eq('id', req.user.id);

    await sendPaymentNotification({ email: req.user.email, plan, amount, reference, userId: req.user.id });
    return res.json({ success: true });
  } catch (error) {
    console.log('Bank transfer error:', error.message);
    return res.json({ success: true });
  }
});

module.exports = {
  router,
  PLANS,
};
