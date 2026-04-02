'use strict';

/**
 * VERDICT AI — DOCUMENTS ROUTE
 * routes/documents.js
 */

const express = require('express');
const router = express.Router();
const { requireAuth, isUuid, stringOrEmpty } = require('../middleware');
const { supabase } = require('../services/supabase');

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('documents').select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:id', requireAuth, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Document not found' });
  const { data, error } = await supabase
    .from('documents').select('*')
    .eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (error || !data) return res.status(404).json({ error: 'Document not found' });
  res.json(data);
});

router.post('/', requireAuth, async (req, res) => {
  const { name, content, analysis, type } = req.body || {};
  const cleanName = stringOrEmpty(name);
  const cleanContent = typeof content === 'string' ? content : '';
  if (!cleanName || !cleanContent) return res.status(400).json({ error: 'Document name and content are required' });
  if (Buffer.byteLength(cleanContent, 'utf8') > 1024 * 1024) return res.status(413).json({ error: 'Document content exceeds 1MB limit' });
  const { data, error } = await supabase.from('documents')
    .insert({ user_id: req.user.id, name: cleanName, content: cleanContent, analysis, type, created_at: new Date().toISOString() })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Document not found' });
  const { data: existing } = await supabase.from('documents').select('id').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (!existing) return res.status(404).json({ error: 'Document not found' });
  const { error } = await supabase.from('documents').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
