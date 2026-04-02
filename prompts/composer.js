'use strict';

/**
 * VERDICT AI — PROMPT COMPOSER
 * Assembles all layers into the final system prompt.
 * prompts/composer.js
 */

const { IDENTITY_CORE } = require('./identity');
const { ROLE_VOICES } = require('./roles');
const { COGNITIVE_TASKS } = require('./cognitive');
const { OUTPUT_STRUCTURES } = require('./structures');
const { COURT_PROFILES } = require('./courts');

/**
 * Resolves the cognitive task for a given toolId.
 * Tries exact match first, then partial match.
 */
function resolveCognitiveTask(toolId) {
  if (!toolId) return '';
  if (COGNITIVE_TASKS[toolId]) return COGNITIVE_TASKS[toolId];
  // Partial match — e.g. 'docanalysis' matches 'reader'
  const aliases = {
    docanalysis: 'reader',
    analysis: 'reader',
    qa: 'nigeriancases',
    pleadings: 'pleadingcheck',
    pleadingcheck: 'pleadingcheck',
    witness: 'crossexam',
    evidence: 'reader',
    seniorpartner: 'warroom',
    settlement: 'warroom',
    judgment_composer: 'brief_builder',
    court_order: 'motionammo',
    case_summary_judge: 'digest',
    issue_spotter: 'pleadingcheck',
    quick_ruling: 'motionammo',
    bail_decision: 'motionammo',
    warrant_drafter: 'draft',
    sentencing_guide: 'digest',
    clerk_filing: 'pleadingcheck',
    clerk_classify: 'pleadingcheck',
    bill_drafter: 'draft',
    law_comparison: 'legalmemo',
    law_simplifier: 'statute',
    impact_assessment: 'legalmemo',
    paralegal_research: 'nigeriancases',
    negotiation: 'risk_delta',
    correspondence: 'letter_chain',
    whatsapp: 'reader',
    feenote: 'draft',
    intakememo: 'draft',
    clientreport: 'draft',
    explainer: 'contract_plain',
    jurisdiction: 'legalmemo',
    compliancecal: 'deadlines',
    precedent: 'precedent_matcher',
    matterclock: 'deadlines',
    briefscore: 'briefscore',
    courtpredictor: 'courtpredictor',
  };
  const aliased = aliases[toolId];
  return aliased ? (COGNITIVE_TASKS[aliased] || '') : '';
}

/**
 * Resolves the output structure for a given toolId.
 */
function resolveOutputStructure(toolId) {
  if (!toolId) return OUTPUT_STRUCTURES.default;
  if (OUTPUT_STRUCTURES[toolId]) return OUTPUT_STRUCTURES[toolId];
  // Use default for tools without specific output structures
  return OUTPUT_STRUCTURES.default;
}

/**
 * Formats the matter context block for injection.
 */
function formatMatterBlock(matterContext) {
  if (!matterContext || !matterContext.name) return '';

  const facts = Array.isArray(matterContext.established_facts)
    ? matterContext.established_facts.map(f => `  — ${f}`).join('\n')
    : '';

  const weaknesses = Array.isArray(matterContext.known_weaknesses)
    ? matterContext.known_weaknesses.map(w => `  — ${w}`).join('\n')
    : '';

  return `
=== MATTER INTELLIGENCE — AUTO-INJECTED FROM WORKSPACE ===
Matter Name: ${matterContext.name}
Court: ${matterContext.court || 'Not specified'}
Current Stage: ${matterContext.stage || 'Not specified'}
Parties: ${matterContext.parties || 'Not specified'}
${facts ? `Established facts from previous analysis sessions:\n${facts}` : ''}
${matterContext.strategy_notes ? `Strategy notes from previous sessions: ${matterContext.strategy_notes}` : ''}
${weaknesses ? `Known vulnerabilities from previous analysis:\n${weaknesses}` : ''}

INSTRUCTION: Apply this matter context directly. Do not ask the user to re-enter any information already established in this matter. Build on the existing analysis — do not start from scratch.
=== END MATTER INTELLIGENCE ===
`.trim();
}

/**
 * Formats the court intelligence block for injection.
 */
function formatCourtBlock(courtId) {
  if (!courtId) return '';
  const profile = COURT_PROFILES[courtId];
  if (!profile) return '';
  return `
=== COURT-SPECIFIC INTELLIGENCE ===
${profile.trim()}
=== END COURT INTELLIGENCE ===
`.trim();
}

/**
 * Main composer function.
 * Builds the complete layered system prompt from all five layers.
 *
 * @param {string} role - User role key
 * @param {string} toolId - Tool identifier
 * @param {string} groundingContext - Verified database context from grounding service
 * @param {object|null} matterContext - Matter workspace context
 * @param {string} courtId - Court profile key
 * @returns {string} Complete system prompt
 */
function buildSystemPrompt(role = 'lawyer', toolId = '', groundingContext = '', matterContext = null, courtId = '') {
  const roleVoice = ROLE_VOICES[role] || ROLE_VOICES.lawyer;
  const cognitiveTask = resolveCognitiveTask(toolId);
  const outputStructure = resolveOutputStructure(toolId);
  const matterBlock = formatMatterBlock(matterContext);
  const courtBlock = formatCourtBlock(courtId);

  const layers = [
    IDENTITY_CORE.trim(),
    roleVoice.trim(),
    matterBlock || null,
    courtBlock || null,
    cognitiveTask.trim() || null,
    outputStructure.trim(),
    // Grounding context injected last — closest to the user message
    groundingContext && groundingContext.trim() ? groundingContext.trim() : null,
  ].filter(Boolean);

  return layers.join('\n\n');
}

module.exports = { buildSystemPrompt, resolveCognitiveTask, resolveOutputStructure };
