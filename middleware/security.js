'use strict';

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://js.paystack.co; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://paystack.com; style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://paystack.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https: blob:; manifest-src 'self'; connect-src 'self' https://api.groq.com https://openrouter.ai https://api.anthropic.com https://verdictai.com.ng https://api.paystack.co https://checkout.paystack.com https://*.supabase.co wss://*.supabase.co https://unpkg.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; frame-src 'self' https://js.paystack.co https://checkout.paystack.com; worker-src 'self' blob:;"
  );
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = {
  securityHeaders,
  isUuid,
  stringOrEmpty,
};
