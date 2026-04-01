'use strict';

/**
 * VERDICT AI - ORCHESTRATOR SERVICE
 * AI routing, preprocessing, and failover logic.
 */

const { groqStream, getGroqKey, aiLog } = require('./groq');
const { GPT_PRIMARY, GPT_SECONDARY, getOrKey, openRouterStream } = require('./openrouter');
const { hasSelfHostedModel, selfHostedStream, getSelfHostedConfig } = require('./selfhosted');
const { HEAVY_TOOLS, detectDocumentType } = require('../tools/preprocess');

async function callWithFailover(system, user) {
  const groqKey = getGroqKey();
  const orKey = getOrKey();

  if (hasSelfHostedModel()) {
    try {
      aiLog('Trying self-hosted model...');
      const res = await selfHostedStream(system, user);
      if (res.statusCode === 200) return { aiRes: res, engine: `self-hosted:${getSelfHostedConfig().name}` };
      let err = '';
      for await (const chunk of res) err += chunk;
      aiLog(`Self-hosted failed ${res.statusCode}: ${err.slice(0, 80)}`);
    } catch (error) {
      aiLog(`Self-hosted error: ${error.message}`);
    }
  }

  if (!orKey) {
    if (!groqKey) throw new Error('No AI engine configured');
    aiLog('No OpenRouter key - Groq direct');
    return { aiRes: await groqStream(system, user), engine: 'groq-direct' };
  }

  const models = [
    { model: GPT_PRIMARY, name: 'gpt-120b' },
    { model: GPT_PRIMARY, name: 'gpt-120b-retry' },
    { model: GPT_SECONDARY, name: 'gpt-20b' },
    { model: GPT_SECONDARY, name: 'gpt-20b-retry' },
  ];

  for (const { model, name } of models) {
    try {
      aiLog(`Trying ${name}...`);
      const res = await openRouterStream(model, system, user);
      if (res.statusCode === 200) return { aiRes: res, engine: name };
      let err = '';
      for await (const chunk of res) err += chunk;
      aiLog(`${name} failed ${res.statusCode}: ${err.slice(0, 80)}`);
      if (/guardrail|No endpoints/i.test(err) && groqKey) {
        aiLog('OpenRouter blocked - Groq policy fallback');
        return { aiRes: await groqStream(system, user), engine: 'groq-policy-fallback' };
      }
    } catch (error) {
      aiLog(`${name} error: ${error.message}`);
    }
  }

  if (!groqKey) throw new Error('All AI engines failed');
  aiLog('All GPT routes failed - Groq fallback');
  return { aiRes: await groqStream(system, user), engine: 'groq-fallback' };
}

async function orchestrate(toolId, system, user) {
  const isHeavy = HEAVY_TOOLS.has(toolId);

  if (!isHeavy) {
    if (hasSelfHostedModel()) {
      aiLog(`Simple: self-hosted -> ${toolId}`);
      return { aiRes: await selfHostedStream(system, user), engine: 'self-hosted' };
    }
    const groqKey = getGroqKey();
    if (!groqKey) return callWithFailover(system, user);
    aiLog(`Simple: Groq -> ${toolId}`);
    return { aiRes: await groqStream(system, user), engine: 'groq' };
  }

  if (toolId === 'reader' || toolId === 'docanalysis' || toolId === 'analysis') {
    const [, modelResult] = await Promise.allSettled([
      detectDocumentType(user),
      callWithFailover(system, user),
    ]);

    if (modelResult.status === 'fulfilled') return modelResult.value;

    const groqKey = getGroqKey();
    if (!groqKey) throw new Error('No AI engine available');
    return { aiRes: await groqStream(system, user), engine: 'groq-fallback' };
  }

  aiLog(`Heavy: parallel orchestration -> ${toolId}`);
  const [, modelResult] = await Promise.allSettled([
    detectDocumentType(user),
    callWithFailover(system, user),
  ]);

  if (modelResult.status === 'fulfilled') return modelResult.value;

  const groqKey = getGroqKey();
  if (!groqKey) throw new Error('Orchestration failed - no fallback');
  aiLog('Emergency Groq fallback');
  return { aiRes: await groqStream(system, user), engine: 'groq-emergency' };
}

module.exports = {
  orchestrate,
  callWithFailover,
};
