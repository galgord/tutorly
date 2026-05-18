# Tutorly

A SaaS companion tool for private tutors. Tutors connect Google Calendar, manage students, write (or speak) feedback after lessons, and an LLM turns that feedback into practice games students play between sessions on a tutor-shared URL. Tutors then see per-student progress: per-game trends, per-topic mastery, hardest questions.

Subject-agnostic. Designed for English, Brazilian Portuguese, and Hebrew (RTL) from day one. Built phase-by-phase to a [detailed implementation spec](./create-a-new-dir-optimized-mochi.md); per-phase narrative + handoff notes live in [CLAUDE.md](./CLAUDE.md), follow-ups in [FOLLOWUPS.md](./FOLLOWUPS.md).

**Status**: Phases 0–9 done; Phase 10 (production deploy) is the only remaining phase. Everything below works against local docker.

---

## TL;DR for a new engineer

```bash
# 1. Install deps + bring up Postgres (5433) + Redis (6380)
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm docker:up

# 2. Run the migrations
pnpm --filter api prisma:migrate:deploy

# 3. Start everything
pnpm dev                         # api on :3000, web on :5174

# 4. Sign in (no real email needed — the magic link is logged + returned in the response in dev)
#    Open http://localhost:5174, enter any email, click the link Vite shows.

# 5. Run the full gate to confirm nothing is broken
pnpm typecheck && pnpm lint && pnpm test
pnpm test:e2e                    # Playwright (boots dev servers automatically)
```

If `pnpm test:e2e` flakes, make sure the api is already running on :3000 (the Playwright config reuses an existing server in non-CI mode).

---

## What's built

| Phase | Scope | Highlights |
|---|---|---|
| 0 | Scaffold | Monorepo, Docker (Postgres :5433 + Redis :6380), Tailwind logical-properties only, ESLint rule banning physical direction utilities |
| 1 | Tutor auth | Magic link (3/min/email, 10/hr/IP), sessions, CSRF double-submit, audit log, `/me` CRUD + GDPR export + soft-delete + 30d hard-purge cron |
| 2 | Students | Tenant-isolated CRUD, soft delete + 30d purge, 256-bit URL-safe share token (rotatable) |
| 3 | Google Calendar | OAuth (real OAuth path + a `GoogleCalendarClient` Fake for dev/CI), encrypted refresh tokens (libsodium secretbox), calendar+lessons merge, manual-lesson fallback |
| 4 | Feedback + AI gen | `LLM_CLIENT` DI seam (Fake / RealAnthropic auto-picked from `ANTHROPIC_API_KEY`); cached system + game-type prompt blocks; Zod-validated output; in-process queue with retry + circuit breaker + stuck-job recovery; tutor question-review modal with edit/regenerate/assign |
| 5 | Voice transcription | `TRANSCRIBER_CLIENT` DI seam (Fake / OpenAI Whisper); in-browser MediaRecorder; multipart upload with **magic-byte MIME sniff** (not Content-Type) + 25MB / 5min caps; in-process Whisper queue; audio deleted post-transcription; transcript pre-fills `FeedbackEditor` |
| 6 | Game engines | Token-gated student endpoints `/s/:shareToken/...` (NO session, NO CSRF — token IS the credential); **server-side scoring is source of truth**; Unicode-aware normalization (NFC, locale-lowercase, Latin diacritic strip, Hebrew nikud strip U+0591..U+05C7); fill-in-blank + lives-based timed quiz; IndexedDB answer buffer with auto-flush on `online`; hourly abandoned-attempt cron |
| 7 | Progress dashboard | `GET /students/:id/progress` (totals, per-game sparkline + trend, per-topic monthly rollup, hardest-questions) + `GET /students/:id/attempts` (paginated, monthly-aggregate collapse past 6mo). Pure-function aggregation property-tested. Pure-SVG `Sparkline` + `TopicMasteryChart` (no chart-lib dep, RTL = single mirror) |
| 8 | i18n + RTL + PWA | `vite-plugin-pwa` SW + manifest; `eslint-plugin-i18next` no-literal-string with documented whitelist; pseudo-localization mode (`?lang=pseudo`); Heebo + Rubik fonts dynamic-imported only when `lang=he`; modal close-buttons on inline-start edge; `.icon-flip` rule mirrors directional icons in RTL; `InstallPrompt` + `OfflineBanner` on dashboard |
| 9 | AI quota + cost | Per-tutor monthly cap (default 100 generations + 60 Whisper minutes) via atomic `UPDATE ... WHERE counter < cap` (raw SQL for the multi-minute Whisper predicate); refund on terminal FAILED; monthly reset cron; `/admin/usage` admin-token endpoint; UI banner with reset date |
| 10 | Production deploy | ⬜ Pending (Vercel web + Railway api+db+redis + Resend + real Google OAuth + smoke test) |

---

## Stack

- **Frontend**: Vite + React 18 + TypeScript + Tailwind + react-i18next + TanStack Router + TanStack Query (deploys to Vercel)
- **Backend**: NestJS 10 + Prisma 5 + Pino (sync-flushing in dev) + Zod + cookie-parser + @nestjs/throttler + @nestjs/schedule (deploys to Railway)
- **DB**: Postgres 16
- **Queue**: Redis 7 (BullMQ swap pending — Phases 4/5 ship in-process queues with the same public surface so the migration is contained)
- **AI**: Anthropic Claude (game generation) + OpenAI Whisper (voice)
- **Locales**: English, Brazilian Portuguese, Hebrew (RTL is first-class)
- **PWA**: vite-plugin-pwa with autoUpdate service worker

---

## Repo layout

```
apps/
  api/                          NestJS backend (port 3000)
    src/
      attempts/                 Phase 6: student-side play endpoints + abandoned-attempt cron
      audit/                    Append-only audit log
      auth/                     Magic link, sessions, CSRF, guards, current-tutor decorator
      config/                   Zod-validated env loader
      games/                    Phase 4: game CRUD + LLM generation queue + circuit breaker
      health/                   GET /health
      integrations/
        google/                 Phase 3: OAuth + calendar client (Real + Fake + factory)
        anthropic/              Phase 4: LLM client (Real + Fake + factory)
        openai/                 Phase 5: Whisper client (Real + Fake + factory)
      lessons/                  Phase 3: lesson CRUD + calendar merge
      mailer/                   Console mailer (Resend stub for prod)
      me/                       /me CRUD + delete + GDPR export
      middleware/               Request-ID propagation
      prisma/                   PrismaService
      progress/                 Phase 7: aggregation funcs + endpoints
      quota/                    Phase 9: atomic reserve/refund + monthly cron + /admin/usage
      students/                 Phase 2: students CRUD + soft-delete purge + public-by-token controller
      test/                     Test helpers (prisma-mock, fixtures)
      voice/                    Phase 5: audio upload + magic-byte sniff + Whisper queue + storage service
    prisma/
      schema.prisma             Full data model (defined upfront in Phase 1; subsequent migrations are additive only)
      migrations/

  web/                          Vite SPA (port 5174)
    src/
      components/               Bidi, ConfirmDialog, Toast, FeedbackEditor, GamesPanel,
                                QuestionReviewModal, VoiceRecorder, Sparkline, TopicMasteryChart,
                                ProgressOverview, RecentAttemptsList, InstallPrompt, OfflineBanner,
                                games/{FillBlankEngine,TimedQuizEngine}
      hooks/                    useDirection (also dynamic-imports Hebrew fonts when lang=he)
      i18n/                     pseudo-localization transformer + boot-locale tests
      lib/                      api client, react-query hooks, attempt-buffer (IndexedDB), pwa registration
      locales/{en,pt,he}/       common.json bundles (314 keys, all locales)
      pages/                    Every route
      router.tsx                TanStack Router config
    tests/                      Playwright E2E
    scripts/                    check-translations.mjs, generate-pwa-icons.mjs

packages/
  shared/                       Zod schemas + types consumed by both apps
    src/schemas/                auth, student, lesson, feedback, games, voice, attempts, progress,
                                answers (Unicode normalization), locale
  eslint-plugin-direction/      Custom rule banning Tailwind physical-direction utilities (RTL safety)

docker-compose.yml              Postgres :5433 + Redis :6380 (NOT default ports — see "Gotchas")
```

---

## Prerequisites

- Node ≥ 20.10 (the root `engines` field enforces this)
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Docker (for local Postgres + Redis; can be skipped if you point `DATABASE_URL` at a managed instance)

---

## Environment

Copy `apps/api/.env.example` to `apps/api/.env`. Everything Phase 3+ that touches a paid external service (Google, Anthropic, OpenAI) is **optional in dev** — the api boots with Fake providers when the keys are absent.

| Variable | Default in dev | Required in prod | Notes |
|---|---|---|---|
| `DATABASE_URL` | `postgresql://tutor:tutor_dev_password@localhost:5433/tutor_app` | yes | Match `docker-compose.yml` if local |
| `REDIS_URL` | `redis://localhost:6380` | yes (Phase 10) | Used by BullMQ swap |
| `SESSION_COOKIE_SECRET` | dev placeholder | yes | ≥32 chars; signs session cookies |
| `MAILER` | `console` | `resend` in prod | Console mailer logs the magic-link URL |
| `RESEND_API_KEY` | unset | yes if `MAILER=resend` | |
| `WEB_ORIGIN` | `http://localhost:5174` | yes | CORS origin |
| `PUBLIC_API_BASE_URL` | `http://localhost:5174/api` | yes | Used in magic-link emails — must point at the **web** origin in dev so SameSite=Lax cookies land |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` | unset | yes for real Google | All three or none; Fake client is auto-injected when unset |
| `INTEGRATION_TOKEN_ENCRYPTION_KEY` | unset | yes if Google enabled | 64 hex chars (`openssl rand -hex 32`); encrypts refresh tokens at rest |
| `ANTHROPIC_API_KEY` | unset | yes for real LLM | `FakeLlmClient` returns canned content when unset |
| `OPENAI_API_KEY` | unset | yes for real Whisper | `FakeTranscriberClient` returns canned text when unset |
| `STORAGE_DIR` | `./var/audio` | Railway Volume path | Audio is stored relative to this then deleted post-transcription |
| `GAME_GEN_MONTHLY_CAP` | `100` | configurable | Per-tutor monthly generation cap |
| `WHISPER_MONTHLY_MINUTES_CAP` | `60` | configurable | Per-tutor monthly transcription minutes |
| `ADMIN_TOKEN` | unset | yes | Gates `/admin/usage`; `openssl rand -hex 32` |

Full list with cross-field refinements: `apps/api/src/config/env.ts`.

---

## Daily dev

```bash
pnpm dev                            # api (:3000) + web (:5174) concurrently; shared package rebuilt first
pnpm lint                           # ESLint across all packages
pnpm typecheck                      # tsc --noEmit
pnpm test                           # vitest across all packages (api + web + shared)
pnpm test:e2e                       # Playwright (chromium + mobile-safari projects)
pnpm --filter api test:coverage     # coverage report (current: ~97% line coverage on api)
pnpm --filter api prisma:studio     # browse the DB at http://localhost:5555
node apps/web/scripts/check-translations.mjs   # locale completeness gate
```

### Generating + applying migrations

```bash
pnpm --filter api prisma:migrate     # interactive — prompts for a migration name
pnpm --filter api prisma:migrate:deploy   # non-interactive, idempotent (CI + first-time setup)
```

The schema was written end-to-end in Phase 1; subsequent migrations are **additive only** (`prisma migrate diff` should never propose drops). Phase 3 added `OAuthState`, Phase 4 added `Game` status enum + generation fields, Phase 5 added `TranscriptionStatus` enum + `Lesson.transcriptionStatus/transcriptionError` (audioUrl was scaffolded in Phase 1), Phase 9 added the monthly counters.

---

## Conventions (non-negotiable)

These are checked in CI and enforced via ESLint rules where possible. A new engineer should read these in `CLAUDE.md` before touching anything.

### Tenant isolation
Every loader that takes an entity id verifies ownership through the session's tutor. Cross-tenant access returns **404, never 401 or 403** (uniform shape prevents existence leaks). Patterns:

- Direct: `apps/api/src/students/student.service.ts` — `findForTutor` / `getForTutorOrFail`
- Nested (Lesson → Student → Tutor): `apps/api/src/lessons/lesson.service.ts` — explicit `lesson.student.tutorId === opts.tutorId` check after load
- Live-Postgres tenant-isolation specs live next to each module (e.g. `students/tenant-isolation.test.ts`, `lessons/`, `games/`, `voice/`, `attempts/`, `progress/`). They skip cleanly when the DB is unreachable.

### CSRF + auth
- `AuthGuard` on every private endpoint (sets `req.tutor` via session cookie)
- `CsrfGuard` on every state-changing endpoint (POST/PATCH/DELETE) — double-submit cookie + header
- `@CurrentTutor()` decorator injects the tutor in handlers
- **Never accept `tutorId` from request body or query** — always derive from the session
- Student-facing endpoints under `/s/:shareToken/...` use `StudentTokenGuard` (no CSRF — the share token IS the credential)

### Audit log
Service: `apps/api/src/audit/audit.service.ts`. Audit every auth event, destructive action, data export, AI call, integration change, system cron action. Action names are `entity.verb` (e.g. `student.deleted`, `system.student.purged`, `quota.generation.refunded`). **Never include raw PII in metadata** — hash emails (see `magic-link.service.ts`'s `hashEmail`); record byte size or length, not the content.

### RTL is first-class
- Tailwind logical properties only: `ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`, `text-end`, `border-s-`, `border-e-`, `rounded-s-`, `rounded-e-`
- `direction/no-physical-direction-classes` ESLint rule fails the build on `ml-`, `mr-`, `text-right`, `text-left`, `border-l`, `border-r`, `rounded-l`, `rounded-r`, `left-N`, `right-N`
- Mixed-script content (English name in a Hebrew sentence): wrap in `<Bidi>` (`apps/web/src/components/Bidi.tsx`)
- `useDirection()` syncs `<html dir>` to current locale and dynamic-imports Heebo + Rubik when `lang=he`
- Email / URL / code inputs forced `dir="ltr"` regardless of locale; free-text content uses `dir="auto"`
- Directional icons (pagination arrows, next-question chevron) wear the `.icon-flip` class — global CSS rule mirrors them in `[dir="rtl"]`
- Every UI-touching phase ships LTR + Hebrew Playwright specs with viewport checks at 320/768/1280

### i18n
- All user-facing strings live in `apps/web/src/locales/{en,pt,he}/common.json` — all three locales
- `eslint-plugin-i18next` `no-literal-string` enforces no hardcoded JSX text (whitelist documented in `apps/web/.eslintrc.cjs`)
- `node apps/web/scripts/check-translations.mjs` gates completeness; CI fails on missing keys
- Date / time / number formatting via `Intl.*` with explicit locale — never raw `toLocaleString()`
- Pseudo-localization mode: `?lang=pseudo` wraps strings in `⟦…⟧` with ~30% length inflation + a striped band marker; great for catching hardcoded strings and layout truncation

### Server-side scoring (Phase 6)
Student-facing game endpoints are the only place where client-supplied data drives a write. The client may compute correctness locally for instant feedback, but **the server response is source of truth**. The attempt's sampled question IDs are persisted server-side so the answer endpoint can re-score from the same known set. `answer` and `acceptAlternates` are never returned in the start payload. Answer + finish endpoints are idempotent so the IndexedDB-replay-on-reconnect path is safe.

### Provider seams (DI for external services)
Every external dependency (Google, Anthropic, OpenAI) has the same shape:

1. `*.client.ts` — interface + typed errors (no provider-SDK leakage)
2. `*.fake.ts` — programmable in-memory fake; used by all unit tests + Playwright + dev when the key is absent
3. `*.real.ts` — provider-SDK wrapper; auto-injected when the key is present
4. `*.module.ts` — factory provider that picks based on env

This is the canonical pattern — see `apps/api/src/integrations/{google,anthropic,openai}/`. Phase 10's BullMQ swap will keep the same shape for the queue.

---

## Testing

| Layer | Command | Where | Coverage |
|---|---|---|---|
| Unit (api) | `pnpm --filter api test` | `apps/api/src/**/*.test.ts` | 482 tests, ~97% lines |
| Unit (web) | `pnpm --filter web test` | `apps/web/src/**/*.test.ts` | 24 tests (i18n pseudo, attempt-buffer, api wrapper, boot-locale) |
| Live-Postgres integration | `pnpm --filter api test` (when DB is up) | `**/tenant-isolation.test.ts`, `quota/quota-enforcement.test.ts`, `voice/tenant-isolation.test.ts`, etc. | Tests skip cleanly if DB is unreachable |
| Coverage | `pnpm --filter api test:coverage` | v8 reporter | Threshold gates 90% statements/lines/functions, 80% branches |
| Playwright E2E | `pnpm test:e2e` | `apps/web/tests/*.spec.ts` | 104 specs across chromium-desktop + mobile-safari, every UI-touching phase ships LTR + Hebrew variants |
| Accessibility | included in `play-game-a11y.spec.ts` | `@axe-core/playwright` against both game engines | Zero serious/critical violations gate |

Live-Postgres specs are intentionally excluded from coverage thresholds (`apps/api/vitest.config.ts`) so unit coverage stays meaningful when the DB is offline.

### Manual smoke

The `/admin/usage` endpoint behind `x-admin-token: $ADMIN_TOKEN` gives aggregate counters + in-flight queue + breaker state — useful for "is the cost spike real?" inspection without an observability stack:

```bash
curl -H "x-admin-token: $ADMIN_TOKEN" http://localhost:3000/admin/usage
```

---

## Gotchas

- **Port conflicts**: API 3000, web 5174 (NOT 5173), Postgres 5433 (NOT 5432), Redis 6380 (NOT 6379). Defaults are taken by other things on dev machines; CI + Playwright rely on these offsets. Don't move them.
- **Vite dev proxy**: `/api/*` → `:3000` makes the api look same-origin to the browser so SameSite=Lax cookies just work. Without the proxy, cookies set by the api are unreachable from the SPA. Phase 10 deploy needs `SameSite=None; Secure` or subdomain-shared cookies — handled there.
- **Pino async buffering**: pino-pretty buffers stdout. `AppModule` sets `sync: true` in dev so logs flush even on SIGKILL. Don't remove that.
- **Incremental TS builds**: removed `incremental: true` from `apps/api/tsconfig.json` because nest build was silently emitting partial dist when tsbuildinfo was stale. The api's `clean` script removes `dist + tsconfig.tsbuildinfo` before every build.
- **Magic link in dev/test**: `POST /auth/magic-link` returns `devMagicLinkUrl` in its 202 body when `NODE_ENV !== 'production'`. Playwright reads this directly. Stripped in prod.
- **react-query v5 `refetchInterval` as callback**: reads stale state and never re-fires in our setup. Polling components use fixed-cadence `refetchInterval: 1500` (number, not function). Don't switch back without verifying.
- **`.env` partial Google envs**: setting only one of the three Google env vars trips the validator. `.env.example` ships them all empty for clarity; the loader treats `""` as undefined, but if you fill in just `GOOGLE_CLIENT_ID` without the others, the api won't boot. (Flagged in FOLLOWUPS.)
- **Vitest + Nest DI metadata**: esbuild (Vitest's transformer) doesn't emit `emitDecoratorMetadata`. Don't try to build NestJS testing modules with DI — construct controllers/services directly with stubs. See `auth.controller.test.ts` for the pattern.
- **Throttler in tests**: global throttler is bumped to 1000/min when `NODE_ENV=test` so parallel Playwright workers don't trip it. The per-email magic-link limit (3/min, Postgres-backed) is the real abuse protection.
- **Hebrew fonts are lazy-loaded**: Heebo + Rubik (via `@fontsource-variable/*`) land in their own ~4KB CSS chunks and are dynamic-imported in `useDirection.ts` only when `lang=he`. The Vite PWA precache explicitly excludes the woff2 files so English/Portuguese users don't download them on first SW install. Runtime CacheFirst picks them up once a Hebrew user fetches them.

---

## Deployment (Phase 10 — pending)

Target:
- **Web** → Vercel (static SPA + Vite PWA)
- **API + Postgres + Redis** → Railway
- **Magic-link email** → Resend (set `MAILER=resend` + `RESEND_API_KEY`)
- **Object storage** → Railway Volume for v1 (audio); R2/S3 swap documented in `apps/api/src/voice/audio-storage.service.ts` as a single seam

Pre-launch checklist (also tracked in `FOLLOWUPS.md`):
- [ ] Real Google OAuth manual walkthrough (the code path is fully tested with a Fake; needs a Google Cloud project)
- [ ] Real-Anthropic LLM smoke + verify prompt cache hit on second call (Phase 9 gate item)
- [ ] Real-Whisper smoke (en + he)
- [ ] Native Hebrew QA pass — one native reader walks the app
- [ ] Lighthouse PWA ≥ 90 score (structural requirements all met; needs a real Chrome run)
- [ ] `ADMIN_TOKEN` set (`openssl rand -hex 32`)
- [ ] DB backup verification (monthly restore drill)
- [ ] Cookie strategy switched to `SameSite=None; Secure` or subdomain-shared
- [ ] BullMQ swap (Phases 4/5 ship in-process queues with the same public surface — swap is contained)

---

## Where to look first

- **What did Phase N ship and what patterns should Phase N+1 mirror?** → `CLAUDE.md`
- **What's the full spec?** → `create-a-new-dir-optimized-mochi.md`
- **What's been deferred and why?** → `FOLLOWUPS.md`
- **A specific module's tenant-isolation contract** → its `tenant-isolation.test.ts` (live-DB, runs against real Postgres)
- **How a provider seam looks end-to-end** → `apps/api/src/integrations/anthropic/` is the cleanest example (interface + Fake + Real + module + tests)
- **How the in-process queue + circuit breaker works** → `apps/api/src/games/game-generation.queue.ts` (Phase 5's Whisper queue mirrors this exactly)
- **Unicode-aware answer scoring** → `packages/shared/src/schemas/answers.ts` + `answers.test.ts` (the heart of the gameplay correctness; nikud-aware for Hebrew, diacritic-strip for Latin)
- **Progress aggregation math** → `apps/api/src/progress/progress.aggregations.ts` (pure functions, property-tested)

---

## License

Private. Not for redistribution.
