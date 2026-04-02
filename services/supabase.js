'use strict';

/**
 * VERDICT AI — SUPABASE SERVICE
 * Supabase client singleton + profile cache.
 * services/supabase.js
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Profile cache ─────────────────────────────────────────────────────────────
const profileCache = new Map();
const PROFILE_CACHE_TTL = 60_000; // 60 seconds

async function getCachedProfile(userId) {
  const cached = profileCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.profile;

  const { data } = await supabase
    .from('profiles')
    .select('tier, usage_count, usage_reset_date, tier_expiry, role, full_name, auto_renew')
    .eq('id', userId)
    .single();

  if (data) {
    profileCache.set(userId, { profile: data, expiresAt: Date.now() + PROFILE_CACHE_TTL });
  }
  return data;
}

async function getFullProfile(userId) {
  const cached = profileCache.get(userId + '_full');
  if (cached && Date.now() < cached.expiresAt) return cached.profile;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (data) {
    profileCache.set(userId + '_full', { profile: data, expiresAt: Date.now() + PROFILE_CACHE_TTL });
  }
  return { data, error };
}

function invalidateProfileCache(userId) {
  profileCache.delete(userId);
  profileCache.delete(userId + '_full');
}

// ── Usage tracking ────────────────────────────────────────────────────────────
async function checkAndIncrementUsage(userId) {
  const profile = await getCachedProfile(userId);
  if (!profile) return { allowed: true };

  // Check tier expiry
  if (profile.tier !== 'free' && profile.tier_expiry) {
    if (new Date(profile.tier_expiry) < new Date()) {
      await supabase.from('profiles').update({ tier: 'free' }).eq('id', userId);
      invalidateProfileCache(userId);
      profile.tier = 'free';
      profile.usage_count = 0;
    }
  }

  // Monthly reset check
  const resetDate = new Date(profile.usage_reset_date || 0);
  const now = new Date();
  if (now.getMonth() !== resetDate.getMonth() || now.getFullYear() !== resetDate.getFullYear()) {
    await supabase.from('profiles').update({
      usage_count: 0,
      usage_reset_date: now.toISOString()
    }).eq('id', userId);
    invalidateProfileCache(userId);
    profile.usage_count = 0;
  }

  // Free tier limit
  if (profile.tier === 'free' && profile.usage_count >= 3) {
    return { allowed: false, reason: 'FREE_LIMIT_REACHED' };
  }

  // Increment usage
  await supabase.from('profiles').update({
    usage_count: (profile.usage_count || 0) + 1
  }).eq('id', userId);
  invalidateProfileCache(userId);

  return { allowed: true };
}

module.exports = {
  supabase,
  getCachedProfile,
  getFullProfile,
  invalidateProfileCache,
  checkAndIncrementUsage,
};
