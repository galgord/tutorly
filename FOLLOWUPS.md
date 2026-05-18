# Follow-ups

Small items deferred during Phases 0-3. None are blocking; pick them up whenever fits.

## Quick wins (~5-10 min each)

- [x] **`*.tsbuildinfo` gitignore** — added to `.gitignore`; `packages/shared/tsconfig.tsbuildinfo` untracked.
- [ ] **FullCalendar narrow-viewport header overlap** on `/calendar` at < 768px — day labels clip into each other. Switch to `dayGridMonth` or `listWeek` at narrow widths, or hide the timegrid below a breakpoint.
- [ ] **`current-tutor.decorator.ts` coverage** — only 68% line coverage because its happy path runs through controllers, not the decorator factory directly. Add a unit test that calls the factory function with a fake `ExecutionContext`.

## Deferred — intentional, naturally lands in a later phase

- **Calendar "Add feedback" student association** — clicking "Add feedback" on a Google-only event currently `alert`s. Implementation belongs with Phase 4's feedback flow (where lessons need a `studentId`). Options to choose: student picker dialog, attendee-email auto-match, or route through student detail.
- **Real Google OAuth manual walkthrough** — needs a Google Cloud project with valid `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT_URI`. The OAuth code path is fully tested with a fake; verify the real flow before/during Phase 10.
- **Phase 1 throttler vs parallel E2E** — bumped global to 300/min (1000/min in test) which is enough for current parallelism. Revisit if CI gets more workers or test specs proliferate.

## Bigger pieces (any phase)

- **`googleapis` SDK is heavy** (~20 transitive deps) — track Railway image size in Phase 10. If it becomes a problem, replace OAuth + calendar fetches with bare `fetch` calls; the surface area is small.
- **Visual regression tests** — Playwright screenshots for the polished i18n pass (Phase 8). Useful for catching RTL regressions on every PR.
- **Real-LLM smoke test** — one happy-path test against real Anthropic per LLM-using phase. Defer setup until Phase 4 ships; keep it nightly, not per-PR.
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
