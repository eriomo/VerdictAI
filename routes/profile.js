'use strict';

const express = require('express');

const { requireAuth } = require('../middleware/auth');
const { supabase, invalidateProfileCache } = require('../services/supabase');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ...data, email: req.user.email });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/', requireAuth, async (req, res) => {
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

  if (error && role !== undefined && /Could not find the 'role' column/i.test(error.message || '')) {
    delete updateFields.role;
    if (!Object.keys(updateFields).length) {
      const retry = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
      if (retry.error) return res.status(500).json({ error: retry.error.message });
      return res.json({ ...retry.data, role });
    }
    const retry = await supabase.from('profiles').update(updateFields).eq('id', req.user.id).select().single();
    data = retry.data;
    error = retry.error;
    if (!error && data) data = { ...data, role };
  }

  if (error) return res.status(500).json({ error: error.message });
  invalidateProfileCache(req.user.id);
  return res.json(data);
});

module.exports = router;
