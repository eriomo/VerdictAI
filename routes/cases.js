'use strict';

/**
 * VERDICT AI — CASES ROUTE
 * Includes matter intelligence endpoints for context injection.
 * routes/cases.js
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { isUuid, stringOrEmpty } = require('../middleware/security');
const { supabase } = require('../services/supabase');
const { getMatterContext, updateMatterIntelligence } = require('../services/matter');
const { searchVerifiedCases } = require('../services/grounding');

// ── Case CRUD ─────────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('cases').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const { name, description, status } = req.body || {};
  const cleanName = stringOrEmpty(name);
  if (!cleanName) return res.status(400).json({ error: 'Case name is required' });
  const { data, error } = await supabase.from('cases')
    .insert({ user_id: req.user.id, name: cleanName, description: stringOrEmpty(description), status: stringOrEmpty(status) || 'active', created_at: new Date().toISOString() })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch('/:id', requireAuth, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Case not found' });
  const { name, description, status, notes } = req.body;
  const { data, error } = await supabase.from('cases')
    .update({ name: stringOrEmpty(name), description: stringOrEmpty(description), status: stringOrEmpty(status), notes: stringOrEmpty(notes) })
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error || !data) return res.status(404).json({ error: 'Case not found' });
  res.json(data);
});

router.delete('/:id', requireAuth, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Case not found' });
  const { error } = await supabase.from('cases').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Matter Intelligence ───────────────────────────────────────────────────────
router.get('/:id/context', requireAuth, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Matter not found' });
  const context = await getMatterContext(req.params.id, req.user.id);
  if (!context) return res.status(404).json({ error: 'Matter not found' });
  res.json(context);
});

router.patch('/:id/intelligence', requireAuth, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Matter not found' });
  try {
    const data = await updateMatterIntelligence(req.params.id, req.user.id, req.body);
    if (!data) return res.status(404).json({ error: 'Matter not found' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Case search ───────────────────────────────────────────────────────────────
router.get('/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const results = await searchVerifiedCases(q, 12);
  res.json({
    results: results.map(item => ({
      title: item.title, court: item.court, url: '',
      snippet: item.summary, source: 'Verified Nigerian case law database',
      isLink: false, isLocal: true,
    }))
  });
});

module.exports = router;
