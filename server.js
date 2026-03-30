const express = require('express');
const cors = require('cors');
const fs = require('fs');
const http = require('http');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// â”€â”€ FIX #1: CORS must be FIRST  -  before rate limiter, before everything â”€â”€â”€â”€â”€â”€â”€â”€
// Previously cors() was after the rate limiter. When the rate limiter fired a 429,
// no CORS headers were attached, so the browser blocked the response entirely,
// causing every subsequent request to return "Status 0" instead of 429.
// This was the root cause of ALL the Status 0 failures in the stress test.
const corsOptions = {
  origin: true,            // reflect the request origin (allows all)
  credentials: true,
  methods: 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  allowedHeaders: 'Content-Type,Authorization',
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // handle ALL preflight requests immediately

// â”€â”€ Security headers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://js.paystack.co; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://paystack.com; style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://paystack.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https: blob:; manifest-src 'self'; connect-src 'self' https://api.groq.com https://openrouter.ai https://api.anthropic.com https://verdictai.com.ng https://api.paystack.co https://checkout.paystack.com https://*.supabase.co wss://*.supabase.co https://unpkg.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; frame-src 'self' https://js.paystack.co https://checkout.paystack.com; worker-src 'self' blob:;"
  );
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// â”€â”€ Rate limiting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FIX #2: Every 429 response now explicitly sets Access-Control-Allow-Origin
// so the browser can read the status code instead of blocking it as a CORS error.
const ipRequests  = new Map();
const userAiCalls = new Map();
const aiResponseCache = new Map();
const AI_CACHE_TTL = 6 * 60 * 60 * 1000;

function getIP(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0] : req.socket?.remoteAddress || 'unknown').trim();
}

function rateLimit(store, key, limit, windowMs) {
  const now = Date.now();
  let r = store.get(key);
  if (!r || now > r.resetAt) { r = { count: 0, resetAt: now + windowMs }; store.set(key, r); }
  r.count++;
  return { allowed: r.count <= limit, count: r.count, limit };
}

// 60 req/min per IP on all /api/* routes
app.use('/api', (req, res, next) => {
  const ip = getIP(req);
  const { allowed, count, limit } = rateLimit(ipRequests, `ip:${ip}`, 240, 60_000);
  if (!allowed) {
    console.log(`[RATE] IP ${ip} exceeded ${limit} req/min (count: ${count})`);
    // FIX #2: CORS header on 429  -  without this, browser sees Status 0 not 429
    res.setHeader('Retry-After', '60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
  }
  next();
});

// Clean stale rate limit entries every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ipRequests)  if (now > v.resetAt) ipRequests.delete(k);
  for (const [k, v] of userAiCalls) if (now > v.resetAt) userAiCalls.delete(k);
}, 5 * 60_000);

// â”€â”€ Body parsing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Webhook must use raw body (must come before express.json)
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (!err) return next();
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }
  return next(err);
});

// â”€â”€ Profile cache (60s TTL) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const profileCache = new Map();
const PROFILE_CACHE_TTL = 60_000;

async function getCachedProfile(userId) {
  const cached = profileCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.profile;
  const { data } = await supabase
    .from('profiles').select('tier, usage_count, usage_reset_date, tier_expiry')
    .eq('id', userId).single();
  if (data) profileCache.set(userId, { profile: data, expiresAt: Date.now() + PROFILE_CACHE_TTL });
  return data;
}

function invalidateProfileCache(userId) {
  profileCache.delete(userId);
  profileCache.delete(userId + '_full');
}

function getCachedAiResponse(cacheKey) {
  const cached = aiResponseCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    aiResponseCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedAiResponse(cacheKey, value) {
  if (!cacheKey || !value) return;
  aiResponseCache.set(cacheKey, { value, expiresAt: Date.now() + AI_CACHE_TTL });
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

const DISCLAIMER = '\n\nDISCLAIMER: This analysis is for informational purposes only and does not constitute legal advice. It is grounded in verified Nigerian case law in our database and should still be reviewed with professional judgment before reliance in proceedings.';

const PLANS = {
  solo_monthly:     { amount: 1200000,  name: 'Solo Monthly',     tier: 'solo',     planCode: 'PLN_l7ult7t4qd7mn1u', interval: 'monthly' },
  solo_annual:      { amount: 12000000, name: 'Solo Annual',      tier: 'solo',     planCode: 'PLN_ffqekbbt68cyp7r', interval: 'annually' },
  chambers_monthly: { amount: 2000000,  name: 'Chambers Monthly', tier: 'chambers', planCode: 'PLN_45dm51knapwa3co', interval: 'monthly' },
  chambers_annual:  { amount: 20000000, name: 'Chambers Annual',  tier: 'chambers', planCode: 'PLN_wjq8pwccb97xnqw', interval: 'annually' },
  // Legacy keys
  solo:     { amount: 1200000,  name: 'Solo Monthly',     tier: 'solo',     planCode: 'PLN_l7ult7t4qd7mn1u', interval: 'monthly' },
  chambers: { amount: 2000000,  name: 'Chambers Monthly', tier: 'chambers', planCode: 'PLN_45dm51knapwa3co', interval: 'monthly' },
};

const DATA_DIR = path.join(__dirname, 'data');
const LEGAL_CORPUS_FILE = path.join(DATA_DIR, 'legal-corpus.ndjson');
const TRAINING_EXPORT_FILE = path.join(DATA_DIR, 'training-corpus.jsonl');
const ADMIN_SECRET = stringOrEmpty(process.env.ADMIN_SECRET);
const SELF_HOSTED_MODEL_URL = stringOrEmpty(process.env.SELF_HOSTED_MODEL_URL);
const SELF_HOSTED_MODEL_NAME = stringOrEmpty(process.env.SELF_HOSTED_MODEL_NAME || 'verdict-private-legal');
const SELF_HOSTED_MODEL_API_KEY = stringOrEmpty(process.env.SELF_HOSTED_MODEL_API_KEY);

const KNOWLEDGE_TOOLS = new Set([
  'qa', 'nigeriancases', 'statute', 'legalmemo', 'digest', 'paralegal_research',
  'reader', 'precedent', 'compliancecal', 'warroom', 'crossexam', 'motionammo',
  'claimanalyser', 'clientprep', 'seniorpartner', 'witness', 'evidence',
  'settlement', 'draft', 'negotiation', 'whatsapp', 'judgment_composer',
  'court_order', 'case_summary_judge', 'issue_spotter', 'quick_ruling',
  'bail_decision', 'warrant_drafter', 'sentencing_guide', 'clerk_filing',
  'clerk_classify', 'bill_drafter', 'law_comparison', 'law_simplifier',
  'impact_assessment', 'opposing', 'pleadings', 'clausedna', 'matterclock'
]);

const LEGAL_KNOWLEDGE_BANK = [
  {
    id: 'kb-contract-breach',
    title: 'Breach of contract dispute research starter',
    category: 'Commercial Litigation',
    summary: 'Start with contract formation, express terms, breach facts, damages, mitigation, notice requirements, limitation issues, and dispute resolution clauses.',
    keywords: ['breach of contract', 'agreement', 'damages', 'repudiation', 'specific performance', 'commercial litigation'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-land-title',
    title: 'Land title and ownership verification checklist',
    category: 'Property',
    summary: 'Trace root of title, governor consent issues, survey plan consistency, registered instruments, possession history, encumbrances, and competing equitable interests.',
    keywords: ['land', 'title', 'governor consent', 'survey', 'property', 'deed of assignment', 'ownership'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-cama-governance',
    title: 'CAMA governance and filing review',
    category: 'Corporate',
    summary: 'Review incorporation status, directors, share structure, board resolutions, annual returns, beneficial ownership disclosures, and compliance filings.',
    keywords: ['cama', 'company', 'board resolution', 'annual returns', 'shareholder', 'corporate affairs commission', 'cac'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-employment-termination',
    title: 'Employment termination and workplace dispute guide',
    category: 'Employment',
    summary: 'Separate statutory employment from master-servant relationships, check notice provisions, disciplinary process, redundancy steps, and unpaid benefits claims.',
    keywords: ['employment', 'termination', 'wrongful dismissal', 'notice', 'redundancy', 'labour'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-evidence-documents',
    title: 'Documentary evidence reliability review',
    category: 'Evidence',
    summary: 'Check authenticity, foundation, chain of custody, hearsay risks, certification, electronic evidence requirements, and contradictions with pleadings.',
    keywords: ['evidence', 'document', 'electronic evidence', 'certification', 'proof', 'admissibility'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-criminal-bail',
    title: 'Bail application issue map',
    category: 'Criminal Procedure',
    summary: 'Assess severity of offence, flight risk, interference with witnesses, previous compliance with bail terms, health factors, and interests of justice.',
    keywords: ['bail', 'criminal', 'flight risk', 'witness interference', 'magistrate', 'custody'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-jurisdiction',
    title: 'Jurisdiction challenge checklist',
    category: 'Procedure',
    summary: 'Confirm subject matter jurisdiction, territorial competence, cause of action venue, mandatory pre-action steps, limitation periods, and forum clauses.',
    keywords: ['jurisdiction', 'venue', 'pre-action', 'limitation', 'forum', 'competence'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-injunction',
    title: 'Interlocutory injunction research frame',
    category: 'Procedure',
    summary: 'Organize evidence around serious question to be tried, balance of convenience, urgency, preservation of res, and undertaking as to damages.',
    keywords: ['injunction', 'interlocutory', 'undertaking as to damages', 'balance of convenience', 'urgent relief'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-arbitration',
    title: 'Arbitration clause and stay analysis',
    category: 'ADR',
    summary: 'Check clause scope, validity, carve-outs, waiver by steps in proceedings, seat, rules, and whether the dispute is arbitrable.',
    keywords: ['arbitration', 'stay of proceedings', 'clause', 'adr', 'seat', 'waiver'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-tax-compliance',
    title: 'Tax compliance and enforcement issue map',
    category: 'Tax',
    summary: 'Review registration status, filing history, assessment notices, penalties, audit trail, withholding tax issues, VAT position, and objection timelines.',
    keywords: ['tax', 'firs', 'vat', 'withholding tax', 'assessment', 'penalty', 'objection'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-data-protection',
    title: 'Data protection compliance review',
    category: 'Compliance',
    summary: 'Map personal data flows, lawful basis, retention, processor contracts, cross-border transfer controls, and incident response obligations.',
    keywords: ['data protection', 'privacy', 'ndpa', 'personal data', 'processor', 'breach'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-banking-regulation',
    title: 'Banking and financial services regulatory review',
    category: 'Financial Regulation',
    summary: 'Check licensing status, customer mandate issues, AML controls, circular compliance, account restrictions, and regulator reporting expectations.',
    keywords: ['banking', 'cbn', 'aml', 'mandate', 'financial regulation', 'compliance'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-ip-license',
    title: 'Intellectual property and licensing issues',
    category: 'Intellectual Property',
    summary: 'Identify ownership chain, scope of licensed rights, infringement indicators, exclusivity, royalties, termination triggers, and confidentiality overlap.',
    keywords: ['copyright', 'trademark', 'license', 'royalty', 'infringement', 'software license'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-company-search',
    title: 'Corporate verification through CAC and filings',
    category: 'Corporate',
    summary: 'Use CAC to verify registration, directors, status, name changes, share capital basics, and whether the entity can lawfully contract or sue.',
    keywords: ['cac', 'company search', 'registration', 'directors', 'corporate status', 'incorporation'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-verified-db-workflow',
    title: 'Verified database research workflow',
    category: 'Research Source',
    summary: 'Search by party name, citation, issue, statute, or court and ground the analysis in verified Nigerian case law stored in our database.',
    keywords: ['verified database', 'nigerian case law', 'citation', 'party name', 'court', 'issue'],
    authority: 'Verdict AI database workflow',
    sourceType: 'internal',
  },
  {
    id: 'kb-pleadings-check',
    title: 'Pleadings consistency review',
    category: 'Litigation',
    summary: 'Check parties, dates, reliefs, capacities, document references, jurisdiction paragraphs, contradictions, and whether facts support every remedy sought.',
    keywords: ['pleadings', 'statement of claim', 'defence', 'reliefs', 'contradiction', 'litigation'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-company-compliance',
    title: 'Company compliance calendar foundations',
    category: 'Compliance',
    summary: 'Track annual returns, board and shareholder approvals, tax deadlines, sector filings, licence renewals, and evidence of internal approvals.',
    keywords: ['compliance calendar', 'annual returns', 'licence renewal', 'tax deadline', 'board approval'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
  {
    id: 'kb-legal-memo',
    title: 'Legal memorandum evidence ladder',
    category: 'Research',
    summary: 'Build research memos from issue framing, governing statute, authority search plan, strongest supporting facts, contrary authorities, and practical recommendations.',
    keywords: ['legal memo', 'research memorandum', 'issue framing', 'authority', 'recommendation'],
    authority: 'Internal research guide',
    sourceType: 'internal',
  },
];

const diskCorpusCache = {
  loadedAt: 0,
  entries: [],
};

function ensureCorpusFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LEGAL_CORPUS_FILE)) fs.writeFileSync(LEGAL_CORPUS_FILE, '', 'utf8');
  if (!fs.existsSync(TRAINING_EXPORT_FILE)) fs.writeFileSync(TRAINING_EXPORT_FILE, '', 'utf8');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `record-${Date.now()}`;
}

function sanitizeCorpusRecord(record, index = 0) {
  if (!record || typeof record !== 'object') return null;
  const title = stringOrEmpty(record.title);
  const summary = stringOrEmpty(record.summary || record.holding || record.snippet);
  if (!title || !summary) return null;

  return {
    id: stringOrEmpty(record.id) || slugify(`${title}-${record.citation || index}`),
    title,
    category: stringOrEmpty(record.category || 'Case Law'),
    summary,
    keywords: Array.isArray(record.keywords)
      ? record.keywords.map(stringOrEmpty).filter(Boolean)
      : tokenizeSearchText(`${title} ${summary}`).slice(0, 12),
    authority: stringOrEmpty(record.authority || record.citation || record.source || 'Imported legal record'),
    sourceType: stringOrEmpty(record.sourceType || 'corpus'),
    court: stringOrEmpty(record.court || 'Nigerian Courts'),
    citation: stringOrEmpty(record.citation),
    decisionDate: stringOrEmpty(record.decisionDate || record.decision_date),
    url: stringOrEmpty(record.url),
    holding: stringOrEmpty(record.holding),
  };
}

function reloadDiskCorpus() {
  ensureCorpusFiles();
  const content = fs.readFileSync(LEGAL_CORPUS_FILE, 'utf8');
  const entries = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const clean = sanitizeCorpusRecord(parsed, index);
      if (clean) entries.push(clean);
    } catch (error) {
      console.log(`Corpus parse warning on line ${index + 1}: ${error.message}`);
    }
  }
  diskCorpusCache.loadedAt = Date.now();
  diskCorpusCache.entries = entries;
  return entries;
}

function getUnifiedKnowledgeBank() {
  if (!diskCorpusCache.loadedAt) reloadDiskCorpus();
  return [...diskCorpusCache.entries, ...LEGAL_KNOWLEDGE_BANK];
}

function appendCorpusRecords(records) {
  ensureCorpusFiles();
  const cleaned = records.map((record, index) => sanitizeCorpusRecord(record, index)).filter(Boolean);
  if (!cleaned.length) return 0;
  const existingIds = new Set(getUnifiedKnowledgeBank().map((entry) => entry.id));
  const fresh = cleaned.filter((entry) => !existingIds.has(entry.id));
  if (!fresh.length) return 0;
  fs.appendFileSync(LEGAL_CORPUS_FILE, fresh.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
  reloadDiskCorpus();
  return fresh.length;
}

function exportTrainingCorpus() {
  ensureCorpusFiles();
  const records = getUnifiedKnowledgeBank()
    .filter((entry) => entry.sourceType === 'corpus')
    .map((entry) => JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a Nigerian legal research model. Use only the supplied authority and do not invent cases.' },
        { role: 'user', content: `Summarize the authority and core holding of ${entry.title}${entry.citation ? ` (${entry.citation})` : ''}.` },
        { role: 'assistant', content: `${entry.summary}${entry.holding ? `\n\nHolding: ${entry.holding}` : ''}` }
      ],
      metadata: {
        id: entry.id,
        title: entry.title,
        citation: entry.citation,
        court: entry.court,
        authority: entry.authority,
      }
    }));
  fs.writeFileSync(TRAINING_EXPORT_FILE, records.join('\n') + (records.length ? '\n' : ''), 'utf8');
  return records.length;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET) return res.status(503).json({ error: 'ADMIN_SECRET is not configured' });
  const provided = stringOrEmpty(req.headers['x-admin-secret']);
  if (!provided || provided !== ADMIN_SECRET) return res.status(403).json({ error: 'Admin access denied' });
  next();
}

function hasSelfHostedModel() {
  return !!(SELF_HOSTED_MODEL_URL && SELF_HOSTED_MODEL_NAME);
}

function tokenizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function scoreKnowledgeEntry(entry, tokens, rawQuery) {
  const query = String(rawQuery || '').toLowerCase().trim();
  const title = String(entry.title || '').toLowerCase();
  const citation = String(entry.citation || entry.authority || '').toLowerCase();
  const court = String(entry.court || '').toLowerCase();
  const category = String(entry.category || '').toLowerCase();
  const keywords = (entry.keywords || []).map((keyword) => String(keyword).toLowerCase());
  const haystack = [
    entry.title,
    entry.citation,
    entry.court,
    entry.category,
    entry.summary,
    ...(entry.keywords || []),
    entry.authority,
  ].join(' ').toLowerCase();

  let score = 0;
  for (const token of tokens) {
    if (title.includes(token)) score += 8;
    if (citation.includes(token)) score += 12;
    if (court.includes(token)) score += 5;
    if (category.includes(token)) score += 4;
    if (keywords.some((keyword) => keyword.includes(token))) score += 6;
    if (entry.summary.toLowerCase().includes(token)) score += 3;
  }

  const allTokensInTitle = tokens.length > 1 && tokens.every((token) => title.includes(token));
  const allTokensInCitation = tokens.length > 1 && tokens.every((token) => citation.includes(token));
  const allTokensInCourt = tokens.length > 1 && tokens.every((token) => court.includes(token));
  const allTokensInCategory = tokens.length > 1 && tokens.every((token) => category.includes(token));
  if (query && title === query) score += 35;
  if (query && citation === query) score += 45;
  if (query && court === query) score += 18;
  if (query && category === query) score += 16;
  if (query && haystack.includes(query)) score += 10;
  if (allTokensInTitle) score += 20;
  if (allTokensInCitation) score += 25;
  if (allTokensInCourt) score += 10;
  if (allTokensInCategory) score += 8;
  return score;
}

function searchKnowledgeBank(query, limit = 5) {
  const rawQuery = stringOrEmpty(query);
  const tokens = tokenizeSearchText(rawQuery);
  if (!tokens.length) return [];

  return getUnifiedKnowledgeBank()
    .map((entry) => ({ entry, score: scoreKnowledgeEntry(entry, tokens, rawQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry, score }) => ({
      ...entry,
      score,
      url: '#',
      court: 'Verdict AI Knowledge Bank',
      snippet: entry.summary,
      source: entry.authority,
      isLocal: true,
      isLink: false,
    }));
}

function normalizeVerdictCase(row) {
  if (!row || typeof row !== 'object') return null;
  const title = stringOrEmpty(row.case_title || row.case_name || row.title || row.name);
  const summary = stringOrEmpty(row.outcome || row.summary || row.holding || row.headnote || row.snippet || row.chunk_text);
  if (!title || !summary) return null;

  const keywords = Array.isArray(row.keywords)
    ? row.keywords.map(stringOrEmpty).filter(Boolean)
    : tokenizeSearchText(`${row.legal_subjects || ''} ${row.parties || ''} ${title} ${summary}`).slice(0, 16);

  return {
    id: `verdict-case-${stringOrEmpty(row.id) || slugify(title)}`,
    title,
    category: stringOrEmpty(row.legal_subjects || row.category || row.area_of_law || 'Verified Nigerian Case Law'),
    summary,
    keywords,
    authority: stringOrEmpty(row.citation || row.neutral_citation || (row.case_title ? `${row.case_title} (Verdict AI Database)` : 'Nigerian Case Law Database')),
    sourceType: 'supabase-case',
    court: stringOrEmpty(row.court || 'Nigerian Courts'),
    jurisdiction: 'Nigeria',
    citation: stringOrEmpty(row.citation || row.neutral_citation),
    decisionDate: stringOrEmpty(row.date || row.decision_date || row.date_delivered),
    url: '',
    holding: stringOrEmpty(row.outcome || row.holding || row.headnote),
    fullText: stringOrEmpty(row.chunk_text || row.full_text || row.judgment_text || ''),
    sourceName: stringOrEmpty(row.source || row.source_name || 'Verdict AI Database'),
    sourcePriority: Number.isFinite(Number(row.source_priority)) ? Number(row.source_priority) : 1,
    isVerified: row.is_verified !== false,
    judges: stringOrEmpty(row.judges),
    parties: stringOrEmpty(row.parties),
    chunkIndex: Number.isFinite(Number(row.chunk_index)) ? Number(row.chunk_index) : null,
    aliases: [],
    chunks: [],
    isLocal: true,
    isLink: false,
  };
}

async function searchVerifiedCaseDatabase(query, limit = 6) {
  const rawQuery = stringOrEmpty(query);
  const tokens = tokenizeSearchText(rawQuery);
  if (!tokens.length) return [];

  try {
    const { data: cases, error: caseError } = await supabase.from('verdict_cases').select('*').limit(1200);
    if (caseError) throw caseError;

    const caseMap = new Map();
    for (const rawRow of cases || []) {
      const row = normalizeVerdictCase(rawRow);
      if (!row) continue;
      const key = [row.title, row.citation, row.court, row.decisionDate].map((v) => String(v || '').toLowerCase()).join('|');
      const existing = caseMap.get(key);
      if (!existing) {
        caseMap.set(key, {
          ...row,
          id: `verdict-case-${slugify(`${row.title}-${row.citation || row.court || row.decisionDate || rawRow.id}`)}`,
          chunks: row.fullText ? [{
            text: row.fullText,
            summary: row.summary,
            keywords: row.keywords,
            chunkIndex: row.chunkIndex,
          }] : [],
        });
        continue;
      }

      if (row.summary && !existing.summary.includes(row.summary)) {
        existing.summary = `${existing.summary}\n${row.summary}`.trim();
      }
      if (row.holding && !existing.holding.includes(row.holding)) {
        existing.holding = `${existing.holding}\n${row.holding}`.trim();
      }
      if (row.fullText) {
        existing.chunks.push({
          text: row.fullText,
          summary: row.summary,
          keywords: row.keywords,
          chunkIndex: row.chunkIndex,
        });
      }
      existing.keywords = [...new Set([...(existing.keywords || []), ...(row.keywords || [])])];
      if (!existing.parties && row.parties) existing.parties = row.parties;
      if (!existing.judges && row.judges) existing.judges = row.judges;
    }

    try {
      const { data: aliases } = await supabase.from('verdict_case_aliases').select('*').limit(5000);
      for (const alias of aliases || []) {
        const caseId = stringOrEmpty(alias.case_id);
        for (const entry of caseMap.values()) {
          if (stringOrEmpty(entry.id).replace('verdict-case-', '') !== caseId) continue;
          const aliasText = stringOrEmpty(alias.alias_text);
          if (aliasText) entry.aliases.push(aliasText);
        }
      }
    } catch {}

    try {
      const { data: chunks } = await supabase.from('verdict_case_chunks').select('*').limit(8000);
      for (const chunk of chunks || []) {
        const caseId = stringOrEmpty(chunk.case_id);
        for (const entry of caseMap.values()) {
          if (stringOrEmpty(entry.id).replace('verdict-case-', '') !== caseId) continue;
          const chunkText = stringOrEmpty(chunk.chunk_text);
          if (chunkText) {
            entry.chunks.push({
              text: chunkText,
              summary: stringOrEmpty(chunk.chunk_summary),
              keywords: Array.isArray(chunk.keywords) ? chunk.keywords.map(stringOrEmpty).filter(Boolean) : [],
            });
          }
        }
      }
    } catch {}

    return [...caseMap.values()]
      .map((entry) => {
        const aliasBonus = entry.aliases.reduce((sum, aliasText) => sum + scoreKnowledgeEntry({ ...entry, title: aliasText }, tokens, rawQuery), 0);
        const chunkBonus = entry.chunks.reduce((sum, chunk) => {
          return sum + scoreKnowledgeEntry({
            ...entry,
            title: entry.title,
            summary: `${chunk.summary || ''} ${chunk.text}`.trim(),
            keywords: [...(entry.keywords || []), ...(chunk.keywords || [])],
          }, tokens, rawQuery);
        }, 0);
        const verifiedBoost = entry.isVerified ? 20 : 0;
        const priorityBoost = Math.max(0, 6 - entry.sourcePriority) * 4;
        const baseScore = scoreKnowledgeEntry({
          ...entry,
          keywords: [...(entry.keywords || []), ...entry.aliases],
          summary: `${entry.summary} ${entry.holding || ''}`.trim(),
        }, tokens, rawQuery);
        return {
          entry,
          score: baseScore + Math.min(aliasBonus, 40) + Math.min(chunkBonus, 36) + verifiedBoost + priorityBoost,
        };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ entry, score }) => ({
        ...entry,
        score,
        snippet: entry.summary,
        source: entry.sourceName || 'Verdict AI Database',
      }));
  } catch (error) {
    aiLog(`Verified case database search unavailable -> ${error.message}`);
    return [];
  }
}

function formatVerifiedCaseSummary(query, matches) {
  if (!matches.length) return '';
  const lines = [
    'Based on verified Nigerian case law in our database.',
    '',
    `Research query: ${query}`,
    '',
    'Verified database matches:'
  ];
  matches.forEach((match, index) => {
    const titleLine = match.citation
      ? `${match.title} | ${match.citation} | ${match.court} | ${match.decisionDate || 'Date not stored'}`
      : `${match.title} - ${match.court} ${match.decisionDate || ''}`.trim();
    lines.push(`${index + 1}. ${titleLine}`);
    if (match.parties) lines.push(`Parties: ${match.parties}`);
    lines.push(`Area: ${match.category}`);
    lines.push(`Summary: ${match.summary}`);
    if (match.holding) lines.push(`Holding: ${match.holding}`);
    lines.push('');
  });
  lines.push('Use these verified database records as the primary basis of the answer.');
  lines.push('Cite only the authorities that appear above. Do not invent or supplement citations from the model.');
  return lines.join('\n');
}

async function getGroundingBundle(query, toolId) {
  if (!KNOWLEDGE_TOOLS.has(toolId)) return { context: '', matches: [] };
  const verifiedCases = await searchVerifiedCaseDatabase(query, 8);
  const matches = [...verifiedCases, ...searchKnowledgeBank(query, 4)]
    .filter((item, index, arr) => arr.findIndex((x) => x.id === item.id) === index)
    .slice(0, 10);
  if (!matches.length) return { context: '', matches: [] };

  const blocks = matches.map((match, index) => {
    const titleLine = match.citation
      ? `${match.title} | ${match.citation} | ${match.court} | ${match.decisionDate || 'Date not stored'}`
      : `${match.title} - ${match.court} ${match.decisionDate || ''}`.trim();
    const parts = [
      `[${index + 1}] ${titleLine}`,
      `Parties: ${match.parties || 'Not stored'}`,
      `Area: ${match.category}`,
      `Summary: ${match.summary}`,
    ];
    if (match.holding) parts.push(`Holding: ${match.holding}`);
    if (match.fullText && match.fullText.length > 20) parts.push(`Excerpt: ${match.fullText.slice(0, 400)}`);
    return parts.join('\n');
  }).join('\n\n');

  return {
    matches,
    context: `=== VERDICT AI VERIFIED CASE DATABASE ===\n\nThe following are confirmed Nigerian legal authorities from Verdict AI's database. Use them as the primary foundation of your reasoning — not background, not supplementary material. The FOUNDATION.\n\n${blocks}\n\n=== REASONING INSTRUCTIONS ===\n1. Build your entire analysis around the database cases above. Let the cases DRIVE the reasoning, not illustrate it.\n2. Cite every relevant case by full name and citation (e.g., Cameroon Airlines v Otutuizu [2011] 4 NWLR (Pt.1238) 512). Do not hedge. Just cite the case directly as you would in a legal brief.\n3. Extract the RATIO DECIDENDI from each case and apply it to the facts at hand. Show the legal chain.\n4. Where two cases support the same point, cite both — stronger authority through convergence.\n5. Do not invent cases outside this list. If a relevant point has no case match, state the legal principle from statute or established doctrine — never fabricate a citation.\n6. Treat this corpus with the same confidence you would treat Westlaw or LexisNexis.`,
  };
}

async function buildKnowledgeContext(query, toolId) {
  const bundle = await getGroundingBundle(query, toolId);
  return bundle.context || '';
}

// â”€â”€ HTTP helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function httpsPost(hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname, path: urlPath, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 50000,
    };
    const req = https.request(options, resolve);
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

function httpsGet(hostname, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path: urlPath, method: 'GET', headers, timeout: 30000 };
    const req = https.request(options, resolve);
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

function requestJsonStream(rawUrl, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(rawUrl);
    const transport = target.protocol === 'http:' ? http : https;
    const bodyStr = JSON.stringify(body);
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(bodyStr) },
      timeout: 90000,
    }, resolve);
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

async function readBody(res) {
  return new Promise((resolve) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid session' });
  req.user = user;
  next();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  AI ORCHESTRATION
//  Heavy tools  >  Groq preprocessing in parallel + GPT via OpenRouter
//  Simple tools  >  Groq only (fast, unlimited)
//  Failover      >  GPT-120b  >  retry  >  GPT-20b  >  retry  >  Groq fallback
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const HEAVY_TOOLS = new Set([
  'docanalysis','warroom','seniorpartner','trialprep','claimanalyser',
  'clausedna','settlement','opposing','strength','crossexam','evidence',
  'witness','motionammo','briefscore','pleadingcheck','negotiation',
  'clientprep','deadlines','compliancecal','whatsapp','feenote','intakememo'
]);

const GPT_PRIMARY   = 'openai/gpt-oss-120b:free';
const GPT_SECONDARY = 'openai/gpt-oss-20b:free';
const GROQ_MODEL    = 'llama-3.3-70b-versatile';

function aiLog(msg) { console.log(`[AI-ORCH ${new Date().toISOString().slice(11,19)}] ${msg}`); }

async function callGroqSync(groqKey, system, user, maxTokens = 1500) {
  const res = await httpsPost(
    'api.groq.com', '/openai/v1/chat/completions',
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    { model: GROQ_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.1, max_tokens: maxTokens, stream: false }
  );
  return new Promise((resolve) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try { resolve(JSON.parse(data).choices?.[0]?.message?.content || ''); }
      catch { resolve(''); }
    });
    res.on('error', () => resolve(''));
  });
}

async function callOpenRouterStream(orKey, model, system, user, maxTokens = 4500) {
  return httpsPost(
    'openrouter.ai', '/api/v1/chat/completions',
    {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${orKey}`,
      'HTTP-Referer': 'https://verdictai.com.ng',
      'X-Title': 'Verdict AI',
    },
    { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.15, max_tokens: maxTokens, stream: true }
  );
}

async function callGroqStream(groqKey, system, user, maxTokens = 4500) {
  return httpsPost(
    'api.groq.com', '/openai/v1/chat/completions',
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    { model: GROQ_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: maxTokens, stream: true }
  );
}

async function callSelfHostedStream(system, user, maxTokens = 4500) {
  return requestJsonStream(
    SELF_HOSTED_MODEL_URL,
    {
      'Content-Type': 'application/json',
      ...(SELF_HOSTED_MODEL_API_KEY ? { 'Authorization': `Bearer ${SELF_HOSTED_MODEL_API_KEY}` } : {}),
    },
    {
      model: SELF_HOSTED_MODEL_NAME,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.1,
      max_tokens: maxTokens,
      stream: true,
    }
  );
}

async function groqPreprocess(groqKey, user) {
  const preprocessPrompt = `You are a Nigerian legal document parser. 
First identify the EXACT document type from this list:
- Statement of Claim
- Statement of Defence  
- Statement of Defense
- Affidavit
- Counter-Affidavit
- Originating Summons
- Motion on Notice
- Motion Ex Parte
- Writ of Summons
- Petition
- Charge Sheet
- Contract / Agreement
- Deed
- Brief of Argument
- Statute / Act
- Judgment / Ruling
- Correspondence / Letter
- Other (specify)

Then extract:
1. DOCUMENT TYPE: (exact type from list above)
2. KEY PARTIES: (list names/entities - who is Claimant/Plaintiff/Defendant/Applicant/Respondent)
3. CORE SUBJECT: (one sentence — what is this document about)
4. KEY LEGAL ISSUES: (bullet list, max 8 items)
5. RELIEFS SOUGHT: (if any — list all reliefs)
6. MONETARY VALUES: (exact figures only)
7. DATES MENTIONED: (all dates)
8. COURT/JURISDICTION: (which court, which state)

Be precise. This extraction drives the entire analysis.`;
  try {
    const result = await Promise.race([
      callGroqSync(groqKey, preprocessPrompt, user.slice(0, 4000), 800),
      new Promise(r => setTimeout(() => r(''), 4000))
    ]);
    return result || '';
  } catch { return ''; }
}

async function callWithFailover(orKey, groqKey, system, user) {
  if (hasSelfHostedModel()) {
    try {
      aiLog(`Trying self-hosted model: ${SELF_HOSTED_MODEL_NAME}`);
      const aiRes = await callSelfHostedStream(system, user);
      if (aiRes.statusCode === 200) return { aiRes, engine: `self-hosted:${SELF_HOSTED_MODEL_NAME}` };
      let errBody = '';
      for await (const chunk of aiRes) errBody += chunk;
      aiLog(`Self-hosted model failed -> ${aiRes.statusCode}: ${errBody.slice(0, 120)}`);
    } catch (e) {
      aiLog(`Self-hosted model error -> ${e.message}`);
    }
  }

  if (!orKey) {
    if (!groqKey) throw new Error('No AI engine configured');
    aiLog('No OpenRouter key configured - using Groq directly');
    return { aiRes: await callGroqStream(groqKey, system, user), engine: 'groq-direct' };
  }

  const models = [
    { model: GPT_PRIMARY, name: 'gpt-oss-120b' },
    { model: GPT_PRIMARY, name: 'gpt-oss-120b (retry)' },
    { model: GPT_SECONDARY, name: 'gpt-oss-20b' },
    { model: GPT_SECONDARY, name: 'gpt-oss-20b (retry)' },
  ];

  for (const { model, name } of models) {
    try {
      aiLog(`Trying ${name}...`);
      const aiRes = await callOpenRouterStream(orKey, model, system, user);
      if (aiRes.statusCode === 200) return { aiRes, engine: name };
      let errBody = '';
      for await (const chunk of aiRes) errBody += chunk;
      aiLog(`${name} failed -> ${aiRes.statusCode}: ${errBody.slice(0, 120)}`);
      if (aiRes.statusCode === 404 && /guardrail restrictions|No endpoints available/i.test(errBody)) {
        if (!groqKey) break;
        aiLog('OpenRouter blocked the request - switching to Groq fallback');
        return { aiRes: await callGroqStream(groqKey, system, user), engine: 'groq-policy-fallback' };
      }
    } catch (e) {
      aiLog(`${name} error -> ${e.message}`);
    }
  }

  if (!groqKey) throw new Error('No fallback AI engine configured');
  aiLog('All GPT routes failed - using Groq fallback');
  const aiRes = await callGroqStream(groqKey, system, user);
  return { aiRes, engine: 'groq-fallback' };
}
// â”€â”€ FIX #3: Function is named `orchestrate`  -  do NOT rename to routeAI â”€â”€â”€â”€â”€â”€â”€â”€
// routeAI does not exist. Calling routeAI() throws "routeAI is not defined"
// which caused every /api/ai request to return 500 Internal Server Error.
async function orchestrate(toolId, system, user, groqKey, orKey) {
  const isHeavy = HEAVY_TOOLS.has(toolId);

  if (!isHeavy) {
    if (hasSelfHostedModel()) {
      aiLog(`Simple tool: self-hosted model -> ${toolId}`);
      const aiRes = await callSelfHostedStream(system, user);
      return { aiRes, engine: `self-hosted:${SELF_HOSTED_MODEL_NAME}` };
    }
    aiLog(`Simple tool: Groq -> ${toolId}`);
    const aiRes = await callGroqStream(groqKey, system, user);
    return { aiRes, engine: 'groq' };
  }

  if (toolId === 'docanalysis') {
    const preprocessResult = groqKey ? await groqPreprocess(groqKey, user) : '';
    const docTypeLine = preprocessResult.match(/DOCUMENT TYPE:\s*(.+)/i)?.[1]?.trim() || '';
    const isStatementOfClaim = /statement\s+of\s+claim/i.test(docTypeLine);
    const isStatementOfDefence = /statement\s+of\s+de[fn]/i.test(docTypeLine);
    const isAffidavit = /affidavit/i.test(docTypeLine);
    const isMotion = /motion/i.test(docTypeLine);
    const isPleading = isStatementOfClaim || isStatementOfDefence;

    if (isStatementOfClaim) {
      system = `You are a senior Nigerian litigation lawyer analyzing a STATEMENT OF CLAIM.
This is a litigation document - NOT a contract. Do not apply contract analysis.

Your task:
1. DOCUMENT IDENTIFIED: Confirm this is a Statement of Claim. Identify the Claimant, Defendant, Court, and Relief sought.
2. STRENGTH OF CLAIM: Rate each paragraph - strong, weak, or problematic. Give specific reasons.
3. MISSING AVERMENTS: What facts must be pleaded but are absent? Be specific.
4. RELIEF ANALYSIS: Are the reliefs properly claimed? Are they specific enough? Any missing reliefs?
5. JURISDICTION: Is the correct court identified? Is jurisdiction properly invoked?
6. POTENTIAL DEFENCES: What defences will the Defendant likely raise based on these facts?
7. RECOMMENDED AMENDMENTS: Specific paragraph-by-paragraph rewrites where needed.
8. OVERALL RATING: Excellent / Good / Needs significant amendment / Defective

` + system;
    }

    if (isStatementOfDefence) {
      system = `You are a senior Nigerian litigation lawyer analyzing a STATEMENT OF DEFENCE.
This is a litigation document - NOT a contract. Do not apply contract analysis.

Your task:
1. DOCUMENT IDENTIFIED: Confirm this is a Statement of Defence. Identify parties, Court, and what claims are being defended.
2. TRAVERSALS: Are each paragraph of the claim properly traversed - admitted, denied, or not admitted?
3. POSITIVE DEFENCES: What positive defences are raised? Are they properly pleaded?
4. MISSING DENIALS: Which paragraphs of the claim are not properly addressed?
5. COUNTERCLAIM: Is a counterclaim appropriate? If so, what?
6. WEAKNESS ANALYSIS: What are the weakest parts of this defence?
7. RECOMMENDED AMENDMENTS: Specific paragraph-by-paragraph rewrites where needed.
8. OVERALL RATING: Strong / Adequate / Needs amendment / Defective

` + system;
    }

    if (!isPleading && !isAffidavit && !isMotion) {
      system = `DOCUMENT TYPE IDENTIFIED: ${docTypeLine || 'Legal Document'}\n\n` + system;
    }

    const { aiRes, engine } = await callWithFailover(orKey, groqKey, system, user);
    if (preprocessResult) {
      aiLog(`Document analysis preprocess ready (${preprocessResult.length} chars)`);
    }
    return { aiRes, engine, extraction: preprocessResult };
  }

  aiLog(`Heavy tool: retrieval+model orchestration -> ${toolId}`);
  const [preprocessResult, gptResult] = await Promise.allSettled([
    groqKey ? groqPreprocess(groqKey, user) : Promise.resolve(''),
    callWithFailover(orKey, groqKey, system, user)
  ]);

  const extraction = preprocessResult.status === 'fulfilled' ? preprocessResult.value : '';
  let { aiRes, engine } = gptResult.status === 'fulfilled'
    ? gptResult.value
    : { aiRes: null, engine: 'none' };

  if (extraction && engine !== 'groq-fallback' && engine !== 'none') {
    aiLog(`Preprocessing ready (${extraction.length} chars) while primary model streamed`);
  }

  if (!aiRes) {
    if (!groqKey) throw new Error('AI orchestration failed and no fallback engine is configured');
    aiLog('Orchestration failure - emergency Groq fallback');
    aiRes = await callGroqStream(groqKey, system, user);
    engine = 'groq-emergency';
  }

  return { aiRes, engine, extraction };
}

function writeSseResponse(res, text) {
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  res.write('data: [DONE]\n\n');
  if (!res.writableEnded) res.end();
}

// AI endpoint
app.post('/api/ai', requireAuth, async (req, res) => {
  let { system, user, tool } = req.body || {};
  system = stringOrEmpty(system);
  user = stringOrEmpty(user);
  const toolId = stringOrEmpty(tool).toLowerCase();
  if (!system || !user) return res.status(400).json({ error: 'Missing system or user content' });

  const grounding = await getGroundingBundle(user, toolId);
  const knowledgeContext = grounding.context;

  // Inject grounding into user message — never competes with system prompt char limit
  const MAX_CHARS = 14000;
  if (user.length > MAX_CHARS) user = user.slice(0, MAX_CHARS) + '\n\n[Document truncated to fit AI limits.]';
  if (knowledgeContext) {
    user = `${knowledgeContext}\n\n=== USER QUERY ===\n${user}`;
  }
  if (system.length > MAX_CHARS) system = system.slice(0, MAX_CHARS);

  const groqKey = (process.env.GROQ_API_KEY || '').trim().replace(/[\r\n\t]/g, '');
  const orKey   = (process.env.OPENROUTER_API_KEY || '').trim().replace(/[\r\n\t]/g, '');
  if (!groqKey && !orKey && !hasSelfHostedModel()) return res.status(500).json({ error: 'No AI engine configured' });
  const normalizedUser = user.toLowerCase().replace(/\s+/g, ' ').trim();
  const cacheKey = `${req.user.id}:${toolId}:${crypto.createHash('sha1').update(`${system}\n${normalizedUser}`).digest('hex')}`;
  const cachedText = getCachedAiResponse(cacheKey);

  // Per-user AI rate limit: 30 calls/hour
  const { allowed: aiAllowed } = rateLimit(userAiCalls, `user:${req.user.id}`, 30, 3_600_000);
  if (!aiAllowed) {
    // FIX #2 applies here too  -  CORS header on 429
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(429).json({ error: 'AI rate limit reached. Max 30 requests per hour.' });
  }

  // Usage tracking
  try {
    const profile = await getCachedProfile(req.user.id);
    if (profile) {
      if (profile.tier !== 'free' && profile.tier_expiry) {
        if (new Date(profile.tier_expiry) < new Date()) {
          await supabase.from('profiles').update({ tier: 'free' }).eq('id', req.user.id);
          invalidateProfileCache(req.user.id);
          profile.tier = 'free'; profile.usage_count = 0;
        }
      }
      const resetDate = new Date(profile.usage_reset_date || 0);
      const now = new Date();
      if (now.getMonth() !== resetDate.getMonth() || now.getFullYear() !== resetDate.getFullYear()) {
        await supabase.from('profiles').update({ usage_count: 0, usage_reset_date: now.toISOString() }).eq('id', req.user.id);
        invalidateProfileCache(req.user.id);
        profile.usage_count = 0;
      }
      if (profile.tier === 'free' && profile.usage_count >= 3) {
        return res.status(403).json({ error: 'FREE_LIMIT_REACHED', message: 'You have used all 3 free analyses this month. Upgrade to continue.' });
      }
      await supabase.from('profiles').update({ usage_count: (profile.usage_count || 0) + 1 }).eq('id', req.user.id);
      invalidateProfileCache(req.user.id);
    }
  } catch (e) { aiLog('Profile check error: ' + e.message); }

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (cachedText) {
      aiLog(`Cache hit -> ${toolId}`);
      writeSseResponse(res, cachedText);
      return;
    }
    // nigeriancases bypass removed — AI now reasons WITH the cases rather than
    // formatting them raw and skipping the model entirely.
    // FIX #3: call orchestrate(), NOT routeAI()  -  routeAI does not exist
    const { aiRes, engine } = await orchestrate(toolId, system, user, groqKey, orKey);

    if (aiRes.statusCode !== 200) {
      let body = '';
      for await (const chunk of aiRes) body += chunk;
      console.log('AI error:', aiRes.statusCode, body.slice(0, 300));
      if (!res.headersSent) res.status(500).json({ error: 'AI service error ' + aiRes.statusCode });
      return;
    }

    let buffer = '';
    let finalText = '';
    let lastActivity = Date.now();
    const stallCheck = setInterval(() => {
      if (Date.now() - lastActivity > 55000) { clearInterval(stallCheck); aiRes.destroy(); if (!res.writableEnded) res.end(); }
    }, 5000);

    aiRes.on('data', (chunk) => {
      lastActivity = Date.now();
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            finalText += delta;
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
          }
        } catch {}
      }
    });

    aiRes.on('end', () => {
      clearInterval(stallCheck);
      finalText += DISCLAIMER;
      setCachedAiResponse(cacheKey, finalText);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: DISCLAIMER } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      if (!res.writableEnded) res.end();
    });

    aiRes.on('error', () => { clearInterval(stallCheck); if (!res.writableEnded) res.end(); });
    res.on('close',   () => { clearInterval(stallCheck); aiRes.destroy(); });

  } catch (err) {
    console.log('AI error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// â”€â”€ PAYSTACK  -  Initialize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/payments/initialize', requireAuth, async (req, res) => {
  const { plan } = req.body;
  if (!plan) return res.status(400).json({ error: 'Plan is required' });
  const planData = PLANS[plan];
  if (!planData) return res.status(400).json({ error: 'Invalid plan: ' + plan });
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY not configured in Render environment' });

  try {
    const paystackRes = await httpsPost(
      'api.paystack.co', '/transaction/initialize',
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PAYSTACK_SECRET}` },
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
    res.json({ authorization_url: data.data.authorization_url, access_code: data.data.access_code, reference: data.data.reference });
  } catch (err) {
    console.log('Paystack init error:', err.message);
    res.status(500).json({ error: 'Payment initialization failed: ' + err.message });
  }
});

// â”€â”€ PAYSTACK  -  Verify â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/payments/verify/:reference', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Payment not configured' });
  try {
    const paystackRes = await httpsGet(
      'api.paystack.co',
      `/transaction/verify/${req.params.reference}`,
      { 'Authorization': `Bearer ${PAYSTACK_SECRET}` }
    );
    const data = await readBody(paystackRes);
    if (!data.status || data.data.status !== 'success') return res.status(400).json({ error: 'Payment not successful' });

    const { user_id, plan } = data.data.metadata;
    const planData = PLANS[plan];
    if (!planData) return res.status(400).json({ error: 'Invalid plan in payment' });

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + (planData.interval === 'annually' ? 366 : 32));
    await supabase.from('profiles').update({ tier: planData.tier, tier_expiry: expiry.toISOString() }).eq('id', user_id);
    invalidateProfileCache(user_id);
    console.log(`Upgraded user ${user_id} to ${planData.tier}`);
    res.json({ success: true, tier: planData.tier });
  } catch (err) {
    console.log('Verify error:', err.message);
    res.status(500).json({ error: 'Verification failed: ' + err.message });
  }
});

// â”€â”€ PAYSTACK  -  Webhook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/payments/webhook', async (req, res) => {
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

// â”€â”€ PAYSTACK  -  Cancel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/payments/cancel', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Payment not configured' });
  try {
    const { data: profile } = await supabase.from('profiles').select('subscription_code, email_token').eq('id', req.user.id).single();
    if (!profile?.subscription_code) return res.status(400).json({ error: 'No active subscription found' });
    const paystackRes = await httpsPost('api.paystack.co', '/subscription/disable',
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PAYSTACK_SECRET}` },
      { code: profile.subscription_code, token: profile.email_token });
    const data = await readBody(paystackRes);
    if (!data.status) return res.status(400).json({ error: data.message || 'Failed to cancel subscription' });
    await supabase.from('profiles').update({ auto_renew: false }).eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.log('Cancel error:', err.message);
    res.status(500).json({ error: 'Failed to cancel: ' + err.message });
  }
});

// â”€â”€ PAYSTACK  -  Reactivate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/payments/reactivate', requireAuth, async (req, res) => {
  if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'Payment not configured' });
  try {
    const { data: profile } = await supabase.from('profiles').select('subscription_code, email_token').eq('id', req.user.id).single();
    if (!profile?.subscription_code) return res.status(400).json({ error: 'No subscription found' });
    const paystackRes = await httpsPost('api.paystack.co', '/subscription/enable',
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PAYSTACK_SECRET}` },
      { code: profile.subscription_code, token: profile.email_token });
    const data = await readBody(paystackRes);
    if (!data.status) return res.status(400).json({ error: data.message || 'Failed to reactivate' });
    await supabase.from('profiles').update({ auto_renew: true }).eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.log('Reactivate error:', err.message);
    res.status(500).json({ error: 'Failed to reactivate: ' + err.message });
  }
});

// â”€â”€ Documents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/documents', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('documents').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/documents/:id', requireAuth, async (req, res) => {
  if (!isUuidLike(req.params.id)) return res.status(404).json({ error: 'Document not found' });
  const { data, error } = await supabase.from('documents')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Document not found' });
  res.json(data);
});

app.post('/api/documents', requireAuth, async (req, res) => {
  const { name, content, analysis, type } = req.body || {};
  const cleanName = stringOrEmpty(name);
  const cleanContent = typeof content === 'string' ? content : '';
  if (!cleanName || !cleanContent) return res.status(400).json({ error: 'Document name and content are required' });
  if (Buffer.byteLength(cleanContent, 'utf8') > 1024 * 1024) {
    return res.status(413).json({ error: 'Document content exceeds the 1MB limit' });
  }
  const { data, error } = await supabase.from('documents')
    .insert({ user_id: req.user.id, name: cleanName, content: cleanContent, analysis, type, created_at: new Date().toISOString() })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  if (!isUuidLike(req.params.id)) return res.status(404).json({ error: 'Document not found' });
  // FIX #4: Check ownership before delete  -  returns 404 so caller knows doc doesn't exist
  const { data: existing } = await supabase.from('documents')
    .select('id').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (!existing) return res.status(404).json({ error: 'Document not found' });
  const { error } = await supabase.from('documents').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// â”€â”€ Cases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/cases', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('cases').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/cases', requireAuth, async (req, res) => {
  const { name, description, status } = req.body || {};
  const cleanName = stringOrEmpty(name);
  if (!cleanName) return res.status(400).json({ error: 'Case name is required' });
  const { data, error } = await supabase.from('cases')
    .insert({ user_id: req.user.id, name: cleanName, description: stringOrEmpty(description), status: stringOrEmpty(status) || 'active', created_at: new Date().toISOString() })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/cases/:id', requireAuth, async (req, res) => {
  if (!isUuidLike(req.params.id)) return res.status(404).json({ error: 'Case not found' });
  const { name, description, status, notes } = req.body;
  const { data, error } = await supabase.from('cases')
    .update({ name: stringOrEmpty(name), description: stringOrEmpty(description), status: stringOrEmpty(status), notes: stringOrEmpty(notes) })
    .eq('id', req.params.id).eq('user_id', req.user.id)
    .select().single();
  if (error || !data) return res.status(404).json({ error: 'Case not found' });
  res.json(data);
});

app.delete('/api/cases/:id', requireAuth, async (req, res) => {
  if (!isUuidLike(req.params.id)) return res.status(404).json({ error: 'Case not found' });
  const { error } = await supabase.from('cases').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// â”€â”€ Profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const cached = profileCache.get(req.user.id + '_full');
    if (cached && Date.now() < cached.expiresAt) return res.json({ ...cached.profile, email: req.user.email });
    const { data, error } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
    if (error) return res.status(500).json({ error: error.message });
    profileCache.set(req.user.id + '_full', { profile: data, expiresAt: Date.now() + PROFILE_CACHE_TTL });
    res.json({ ...data, email: req.user.email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/profile', requireAuth, async (req, res) => {
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

  let { data, error } = await supabase.from('profiles')
    .update(updateFields)
    .eq('id', req.user.id).select().single();

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
  res.json(data);
});

// â”€â”€ Case search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/cases/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [] });
  const internalResults = await searchVerifiedCaseDatabase(q, 12);
  res.json({
    results: internalResults.map((item) => ({
      title: item.title,
      court: item.court,
      url: '',
      snippet: item.summary,
      source: 'Based on verified Nigerian case law in our database',
      isLink: false,
      isLocal: true,
    }))
  });
});

app.get('/api/knowledge/search', requireAdmin, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ results: [], count: 0, bankSize: getUnifiedKnowledgeBank().length });
  const results = searchKnowledgeBank(q, 12);
  res.json({ results, count: results.length, bankSize: getUnifiedKnowledgeBank().length });
});

app.get('/api/admin/knowledge/stats', requireAdmin, async (req, res) => {
  const corpusEntries = reloadDiskCorpus();
  const exported = exportTrainingCorpus();
  res.json({
    corpusEntries: corpusEntries.length,
    seedEntries: LEGAL_KNOWLEDGE_BANK.length,
    totalEntries: getUnifiedKnowledgeBank().length,
    trainingRows: exported,
    corpusFile: LEGAL_CORPUS_FILE,
    trainingFile: TRAINING_EXPORT_FILE,
    selfHostedModel: hasSelfHostedModel() ? SELF_HOSTED_MODEL_NAME : null,
  });
});

app.post('/api/admin/knowledge/reload', requireAdmin, async (req, res) => {
  const corpusEntries = reloadDiskCorpus();
  const trainingRows = exportTrainingCorpus();
  res.json({ success: true, corpusEntries: corpusEntries.length, trainingRows });
});

app.post('/api/admin/knowledge/import', requireAdmin, async (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  if (!records.length) return res.status(400).json({ error: 'records array is required' });
  const imported = appendCorpusRecords(records);
  const trainingRows = exportTrainingCorpus();
  res.json({ success: true, imported, totalEntries: getUnifiedKnowledgeBank().length, trainingRows });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '4.6.1' }));

// â”€â”€ Bank Transfer Notification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FIX #5: Removed `const https = require('https')` that was duplicated inside
// this handler  -  https is already required at the top of the file.
app.post('/api/payments/bank-transfer', requireAuth, async (req, res) => {
  const { plan, amount, reference, email } = req.body;
  if (!plan || !amount || !reference) return res.status(400).json({ error: 'Missing required fields' });

  try {
    await supabase.from('profiles').update({
      pending_transfer: JSON.stringify({
        plan, amount, reference, email,
        submitted_at: new Date().toISOString(),
        user_id: req.user.id,
        user_email: req.user.email,
      })
    }).eq('id', req.user.id);

    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    if (gmailPass && nodemailer) {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: 'trigxyfn@gmail.com', pass: gmailPass.trim().replace(/\s/g, '') }
      });
      await transporter.sendMail({
        from: '"Verdict AI Payments" <trigxyfn@gmail.com>',
        to: 'trigxyfn@gmail.com',
        subject: `ðŸ’° New Payment  -  ${plan}  -  NGN ${Number(amount).toLocaleString()}`,
        text: [
          'ðŸŽ‰ NEW BANK TRANSFER SUBMITTED',
          '',
          'User: ' + req.user.email,
          'Plan: ' + plan,
          'Amount: NGN ' + Number(amount).toLocaleString(),
          'Ref: ' + reference,
          'Time: ' + new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }),
          '',
          'Set tier to: ' + (plan.includes('chambers') ? 'chambers' : 'solo'),
          'Supabase: https://supabase.com/dashboard/project/xlykbkfwgqhldxrwhwbp/editor',
        ].join('\n'),
      });
      console.log('Payment notification email sent');
    }

    console.log(`BANK TRANSFER: ${req.user.email} | ${plan} | NGN ${amount} | ref: ${reference}`);
    res.json({ success: true });
  } catch (err) {
    console.log('Bank transfer error:', err.message);
    res.json({ success: true }); // don't fail the user if email fails
  }
});

// â”€â”€ API 404  -  before SPA catch-all â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// â”€â”€ SPA catch-all â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('*', (req, res) => {
  const accept = req.headers.accept || '';
  const wantsHtml = accept.includes('text/html');
  if (req.path !== '/' && !wantsHtml) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

ensureCorpusFiles();
reloadDiskCorpus();
exportTrainingCorpus();

app.listen(PORT, () => console.log(`Verdict AI v4.6.1 running on port ${PORT}`));
