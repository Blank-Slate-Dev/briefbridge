# BriefBridge

AI-powered Australian case law research for legal practitioners.

## Status: Parser verified working ✅

The NSW Caselaw HTML parser in `lib/parsers/nsw-caselaw.ts` has been tested against a real
NSW Supreme Court judgment ([2026] NSWSC 474). It correctly extracts:

- Case name, citation, court, jurisdiction
- Decision date, hearing dates, judges
- Catchwords (legal topic summary)
- Cases Cited — as structured `{ name, citation }` pairs (citation graph for free)
- Legislation Cited — with section parsing
- Parties and Representation
- All numbered paragraphs with their section headings
- File numbers, category, suppression flags

## Tonight's setup checklist

### 1. Set up Supabase

1. Create a project at supabase.com (region: Singapore for AU latency)
2. Save the database password somewhere safe
3. Run `create extension if not exists vector;` in the SQL Editor (for week 2)
4. Grab Database URL (Transaction Pooler), Project URL, and anon key from Settings

### 2. Scaffold the Next.js project

```powershell
cd C:\Users\osr99\OneDrive\Documents\GitHub\local
npx create-next-app@latest briefbridge --typescript --tailwind --app --no-src-dir --import-alias "@/*" --eslint
cd briefbridge
```

### 3. Install dependencies

```powershell
npm install drizzle-orm postgres @supabase/supabase-js zod cheerio
npm install -D drizzle-kit @types/node tsx dotenv
```

### 4. Drop in the generated files

Copy from this output folder into your project at matching paths:
- `lib/db/schema.ts`
- `lib/db/index.ts`
- `lib/parsers/nsw-caselaw.ts`
- `scripts/ingest-nsw-single.ts`
- `app/api/health/route.ts`
- `drizzle.config.ts`
- `.env.local.example` → rename to `.env.local` and fill in real values

### 5. Add scripts to package.json

Open `package.json`, find the `"scripts"` section, add these (don't replace existing):

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio",
"ingest:nsw": "tsx scripts/ingest-nsw-single.ts"
```

### 6. Generate and apply database migration

```powershell
npm run db:generate
npm run db:migrate
```

### 7. Verify connection

```powershell
npm run dev
```

Open http://localhost:3000/api/health — should return `{ "status": "ok", "judgmentCount": 0, ... }`

### 8. Ingest a real judgment

```powershell
npm run ingest:nsw -- https://www.caselaw.nsw.gov.au/decision/19dffa6432c645fbf145d0ed
```

(That's the same judgment we tested the parser against — Zacharatos v Western Agricultural.)

You should see successful `[parse]` and `[insert]` logs.

### 9. Inspect the data

```powershell
npm run db:studio
```

Open the `judgments` table in the Drizzle Studio UI. You should see one row with all
the parsed metadata, including `cases_cited` as a JSON array.

## What's next (week 2)

- Bulk ingestion: scrape the recent decisions list from the Caselaw homepage and
  ingest each one (with 2s rate limiting)
- pgvector embeddings: generate vector embeddings of each paragraph (not just whole
  judgments) using Voyage AI's law-specific model
- Search API: `/api/search` endpoint that takes a fact pattern and returns ranked
  paragraphs with citations
- Anthropic API integration: pass top-K paragraphs to Claude for grounded
  precedent analysis

## Compliance reminders

- Republishing NSW Caselaw judgments is permitted under their Access Policy, with conditions
- Source attribution is mandatory on every judgment view
- Search engine bots must be excluded from indexing judgment content (robots.txt + noindex)
- Suppression orders detected via `publicationRestriction` field — review before display
- Court inquiry emails should still be sent this week (template in court_data_plan.md)

## Tech stack

- Next.js 15 + TypeScript + Tailwind
- Supabase (Postgres + pgvector + Auth)
- Drizzle ORM
- Cheerio for HTML parsing
- Anthropic Claude (week 2)

## File map

```
briefbridge/
├── app/
│   └── api/
│       └── health/route.ts          # Connection check endpoint
├── lib/
│   ├── db/
│   │   ├── index.ts                 # DB client
│   │   └── schema.ts                # Tables + types
│   └── parsers/
│       └── nsw-caselaw.ts           # ✅ Verified working
├── scripts/
│   └── ingest-nsw-single.ts         # Single-judgment ingestion
├── drizzle.config.ts                # Migration config
└── .env.local                       # Your secrets (NOT in git)
```
