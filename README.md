# Tutor Companion App

SaaS companion tool for private tutors. Tutors track students, sync calendar, and turn lesson feedback into LLM-generated practice games for students to play between sessions.

Full spec: `/Users/galgordon/.claude/plans/create-a-new-dir-optimized-mochi.md`

## Stack

- **Frontend** — Vite + React + TypeScript + Tailwind + react-i18next (Vercel)
- **Backend** — NestJS + Prisma + Pino + Zod (Railway)
- **DB** — Postgres 16
- **Queue** — Redis + BullMQ
- **AI** — Anthropic Claude (content) + OpenAI Whisper (voice)
- **Locales** — English, Portuguese, Hebrew (RTL)

## Monorepo layout

```
apps/
  api/          NestJS backend
  web/          Vite SPA frontend
packages/
  shared/       Zod schemas + types (consumed by both apps)
  eslint-plugin-direction/   custom rule banning Tailwind physical-direction utilities (RTL safety)
docker-compose.yml           Postgres + Redis for local dev
```

## Prerequisites

- Node 20+
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Docker (for local Postgres + Redis)

## First-time setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
docker compose up -d
```

## Daily dev

```bash
pnpm dev           # boots api (3000) + web (5174) concurrently
pnpm lint          # ESLint across all packages
pnpm typecheck     # TS across all packages
pnpm test          # unit tests across all packages
pnpm test:e2e      # Playwright (boots web dev server automatically)
```

## Phase 0 gate (verify everything works)

```bash
# 1. Infra up
docker compose up -d

# 2. Install + lint + typecheck + test
pnpm install
pnpm lint && pnpm typecheck && pnpm test

# 3. Boot api, then in another shell:
pnpm --filter api dev
curl http://localhost:3000/health
# expect: {"ok":true,"service":"api","version":"0.0.0"}

# 4. Boot web, then in another shell:
pnpm --filter web dev
# open http://localhost:5174 — see "Hello Sara" + locale switcher (en/pt/he)
# switch to Hebrew — confirm <html dir="rtl">

# 5. E2E
pnpm test:e2e
```

## RTL is first-class

- All Tailwind classes must use **logical properties**: `ms-` / `me-` / `ps-` / `pe-` / `start-` / `end-` / `text-start` / `text-end` / `border-s-` / `border-e-` / `rounded-s-` / `rounded-e-`
- The `eslint-plugin-direction` rule fails the build if any physical direction utility (`ml-`, `mr-`, `text-right`, etc.) slips into committed code
- Use `<Bidi>` (`apps/web/src/components/Bidi.tsx`) to wrap any user-supplied content whose direction may differ from the surrounding context (e.g. an English name in a Hebrew sentence)
- `useDirection()` hook reflects + applies the current locale's direction to `<html dir>`

## Future phases

See the full implementation spec for Phases 1–10 (auth, students, calendar, AI feedback, voice, games, progress, i18n polish, AI quotas, deploy). Each phase has a hard gate that must pass before moving on.
