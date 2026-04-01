'use strict';

const { supabase } = require('../services/supabase');

const ADMIN_SECRET = (process.env.ADMIN_SECRET || '').trim();

async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid session' });

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET) return res.status(503).json({ error: 'ADMIN_SECRET not configured' });
  const provided = (req.headers['x-admin-secret'] || '').trim();
  if (!provided || provided !== ADMIN_SECRET) return res.status(403).json({ error: 'Admin access denied' });
  next();
}

module.exports = {
  requireAuth,
  requireAdmin,
};
