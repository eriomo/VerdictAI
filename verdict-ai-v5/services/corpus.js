'use strict';

/**
 * VERDICT AI — CORPUS SERVICE
 * Disk corpus management and in-memory knowledge bank.
 * services/corpus.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LEGAL_CORPUS_FILE = path.join(DATA_DIR, 'legal-corpus.ndjson');
const TRAINING_EXPORT_FILE = path.join(DATA_DIR, 'training-corpus.jsonl');

const diskCorpusCache = { loadedAt: 0, entries: [] };

function stringOrEmpty(v) { return typeof v === 'string' ? v.trim() : ''; }

function tokenize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `record-${Date.now()}`;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LEGAL_CORPUS_FILE)) fs.writeFileSync(LEGAL_CORPUS_FILE, '', 'utf8');
  if (!fs.existsSync(TRAINING_EXPORT_FILE)) fs.writeFileSync(TRAINING_EXPORT_FILE, '', 'utf8');
}

function sanitizeRecord(record, index = 0) {
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
      : tokenize(`${title} ${summary}`).slice(0, 12),
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
  ensureDataDir();
  const content = fs.readFileSync(LEGAL_CORPUS_FILE, 'utf8');
  const entries = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const clean = sanitizeRecord(JSON.parse(trimmed), index);
      if (clean) entries.push(clean);
    } catch (e) {
      console.log(`Corpus parse warning line ${index + 1}: ${e.message}`);
    }
  });
  diskCorpusCache.loadedAt = Date.now();
  diskCorpusCache.entries = entries;
  return entries;
}

function appendCorpusRecords(records) {
  ensureDataDir();
  const cleaned = records.map((r, i) => sanitizeRecord(r, i)).filter(Boolean);
  if (!cleaned.length) return 0;
  const existingIds = new Set(getDiskEntries().map(e => e.id));
  const fresh = cleaned.filter(e => !existingIds.has(e.id));
  if (!fresh.length) return 0;
  fs.appendFileSync(LEGAL_CORPUS_FILE, fresh.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  reloadDiskCorpus();
  return fresh.length;
}

function getDiskEntries() {
  if (!diskCorpusCache.loadedAt) reloadDiskCorpus();
  return diskCorpusCache.entries;
}

function exportTrainingCorpus() {
  ensureDataDir();
  const records = getDiskEntries()
    .filter(e => e.sourceType === 'corpus')
    .map(e => JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a Nigerian legal research model. Use only the supplied authority and do not invent cases.' },
        { role: 'user', content: `Summarize the authority and core holding of ${e.title}${e.citation ? ` (${e.citation})` : ''}.` },
        { role: 'assistant', content: `${e.summary}${e.holding ? `\n\nHolding: ${e.holding}` : ''}` },
      ],
      metadata: { id: e.id, title: e.title, citation: e.citation, court: e.court, authority: e.authority },
    }));
  fs.writeFileSync(TRAINING_EXPORT_FILE, records.join('\n') + (records.length ? '\n' : ''), 'utf8');
  return records.length;
}

// Expanded knowledge bank with new tool categories
const KNOWLEDGE_BANK = [
  { id: 'kb-contract-breach', title: 'Breach of contract dispute research starter', category: 'Commercial Litigation', summary: 'Start with contract formation, express terms, breach facts, damages, mitigation, notice requirements, limitation issues, and dispute resolution clauses.', keywords: ['breach of contract', 'agreement', 'damages', 'repudiation', 'specific performance', 'commercial litigation'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-land-title', title: 'Land title and ownership verification checklist', category: 'Property', summary: 'Trace root of title, governor consent issues, survey plan consistency, registered instruments, possession history, encumbrances, and competing equitable interests.', keywords: ['land', 'title', 'governor consent', 'survey', 'property', 'deed of assignment', 'ownership'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-cama-governance', title: 'CAMA 2020 governance and filing review', category: 'Corporate', summary: 'Review incorporation status, directors, share structure, board resolutions, annual returns, beneficial ownership disclosures, and compliance filings under Companies and Allied Matters Act 2020.', keywords: ['cama', 'cama 2020', 'company', 'board resolution', 'annual returns', 'shareholder', 'corporate affairs commission', 'cac'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-employment-termination', title: 'Employment termination and workplace dispute guide', category: 'Employment', summary: 'Separate statutory employment from master-servant relationships, check notice provisions, disciplinary process, redundancy steps, and unpaid benefits claims under the Labour Act and Employee Compensation Act 2010.', keywords: ['employment', 'termination', 'wrongful dismissal', 'notice', 'redundancy', 'labour', 'employee compensation act'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-evidence-documents', title: 'Documentary evidence reliability review', category: 'Evidence', summary: 'Check authenticity, foundation, chain of custody, hearsay risks, certification under Evidence Act 2011, electronic evidence requirements under Section 84, and contradictions with pleadings.', keywords: ['evidence', 'document', 'electronic evidence', 'section 84', 'certification', 'proof', 'admissibility', 'evidence act 2011'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-criminal-bail', title: 'Bail application issue map', category: 'Criminal Procedure', summary: 'Assess severity of offence, flight risk, interference with witnesses, previous compliance with bail terms, health factors, and interests of justice for Nigerian Magistrate Court and High Court bail applications.', keywords: ['bail', 'criminal', 'flight risk', 'witness interference', 'magistrate', 'custody', 'remand'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-jurisdiction', title: 'Jurisdiction challenge checklist', category: 'Procedure', summary: 'Confirm subject matter jurisdiction, territorial competence, cause of action venue, mandatory pre-action steps, limitation periods, and forum clauses under Section 251 of the 1999 Constitution and applicable procedural rules.', keywords: ['jurisdiction', 'venue', 'pre-action', 'limitation', 'forum', 'competence', 'section 251'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-injunction', title: 'Interlocutory injunction research frame', category: 'Procedure', summary: 'Organize evidence around serious question to be tried, balance of convenience, urgency, preservation of res, and undertaking as to damages given by the Applicant to compensate the Respondent.', keywords: ['injunction', 'interlocutory', 'undertaking as to damages', 'balance of convenience', 'urgent relief', 'mareva'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-arbitration', title: 'Arbitration clause and stay analysis under Arbitration and Mediation Act 2023', category: 'ADR', summary: 'Check clause scope, validity, carve-outs, waiver by taking steps in proceedings, seat, applicable rules, and whether the dispute is arbitrable under the Arbitration and Mediation Act 2023.', keywords: ['arbitration', 'stay of proceedings', 'clause', 'adr', 'seat', 'waiver', 'arbitration and mediation act 2023'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-tax-compliance', title: 'Tax compliance and FIRS enforcement issue map', category: 'Tax', summary: 'Review registration status, filing history, assessment notices, penalties, audit trail, withholding tax issues, VAT position, and objection timelines under the Federal Inland Revenue Service (Establishment) Act.', keywords: ['tax', 'firs', 'vat', 'withholding tax', 'assessment', 'penalty', 'objection', 'company income tax'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-data-protection', title: 'Nigeria Data Protection Act 2023 compliance review', category: 'Compliance', summary: 'Map personal data flows, lawful basis for processing, retention limits, data processor contracts, cross-border transfer controls, and incident response obligations under the Nigeria Data Protection Act 2023.', keywords: ['data protection', 'privacy', 'ndpa', 'ndpa 2023', 'personal data', 'processor', 'breach', 'data controller'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-banking-regulation', title: 'CBN banking and financial services regulatory review', category: 'Financial Regulation', summary: 'Check CBN licensing status, customer mandate issues, AML controls, CBN circular compliance, account restrictions, and regulator reporting expectations for Nigerian financial institutions.', keywords: ['banking', 'cbn', 'aml', 'mandate', 'financial regulation', 'compliance', 'microfinance', 'fintech'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-ip-license', title: 'Intellectual property and licensing issues under Nigerian law', category: 'Intellectual Property', summary: 'Identify ownership chain, scope of licensed rights, infringement indicators, exclusivity provisions, royalty obligations, termination triggers, and confidentiality overlap under the Copyright Act and Trademarks Act.', keywords: ['copyright', 'trademark', 'license', 'royalty', 'infringement', 'software license', 'copyright act', 'trademarks act'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-contradiction', title: 'Contradiction detection methodology for legal documents', category: 'Evidence', summary: 'Compare witness statements, affidavits, correspondence, and pleadings for internal inconsistencies — date conflicts, factual contradictions, admission mapping, and legally significant silences.', keywords: ['contradiction', 'inconsistency', 'witness statement', 'affidavit', 'cross-examination', 'evidence', 'admission'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-timeline', title: 'Factual timeline extraction and limitation period analysis', category: 'Litigation', summary: 'Extract chronological events from legal documents, identify limitation period triggers, flag evidentiary gaps, map cascading deadline consequences, and identify legally significant silences in the factual record.', keywords: ['timeline', 'chronology', 'limitation period', 'dates', 'events', 'gap analysis', 'time bar'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-obligations', title: 'Contractual obligation register methodology', category: 'Commercial', summary: 'Extract every contractual obligation by party, deadline, trigger, and consequence of non-performance. Rank by risk of non-compliance and convert into a compliance calendar.', keywords: ['obligation', 'contractual duty', 'deadline', 'trigger', 'breach', 'performance', 'compliance calendar'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-student-research', title: 'Nigerian law student research and examination methodology', category: 'Legal Education', summary: 'Issue spotting in problem questions, authority hierarchy in Nigerian law, IRAC structure for Nigerian law assessments, moot argument construction, and case analysis techniques.', keywords: ['law student', 'problem question', 'IRAC', 'moot', 'assignment', 'issue spotting', 'legal education', 'law school'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-business-legal', title: 'Business legal health framework for Nigerian companies', category: 'Business Law', summary: 'Five-dimension legal health check: contractual exposure, employment compliance under Labour Act and Employee Compensation Act, regulatory compliance, IP protection, and dispute readiness for Nigerian businesses.', keywords: ['business', 'legal health', 'compliance', 'risk', 'entrepreneur', 'startup', 'Nigerian business', 'sme'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-regulatory-nigeria', title: 'Nigerian regulatory landscape by business sector', category: 'Regulatory', summary: 'CBN (banking/fintech/payment systems), SEC (capital markets/investment), NAFDAC (food/drugs/cosmetics), NCC (telecommunications), CAC (company registration), FIRS (federal taxation), PENCOM (pension administration), NESREA (environmental compliance), NAICOM (insurance).', keywords: ['regulatory', 'cbn', 'sec', 'nafdac', 'ncc', 'firs', 'pencom', 'nesrea', 'naicom', 'licence', 'regulatory compliance'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-pleadings', title: 'Pleadings consistency review under Nigerian court rules', category: 'Litigation', summary: 'Check parties, dates, reliefs, capacities, document references, jurisdiction paragraphs, contradictions, and whether facts support every remedy sought under the applicable High Court (Civil Procedure) Rules.', keywords: ['pleadings', 'statement of claim', 'defence', 'reliefs', 'contradiction', 'litigation', 'civil procedure rules'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-company-compliance', title: 'Company compliance calendar under CAMA 2020 and Nigerian tax law', category: 'Compliance', summary: 'Track CAMA 2020 annual returns, board and shareholder approvals, Company Income Tax filings, VAT returns, PAYE remittances, PENCOM contributions, ITF levy, sector filings, licence renewals, and evidence of internal approvals.', keywords: ['compliance calendar', 'annual returns', 'licence renewal', 'tax deadline', 'board approval', 'cama 2020'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-risk-delta', title: 'Contract risk delta analysis methodology', category: 'Commercial', summary: 'Compare two versions of a contract to identify every change, rate each change by risk impact, detect concealed changes that appear minor but shift risk significantly, and produce a net risk assessment.', keywords: ['risk delta', 'contract comparison', 'negotiation', 'risk change', 'redline', 'version comparison'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-letter-chain', title: 'Legal correspondence chain analysis and admission mapping', category: 'Evidence', summary: 'Analyze sequences of legal correspondence to map admissions, track position evolution, assess without-prejudice risk, and identify statements that can be used in cross-examination or submissions.', keywords: ['correspondence', 'letter chain', 'admission', 'without prejudice', 'position evolution', 'pre-action letters'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-corporate-governance', title: 'Corporate governance review under CAMA 2020 and SEC Code', category: 'Corporate', summary: 'Review board composition, committee structures, director duties, related party transactions, disclosure obligations, shareholder rights, and compliance with the SEC Code of Corporate Governance for Public Companies.', keywords: ['corporate governance', 'board', 'directors', 'sec code', 'related party', 'shareholder rights', 'cama 2020'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-land-use-act', title: 'Land Use Act 1978 — key provisions and practical application', category: 'Property', summary: 'Governor consent requirements for alienation of right of occupancy, customary right of occupancy vs statutory right of occupancy, revocation grounds, compensation entitlements, and interaction with registered land systems.', keywords: ['land use act', 'governor consent', 'right of occupancy', 'statutory right', 'customary right', 'revocation', 'compensation', 'land'], authority: 'Internal research guide', sourceType: 'internal' },
  { id: 'kb-evidence-act-2011', title: 'Evidence Act 2011 — complete guide for Nigerian practitioners', category: 'Evidence', summary: 'Admissibility of documentary evidence, hearsay rule and exceptions, electronic evidence under Section 84, expert evidence, privilege, confessions, and the best evidence rule under the Evidence Act 2011.', keywords: ['evidence act 2011', 'section 84', 'electronic evidence', 'hearsay', 'admissibility', 'privilege', 'confession', 'documentary evidence'], authority: 'Internal research guide', sourceType: 'internal' },
];

function getUnifiedKnowledgeBank() {
  return [...getDiskEntries(), ...KNOWLEDGE_BANK];
}

module.exports = {
  reloadDiskCorpus,
  appendCorpusRecords,
  getDiskEntries,
  getUnifiedKnowledgeBank,
  exportTrainingCorpus,
  ensureDataDir,
  slugify,
  tokenize,
  LEGAL_CORPUS_FILE,
  TRAINING_EXPORT_FILE,
};
