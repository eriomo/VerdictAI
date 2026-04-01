'use strict';

const ipRequests = new Map();
const userAiCalls = new Map();

function getIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (forwarded ? forwarded.split(',')[0] : req.socket?.remoteAddress || 'unknown').trim();
}

function checkRateLimit(store, key, limit, windowMs) {
  const now = Date.now();
  let record = store.get(key);
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + windowMs };
    store.set(key, record);
  }
  record.count += 1;
  return { allowed: record.count <= limit, count: record.count, limit };
}

function ipRateLimit(req, res, next) {
  const ip = getIP(req);
  const { allowed } = checkRateLimit(ipRequests, `ip:${ip}`, 240, 60_000);
  if (!allowed) {
    res.setHeader('Retry-After', '60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(429).json({ error: 'Too many requests. Please wait and try again.' });
  }
  next();
}

function checkUserAiLimit(userId) {
  return checkRateLimit(userAiCalls, `user:${userId}`, 30, 3_600_000);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of ipRequests) if (now > value.resetAt) ipRequests.delete(key);
  for (const [key, value] of userAiCalls) if (now > value.resetAt) userAiCalls.delete(key);
}, 5 * 60_000);

module.exports = {
  ipRateLimit,
  checkUserAiLimit,
};
