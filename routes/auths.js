'use strict';

const express = require('express');
const { supabase } = require('../services/supabase');

const router = express.Router();

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

router.post('/login', async (req, res) => {
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

router.post('/register', async (req, res) => {
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

router.post('/me', async (req, res) => {
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

module.exports = router;
