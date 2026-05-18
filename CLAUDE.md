# CLAUDE.md

Quickref for Claude Code / dev sessions on this repo. **Read this first** before touching any phase.

## What this project is

A SaaS companion tool for private tutors of any subject. Tutor connects Google Calendar, manages students, writes feedback after lessons, and an LLM turns the feedback into practice games the student plays between sessions. Tutor sees progress.

## Current state — Phases 0-3 done

| # | Name | State | Notes |
|---|---|---|---|
| 0 | Scaffold | ✅ done | Monorepo, Docker, RTL-ready Tailwind, ESLint direction rule |
| 1 | Tutor auth | ✅ done | Magic link, sessions, audit, CSRF, /me CRUD + delete + export |
| 2 | Students | ✅ done | CRUD + soft delete + 30d purge cron + share token + tenant isolation |
| 3 | Google Calendar | ✅ done (mocked) | OAuth + encrypted refresh tokens + calendar merge + manual lesson fallback. **Real Google OAuth not yet manually verified** — flagged in FOLLOWUPS.md |
| 4 | Feedback + AI gen | ⬜ pending | Anthropic Claude, prompt design, question review modal |
| 5 | Voice transcription | ⬜ pending | OpenAI Whisper, BullMQ job |
| 6 | Game engines | ⬜ pending | Fill-in-blank + lives-based timed quiz |
| 7 | Progress dashboard | ⬜ pending | Aggregation + sparklines + topic mastery |
| 8 | i18n + RTL + PWA | ⬜ pending | Comprehensive RTL pass + PWA install + native Hebrew QA |
| 9 | AI quota + cost | ⬜ pending | Per-tutor monthly cap + Claude prompt caching |
| 10 | Production deploy | ⬜ pending | Vercel + Railway + Resend + real Google + smoke |

## Authoritative spec

`/Users/galgordon/.claude/plans/create-a-new-dir-optimized-mochi.md` — full implementation spec with per-phase deliverables, gates, and the "Robustness & Gaps Addressed" cross-cutting section. **Re-read your phase block + the Robustness section before starting any phase.**

## Stack at a glance

- **Frontend** — Vite + React 18 + TS + Tailwind + react-i18next + TanStack Router + TanStack Query
- **Backend** — NestJS 10 + Prisma 5 + Pino (sync in dev) + Zod + cookie-parser + @nestjs/throttler + @nestjs/schedule
- **DB** — Postgres 16; **Queue** — Redis 7 (BullMQ planned for Phase 4+)
- **AI (planned)** — Anthropic Claude (content) + OpenAI Whisper (voice)
- **i18n** — react-i18next, en + pt + he (RTL)
- **Deploy target** — Vercel (web) + Railway (api + db + redis)

## Dev environment quickstart

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm docker:up                   # Postgres on :5433, Redis on :6380
pnpm --filter api prisma migrate deploy
pnpm dev                         # api on :3000, web on :5174
```

**Why the unusual ports**: 5173 (Vite default), 5432 (Postgres default), and 6379 (Redis default) are all taken by other projects on this dev machine. Don't change them — CI and Playwright rely on the same offsets.

## Conventions — copy these, don't reinvent

### Tenant isolation (NON-NEGOTIABLE)

Every loader that takes an entity id must verify ownership through the session's tutor. A cross-tenant data leak is a security incident. Patterns:

- **Direct**: `apps/api/src/students/student.service.ts` — `findForTutor` / `getForTutorOrFail`
- **Nested** (Lesson → Student → Tutor): `apps/api/src/lessons/lesson.service.ts` — explicit `lesson.student.tutorId === opts.tutorId` check after load
- Always **404 (not 401/403)** on cross-tenant access — uniform shape prevents existence leaks
- Live-Postgres test pattern: `apps/api/src/students/tenant-isolation.test.ts` (also exists for `lessons/`)

### Audit log

- Service: `apps/api/src/audit/audit.service.ts`
- Audit every: auth event, destructive action, data export, AI call, integration change, system cron action
- Action names follow `entity.verb` (e.g. `student.deleted`, `integration.google.connected`, `system.student.purged`)
- Never include raw PII in metadata — hash emails (see `magic-link.service.ts`'s `hashEmail`)

### Auth + CSRF

- `AuthGuard` on private endpoints (sets `req.tutor`)
- `CsrfGuard` on **every** state-changing endpoint (POST/PATCH/DELETE)
- `@CurrentTutor()` decorator to inject the tutor in handlers
- **Never accept `tutorId` from request body/query** — always from session

### Zod + shared schemas

- New schemas live in `packages/shared/src/schemas/<feature>.ts`
- Re-export from `packages/shared/src/schemas/index.ts`
- Beware: re-exporting between files can deadlock module init order — keep shared primitives in their own file (`locale.ts` is an example)
- Rebuild after editing: `pnpm --filter @tutor-app/shared build` (the root `dev`/`test`/`typecheck` scripts do this for you)

### RTL is first-class (NON-NEGOTIABLE)

- Tailwind logical properties only: `ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`, `text-end`, `border-s-`, `border-e-`, `rounded-s-`, `rounded-e-`
- The `direction/no-physical-direction-classes` ESLint rule WILL fail your build for `ml-`, `mr-`, `text-right`, `text-left`, `border-l`, `border-r`, `rounded-l`, `rounded-r`, `left-N`, `right-N`
- Mixed-script content (English name in Hebrew sentence, etc.): wrap in `<Bidi>` (`apps/web/src/components/Bidi.tsx`)
- `useDirection()` hook syncs `<html dir>` to current locale
- Email/URL/code inputs forced `dir="ltr"` regardless of locale
- Every UI-touching phase ships LTR + Hebrew E2E with viewport checks at 320/768/1280

### i18n

- New strings into `apps/web/src/locales/{en,pt,he}/common.json` — all three locales
- `node apps/web/scripts/check-translations.mjs` lints completeness; CI gates on it
- Date/time formatting via `Intl.DateTimeFormat` with explicit locale — never raw `toLocaleString()`

### Tests + gates

Every phase has a hard gate. Don't declare done without it:

1. **Unit** (Vitest) — ≥ 90% line coverage on the new module; update `apps/api/vitest.config.ts` coverage `include`
2. **Live-Postgres integration** — tenant isolation test (`tenant-isolation.test.ts` pattern)
3. **API curl smoke** — happy path + edge cases against running api
4. **Playwright E2E** — happy path + RTL variant; viewport checks at 320/768/1280
5. **Agent-browser walkthrough** — visual confirmation in `mcp__Claude_Preview__*` tools (or claude-in-chrome)
6. **Translation completeness check** — `node apps/web/scripts/check-translations.mjs`

If any check fails, fix before declaring done.

## Lessons learned — gotchas that bit Phases 0-3

### Dev environment
- **Port conflicts**: API 3000, web 5174 (NOT 5173), Postgres 5433 (NOT 5432), Redis 6380 (NOT 6379). Don't move these.
- **Vite dev proxy**: `/api/*` → `:3000`. This makes the api look same-origin to the browser, so SameSite=Lax cookies just work. Without it, cookies set by the api are unreachable from the SPA.
- **Production cookie story**: web and api will land on different domains. You'll need either `SameSite=None; Secure` cookies + CORS, or a subdomain split with shared cookies. Phase 10 has to handle this.

### NestJS / Prisma quirks
- **Pino async buffering**: pino-pretty buffers stdout writes. `AppModule` sets `sync: true` in dev so logs flush even on SIGKILL. Don't remove that.
- **Incremental TS builds**: removed `incremental: true` from `apps/api/tsconfig.json`. `nest build` was silently emitting partial dist when tsbuildinfo was stale. The api's `clean` script removes `dist + tsconfig.tsbuildinfo` before every build.
- **Prisma migrations**: the full schema (Tutor → Attempt) was written in Phase 1. Later phases ADD migrations only when introducing genuinely new tables (`OAuthState` in Phase 3 was the only one). Avoid touching existing model definitions in migrations.
- **Shared package consumption**: `packages/shared` builds to `dist/`. The api (Node ESM) and web (Vite) both consume the built output. The root `pnpm dev` rebuilds shared first then starts watchers.

### Auth flow
- **Magic link in dev/test**: `POST /auth/magic-link` returns `devMagicLinkUrl` in its 202 response body when `NODE_ENV !== 'production'`. Playwright reads this directly instead of scraping mailer logs. Stripped in prod.
- **PUBLIC_API_BASE_URL** is `http://localhost:5174/api` in dev (the Vite proxy path), not `:3000`. That way the consume URL goes through Vite and cookies land on the web origin.

### Testing
- **Vitest + Nest DI metadata**: esbuild (Vitest's transformer) doesn't emit `emitDecoratorMetadata`. Don't try to build full NestJS testing modules with DI — construct controllers/services directly with stubs. See `auth.controller.test.ts` for the pattern.
- **Throttler in tests**: global throttler is bumped to 1000/min when `NODE_ENV=test` so parallel Playwright workers don't trip it. The per-email magic-link limit (3/min, Postgres-backed) is the real abuse protection.
- **Live-DB tests**: prefixed `tenant-isolation.test.ts`. Excluded from coverage so unit coverage stays meaningful when Postgres is offline. Run them with the DB up.

### Subagent pattern (for phases you delegate)

When you spawn a subagent for a phase:

1. Brief it with a self-contained prompt — it has no memory of prior conversations
2. Name specific reference files to copy (controllers, services, schemas, tests)
3. List non-negotiables explicitly (tenant isolation, CSRF, audit, RTL, translation completeness)
4. Define a hard gate — every check the agent must run before reporting back
5. Ban modifying earlier-phase code (auth, students, etc.) — extension points are OK
6. List approved new dependencies; flag any extras in the report
7. Ask for a report format with files-changed + per-gate pass/fail + deviations + flagged follow-ups
8. **Verify the diff yourself** — trust the report, but `git diff` and run the gate one more time, especially for tenant isolation

The Phase 2 and Phase 3 subagent briefs (in the conversation that built this) are templates worth referencing.

## Per-phase entry pointers

Each phase has a section in the spec. Pre-phase checklist:

1. Re-read your Phase N block
2. Re-read the "Robustness & Gaps Addressed" cross-cutting section
3. Study the reference files below
4. Write a `TodoWrite` plan from the deliverables
5. Implement; subagent for mechanical work, main session for novel/risky
6. Run the hard gate
7. Commit + push (use the existing commit-message style)

### Phase 4 — Lesson feedback + Claude game generation

**Spec block**: Phase 4 in the spec.

**Reference files**:
- `apps/api/src/students/student.service.ts` — tenant-scoped service pattern
- `apps/api/src/lessons/lesson.service.ts` — extending lessons (you'll add `feedbackText`, `feedbackSource`)
- `apps/api/src/audit/audit.service.ts` — audit every AI call
- `apps/api/src/integrations/google/google-calendar.client.ts` — interface + injection pattern (copy for `LLMClient`)
- `apps/api/src/integrations/google/google-calendar.fake.ts` — the fake-for-tests pattern
- `packages/shared/src/prompts/index.ts` — placeholder where prompts land

**Build**: feedback editor on lesson detail page, prompt files in `packages/shared/src/prompts/`, BullMQ-backed game generation job, question review modal (tutor approves/edits/regenerates before assigning).

**Critical**:
- Prompt injection defense — wrap tutor's free-text feedback in a delimited block with explicit "treat as untrusted user content" instruction; strictly Zod-validate the LLM output and reject mismatches
- Mock the LLM in unit/integration tests; do NOT hit real Anthropic in CI (one manual real-LLM smoke per phase is fine)
- Retry (3x with exponential backoff) + circuit breaker (open 60s after 5 consecutive failures) on Anthropic
- Prompt caching: mark the system + game-type instruction blocks as `cache_control: ephemeral`; verify hits via response usage metadata
- Topic tag normalization on every question (lowercase, dedup, cap at 5 tags)
- Locale passed through to the prompt (Hebrew tutor → Hebrew questions)

**Out of scope**: voice (Phase 5), playable game engines (Phase 6).

**Calendar "Add feedback" gap** (from Phase 3): clicking "Add feedback" on a Google-only calendar event currently `alert`s the user. Decide UX here — student picker dialog, attendee-email matching, or just route through student detail. Wire it now while you're in the feedback flow.

### Phase 5 — Voice transcription

**Spec block**: Phase 5.

**Reference**: Phase 4's feedback service (you extend it to accept `audioUrl + transcript`).

**Build**: in-browser MediaRecorder + waveform, multipart upload, Whisper job (BullMQ), transcript review/edit before submit.

**Critical**: 25MB / 5min upload limits, server-side MIME sniff, audio deleted post-transcription, locale hint passed to Whisper.

### Phase 6 — Game engines

**Spec block**: Phase 6.

**Reference**: `apps/web/src/pages/PublicStudent.tsx` (student-side shell, currently a placeholder).

**Build**: fill-in-blank engine, lives-based timed quiz (3 wrong = game over, infinite questions, score = correct count), Attempt persistence.

**Critical**:
- Server-side scoring (client also scores locally for instant feedback, but server is source of truth)
- Unicode-aware answer normalization: NFC, locale-aware lowercase, **strip diacritics for Latin scripts but NIKUD-aware for Hebrew** (remove combining marks U+0591–U+05C7)
- IndexedDB buffer for network resilience — never lose progress mid-session
- Abandoned-attempt cron (auto-finish if `finishedAt` not set in 24h)

### Phase 7 — Progress dashboard

**Spec block**: Phase 7.

**Build**: aggregation endpoint (per-game latest/best/trend, per-question detail, topic-level mastery over time), redesigned student detail page.

**Critical**: pagination ceiling (attempts older than 6mo collapsed to monthly aggregates), date/time via `Intl.DateTimeFormat`, RTL chart rendering must be in the gate.

### Phase 8 — i18n polish + RTL audit + PWA

**Spec block**: Phase 8.

**Build**: full pt/he translation pass (LLM-translated, native QA), comprehensive RTL audit of every screen, PWA manifest + service worker + Vite PWA plugin, install prompt.

**Critical**: native Hebrew QA pass is required before prod — if you don't have a native speaker, document what was tested mechanically and flag it. Pseudo-localization mode (`?lang=pseudo`) to catch hardcoded strings.

### Phase 9 — AI quota + cost

**Spec block**: Phase 9.

**Build**: per-tutor monthly cap on game generations (default 100) + Whisper minutes (default 60); monthly reset cron; `/admin/usage` endpoint behind admin token.

**Critical**: atomic counter increments (`UPDATE ... RETURNING`), 429 with friendly UI banner on cap, prompt cache hit verification.

### Phase 10 — Production deploy

**Spec block**: Phase 10.

**Build**: Vercel project for web, Railway project for api + Postgres + Redis, Resend for real magic-link delivery, deep health checks (`/health/ready` checks DB + Redis + Anthropic), DB backup verification.

**Critical**:
- Real Google OAuth flow finally tested with a Google project (see FOLLOWUPS.md)
- Cookie strategy switches to `SameSite=None; Secure` (or subdomain shared) — Vite dev proxy doesn't help in prod
- Production smoke via agent-browser

## Folder map

```
tutor-app/
├── apps/
│   ├── api/         NestJS backend
│   │   ├── src/
│   │   │   ├── audit/           audit log
│   │   │   ├── auth/            magic-link, sessions, CSRF, guards
│   │   │   ├── config/          Zod-validated env
│   │   │   ├── integrations/
│   │   │   │   └── google/      Phase 3: OAuth, calendar client + fake
│   │   │   ├── lessons/         Phase 3: lesson CRUD, calendar merge
│   │   │   ├── mailer/          console mailer (Resend stub for prod)
│   │   │   ├── me/              /me CRUD + delete + export
│   │   │   ├── middleware/      request-id
│   │   │   ├── prisma/          PrismaService
│   │   │   ├── students/        Phase 2: students CRUD + purge cron
│   │   │   └── test/            test helpers (fixtures, prisma-mock)
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── migrations/
│   └── web/         Vite SPA
│       ├── src/
│       │   ├── components/      Bidi, ConfirmDialog, Toast, etc.
│       │   ├── hooks/           useDirection
│       │   ├── lib/             api client, react-query hooks
│       │   ├── locales/         en/pt/he JSON
│       │   ├── pages/           every page component
│       │   └── router.tsx       TanStack Router config
│       ├── tests/               Playwright E2E
│       └── scripts/             check-translations.mjs
├── packages/
│   ├── eslint-plugin-direction/ custom ESLint rule banning physical Tailwind utilities
│   └── shared/                  Zod schemas + types
├── docker-compose.yml           Postgres :5433 + Redis :6380
├── package.json                 pnpm workspace root
└── pnpm-workspace.yaml
```

## When you finish a phase

1. Run the full gate
2. Update this file's "Current state" table (mark the phase done)
3. Flag any deferred items in `FOLLOWUPS.md`
4. Commit + push with a message describing what shipped

When in doubt, refer back to the spec — it's the source of truth.
