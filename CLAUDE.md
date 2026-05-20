# CLAUDE.md

Quickref for Claude Code / dev sessions on this repo. **Read this first.**

## What this project is

A SaaS companion tool for private tutors of any subject. Tutor connects Google Calendar, manages students, writes feedback after lessons, and an LLM turns the feedback into practice games the student plays between sessions — games that adapt in difficulty across plays, avoid repeats, and resurface missed material on a spaced-repetition schedule. Tutor sees progress.

## Status

Phases 0–9 + 12 are shipped and green; **Phase 10 (production deploy) is the only one left.** Deferred and manual items — real-Anthropic / real-Google / real-Whisper smokes, native-Hebrew QA, Lighthouse PWA, BullMQ swap, threshold calibration, etc. — all live in **[FOLLOWUPS.md](FOLLOWUPS.md)**; check there before assuming something is missing.

## Stack at a glance

- **Frontend** — Vite + React 18 + TS + Tailwind + react-i18next + TanStack Router + TanStack Query
- **Backend** — NestJS 10 + Prisma 5 + Pino (sync in dev) + Zod + cookie-parser + @nestjs/throttler + @nestjs/schedule
- **DB** — Postgres 16; **Queue** — Redis 7 (in-process queues today; BullMQ swap is a Phase 10 item)
- **AI** — Anthropic Claude (content) + OpenAI Whisper (voice), both behind Fake/Real DI seams (fakes run in dev/CI)
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

**Running the E2E suite** (Playwright, in `apps/web`): with Postgres/Redis up, run the api with `NODE_ENV=test` (bumps the per-IP throttler 300 → 1000/min so parallel workers don't trip it) plus the web server, then `pnpm exec playwright test --project=chromium-desktop` (and `--project=mobile-safari`). The `integrations` spec and the `/admin/usage` smoke also need `INTEGRATION_TOKEN_ENCRYPTION_KEY` (64 hex — `openssl rand -hex 32`) and `ADMIN_TOKEN` (≥16 chars) set in `apps/api/.env`; `.env.example` ships them blank.

## Conventions — copy these, don't reinvent

### Tenant isolation (NON-NEGOTIABLE)

Every loader that takes an entity id must verify ownership through the session's tutor. A cross-tenant data leak is a security incident. Patterns:

- **Direct**: `apps/api/src/students/student.service.ts` — `findForTutor` / `getForTutorOrFail`
- **Nested** (Lesson → Student → Tutor): `apps/api/src/lessons/lesson.service.ts` — explicit `lesson.student.tutorId === opts.tutorId` check after load
- Always **404 (not 401/403)** on cross-tenant access — uniform shape prevents existence leaks
- Live-Postgres test pattern: `apps/api/src/students/tenant-isolation.test.ts` (also `lessons/`, `games/`, `attempts/`, `progress/`)

### Audit log

- Service: `apps/api/src/audit/audit.service.ts`
- Audit every: auth event, destructive action, data export, AI call, integration change, system cron action
- Action names follow `entity.verb` (e.g. `student.deleted`, `integration.google.connected`, `system.student.purged`)
- Never include raw PII in metadata — hash emails (see `magic-link.service.ts`'s `hashEmail`); log only lengths + categorical fields, never raw answer/prompt/feedback text

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
- Every UI change ships LTR + Hebrew E2E with viewport checks at 320/768/1280

### i18n

- New strings into `apps/web/src/locales/{en,pt,he}/common.json` — all three locales
- `node apps/web/scripts/check-translations.mjs` lints completeness; CI gates on it
- Date/time formatting via `Intl.DateTimeFormat` with explicit locale — never raw `toLocaleString()`
- `eslint-plugin-i18next` fails the build on hardcoded JSX text; `?lang=pseudo` pseudo-localizes for a hardcoded-string sweep

### Reusable seams (don't reinvent)

- **Provider Fake/Real swap** via a DI token + env-driven factory: `LLM_CLIENT`, `TRANSCRIBER_CLIENT`, `GOOGLE_CALENDAR_CLIENT`, `ATTEMPT_SAMPLER`. Fakes run in dev/CI; the real client auto-injects when its API key is set.
- **In-process job queue** — public surface `enqueue` / `drain` / `process*` / `snapshot` + per-process circuit breaker + `onModuleInit` stuck-job recovery: `apps/api/src/games/game-generation.queue.ts` (the Whisper queue mirrors it). A future BullMQ swap keeps this surface.
- **Atomic quota reserve/refund** — `updateMany({ where: { …, counter: { lt: cap } }, data: { counter: { increment: 1 } } })`; Postgres serializes concurrent calls so N parallel reserves against cap K yield exactly K. `apps/api/src/quota/quota.service.ts`. Refund only on terminal failure, never on a user error.
- **Attempt write-back idempotency** — level + spaced-repetition writes ride the single `finishedAt: null → now` transition inside one `$transaction`; the abandoned-attempt cron writes nothing. `apps/api/src/attempts/attempt.service.ts`.
- **Prompt-injection defense** — tutor feedback wrapped in `<<<TUTOR_FEEDBACK_START>>>` … framing as data; output strictly Zod-validated. The two `cache_control` prompt blocks must stay byte-identical across prompt builders (`packages/shared/src/prompts/prompts.test.ts` asserts it).

### Definition of done (any change)

Don't declare done without the relevant gates:

1. **Unit** (Vitest) — ≥ 90% line coverage on new modules; keep `apps/api/vitest.config.ts` coverage `include` current.
2. **Live-Postgres tenant isolation** — a `*tenant-isolation.test.ts` for any new tutor-scoped loader.
3. **API curl smoke** — happy path + edge cases against the running api.
4. **Playwright E2E** — happy path + Hebrew RTL; viewport checks at 320/768/1280 for UI changes.
5. **Translation completeness** — `node apps/web/scripts/check-translations.mjs` (all three locales).
6. `pnpm typecheck` + `pnpm lint` (incl. the direction + i18next rules) clean.

## Gotchas

### Dev environment
- **Port conflicts**: API 3000, web 5174 (NOT 5173), Postgres 5433 (NOT 5432), Redis 6380 (NOT 6379). Don't move these.
- **Vite dev proxy**: `/api/*` → `:3000`, making the api look same-origin so SameSite=Lax cookies just work. `PUBLIC_API_BASE_URL=http://localhost:5174/api` routes the magic-link consume URL through the proxy so cookies land on the web origin.
- **Production cookies** (not yet deployed): web + api land on different domains, so prod needs `SameSite=None; Secure` + CORS or a shared-subdomain split — the dev proxy doesn't help there.

### NestJS / Prisma
- **Pino sync in dev**: `AppModule` sets `sync: true` so logs flush even on SIGKILL. Don't remove it.
- **No incremental TS builds for the api**: `nest build` silently emitted partial dist on a stale tsbuildinfo, so the api `clean` script wipes `dist + tsconfig.tsbuildinfo` before every build.
- **Migrations are additive-only**: new tables / columns with defaults; never edit an existing model definition in an old migration.
- **Shared package**: `packages/shared` builds to `dist/`; api (Node ESM) + web (Vite) consume the built output, so rebuild it after editing (root scripts do this for you).

### Auth
- **Magic link in dev/test**: `POST /auth/magic-link` returns `devMagicLinkUrl` in its 202 body when `NODE_ENV !== 'production'` (stripped in prod). The dev login form auto-follows it via `window.location.replace`, so E2E helpers consume that URL directly — don't ALSO submit the form, the two navigations race and abort (`net::ERR_ABORTED`).

### Testing
- **Vitest + Nest DI**: esbuild doesn't emit `emitDecoratorMetadata`, so don't build full NestJS testing modules — construct controllers/services directly with stubs (`auth.controller.test.ts` is the pattern).
- **Throttler**: per-IP global limit is 1000/min under `NODE_ENV=test`, 300 otherwise; the real abuse guard is the Postgres-backed per-email magic-link limit (3/min).
- **Live-DB tests**: `*tenant-isolation.test.ts` / `*-enforcement.test.ts` are excluded from coverage so unit coverage stays meaningful when Postgres is offline. Run them with the DB up.
- **Test-seed routes** (`/__test__/*`, non-prod only) let E2E pretend OAuth completed, set quotas, seed levels/reviews. Mirror that pattern for new deterministic E2E setup.

## Folder map

```
tutor-app/
├── apps/
│   ├── api/         NestJS backend
│   │   ├── src/
│   │   │   ├── attempts/      play + scoring, adaptive selector, level + spaced-repetition
│   │   │   ├── audit/         audit log
│   │   │   ├── auth/          magic-link, sessions, CSRF, guards
│   │   │   ├── config/        Zod-validated env (config.service + env.ts)
│   │   │   ├── games/         game-generation queue + automatic bank top-up
│   │   │   ├── integrations/  google · anthropic · openai (each: client + fake + real)
│   │   │   ├── lessons/       lesson CRUD + calendar merge
│   │   │   ├── mailer/        console mailer (Resend stub for prod)
│   │   │   ├── me/            /me CRUD + delete + export
│   │   │   ├── progress/      tutor-facing progress + game-progress endpoints
│   │   │   ├── quota/         AI quota/cost reserve/refund + /admin/usage
│   │   │   ├── students/      students CRUD + purge cron
│   │   │   ├── voice/         audio upload + Whisper transcription queue
│   │   │   ├── prisma/        PrismaService
│   │   │   └── test/          test helpers (fixtures, prisma-mock)
│   │   └── prisma/            schema.prisma + migrations (additive)
│   └── web/         Vite SPA
│       ├── src/
│       │   ├── components/    Bidi, ConfirmDialog, Toast, games/*, …
│       │   ├── hooks/         useDirection, …
│       │   ├── lib/           api client, react-query hooks
│       │   ├── locales/       en/pt/he JSON
│       │   ├── pages/         every page component
│       │   └── router.tsx     TanStack Router config
│       ├── tests/             Playwright E2E
│       └── scripts/           check-translations.mjs
├── packages/
│   ├── eslint-plugin-direction/  custom ESLint rule banning physical Tailwind utilities
│   └── shared/                   Zod schemas + types + prompts
├── docker-compose.yml            Postgres :5433 + Redis :6380
├── package.json                  pnpm workspace root
└── pnpm-workspace.yaml
```
