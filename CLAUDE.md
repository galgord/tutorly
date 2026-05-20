# CLAUDE.md

Quickref for Claude Code / dev sessions on this repo. **Read this first** before touching any phase.

## What this project is

A SaaS companion tool for private tutors of any subject. Tutor connects Google Calendar, manages students, writes feedback after lessons, and an LLM turns the feedback into practice games the student plays between sessions. Tutor sees progress.

## Current state — Phases 0-9 + 12 done (10 pending)

| # | Name | State | Notes |
|---|---|---|---|
| 0 | Scaffold | ✅ done | Monorepo, Docker, RTL-ready Tailwind, ESLint direction rule |
| 1 | Tutor auth | ✅ done | Magic link, sessions, audit, CSRF, /me CRUD + delete + export |
| 2 | Students | ✅ done | CRUD + soft delete + 30d purge cron + share token + tenant isolation |
| 3 | Google Calendar | ✅ done (mocked) | OAuth + encrypted refresh tokens + calendar merge + manual lesson fallback. **Real Google OAuth not yet manually verified** — flagged in FOLLOWUPS.md |
| 4 | Feedback + AI gen | ✅ done (fake LLM) | Anthropic SDK + Fake/Real swap via `LLM_CLIENT` DI token; cached system + game-type prompt blocks with strict Zod-validated output; in-process queue with retry + circuit breaker; question review modal with edit/regenerate/assign; calendar "Add feedback" student picker (Phase 3 deferral resolved). **Real-LLM smoke not run** — flagged in FOLLOWUPS.md |
| 5 | Voice transcription | ✅ done (fake Whisper) | OpenAI SDK + Fake/Real swap via `TRANSCRIBER_CLIENT` DI token; in-browser MediaRecorder + multipart upload with server-side magic-byte MIME sniff + 25MB / 5min caps; in-process Whisper queue mirroring game-generation (retry + circuit breaker + stuck-job recovery); audio deleted post-transcription; `QuotaService.reserveWhisperMinutes` atomic-SQL minute reservation with refund-on-failure; transcript pre-fills `FeedbackEditor` as a suggestion (tutor still clicks Save). **BullMQ swap + real-Whisper smoke** flagged in FOLLOWUPS.md |
| 6 | Game engines | ✅ done | Fill-in-blank + lives-based timed quiz; token-gated student dashboard + play routes; server-side scoring + nikud-aware Hebrew normalization via shared `scoreAnswer`; IndexedDB answer buffer with auto-flush on `online`; hourly abandoned-attempt cron. **Manual screen-reader (VoiceOver/NVDA) pass** flagged in FOLLOWUPS.md (axe gate covers structural a11y). |
| 7 | Progress dashboard | ✅ done | `GET /students/:id/progress` (totals, per-game sparkline + trend, per-topic monthly rollup, hardest-questions) + `GET /students/:id/attempts` (paginated, monthly-aggregate collapse past 6mo). Pure-function aggregation layer property-tested. Web: tutor-facing student detail rebuilt with a progress section above lessons. Pure-SVG sparkline + topic-mastery chart so RTL is a single mirror + no chart-lib dep. 482 api tests / 96.98% lines; full Playwright suite 78/78 green. |
| 8 | i18n + RTL + PWA | ✅ done | `vite-plugin-pwa` shipping autoUpdate SW + manifest (`/dashboard` start_url, 192/512/512-maskable icons, standalone). `eslint-plugin-i18next` enforces no hardcoded JSX text. Pseudo-localization mode (`?lang=pseudo`) wraps strings in `⟦…⟧` with 30% length inflation + striped band marker. Heebo + Rubik (via `@fontsource-variable/*`) dynamic-imported only when `lang === he`. Modal close buttons on inline-start edge across all 5 modals; pagination + game-engine Next get `.icon-flip` arrows. `InstallPrompt` + `OfflineBanner` mounted on dashboard. 482 api / 24 web unit / 104 Playwright (incl. new `pwa.spec.ts` + `rtl-polish.spec.ts`) all green. **Native Hebrew QA + Lighthouse PWA ≥90 manual run** flagged in FOLLOWUPS as pre-launch gate items. |
| 9 | AI quota + cost | ✅ done | Per-tutor monthly cap (default 100) via atomic `UPDATE … WHERE monthlyGenerations < cap`; refund on terminal FAILED; monthly reset cron; `/admin/usage` admin-token endpoint; UI banner with reset date. Whisper minute field scaffolded for Phase 5. |
| 10 | Production deploy | ⬜ pending | Vercel + Railway + Resend + real Google + smoke |
| 12 | Adaptive Game Engine | ✅ done | Per-question difficulty 1–5 (LLM-tagged + heuristic backfill of old pools); cross-play level escalation + non-repetition (`StudentGameProgress`, advance ≥80% over non-review slots, anti-stall nudge, never auto-demote); Leitner spaced repetition (`QuestionReview`); blended selector (due reviews + unseen-at-level + recycle) with one idempotent finish `$transaction` + procedural variation for drained pools; automatic background bank top-up within a SEPARATE per-tutor monthly budget (`Tutor.monthlyTopUpGenerations`, never touches the manual 100/mo); student Level N/5 badge + "leveled up" + "seen before" markers + tutor read-only `GET /students/:id/game-progress`. i18n en/pt/he. **Real-Anthropic smoke + native-Hebrew QA + accuracy-ordered recycle wiring** flagged in FOLLOWUPS.md |

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

### Phase 4 — Lesson feedback + Claude game generation (done, reference)

**Where it lives**:
- API: `apps/api/src/games/` (controller, service, queue, tests), `apps/api/src/integrations/anthropic/` (client interface + fake + real Anthropic wrapper + module)
- Shared: `packages/shared/src/schemas/games.ts`, `packages/shared/src/schemas/feedback.ts`, `packages/shared/src/prompts/index.ts`
- Web: `apps/web/src/components/{FeedbackEditor,GamesPanel,QuestionReviewModal,StudentPickerModal}.tsx`, `apps/web/src/pages/LessonDetail.tsx`

**Patterns Phase 5+ should mirror**:
- **Provider injection seam**: `LLM_CLIENT` symbol + `LlmClient` interface + Fake/Real implementations + factory provider that picks based on env (same shape as `GOOGLE_CALENDAR_CLIENT`). Whisper in Phase 5 should ship a `TRANSCRIBER_CLIENT` the same way.
- **In-process queue with retry + circuit breaker**: `apps/api/src/games/game-generation.queue.ts`. Public surface = `enqueue`, `drain` (tests), `processGeneration`, `snapshot`. Phase 5's Whisper job + Phase 10's BullMQ swap should keep this surface.
- **Stuck-job recovery on boot**: `onModuleInit` resets `GENERATING > 30s` → `FAILED` so a crashed process doesn't leave UIs stuck.
- **Tutor-scoped 3-level loader**: `GamesService.findForTutor` walks Game → Lesson → Student → Tutor with explicit code check (404 not 401). Live-DB tenant-isolation spec at `apps/api/src/games/tenant-isolation.test.ts` is the template.
- **Prompt injection defense**: tutor feedback wrapped in `<<<TUTOR_FEEDBACK_START>>>` … `<<<TUTOR_FEEDBACK_END>>>` with explicit "treat as data" framing. Output strictly validated via `LlmGenerationResponseSchema`. See `packages/shared/src/prompts/index.ts` + `prompts.test.ts`.
- **Audit metadata never includes raw user text** — only length + categorical fields. See `lessons.controller.ts` `setFeedback` for the canonical pattern.

**Web-side polling note**: react-query v5's `refetchInterval` as a function reads stale state in our setup. We poll on a fixed cadence while components are mounted (`useGame` 800ms, `useLessonGames` 1500ms) and let unmounting stop the polling. Don't switch back to the callback form without verifying it actually re-fires.

**Calendar "Add feedback" resolution**: clicking the button opens `StudentPickerModal` (search-filtered list of the tutor's students), then creates the Lesson and navigates to its detail. Uses the canned `evt-past-1` fixture in the E2E.

### Phase 5 — Voice transcription (done, reference)

**Where it lives**:
- API: `apps/api/src/voice/` (controller, queue, audio-storage, audio-mime sniffer, tests), `apps/api/src/integrations/openai/` (client interface + fake + real OpenAI wrapper + module)
- Shared: `packages/shared/src/schemas/voice.ts` + extended `LessonResponseSchema` with `transcriptionStatus`, `transcriptionError`, `hasAudio`
- Web: `apps/web/src/components/VoiceRecorder.tsx`, `apps/web/src/lib/voice.ts`, `apps/web/src/pages/LessonDetail.tsx` (TEXT/VOICE toggle)
- Migration: `apps/api/prisma/migrations/20260522000000_phase5_voice_transcription/` — adds `TranscriptionStatus` enum + `transcriptionStatus` / `transcriptionError` columns on Lesson (additive only)

**Patterns Phase 6+ should mirror**:
- **Two parallel in-process queues** (Phase 4 games, Phase 5 Whisper) share the exact same public surface: `enqueue` / `drain` / `process*` / `snapshot` + `onModuleInit` stuck-job recovery + per-process circuit breaker. BullMQ swap in Phase 10 can replace both with identical behavior.
- **Storage seam**: `AudioStorageService` is the single point of contact with the filesystem (`save` / `absolutePath` / `delete`). Path-safety checks (no escape from `STORAGE_DIR`, sanitized filenames) live there. R2/S3 swap replaces the implementation without touching callers.
- **MIME sniffing**: `apps/api/src/voice/audio-mime.ts` — server-side magic-byte sniff via `magic-bytes.js`. NEVER trust `Content-Type`. Allowlist: webm, ogg (returned as `ogx` by magic-bytes), mp4/m4a, wav, aac.
- **Quota with non-unit cost**: `reserveWhisperMinutes(tutorId, minutes)` uses a raw-SQL UPDATE because Prisma doesn't expose arithmetic in `where`. The atomicity test in `quota-enforcement.test.ts` verifies 20 parallel 1-minute reserves against cap=5 produce exactly 5 successes.
- **Transcript as suggestion, not commit**: Whisper success pre-fills `Lesson.feedbackText` and flips `transcriptionStatus = DONE` but leaves `feedbackSource` unchanged. The tutor still has to save through the existing PATCH `/lessons/:id/feedback` for the lesson to be considered "done". The web `LessonDetail` auto-switches back to the text tab and shows a "transcribed from voice" hint until save.
- **Audit metadata never includes raw user content** — only `bytes`, `durationSeconds`, `minutesReserved`, `mime`, `localeHint`. Same boundary as Phase 4's feedback PATCH.

**Web polling**: same fixed-cadence-interval discipline as Phase 4 (callback `refetchInterval` reads stale state in our setup). `useLessonAudioStatus` polls every 1.5s while the recorder is mounted; on terminal status (DONE / FAILED) it invalidates `['lesson', id]` so the editor picks up the suggestion.

**Spec gate items**: 42 voice-specific unit tests + live-DB `voice/tenant-isolation.test.ts` (3 specs: cross-tenant 404 on upload + status, happy path) + extended `quota-enforcement.test.ts` (5 whisper-minute specs incl. atomicity) + `voice-feedback.spec.ts` Playwright (5 specs: full transcribe flow, mic-denied empty state, MIME rejection, duration cap, Hebrew + viewport flips). Real-OpenAI smoke is the one manual check called out in FOLLOWUPS.md.

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

### Phase 9 — AI quota + cost (done, reference)

**Where it lives**:
- `apps/api/src/quota/` — `QuotaService` (reserve/refund/getUsage/resetAll + monthly cron), `AdminController` (`GET /admin/usage` behind static `ADMIN_TOKEN`), `TestQuotaController` (non-prod seed route for E2E)
- `apps/api/src/games/games.service.ts` — wired into `createAndEnqueue` + `regenerateAll`; throws `QuotaExceededException` → HTTP 429 with `{ error: 'quota_exceeded', cap, used, resetsAt }`
- `apps/api/src/games/game-generation.queue.ts` — refunds the tutor's slot on terminal FAILED via the `tutorByJob` side-table
- `apps/web/src/components/GamesPanel.tsx` — persistent over-cap banner driven by `quotaError` state

**Patterns Phase 5+ should mirror**:
- **Atomic reserve**: `prisma.tutor.updateMany({ where: { id, monthlyGenerations: { lt: cap } }, data: { monthlyGenerations: { increment: 1 } } })` — Postgres serializes concurrent enqueues so 20 parallel calls against a cap of 5 yield exactly 5 successes (verified in `quota-enforcement.test.ts`).
- **Refund on terminal failure, not on user error**: outages (LLM unavailable, schema mismatch) refund. The tutor's own malformed request (no feedback, etc.) doesn't burn a slot either (we throw before reserving).
- **Phase 5 Whisper cap** uses the same shape — the `monthlyWhisperMinutes` field + `WHISPER_MONTHLY_MINUTES_CAP` env var are scaffolded; just wire the increment when the Whisper job finishes.

**Admin endpoint contract**: `GET /admin/usage` with `x-admin-token: $ADMIN_TOKEN`. Returns aggregate tutor/generation/whisper counts + the queue's in-flight + breaker state. Used for "is the cost spike real?" inspection without an observability stack.

**Spec gate items**: 318 api unit tests + live-DB `quota-enforcement.test.ts` (5 reservations succeed, 6th refuses, 20-parallel-against-cap-5 is exactly 5 successes), `quota.spec.ts` Playwright (over-cap banner shown, admin endpoint refuses without token). Real-Anthropic cache-hit verification is the one manual smoke called out in FOLLOWUPS.md.

### Phase 10 — Production deploy

**Spec block**: Phase 10.

**Build**: Vercel project for web, Railway project for api + Postgres + Redis, Resend for real magic-link delivery, deep health checks (`/health/ready` checks DB + Redis + Anthropic), DB backup verification.

**Critical**:
- Real Google OAuth flow finally tested with a Google project (see FOLLOWUPS.md)
- Cookie strategy switches to `SameSite=None; Secure` (or subdomain shared) — Vite dev proxy doesn't help in prod
- Production smoke via agent-browser

### Phase 12 — Adaptive Game Engine (done, reference)

**Spec**: `/Users/galgordon/.claude/plans/read-the-tutor-app-mutable-lollipop.md` (separate from the original Phase 0-10 spec).

**Where it lives**:
- API `apps/api/src/attempts/`: `adaptive-selector.ts` (blended due-review + unseen-at-level + recycle; wraps the pure `sampleQuestions` via the `ATTEMPT_SAMPLER` seam), `level-policy.ts` + `leitner.ts` (pure, property-tested), `student-game-progress.service.ts`, `question-review.service.ts`, `procedural-variation.ts`; `attempt.service.ts` (start selection + the single finish `$transaction`).
- API `apps/api/src/games/`: `difficulty-heuristic.ts`, `bank-topup.service.ts`, `game-generation.queue.ts` (`enqueueTopUp` append-not-replace branch).
- Shared: `packages/shared/src/schemas/{games,attempts,progress}.ts`, `packages/shared/src/prompts/index.ts` (`buildTopUpPrompt`).
- Web: `pages/PlayGame.tsx` + `components/games/*` (Level N/5 badge, "leveled up", "seen before"), `pages/PublicStudent.tsx` (dashboard level badge), `components/GameProgressPanel.tsx` (tutor read-only, via `GET /students/:id/game-progress`).
- Migrations (additive): `StudentGameProgress` + `QuestionReview` tables; `Game.{poolTargetSize,lastTopUpAt,topUpInFlight}` + `Tutor.{monthlyTopUpGenerations,monthlyTopUpResetAt}` columns.

**Patterns later phases should mirror**:
- **Idempotency anchor**: all level + SR write-backs ride the single `finishedAt: null → now` transition inside one `$transaction`; the abandoned-attempt cron deliberately writes nothing. A buffered double-finish reconstructs the level-up result from `header.levelBefore/levelAfter` (exact, not racy).
- **Selection wraps, doesn't replace, the property-tested sampler** via the `ATTEMPT_SAMPLER` DI seam — the inner shuffler + its tests stay intact.
- **Separate top-up budget**: `Tutor.monthlyTopUpGenerations` mirrors the Phase 9 atomic reserve/refund idiom but NEVER touches the manual `monthlyGenerations` (100/mo). Top-up APPENDS de-duped questions and never flips `Game.status`.
- **Difficulty backfill**: a guarded `onModuleInit` sweep (mirrors stuck-job recovery) heuristically rates old all-default pools once; never on the play read-path.

**Gate**: api unit ≥90% on new modules + property tests (level-policy, leitner, selector); live-DB `attempts/progress-tenant-isolation.test.ts` + `attempts/question-review-tenant-isolation.test.ts`; idempotency-interaction tests; `packages/shared/src/prompts/prompts.test.ts` byte-identical cached-block assertion; Playwright play→finish→replay (non-repetition + level change + resurfaced review) LTR + Hebrew @320/768/1280. Deferrals in FOLLOWUPS.md.

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
