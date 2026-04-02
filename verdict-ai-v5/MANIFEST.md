# VERDICT AI v5.0 — COMPLETE FILE MANIFEST
# Every file listed. Drop order matters. Follow this exactly.

## REPOSITORY STRUCTURE

verdict-ai/                          ← your repo root
├── server.js                        ← REPLACE: main server entry point
├── package.json                     ← REPLACE: add new dependencies
├── prompts/
│   ├── identity.js                  ← NEW: Layer 1 - identity core + rules
│   ├── roles.js                     ← NEW: Layer 2 - all 9 role voices
│   ├── cognitive.js                 ← NEW: Layer 3 - per-tool thinking protocols
│   ├── structures.js                ← NEW: Layer 4 - mandatory output formats
│   ├── verify.js                    ← NEW: Layer 5 - citation verification
│   ├── courts.js                    ← NEW: court-specific intelligence profiles
│   ├── composer.js                  ← NEW: buildSystemPrompt() - assembles all layers
│   └── index.js                     ← NEW: exports everything, entry point for server
├── middleware/
│   ├── auth.js                      ← NEW: requireAuth middleware
│   ├── rateLimit.js                 ← NEW: rate limiting logic
│   ├── cors.js                      ← NEW: CORS configuration
│   └── security.js                  ← NEW: security headers
├── routes/
│   ├── ai.js                        ← NEW: /api/ai endpoint (main AI route)
│   ├── documents.js                 ← NEW: document CRUD
│   ├── cases.js                     ← NEW: case/matter CRUD + intelligence
│   ├── profile.js                   ← NEW: user profile
│   ├── payments.js                  ← NEW: Paystack integration
│   ├── knowledge.js                 ← NEW: case search + admin knowledge endpoints
│   └── health.js                    ← NEW: health + config endpoints
├── services/
│   ├── supabase.js                  ← NEW: supabase client + profile cache
│   ├── groq.js                      ← NEW: Groq API calls
│   ├── openrouter.js                ← NEW: OpenRouter API calls
│   ├── selfhosted.js                ← NEW: self-hosted model support
│   ├── orchestrator.js              ← NEW: AI routing + failover logic
│   ├── grounding.js                 ← NEW: database retrieval + context building
│   ├── corpus.js                    ← NEW: disk corpus + knowledge bank
│   ├── cache.js                     ← NEW: AI response cache
│   ├── citation.js                  ← NEW: post-generation citation verification
│   ├── matter.js                    ← NEW: matter context injection
│   └── email.js                     ← NEW: nodemailer email service
├── tools/
│   ├── configs.js                   ← NEW: complete AI_CONFIGS registry (all tools)
│   └── preprocess.js                ← NEW: document type detection + preprocessing
└── public/
    └── index.html                   ← REPLACE: complete frontend v5.0

## DROP ORDER (critical — follow exactly)

STEP 1: Create directories
  mkdir -p prompts middleware routes services tools

STEP 2: Drop service files first (no dependencies on other new files)
  services/supabase.js
  services/cache.js
  services/email.js
  services/corpus.js
  services/groq.js
  services/openrouter.js
  services/selfhosted.js

STEP 3: Drop prompt files
  prompts/identity.js
  prompts/roles.js
  prompts/cognitive.js
  prompts/structures.js
  prompts/verify.js
  prompts/courts.js
  prompts/composer.js
  prompts/index.js

STEP 4: Drop tool files
  tools/configs.js
  tools/preprocess.js

STEP 5: Drop service files that depend on above
  services/grounding.js
  services/orchestrator.js
  services/citation.js
  services/matter.js

STEP 6: Drop middleware
  middleware/cors.js
  middleware/security.js
  middleware/rateLimit.js
  middleware/auth.js

STEP 7: Drop routes
  routes/health.js
  routes/knowledge.js
  routes/documents.js
  routes/cases.js
  routes/profile.js
  routes/payments.js
  routes/ai.js

STEP 8: Drop root files
  package.json
  server.js

STEP 9: Drop frontend
  public/index.html

## TOTAL FILES: 30 new/replaced files
## ZERO files deleted from existing structure except server.js and public/index.html
