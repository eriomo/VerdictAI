'use strict';

/**
 * VERDICT AI — PROMPTS INDEX
 * Single entry point for all prompt exports.
 * prompts/index.js
 *
 * server.js uses: const { buildSystemPrompt, CITATION_VERIFY_SYSTEM } = require('./prompts');
 */

const { IDENTITY_CORE } = require('./identity');
const { ROLE_VOICES } = require('./roles');
const { COGNITIVE_TASKS } = require('./cognitive');
const { OUTPUT_STRUCTURES } = require('./structures');
const { CITATION_VERIFY_SYSTEM } = require('./verify');
const { COURT_PROFILES } = require('./courts');
const { buildSystemPrompt, resolveCognitiveTask, resolveOutputStructure } = require('./composer');

module.exports = {
  // Assembled prompt builder — primary export used by server
  buildSystemPrompt,

  // Individual layers — exported for testing and admin
  IDENTITY_CORE,
  ROLE_VOICES,
  COGNITIVE_TASKS,
  OUTPUT_STRUCTURES,
  CITATION_VERIFY_SYSTEM,
  COURT_PROFILES,

  // Utility functions
  resolveCognitiveTask,
  resolveOutputStructure,
};
