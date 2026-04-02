'use strict';

/**
 * VERDICT AI — ORCHESTRATOR SERVICE
 * AI routing, preprocessing, and failover logic.
 * services/orchestrator.js
 */

const { groqSync, groqStream, callWithFailover, hasSelfHostedModel, selfHostedStream, getSelfHostedConfig, aiLog } = require('./ai-models');

const HEAVY_TOOLS = new Set([
  'reader', 'docanalysis', 'warroom', 'seniorpartner', 'claimanalyser',
  'clausedna', 'settlement', 'opposing', 'strength', 'crossexam', 'evidence',
  'witness', 'motionammo', 'briefscore', 'pleadingcheck', 'negotiation',
  'clientprep', 'deadlines', 'compliancecal', 'whatsapp', 'feenote', 'intakememo',
  'contradiction_detector', 'risk_delta', 'letter_chain', 'brief_builder',
  'legal_health_check', 'contract_playbook', 'board_paper_reviewer',
  'contract_plain', 'obligation_extractor',
]);

// Document type detection via Groq preprocessing
async function detectDocumentType(userText) {
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  if (!groqKey) return '';

  const system = `You are a Nigerian legal document classifier. Identify the EXACT document type from: Statement of Claim, Statement of Defence, Affidavit, Counter-Affidavit, Originating Summons, Motion on Notice, Motion Ex Parte, Writ of Summons, Petition, Charge Sheet, Contract or Agreement, Deed, Brief of Argument, Statute or Act, Judgment or Ruling, Correspondence or Letter, Other.

Respond with ONLY:
DOCUMENT_TYPE: [exact type]
PARTIES: [claimant vs defendant if identifiable]
COURT: [court and state if identifiable]
KEY_ISSUE: [one sentence — what this document is about]`;

  try {
    const result = await Promise.race([
      groqSync(system, userText.slice(0, 3000), 300),
      new Promise(r => setTimeout(() => r(''), 4000)),
    ]);
    return result || '';
  } catch {
    return '';
  }
}

// Build document type prefix for system prompt
function buildDocTypePreamble(detection) {
  if (!detection) return '';
  const typeLine = detection.match(/DOCUMENT_TYPE:\s*(.+)/i)?.[1]?.trim() || '';
  if (!typeLine) return '';

  const isClaim = /statement\s+of\s+claim/i.test(typeLine);
  const isDefence = /statement\s+of\s+de[fn]/i.test(typeLine);
  const isAffidavit = /affidavit/i.test(typeLine);
  const isMotion = /motion/i.test(typeLine);
  const isJudgment = /judgment|ruling/i.test(typeLine);

  if (isClaim) return `DOCUMENT IDENTIFIED: Statement of Claim — this is a litigation pleading. Apply litigation pleading analysis ONLY. Do not apply contract analysis. Analyze the pleading's sufficiency, traversals required, reliefs formulated, and jurisdiction invoked.\n\n`;
  if (isDefence) return `DOCUMENT IDENTIFIED: Statement of Defence — this is a litigation pleading. Apply litigation defence analysis ONLY. Do not apply contract analysis. Analyze traversals, positive defences, missing denials, and counterclaim opportunities.\n\n`;
  if (isAffidavit) return `DOCUMENT IDENTIFIED: Affidavit — apply affidavit analysis. Check deponent's competence, sworn facts versus belief, admissibility of exhibits, and consistency with pleadings.\n\n`;
  if (isMotion) return `DOCUMENT IDENTIFIED: ${typeLine} — apply motion/application analysis. Assess grounds, supporting affidavit adequacy, reliefs formulated, and procedural compliance.\n\n`;
  if (isJudgment) return `DOCUMENT IDENTIFIED: Judgment or Ruling — apply judicial analysis. Extract ratio decidendi, obiter dicta, authorities applied, and practice implications.\n\n`;
  return `DOCUMENT IDENTIFIED: ${typeLine}\n\n`;
}

async function orchestrate(toolId, system, user) {
  // Groq-primary. Always use Groq directly.
  aiLog(`Groq → ${toolId}`);
  try {
    const res = await groqStream(system, user);
    return { aiRes: res, engine: 'groq' };
  } catch (err) {
    aiLog(`Groq error: ${err.message} — retrying once`);
    await new Promise(r => setTimeout(r, 2000));
    const res = await groqStream(system, user);
    return { aiRes: res, engine: 'groq-retry' };
  }
}

module.exports = { orchestrate, detectDocumentType, buildDocTypePreamble, HEAVY_TOOLS };
