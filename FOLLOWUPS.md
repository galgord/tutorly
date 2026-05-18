# Follow-ups

Small items deferred during Phases 0-4. None are blocking; pick them up whenever fits.

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

- **BullMQ swap (Phase 5 or 10)**: Phase 4 ships an in-process queue (`apps/api/src/games/game-generation.queue.ts`) because Phase 5 introduces Whisper which is the natural moment to bring BullMQ in. The queue's public surface — `enqueue`, `drain`, `processGeneration`, `snapshot` — should stay identical so the swap is a contained change. The stuck-job recovery in `onModuleInit` becomes a no-op once BullMQ persists jobs; remove it then.
- **Single-question regenerate runs synchronously, bypassing retries**: see `GameGenerationQueue.regenerateSingle`. The tutor is staring at the review modal — quick failure beats a slow retry. If you change this, the controller's UX assumption changes too.
- **Game status FAILED is terminal but recoverable**: tutor clicks "Try again" → `POST /games/:id/regenerate` resets to GENERATING and re-enqueues. Phase 9's quota check must run BEFORE that reset; otherwise a failed-then-retried game could double-charge the cap.

## Bigger pieces (any phase)

- **`googleapis` SDK is heavy** (~20 transitive deps) — track Railway image size in Phase 10. If it becomes a problem, replace OAuth + calendar fetches with bare `fetch` calls; the surface area is small.
- **Visual regression tests** — Playwright screenshots for the polished i18n pass (Phase 8). Useful for catching RTL regressions on every PR.
- **React Query v5 `refetchInterval` callback footgun** — when given as a function, the callback sometimes reads stale state and never re-fires (we hit this in `useGame`/`useLessonGames` during the Phase 4 walkthrough). We use fixed-interval polling now. If a future TanStack release fixes this, switch back to save the polling cost on completed-state games.
- **`auth.spec.ts` — old "rate-limited" test name says "4 quick requests"** but the API call now succeeds on 4 because the throttler was bumped. The test still passes because it pre-burns 3 via the API and triggers the 4th from the UI — but the name + comment are misleading. Tighten naming.

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
