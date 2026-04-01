'use strict';

/**
 * VERDICT AI — CITATION VERIFICATION SERVICE
 * Post-generation citation checking.
 * services/citation.js
 */

const { groqSync } = require('./groq');
const { CITATION_VERIFY_SYSTEM } = require('../prompts');

async function verifyCitations(responseText, groundingContext) {
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  if (!groqKey || !responseText || responseText.length < 150) return null;

  try {
    const user = `VERIFIED DATABASE RECORDS USED IN THIS ANALYSIS:\n${groundingContext || 'None provided'}\n\nANALYSIS TO VERIFY:\n${responseText.slice(0, 4000)}`;

    const result = await Promise.race([
      groqSync(CITATION_VERIFY_SYSTEM, user, 800),
      new Promise(r => setTimeout(() => r(null), 6000)),
    ]);

    return result || null;
  } catch {
    return null;
  }
}

function buildCitationNote(verificationResult) {
  if (!verificationResult) return '';
  if (verificationResult.includes('LOW')) {
    return '\n\nCITATION CONFIDENCE: LOW — One or more case citations in this analysis were not found in the verified database. Verify all case citations independently before filing or advising.';
  }
  if (verificationResult.includes('MEDIUM')) {
    return '\n\nCITATION CONFIDENCE: MEDIUM — Some citations in this analysis were not found in the verified database. Confirm all case citations before relying on them in proceedings.';
  }
  return '';
}

module.exports = { verifyCitations, buildCitationNote };
