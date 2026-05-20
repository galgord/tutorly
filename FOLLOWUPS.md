# Follow-ups

Small items deferred during Phases 0-9 + 12. None are blocking; pick them up whenever fits.

## Quick wins (~5-10 min each)

- [x] **`*.tsbuildinfo` gitignore** — added to `.gitignore`; `packages/shared/tsconfig.tsbuildinfo` untracked.
- [ ] **FullCalendar narrow-viewport header overlap** on `/calendar` at < 768px — day labels clip into each other. Switch to `dayGridMonth` or `listWeek` at narrow widths, or hide the timegrid below a breakpoint.
- [ ] **`current-tutor.decorator.ts` coverage** — only 68% line coverage because its happy path runs through controllers, not the decorator factory directly. Add a unit test that calls the factory function with a fake `ExecutionContext`.
- [ ] **`.env.example` cleanup** — empty `GOOGLE_CLIENT_ID=` style lines used to trip the env validator. The loader now preprocess-coerces empty strings to undefined, so it boots regardless, but the example file still suggests setting them empty. Switch to fully commented-out lines for clarity.

## Deferred — intentional, naturally lands in a later phase

- [x] **Calendar "Add feedback" student association** — resolved in Phase 4 via `StudentPickerModal`.
- **Real Google OAuth manual walkthrough** — needs a Google Cloud project with valid `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT_URI`. The OAuth code path is fully tested with a fake; verify the real flow before/during Phase 10.
- **Real-Anthropic LLM smoke** — Phase 4 ships with `FakeLlmClient` so dev/CI never burns Anthropic credit. One manual happy-path test against real Anthropic with a sample feedback (en + he) should run before Phase 10. Document the prompt + sample feedback used so it's reproducible. The real client is at `apps/api/src/integrations/anthropic/llm.real.ts` and auto-injects when `ANTHROPIC_API_KEY` is set.
- **Phase 1 throttler vs parallel E2E** — bumped global to 300/min (1000/min in test) which is enough for current parallelism. Revisit if CI gets more workers or test specs proliferate.

## Phase 4 → later-phase handoff (queue + LLM patterns)

- **BullMQ swap (Phase 10)**: Phase 5 ships a SECOND in-process queue (`apps/api/src/voice/whisper-job.queue.ts`) using the same public surface as the games queue (`enqueue`, `drain`, `processTranscription`, `snapshot`). Both should swap to BullMQ together in Phase 10 so the deploy gains durable jobs across api restarts. Stuck-job recovery in `onModuleInit` becomes a no-op once BullMQ persists; remove it then.
- **Single-question regenerate runs synchronously, bypassing retries**: see `GameGenerationQueue.regenerateSingle`. The tutor is staring at the review modal — quick failure beats a slow retry. If you change this, the controller's UX assumption changes too.
- [x] **Game status FAILED is terminal but recoverable** — handled in Phase 9. The queue refunds the tutor's quota slot on terminal FAILED via the `tutorByJob` side-table. The regenerate-all path runs `reserveGeneration` BEFORE flipping status, so double-charges aren't possible.

## Phase 9 — handoff to Phase 5 (Whisper) + Phase 10 (deploy)

- [x] **Whisper minute increment** — wired in Phase 5 via `QuotaService.reserveWhisperMinutes` / `refundWhisperMinutes` (atomic UPDATE with `monthlyWhisperMinutes + N <= cap` raw-SQL predicate; concurrent uploads can never collectively exceed the cap, verified in `quota-enforcement.test.ts`).
- **`ADMIN_TOKEN` must be set in production**. The env loader makes it optional in dev (the admin endpoint 403s if unset), but Phase 10's deploy checklist needs an explicit "generate + set ADMIN_TOKEN" step. Suggested entropy: `openssl rand -hex 32`.
- **Real-Anthropic cache-hit smoke** — see also the Phase 4 follow-up. Phase 9's gate calls for verifying `usage.cache_read_input_tokens > 0` on the second call in a session. The `LlmGenerationResult.usage.cachedInputTokens` field is wired through `RealAnthropicLlmClient`; do the manual smoke once a real key is available, capture the numbers in a note.
- **Per-tutor cost dashboard** — current `/admin/usage` is aggregate-only. Phase 10's ops checklist may want per-tutor breakdown for spike investigation. Easy to add: extend `getAggregateUsage` with a `topConsumers` slice (top N by `monthlyGenerations`).

## Phase 5 — handoff to later phases

- **Real-OpenAI Whisper smoke** — Phase 5 ships with `FakeTranscriberClient` so dev/CI never burns credit. One manual happy-path test against real Whisper with a sample WAV (en + he tutor locale) should run before Phase 10. The real client is at `apps/api/src/integrations/openai/whisper.real.ts` and auto-injects when `OPENAI_API_KEY` is set. Document the recording + expected transcript so it's reproducible.
- **R2/S3 object storage migration** — v1 stores audio on local filesystem under `STORAGE_DIR` (Railway Volume in prod). The `AudioStorageService` is a single seam — replace `save` / `absolutePath` / `delete` with R2 SDK calls when storage volume / multi-region access becomes a need. Audit metadata (`bytes`, `durationSeconds`) doesn't depend on the storage backend so no DB migration required.
- **Whisper client-side downsample to 16kHz mono opus**: the spec mentions it under cost controls. The recorder requests `audioBitsPerSecond: 24_000` and prefers `audio/webm;codecs=opus`, which MediaRecorder honors in Chrome/Firefox/Edge. Safari ignores the codec hint and produces mp4 (still accepted). True 16k mono downsampling pre-upload would need an OfflineAudioContext pass; defer until cost data shows it's worth the complexity.
- **Audio duration trust** — the upload endpoint currently believes the client's `durationSeconds` form field (clamped to 0–300). Server-side audio decode for the true duration would be the next hardening step — would need `ffprobe` (or an equivalent JS decoder) added to the api image. Low-priority because the cap is per-tutor monthly, so over-reporting just makes the tutor hit their own cap sooner.
- **Whisper queue concurrency env (`WHISPER_CONCURRENCY`)** is wired but not enforced (the in-process queue is single-threaded by setImmediate scheduling). BullMQ swap in Phase 10 should honor it — the worker config takes a `concurrency` option directly.

## Phase 6 — handoff to later phases

- **Cross-device resume of an in-progress attempt** — the IndexedDB answer buffer lives per-device. If a student starts on phone and switches to laptop mid-attempt, the laptop won't see the buffered answers (and the API has the authoritative score anyway). The server-side `Attempt` row IS persistent across devices, so resume would mean: on PlayGame mount, query for an unfinished attempt on this `(student, game)` and resume from `header.results.length`. Out of scope for v1; document with the engine as a Phase 7/8 nice-to-have.
- **Manual screen-reader walkthrough (VoiceOver / NVDA / TalkBack)** — Phase 6 ships an `@axe-core/playwright` gate that catches structural a11y issues (zero serious/critical on both engines). A real screen-reader pass with Hebrew + English content (especially for the timer countdown announcements and the lives icons) should fold into Phase 8's i18n+RTL polish.
- **TIMED_QUIZ infinite mode** — the engine reshuffles the sampled set when exhausted so play feels infinite, but the server-side sampled question IDs are fixed for the attempt. If we ever want truly bottomless play, the server would need to expand the attempt's `sampledIds` mid-flight — for now the cap (default 20) is plenty.
- **`Attempt.questionResults` JSON header** carries `keys` (the per-question answer keys) so the server can score without re-reading the full game pool. The downside: a tutor editing a question post-assign doesn't change the answer keys already-attempted students see (correct behavior — past attempts' scoring is frozen). Future attempts (next start) re-read the live pool. Document this freezing semantics for tutors before public launch.
- **Per-token rate limit** — Phase 6 reuses the global 60/min/IP throttle on student endpoints. A determined attacker with one stolen share token could grind through ~60 answer PATCHes/min from a single IP, which is fine for one student's homework but worth revisiting with per-token throttling if abuse shows up. Token rotation (already shipped Phase 2) is the real escape hatch.
- **`idb` chosen over raw IndexedDB** — adds ~1.5kB gzipped but saves us re-implementing the open/upgrade/transaction dance. If bundle size becomes critical, swap to native IndexedDB inside `attempt-buffer.ts` — surface is small.
- **`fake-indexeddb` dev-dep** added for the buffer's vitest spec; only used in tests.

## Phase 7 — handoff to later phases

- **Charting**: progress dashboard ships pure SVG (`Sparkline.tsx`, `TopicMasteryChart.tsx`) — no chart-lib dep. Trade-off: limited interactivity (no tooltips on hover). If Phase 8/10 wants richer charts (e.g. tooltip showing exact attempt + date on sparkline hover), `recharts` or `visx` is the swap point — both have RTL stories that need testing. Keep the SVG components as the empty-state fallback.
- **Topic-mastery time axis**: month buckets are UTC. A tutor in São Paulo crossing midnight will see attempts land in the next bucket depending on UTC. If timezone-correctness becomes a complaint, bucket per tutor-locale TZ — `Tutor` model doesn't carry a TZ yet so this needs a schema add.
- **6-month attempt cutoff** is a hard constant in `progress.service.ts` (`RECENT_ATTEMPT_WINDOW_MS`). Tutors with very active long-term students may want to page further back; expose as `?since=` if requested.
- **Trend threshold (5%)** is also a constant in `progress.aggregations.ts`. Tuning candidate — if "stable" feels too generous in early QA, lower to 3%.
- **Hardest-questions list** uses a min 3-sample threshold. A new student who's only played once won't see a hardest-list — that's intentional (one wrong answer isn't a pattern). Document this for tutors before public launch so they don't think the section is broken.
- **Per-question drill-down ships inline** with each attempt row (api returns the full `results` array on each item). For students with dozens of answered questions per attempt, this could bloat the response; consider a `?detail=summary` mode if payload size shows up in performance work.
- **Sparkline tone** keys off `trend` direction (green/red/slate). Colorblind-friendliness was not specifically audited — a Phase 8 a11y polish item.

## Bigger pieces (any phase)

- **`googleapis` SDK is heavy** (~20 transitive deps) — track Railway image size in Phase 10. If it becomes a problem, replace OAuth + calendar fetches with bare `fetch` calls; the surface area is small.
- **Visual regression tests** — Playwright screenshots for the polished i18n pass (Phase 8). Useful for catching RTL regressions on every PR.
- **React Query v5 `refetchInterval` callback footgun** — when given as a function, the callback sometimes reads stale state and never re-fires (we hit this in `useGame`/`useLessonGames` during the Phase 4 walkthrough). We use fixed-interval polling now. If a future TanStack release fixes this, switch back to save the polling cost on completed-state games.
- **`auth.spec.ts` — old "rate-limited" test name says "4 quick requests"** but the API call now succeeds on 4 because the throttler was bumped. The test still passes because it pre-burns 3 via the API and triggers the 4th from the UI — but the name + comment are misleading. Tighten naming.

## Phase 8 — handoff to later phases

- **Native-speaker Hebrew QA pass** — required before public launch. Phase 8 shipped translations en/pt/he (314 keys) machine-translated for pt/he, plus comprehensive RTL polish (modal close on inline-start, `.icon-flip` on directional arrows, Heebo+Rubik lazy-loaded, pseudo-localization mode, italic→bold mapping). One native Hebrew reader still needs to walk the entire app and flag awkward phrasing or RTL bugs. Block release on this.
- **Lighthouse PWA score ≥ 90** — gate item from the spec. Phase 8 confirmed the structural requirements (valid manifest, SW registers without console errors, 192 + 512 + 512-maskable icons, theme-color, viewport meta, https in prod via Vercel). A real `lighthouse https://...` run inside Chrome is awkward to automate in a sub-agent run — fold into Phase 10's deploy smoke and capture the score.
- **Student-side install prompt on mobile after first game played** — the spec mentions this nice-to-have. Phase 8 ships the tutor-facing install card on `/dashboard` only. Student-side install prompt (on `/play/...` after attempt finish) is intentionally deferred.
- **Per-locale PWA manifest builds** — the manifest only supports a single `lang` + `dir` per build. Phase 8 picks `en`/`ltr` as canonical. Per-locale Capacitor/PWA bundles (he with `dir: 'rtl'`) is a real production complication; revisit if RTL install UX is awkward in Phase 10 + onward.
- **Visual regression / golden-snapshot for mixed-content questions** — "Translate _____ to English" rendered in a Hebrew UI. Existing E2E specs confirm layout doesn't break but a snapshot suite would catch bidi mojibake regressions. Add when a screenshot diff tool (Percy / Chromatic) is in place.
- **PWA icon regeneration** — `apps/web/scripts/generate-pwa-icons.mjs` renders the "TA" wordmark at 192/512 + 512-maskable + 64 favicon using a hand-rolled PNG encoder (no native deps). Re-run after any brand mark change. Real branded icon (designer-supplied) can drop in by replacing the four `pwa-*.png` files in `apps/web/public/`.
- **PWA service worker in dev** — defaults to off (`VITE_PWA_DEV=true` to enable). HMR + workbox fight each other. Tests assert against the build output rather than dev-server SW behavior.
- **`vite-plugin-pwa` precache excludes Hebrew woff2** — the `globIgnores: ['**/heebo-*.woff2', '**/rubik-*.woff2']` keeps the first SW install lean for English users; runtime cache (CacheFirst, 1y) hydrates the fonts only when the Hebrew path is hit.
- **Pseudo-localization at `?lang=pseudo`** — wraps every translated string with `⟦ … ⟧` and inflates length ~30%; adds a striped band at the top of the viewport via `html.pseudo-active::before` so QA can confirm the mode is on. Treats interpolation placeholders verbatim. Useful before each phase exit for a fresh hardcoded-string sweep.
- **`eslint-plugin-i18next` whitelist** — `apps/web/.eslintrc.cjs` excludes pure-glyph affordances (`×`, `←`, `→`, `—`, `–`, `·`, `•`), the brand mark `Tutor App`, locale endonyms (`English`, `Português`, `עברית`), and whitespace-only fragments. Anything new on this list needs justification in the commit message.
- **`<Bidi>` is exempted from `no-literal-string`** — it's a wrapper for user-supplied content (student names, question text), not a localization opportunity. Same exemption shape as the rule's default `Trans` exemption.

## Phase 12 — Adaptive game engine — handoff to later phases

All deferred items below are non-blocking; the engine ships fully functional on the `FakeLlmClient`.

- **Real-Anthropic smoke (difficulty + top-up quality + cache hits)** — runs only with a real `ANTHROPIC_API_KEY` (auto-injected into `llm.real.ts`). Against real Claude, verify: (1) per-question `difficulty` tags actually spread across 1–5 and feel calibrated (not all clustered at 3); (2) `buildTopUpPrompt`'s avoid-list yields genuinely new, non-duplicate questions; (3) prompt-cache hits — `usage.cachedInputTokens > 0` on the second call in a session. The two `cache_control` blocks (system + game-type) MUST stay byte-identical between `buildGenerationPrompt` and `buildTopUpPrompt` in `packages/shared/src/prompts/index.ts`; `packages/shared/src/prompts/prompts.test.ts` asserts this — keep it green when editing prompts. Fold into the existing Phase 4/9 real-Anthropic smoke.
- **Native-speaker Hebrew QA of the adaptive copy** — the new strings were machine-translated. A native reader should check `play.levelBadge` / `play.reviewMarker` / `play.leveledUp` / `play.summaryNextLevel`, `publicStudent.level`, and `progress.adaptive.*` in `apps/web/src/locales/he/common.json` for phrasing + RTL. Roll into the existing Phase 8 native-Hebrew pass.
- **Accuracy-ordered recycle (deferred from 12D)** — `apps/api/src/attempts/adaptive-selector.ts` accepts an optional `recycleRank` param (line 35) to order recycled (drained-pool) questions; it is currently UNWIRED, so recycle falls back to band-order. To prioritize a student's weakest/stalest questions, wire `recycleRank` from `QuestionReview` accuracy (`timesWrong/timesSeen`) + recency (`lastSeenAt`): add a stats query to `QuestionReviewService` and pass the ranker from `AttemptService` at selection time. The selector already sorts by it when provided — just supply the function.
- **JSON-pool → dedicated `Question` table threshold** — pools live as JSON on `Game.questionPool`, funneled through `parsePool` (single chokepoint). As auto top-up grows banks toward `poolTargetSize` (default 200), watch row size / query cost. When it bites, promote the pool to its own table; `parsePool` is the one seam to change. No action until banks actually approach the cap in prod.
- **Threshold calibration via an agent-browser "does it feel right" pass** — the level/SR knobs ship with first-cut defaults (`LEVEL_ADVANCE_THRESHOLD=0.8`, `LEVEL_HOLD_FLOOR=0.5`, `LEVEL_NUDGE_EVERY_N=3`, `REVIEW_FRACTION=0.3`, `SR_BOX_INTERVALS_DAYS=0,1,3,7,16`, `LEVEL_ALLOW_DOWN=false`). Play several real sessions and tune so the ramp feels motivating, not punishing — all are env-overridable (see `apps/api/src/config/env.ts` + `apps/api/.env.example`).

## Out of scope for v1 (per the spec) — DO NOT add

These were explicitly cut from v1 in the spec. If you find yourself needing them, surface to the user first:

- Email notifications beyond magic links
- Stripe/billing
- Parent accounts
- Two-way Google Calendar sync (write events back)
- Native mobile apps (PWA only)
- Real-time / websockets
- Sentry / PostHog / observability stack
- Game types beyond fill-in-blank and timed quiz
- Offline game play
- Tutor-to-tutor student sharing
