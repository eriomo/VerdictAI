'use strict';

/**
 * VERDICT AI — COMPLETE TOOL REGISTRY
 * Every tool. Every role. Every config.
 * tools/configs.js
 *
 * Structure per tool:
 *   id        — matches route tool parameter
 *   title     — display name
 *   desc      — one-line description
 *   label     — input field label
 *   ph        — placeholder text
 *   rows      — textarea rows
 *   role      — primary user role
 *   isNew     — show NEW badge
 *   chambers  — requires chambers tier
 */

const AI_CONFIGS = {

  // ══════════════════════════════════════════════════════════════════════════
  // CORE LAWYER TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  reader: {
    id: 'reader', title: 'Document Analysis',
    desc: 'Complete forensic analysis — risk ratings, power map, clause interactions, worst-case scenario, and full rewrites.',
    label: 'Document', ph: 'Paste your legal document here or upload above...', rows: 10, role: 'lawyer',
  },

  warroom: {
    id: 'warroom', title: 'Case War Room',
    desc: 'Litigation intelligence brief — weighted probability, battleground analysis, killer arguments, outcome scenarios, settlement range.',
    label: 'Case Details', ph: 'Describe the case: parties, facts, legal issues, jurisdiction, desired outcome...', rows: 12, role: 'lawyer',
  },

  clausedna: {
    id: 'clausedna', title: 'Clause DNA',
    desc: 'Forensic clause breakdown — risk scores, party bias, hidden traps, compound interactions, enforceability, complete rewrite.',
    label: 'Contract Clause', ph: 'Paste any single contract clause here...', rows: 8, role: 'lawyer',
  },

  opposing: {
    id: 'opposing', title: 'Opposing Counsel Simulator',
    desc: 'The strongest counter-arguments your opponent will make — ranked by danger, with precise defeating strategies.',
    label: 'Your Legal Argument', ph: 'State your position, supporting facts, legal basis...', rows: 12, role: 'lawyer',
  },

  strength: {
    id: 'strength', title: 'Strength Assessment',
    desc: 'Weighted probability 0-100% with factor breakdown, decision implication, and steps to push higher.',
    label: 'Legal Position', ph: 'Describe the claim or defence, facts, jurisdiction, applicable law...', rows: 12, role: 'lawyer',
  },

  courtpredictor: {
    id: 'courtpredictor', title: 'Court Success Predictor',
    desc: 'Weighted probability with factor scores, defendant win path, outcome scenarios, financial figures.',
    label: 'Case Details', ph: 'Describe the claim, relief sought, court, key facts...', rows: 10, role: 'lawyer',
  },

  crossexam: {
    id: 'crossexam', title: 'Witness Cross-Examiner',
    desc: '20 leading questions only. Killer Sequence. Contradiction mapping. Document-anchored fallbacks.',
    label: 'Witness Statement', ph: 'Paste the full witness statement here...', rows: 10, role: 'lawyer', chambers: true,
  },

  motionammo: {
    id: 'motionammo', title: 'Motion Ammunition',
    desc: 'Full Nigerian Written Address — issues, arguments, killer points, formal reliefs. Ready to file.',
    label: 'Facts and Grounds', ph: 'Describe the case, motion type, grounds, relief sought...', rows: 10, role: 'lawyer', chambers: true,
  },

  claimanalyser: {
    id: 'claimanalyser', title: 'Claim Analyser',
    desc: 'Claim strength score, element-by-element audit, 15 leading cross-exam questions, draft Statement of Defence.',
    label: 'Statement of Claim', ph: 'Paste the full statement of claim or opposing pleading...', rows: 10, role: 'lawyer', chambers: true,
  },

  briefscore: {
    id: 'briefscore', title: 'Brief-to-Win Score',
    desc: 'Brief graded on five dimensions — grammar audit, defect identification, complete rewritten sections, filing recommendation.',
    label: 'Legal Brief', ph: 'Paste your complete legal brief here...', rows: 14, role: 'lawyer',
  },

  digest: {
    id: 'digest', title: 'Case Digest Builder',
    desc: 'Transform any Nigerian judgment into a publication-quality digest — ratio, obiter, critical analysis, practice implications.',
    label: 'Judgment Text', ph: 'Paste the full text of any Nigerian judgment...', rows: 14, role: 'lawyer',
  },

  legalmemo: {
    id: 'legalmemo', title: 'Legal Research Memo',
    desc: 'Partner-quality research memorandum — brief answer first, full analysis, killer insight, risk matrix.',
    label: 'Research Brief', ph: 'State the question, client situation, facts, jurisdiction...', rows: 12, role: 'lawyer',
  },

  pleadingcheck: {
    id: 'pleadingcheck', title: 'Pleadings Checker',
    desc: 'Every defect found before your opponent does — rule-by-rule audit, objection simulation, complete rewrites.',
    label: 'Court Process', ph: 'Paste your statement of claim, writ, motion, affidavit, or any court process...', rows: 14, role: 'lawyer',
  },

  statute: {
    id: 'statute', title: 'Statute Explainer',
    desc: 'Any Nigerian statutory provision — text, meaning, judicial interpretation, killer insight, traps, practical implications.',
    label: 'Statutory Section', ph: 'e.g. Section 84 Evidence Act 2011, or paste the full text...', rows: 7, role: 'lawyer',
  },

  deadlines: {
    id: 'deadlines', title: 'Deadline Intelligence',
    desc: 'Every deadline — explicit and hidden — with risk ratings, cascading consequences, and compliance calendar.',
    label: 'Legal Document', ph: 'Paste any legal document — contracts, court orders, filings...', rows: 12, role: 'lawyer',
  },

  nigeriancases: {
    id: 'nigeriancases', title: 'Nigerian Case Law',
    desc: 'AI research grounded in verified Nigerian case law. Database-first. Never invented.',
    label: 'Research Query', ph: 'Describe the legal issue — breach of contract, Land Use Act, CAMA 2020...', rows: 5, role: 'lawyer',
  },

  qa: {
    id: 'qa', title: 'Legal Q&A',
    desc: 'Any Nigerian legal question answered at the level of a senior lawyer — with law, practice reality, and killer insight.',
    label: 'Question', ph: 'Ask any Nigerian legal question...', rows: 4, role: 'lawyer',
  },

  draft: {
    id: 'draft', title: 'Draft Documents',
    desc: '80+ legal document types — professionally drafted with all required elements, ready for review.',
    label: 'Instructions', ph: 'Parties, jurisdiction, key terms, dates, special requirements...', rows: 9, role: 'lawyer',
  },

  clientprep: {
    id: 'clientprep', title: 'Client Prep Coach',
    desc: 'Behaviour coaching, danger zones, model answers that protect — specific to your client and their personality.',
    label: 'Case Facts and Client Situation', ph: "Describe the case, the client's personality, weaknesses, what they will be asked about...", rows: 10, role: 'lawyer', chambers: true,
  },

  witness: {
    id: 'witness', title: 'Witness Forge',
    desc: 'Prepare your own witnesses — 15 questions they will face, ideal answers that protect, coaching notes.',
    label: 'Witness Statement', ph: 'Paste the full witness statement...', rows: 8, role: 'lawyer', chambers: true,
  },

  evidence: {
    id: 'evidence', title: 'Evidence Analyser',
    desc: 'Admissibility ruling under Evidence Act 2011 — Section 84 compliance check, without-prejudice risk, weight assessment.',
    label: 'Evidence Description', ph: 'Paste the document or describe the evidence in detail...', rows: 8, role: 'lawyer', chambers: true,
  },

  settlement: {
    id: 'settlement', title: 'Settlement Intelligence',
    desc: 'BATNA, ZOPA, realistic settlement range in naira, leverage assessment, full negotiation strategy.',
    label: 'Case Facts', ph: 'Describe the dispute, claims, reliefs sought, stage of proceedings...', rows: 8, role: 'lawyer', chambers: true,
  },

  negotiation: {
    id: 'negotiation', title: 'Contract Negotiation',
    desc: 'Paste two versions — AI flags every change, rates risk impact, and drafts your response letter.',
    label: 'Contract Versions', ph: 'Paste Version 1 then --- VERSION 2 --- then Version 2...', rows: 12, role: 'lawyer',
  },

  correspondence: {
    id: 'correspondence', title: 'Correspondence Tracker',
    desc: 'Paste any letter — demand analysis, legal consequences, admission mapping, complete draft reply.',
    label: 'Letter Received', ph: 'Paste the full text of any letter, demand notice, or legal correspondence...', rows: 12, role: 'lawyer',
  },

  whatsapp: {
    id: 'whatsapp', title: 'WhatsApp Evidence',
    desc: 'Complete court exhibit — cover page, formatted transcript, Section 84(2) certificate, without-prejudice risk.',
    label: 'WhatsApp Export', ph: 'Paste the exported WhatsApp chat here...', rows: 10, role: 'lawyer',
  },

  feenote: {
    id: 'feenote', title: 'Fee Note Builder',
    desc: 'Complete professional fee note aligned with NBA Remuneration Rules — ready to send.',
    label: 'Work Done', ph: 'Describe the legal work: matter type, court appearances, documents drafted, time spent...', rows: 9, role: 'lawyer',
  },

  intakememo: {
    id: 'intakememo', title: 'Client Intake Memo',
    desc: 'Rough notes turned into a complete intake memo — causes of action, limitation analysis, strategy, fee estimate.',
    label: 'Client Notes', ph: 'Describe the client situation in rough notes...', rows: 10, role: 'lawyer',
  },

  clientreport: {
    id: 'clientreport', title: 'Client Report',
    desc: 'Describe what happened in court — get a complete, professional client update letter.',
    label: 'What Happened', ph: 'Describe what happened at the hearing, what was filed, what was said...', rows: 9, role: 'lawyer',
  },

  explainer: {
    id: 'explainer', title: 'Client Explainer',
    desc: 'Turn complex legal analysis into plain English for your client — every obligation, every risk, every next step.',
    label: 'Legal Text', ph: 'Paste the document or analysis to explain to your client...', rows: 12, role: 'lawyer',
  },

  jurisdiction: {
    id: 'jurisdiction', title: 'Jurisdiction Translator',
    desc: 'Translate legal concepts between Nigerian and other legal systems — with risk analysis for assuming equivalence.',
    label: 'Legal Text', ph: 'Paste legal text or describe the concept...', rows: 9, role: 'lawyer',
  },

  compliancecal: {
    id: 'compliancecal', title: 'Compliance Calendar',
    desc: 'Full annual compliance calendar — every deadline, penalty, responsible officer, and risk alert.',
    label: 'Company Details', ph: 'Describe the company: type, industry, size, states of operation, licences held, financial year end...', rows: 8, role: 'lawyer',
  },

  precedent: {
    id: 'precedent', title: 'Precedent Clause Library',
    desc: 'Three court-ready clause versions — market standard, aggressive, and conciliatory — with negotiation guide.',
    label: 'Clause Description', ph: 'Describe the clause you need and the contract context...', rows: 8, role: 'lawyer',
  },

  seniorpartner: {
    id: 'seniorpartner', title: 'AI Senior Partner',
    desc: 'Talk through any case with Ade Bello SAN — 28 years. He gives his view first. Then pushes back.',
    label: 'Your Question', ph: 'Describe your case or situation...', rows: 5, role: 'lawyer', chambers: true,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // NEW LAWYER TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  contradiction_detector: {
    id: 'contradiction_detector', title: 'Contradiction Detector', isNew: true,
    desc: 'Paste two documents from the same party — every inconsistency found and mapped to a cross-examination weapon.',
    label: 'Documents', ph: 'Paste Document A, then --- DOCUMENT B --- separator, then Document B...', rows: 14, role: 'lawyer',
  },

  timeline_extractor: {
    id: 'timeline_extractor', title: 'Timeline Extractor', isNew: true,
    desc: 'Extract every date and event — with legal significance ratings, limitation analysis, and gap identification.',
    label: 'Document', ph: 'Paste any legal document or describe the facts...', rows: 12, role: 'lawyer',
  },

  obligation_extractor: {
    id: 'obligation_extractor', title: 'Obligation Extractor', isNew: true,
    desc: 'Every obligation in any document — who owes it, what must be done, by when, consequence of breach — structured register.',
    label: 'Contract or Document', ph: 'Paste any contract or legal document...', rows: 12, role: 'lawyer',
  },

  risk_delta: {
    id: 'risk_delta', title: 'Risk Delta', isNew: true,
    desc: 'Compare two contract versions — before and after risk scores, every change rated, concealed changes identified.',
    label: 'Both Versions', ph: 'Paste Version 1 then --- VERSION 2 --- then Version 2...', rows: 14, role: 'lawyer',
  },

  letter_chain: {
    id: 'letter_chain', title: 'Letter Chain Analyser', isNew: true,
    desc: 'Paste an entire correspondence chain — track position evolution, find admissions, assess without-prejudice risk.',
    label: 'Correspondence Chain', ph: 'Paste the full sequence of letters separated by --- LETTER [DATE] --- markers...', rows: 14, role: 'lawyer',
  },

  brief_builder: {
    id: 'brief_builder', title: 'Brief Builder', isNew: true,
    desc: 'Assemble a complete Brief of Argument from your research and arguments — proper Nigerian court format, ready to file.',
    label: 'Arguments and Research', ph: 'Paste your issues, arguments, and authorities...', rows: 14, role: 'lawyer',
  },

  precedent_matcher: {
    id: 'precedent_matcher', title: 'Precedent Matcher', isNew: true,
    desc: 'Paste any clause or legal issue — AI searches the verified case database for judicial treatment and surfaces exact holdings.',
    label: 'Clause or Issue', ph: 'Paste the clause or describe the legal issue...', rows: 8, role: 'lawyer',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // JUDGE TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  judgment_composer: {
    id: 'judgment_composer', title: 'Judgment Composer',
    desc: 'Complete workflow: upload facts, extract issues, analyse each issue, generate conclusion, draft formal orders.',
    label: 'Case Materials', ph: 'Paste the full case file, pleadings, grounds of appeal...', rows: 12, role: 'judge',
  },

  court_order: {
    id: 'court_order', title: 'Court Order Generator',
    desc: 'Complete, operative Nigerian court orders for any outcome type.',
    label: 'Case Details', ph: 'Suit number, parties, court, key findings, amounts, special terms...', rows: 10, role: 'judge',
  },

  case_summary_judge: {
    id: 'case_summary_judge', title: 'Case Summary',
    desc: 'Turn any case file into a concise bench summary — facts, issues, applicable law — ready before hearing.',
    label: 'Case File', ph: 'Paste the full case file, pleadings, or briefs...', rows: 12, role: 'judge',
  },

  issue_spotter: {
    id: 'issue_spotter', title: 'Issue Spotter',
    desc: 'Auto-identify precise issues for determination from any case materials.',
    label: 'Case Materials', ph: 'Paste briefs, statement of claim, grounds of appeal...', rows: 12, role: 'judge',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // MAGISTRATE TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  quick_ruling: {
    id: 'quick_ruling', title: 'Quick Ruling',
    desc: 'Complete, court-ready Magistrate Court ruling for any matter type.',
    label: 'Case Facts', ph: 'Suit number, parties, charge or claim, brief facts, what happened today...', rows: 10, role: 'magistrate',
  },

  bail_decision: {
    id: 'bail_decision', title: 'Bail Decision',
    desc: 'Complete bail ruling with proper judicial reasoning addressing all four statutory factors.',
    label: 'Case Details', ph: 'Charge, accused details, age, occupation, criminal record, strength of evidence, community ties...', rows: 12, role: 'magistrate',
  },

  warrant_drafter: {
    id: 'warrant_drafter', title: 'Warrant Drafter',
    desc: 'Any Nigerian Magistrate Court warrant in proper judicial format.',
    label: 'Details', ph: 'Name of accused, address, offence, court name, suit number, date...', rows: 10, role: 'magistrate',
  },

  sentencing_guide: {
    id: 'sentencing_guide', title: 'Sentencing Guide',
    desc: 'Sentencing options, mitigating and aggravating factors, statutory range, and draft pronouncement.',
    label: 'Offence and Accused', ph: 'Offence convicted of, statute, accused background, plea, remorse, antecedents...', rows: 14, role: 'magistrate',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // LEGISLATOR TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  bill_drafter: {
    id: 'bill_drafter', title: 'Bill Drafter',
    desc: 'Complete, constitutionally-sound Nigerian bill — from explanatory memorandum to commencement.',
    label: 'Policy Objective', ph: 'Describe what problem this bill solves, who it applies to, key provisions, offences, regulatory bodies...', rows: 12, role: 'legislator',
  },

  law_comparison: {
    id: 'law_comparison', title: 'Law Comparison',
    desc: 'Compare any area of law across jurisdictions with best practices and legislative recommendations.',
    label: 'Legal Topic', ph: 'Describe the legal topic and the jurisdictions to compare...', rows: 8, role: 'legislator',
  },

  law_simplifier: {
    id: 'law_simplifier', title: 'Plain English Summarizer',
    desc: 'Any statute or bill section in citizen-friendly language — rights, obligations, penalties, who enforces.',
    label: 'Legal Text', ph: 'Paste any statute section, bill clause, or complex legal text...', rows: 12, role: 'legislator',
  },

  impact_assessment: {
    id: 'impact_assessment', title: 'Impact Assessment',
    desc: 'Constitutional compliance, economic effects, social impact, implementation risks, and overall recommendation.',
    label: 'Bill Text', ph: 'Paste the bill text, description, or key provisions...', rows: 14, role: 'legislator',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CLERK TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  clerk_filing: {
    id: 'clerk_filing', title: 'Digital Filing',
    desc: 'Upload any court document — classification, defect check, complete filing checklist, next steps.',
    label: 'Court Document', ph: 'Paste the court document here...', rows: 12, role: 'clerk',
  },

  clerk_classify: {
    id: 'clerk_classify', title: 'Document Classifier',
    desc: 'Classify any document — type, court, fees, service requirements, filing checklist.',
    label: 'Document', ph: 'Describe the document or paste its content...', rows: 12, role: 'clerk',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // PARALEGAL TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  paralegal_research: {
    id: 'paralegal_research', title: 'Research Hub',
    desc: 'Any Nigerian legal question with step-by-step procedure, statutes, documents required, and common mistakes.',
    label: 'Research Question', ph: 'Ask any Nigerian legal question — procedures, statutes, documents, time limits...', rows: 5, role: 'paralegal',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // LAW STUDENT TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  problem_analyzer: {
    id: 'problem_analyzer', title: 'Problem Question Analyser', isNew: true,
    desc: 'Paste a law school problem question — AI spots every issue, maps the law, and shows you how to structure your answer.',
    label: 'Problem Question', ph: 'Paste your law school problem question here...', rows: 10, role: 'student',
  },

  case_explainer: {
    id: 'case_explainer', title: 'Case Explainer', isNew: true,
    desc: 'Any Nigerian case explained at student level — facts, issues, decision, ratio, significance, exam relevance.',
    label: 'Case Name or Text', ph: 'Name the case or paste the judgment text...', rows: 6, role: 'student',
  },

  moot_prep: {
    id: 'moot_prep', title: 'Moot Prep', isNew: true,
    desc: 'Both sides of any moot problem — strongest arguments, hardest bench questions, and best answers for each.',
    label: 'Moot Problem', ph: 'Paste the moot problem and any additional instructions...', rows: 10, role: 'student',
  },

  assignment_reviewer: {
    id: 'assignment_reviewer', title: 'Assignment Reviewer', isNew: true,
    desc: 'Paste your draft answer — structure assessment, legal accuracy check, and specific improvement guidance.',
    label: 'Your Draft Answer', ph: 'Paste your draft assignment answer here...', rows: 12, role: 'student',
  },

  doctrine_tracker: {
    id: 'doctrine_tracker', title: 'Doctrine Tracker', isNew: true,
    desc: 'Trace any legal doctrine through Nigerian law — origins, evolution, current state, unsettled questions.',
    label: 'Doctrine or Principle', ph: 'Name the doctrine or legal principle you want to trace...', rows: 5, role: 'student',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BUSINESS OWNER TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  legal_health_check: {
    id: 'legal_health_check', title: 'Legal Health Check', isNew: true,
    desc: 'Score your business across five legal dimensions — contractual exposure, employment, regulatory, IP, dispute readiness.',
    label: 'Business Details', ph: 'Describe your business — type, industry, size, employees, contracts, disputes, licences...', rows: 10, role: 'business_owner',
  },

  contract_plain: {
    id: 'contract_plain', title: 'Contract in Plain English', isNew: true,
    desc: 'Paste any contract — every clause explained in plain business English with dangers prominently flagged.',
    label: 'Contract', ph: 'Paste the contract you want explained...', rows: 12, role: 'business_owner',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CORPORATE COUNSEL TOOLS
  // ══════════════════════════════════════════════════════════════════════════

  contract_playbook: {
    id: 'contract_playbook', title: 'Contract Playbook Builder', isNew: true,
    desc: 'Build a repeatable negotiation playbook for any standard contract type — ideal positions, fallbacks, red lines.',
    label: 'Contract Type and Context', ph: "Describe the contract type, your company's typical position, key commercial terms...", rows: 10, role: 'corporate_counsel',
  },

  regulatory_radar: {
    id: 'regulatory_radar', title: 'Regulatory Radar', isNew: true,
    desc: 'Describe any business activity — get every applicable Nigerian regulatory obligation, licence, and compliance calendar.',
    label: 'Business Activity', ph: 'Describe the business activity or proposed transaction...', rows: 10, role: 'corporate_counsel',
  },

  board_paper_reviewer: {
    id: 'board_paper_reviewer', title: 'Board Paper Reviewer', isNew: true,
    desc: 'Review board papers before they go to the board — authority check, accuracy check, risk identification for directors.',
    label: 'Board Papers', ph: 'Paste the board papers or resolutions for review...', rows: 12, role: 'corporate_counsel',
  },

  // ══════════════════════════════════════════════════════════════════════════
  // VAULT / MATTER TOOLS (no AI prompt needed — UI only)
  // ══════════════════════════════════════════════════════════════════════════

  matterclock: { id: 'matterclock', title: 'Matter Clock', desc: 'Every active case on one board. Check this every morning.', role: 'lawyer' },
  vault: { id: 'vault', title: 'Document Vault', desc: 'Every analyzed document saved to the cloud automatically.', role: 'lawyer' },
  cases: { id: 'cases', title: 'Case Workspaces', desc: 'Organise all your work by matter with full context injection.', role: 'lawyer' },
  profile: { id: 'profile', title: 'My Profile', desc: 'Account, subscription, and settings.', role: 'lawyer' },
  upgrade: { id: 'upgrade', title: 'Upgrade Plan', desc: 'Unlock more features.', role: 'lawyer' },
  dashboard: { id: 'dashboard', title: 'Dashboard', desc: 'Your legal intelligence home.', role: 'lawyer' },
};

// ── Tool lookup helpers ───────────────────────────────────────────────────────
function getToolConfig(toolId) {
  return AI_CONFIGS[toolId] || null;
}

function getAllToolIds() {
  return Object.keys(AI_CONFIGS);
}

function getToolsByRole(role) {
  return Object.values(AI_CONFIGS).filter(t => t.role === role);
}

module.exports = { AI_CONFIGS, getToolConfig, getAllToolIds, getToolsByRole };
