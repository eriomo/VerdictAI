const CACHE_NAME = 'verdict-ai-v4.6';
const OFFLINE_URL = '/offline.html';

// Files to cache for offline shell
const SHELL_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

// Install — cache shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(SHELL_ASSETS).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Don't cache API calls, Supabase, or external resources
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('supabase') ||
    url.hostname.includes('paystack') ||
    url.hostname.includes('anthropic') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('unpkg') ||
    url.hostname.includes('cdnjs') ||
    request.method !== 'GET'
  ) {
    return;
  }

  // For navigation requests — network first, fall back to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/').then(r => r || new Response(getOfflineHTML(), {
          headers: { 'Content-Type': 'text/html' }
        }))
      )
    );
    return;
  }

  // For other assets — cache first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => new Response('', { status: 408 }));
    })
  );
});

function getOfflineHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Verdict AI — Offline</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#07101c;color:#F0EDE6;font-family:'DM Sans',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}
.container{text-align:center;max-width:400px;}
.logo{width:72px;height:72px;background:linear-gradient(135deg,#C8A45E,#D4B474);border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:900;color:#07101c;margin:0 auto 24px;font-family:Georgia,serif;}
h1{font-family:Georgia,serif;font-size:28px;font-weight:700;margin-bottom:8px;}
h1 span{color:#C8A45E;}
.tagline{font-size:13px;color:rgba(240,237,230,0.4);font-style:italic;margin-bottom:32px;}
.offline-box{background:rgba(12,26,46,0.8);border:1px solid rgba(30,52,82,0.9);border-radius:16px;padding:28px;margin-bottom:24px;}
.offline-box h2{font-family:Georgia,serif;font-size:18px;color:#C8A45E;margin-bottom:8px;}
.offline-box p{font-size:13px;color:rgba(240,237,230,0.55);line-height:1.7;}
.features{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px;}
.feature{background:rgba(200,164,94,0.06);border:1px solid rgba(200,164,94,0.15);border-radius:10px;padding:12px;text-align:left;}
.feature-name{font-size:12px;font-weight:600;color:#F0EDE6;margin-bottom:3px;}
.feature-desc{font-size:11px;color:rgba(240,237,230,0.4);}
.retry{display:inline-block;margin-top:24px;padding:12px 28px;border-radius:9px;background:linear-gradient(135deg,#C8A45E,#D4B474);color:#07101c;font-weight:700;font-size:14px;cursor:pointer;border:none;font-family:inherit;}
</style>
</head>
<body>
<div class="container">
  <div class="logo">V</div>
  <h1>Verdict<span>AI</span></h1>
  <p class="tagline">From documents to decisions.</p>
  <div class="offline-box">
    <h2>You're currently offline</h2>
    <p>Verdict AI requires an internet connection to run AI analysis. Please check your connection and try again.</p>
    <div class="features">
      <div class="feature"><div class="feature-name">Document Analysis</div><div class="feature-desc">Available online</div></div>
      <div class="feature"><div class="feature-name">Case War Room</div><div class="feature-desc">Available online</div></div>
      <div class="feature"><div class="feature-name">Matter Clock</div><div class="feature-desc">Available offline</div></div>
      <div class="feature"><div class="feature-name">Document Vault</div><div class="feature-desc">Available online</div></div>
    </div>
  </div>
  <button class="retry" onclick="window.location.reload()">Try Again</button>
</div>
</body>
</html>`;
}
