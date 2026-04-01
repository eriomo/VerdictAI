'use strict';

const express = require('express');

const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getUnifiedKnowledgeBank, reloadDiskCorpus, exportTrainingCorpus, appendCorpusRecords } = require('../services/corpus');
const { searchVerifiedCases, searchKnowledgeBank } = require('../services/grounding');

const router = express.Router();

router.get('/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const dbResults = await searchVerifiedCases(q, 12);
  return res.json({
    results: dbResults.map((item) => ({
      title: item.title,
      court: item.court,
      url: '',
      snippet: item.summary,
      source: 'Verified Nigerian case law database',
      isLink: false,
      isLocal: true,
    })),
  });
});

router.get('/admin/search', requireAdmin, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [], count: 0, bankSize: getUnifiedKnowledgeBank().length });
  const results = searchKnowledgeBank(q, 12);
  return res.json({ results, count: results.length, bankSize: getUnifiedKnowledgeBank().length });
});

router.get('/admin/stats', requireAdmin, async (req, res) => {
  const corpusEntries = reloadDiskCorpus();
  const exported = exportTrainingCorpus();
  return res.json({
    corpusEntries: corpusEntries.length,
    totalEntries: getUnifiedKnowledgeBank().length,
    trainingRows: exported,
  });
});

router.post('/admin/reload', requireAdmin, async (req, res) => {
  const corpusEntries = reloadDiskCorpus();
  const trainingRows = exportTrainingCorpus();
  return res.json({ success: true, corpusEntries: corpusEntries.length, trainingRows });
});

router.post('/admin/import', requireAdmin, async (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  if (!records.length) return res.status(400).json({ error: 'records array is required' });
  const imported = appendCorpusRecords(records);
  const trainingRows = exportTrainingCorpus();
  return res.json({ success: true, imported, totalEntries: getUnifiedKnowledgeBank().length, trainingRows });
});

module.exports = router;
