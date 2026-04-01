'use strict';

/**
 * VERDICT AI — GROUNDING SERVICE
 * Retrieves verified cases from Supabase and builds the grounding context.
 * This is the most critical quality component — what the model sees determines what it outputs.
 * services/grounding.js
 */

const { supabase } = require('./supabase');
const { getUnifiedKnowledgeBank, tokenize, slugify } = require('./corpus');

// Tools that receive database grounding — essentially everything
const KNOWLEDGE_TOOLS = new Set([
  'reader', 'docanalysis', 'analysis', 'warroom', 'clausedna', 'opposing', 'strength',
  'courtpredictor', 'draft', 'briefscore', 'crossexam', 'motionammo', 'claimanalyser',
  'clientprep', 'digest', 'legalmemo', 'pleadingcheck', 'statute', 'deadlines',
  'nigeriancases', 'qa', 'negotiation', 'correspondence', 'whatsapp', 'feenote',
  'intakememo', 'clientreport', 'explainer', 'jurisdiction', 'compliancecal',
  'precedent', 'seniorpartner', 'witness', 'evidence', 'settlement',
  'contradiction_detector', 'timeline_extractor', 'obligation_extractor',
  'risk_delta', 'letter_chain', 'brief_builder', 'precedent_matcher',
  'problem_analyzer', 'case_explainer', 'moot_prep', 'assignment_reviewer',
  'doctrine_tracker', 'legal_health_check', 'contract_plain', 'contract_playbook',
  'regulatory_radar', 'board_paper_reviewer', 'judgment_composer', 'court_order',
  'case_summary_judge', 'issue_spotter', 'quick_ruling', 'bail_decision',
  'warrant_drafter', 'sentencing_guide', 'clerk_filing', 'clerk_classify',
  'bill_drafter', 'law_comparison', 'law_simplifier', 'impact_assessment',
  'paralegal_research', 'pleadingcheck', 'matterclock',
]);

// ── Scoring ───────────────────────────────────────────────────────────────────
function scoreEntry(entry, tokens, rawQuery) {
  const q = String(rawQuery || '').toLowerCase().trim();
  const title = String(entry.title || '').toLowerCase();
  const citation = String(entry.citation || entry.authority || '').toLowerCase();
  const court = String(entry.court || '').toLowerCase();
  const category = String(entry.category || '').toLowerCase();
  const keywords = (entry.keywords || []).map(k => String(k).toLowerCase());
  const haystack = [entry.title, entry.citation, entry.court, entry.category, entry.summary, ...(entry.keywords || []), entry.authority].join(' ').toLowerCase();

  let score = 0;

  // Token-level scoring
  for (const t of tokens) {
    if (title.includes(t)) score += 8;
    if (citation.includes(t)) score += 12;
    if (court.includes(t)) score += 5;
    if (category.includes(t)) score += 4;
    if (keywords.some(k => k.includes(t))) score += 6;
    if ((entry.summary || '').toLowerCase().includes(t)) score += 3;
    if ((entry.holding || '').toLowerCase().includes(t)) score += 4;
  }

  // Phrase-level bonuses
  if (q && title === q) score += 35;
  if (q && citation === q) score += 45;
  if (q && haystack.includes(q)) score += 10;
  if (tokens.length > 1 && tokens.every(t => title.includes(t))) score += 20;
  if (tokens.length > 1 && tokens.every(t => citation.includes(t))) score += 25;

  return score;
}

// ── Database case normalization ───────────────────────────────────────────────
function normalizeCase(row) {
  if (!row || typeof row !== 'object') return null;
  const title = [row.case_title, row.case_name, row.title, row.name].map(v => (v || '').trim()).find(Boolean);
  if (!title) return null;

  const summary = [row.outcome, row.summary, row.holding, row.headnote, row.snippet, row.chunk_text, row.body, row.raw_text, row.judgment_text, row.parties]
    .map(v => (v || '').trim()).find(Boolean) || `${title}${row.citation ? ' (' + row.citation + ')' : ''}`;

  const keywords = Array.isArray(row.keywords)
    ? row.keywords.map(k => (k || '').trim()).filter(Boolean)
    : tokenize(`${row.legal_subjects || ''} ${row.parties || ''} ${title} ${summary}`).slice(0, 16);

  return {
    id: `vc-${(row.id || '').toString() || slugify(title)}`,
    title, category: (row.legal_subjects || row.category || row.area_of_law || 'Nigerian Case Law').trim(),
    summary: summary.trim(),
    keywords,
    authority: (row.citation || row.neutral_citation || `${title} (Verdict AI DB)`).trim(),
    sourceType: 'supabase-case',
    court: (row.court || 'Nigerian Courts').trim(),
    citation: (row.citation || row.neutral_citation || '').trim(),
    decisionDate: (row.date || row.decision_date || row.date_delivered || '').trim(),
    holding: (row.outcome || row.holding || row.headnote || '').trim(),
    // Increased from 400 to 1500 characters — the ratio is usually in the middle
    fullText: (row.chunk_text || row.full_text || row.judgment_text || '').trim().slice(0, 1500),
    parties: (row.parties || '').trim(),
    judges: (row.judges || '').trim(),
    sourcePriority: Number.isFinite(Number(row.source_priority)) ? Number(row.source_priority) : 1,
    isVerified: row.is_verified !== false,
    chunkIndex: Number.isFinite(Number(row.chunk_index)) ? Number(row.chunk_index) : null,
    isLocal: true,
    isLink: false,
  };
}

// ── Database search ───────────────────────────────────────────────────────────
async function searchVerifiedCases(query, limit = 10) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  try {
    // Targeted filter using top tokens
    const searchTerms = tokens.slice(0, 5);
    const filters = searchTerms.map(t =>
      `case_title.ilike.%${t}%,citation.ilike.%${t}%,court.ilike.%${t}%,legal_subjects.ilike.%${t}%`
    ).join(',');

    let { data: cases, error } = await supabase
      .from('verdict_cases')
      .select('*')
      .or(filters)
      .limit(400);

    if (error) {
      // Fallback to recent cases
      const { data: fallback } = await supabase.from('verdict_cases').select('*').limit(400);
      cases = fallback || [];
    }

    // Supplement if results are thin
    if ((cases || []).length < 30) {
      const { data: extra } = await supabase.from('verdict_cases').select('*').limit(400);
      const extraFiltered = (extra || []).filter(r => !(cases || []).find(c => c.id === r.id));
      cases = [...(cases || []), ...extraFiltered];
    }

    return scoreCases(cases || [], tokens, query, limit);
  } catch (e) {
    console.log(`[GROUNDING] DB search error: ${e.message}`);
    return [];
  }
}

function scoreCases(rows, tokens, rawQuery, limit) {
  // Deduplicate and merge chunks
  const caseMap = new Map();
  for (const row of rows) {
    const c = normalizeCase(row);
    if (!c) continue;
    const key = `${c.title}|${c.citation}|${c.court}`.toLowerCase();
    const existing = caseMap.get(key);
    if (!existing) {
      caseMap.set(key, { ...c, chunks: c.fullText ? [c.fullText] : [] });
      continue;
    }
    if (c.summary && !existing.summary.includes(c.summary.slice(0, 50))) {
      existing.summary = `${existing.summary}\n${c.summary}`.trim();
    }
    if (c.holding && !existing.holding.includes(c.holding.slice(0, 50))) {
      existing.holding = `${existing.holding}\n${c.holding}`.trim();
    }
    if (c.fullText) existing.chunks.push(c.fullText);
    existing.keywords = [...new Set([...existing.keywords, ...c.keywords])];
  }

  return [...caseMap.values()]
    .map(entry => {
      const baseScore = scoreEntry({ ...entry, summary: `${entry.summary} ${entry.holding}` }, tokens, rawQuery);
      const chunkBonus = Math.min(entry.chunks.length * 8, 40);
      const verifiedBonus = entry.isVerified ? 20 : 0;
      const priorityBonus = Math.max(0, 6 - entry.sourcePriority) * 4;
      return { entry, score: baseScore + chunkBonus + verifiedBonus + priorityBonus };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

// ── Knowledge bank search ─────────────────────────────────────────────────────
function searchKnowledgeBank(query, limit = 5) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  return getUnifiedKnowledgeBank()
    .map(entry => ({ entry, score: scoreEntry(entry, tokens, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

// ── Grounding context builder ─────────────────────────────────────────────────
async function getGroundingBundle(query, toolId) {
  if (!KNOWLEDGE_TOOLS.has(toolId)) return { context: '', matches: [] };

  const [dbCases, kbEntries] = await Promise.all([
    searchVerifiedCases(query, 10),
    Promise.resolve(searchKnowledgeBank(query, 5)),
  ]);

  // Merge, deduplicate
  const seen = new Set();
  const matches = [...dbCases, ...kbEntries].filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 12);

  if (!matches.length) return { context: '', matches: [] };

  const dbCount = matches.filter(m => m.sourceType === 'supabase-case').length;

  const blocks = matches.map((m, i) => {
    const titleLine = m.citation
      ? `${m.title} | ${m.citation} | ${m.court} | ${m.decisionDate || 'Date not stored'}`
      : `${m.title} — ${m.court}`;

    const parts = [
      `[${i + 1}] ${titleLine}`,
      m.parties ? `Parties: ${m.parties}` : null,
      `Area: ${m.category}`,
      `Summary: ${m.summary}`,
      m.holding ? `Holding: ${m.holding}` : null,
      // Full text excerpt — 1500 chars for rich grounding
      (m.fullText && m.fullText.length > 30) ? `Excerpt from judgment: ${m.fullText.slice(0, 1500)}` : null,
    ].filter(Boolean).join('\n');

    return parts;
  }).join('\n\n');

  const context = `=== VERDICT AI VERIFIED NIGERIAN LEGAL DATABASE ===
${dbCount} verified Nigerian court decisions | ${matches.length - dbCount} research entries

${blocks}

=== MANDATORY DATABASE REASONING PROTOCOL ===

You have real Nigerian court decisions above. Apply them like a Senior Advocate, not a student.

STEP 1 — FIND THE CONTROLLING AUTHORITY:
Which case above most directly governs the specific legal issue before you? Name it immediately — full case name and citation.

STEP 2 — STATE THE RATIO:
From that controlling case, extract the precise legal principle that decides this point. One sentence. Every word matters.

STEP 3 — APPLY IT:
Apply the ratio to the specific facts in the user's input. Show the chain explicitly: "Since [case] established that [ratio], and the present facts show [specific fact], it therefore follows that [specific legal outcome]."

STEP 4 — CONVERGING AUTHORITY:
Where multiple database cases support the same point, cite all of them. Convergence of authority is strength.

STEP 5 — HANDLE GAPS HONESTLY:
If no database case directly covers a specific point, state: "The verified database does not contain a case that directly addresses [point]." Then apply the relevant statute or established common law doctrine. Never invent a citation to fill a gap.

CITATION FORMAT: Case Name v Case Name [Year] Volume NWLR (Part) Page. Use this format for every case citation. No shortcuts.
=== END DATABASE SECTION ===`;

  return { context, matches };
}

module.exports = {
  getGroundingBundle,
  searchVerifiedCases,
  searchKnowledgeBank,
  KNOWLEDGE_TOOLS,
};
