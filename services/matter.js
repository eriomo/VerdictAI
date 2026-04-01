'use strict';

/**
 * VERDICT AI — MATTER CONTEXT SERVICE
 * Fetches and formats matter workspace context for AI injection.
 * services/matter.js
 */

const { supabase } = require('./supabase');

async function getMatterContext(matterId, userId) {
  if (!matterId || !userId) return null;
  try {
    const { data, error } = await supabase
      .from('cases')
      .select('*')
      .eq('id', matterId)
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;

    // Parse JSON fields
    let established_facts = [];
    let known_weaknesses = [];
    try { established_facts = JSON.parse(data.established_facts || '[]'); } catch {}
    try { known_weaknesses = JSON.parse(data.known_weaknesses || '[]'); } catch {}

    return {
      name: data.name,
      court: data.court || '',
      stage: data.stage || data.status || '',
      parties: data.parties || '',
      strategy_notes: data.strategy_notes || '',
      established_facts: Array.isArray(established_facts) ? established_facts : [],
      known_weaknesses: Array.isArray(known_weaknesses) ? known_weaknesses : [],
    };
  } catch {
    return null;
  }
}

async function updateMatterIntelligence(matterId, userId, updates) {
  const allowed = ['established_facts', 'known_weaknesses', 'strategy_notes', 'parties', 'court', 'stage'];
  const fields = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      fields[key] = typeof updates[key] === 'object'
        ? JSON.stringify(updates[key])
        : String(updates[key]);
    }
  }
  if (!Object.keys(fields).length) return null;

  const { data, error } = await supabase
    .from('cases')
    .update(fields)
    .eq('id', matterId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

module.exports = { getMatterContext, updateMatterIntelligence };
