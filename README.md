# FieldLine

Offline-first medical logistics and readiness management for expeditionary medical teams, with central accountability through two logistics hubs — Hawaii and Germany (ADR-008).

> **Demonstration project.** All data is fictional. This repository is public — never commit real patient information, medication accountability records, credentials, or deployment details.

## What it answers

What we have · who has it · where it is · what we scanned · what we used · what we returned · what we need · what we learned.

## Core idea

Inventory quantities are never stored. Every receipt, issue, consumption, waste, return, transfer and disposal is an immutable event; balances are computed from the event history. This makes "issued" and "consumed" impossible to confuse, gives a complete audit trail by construction, and is the foundation for safe offline synchronization. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Live demo

<https://daftccc.github.io/expeditionary-medical-logistics/> — fictional data, stored only in your browser. Deployed from `main` by `.github/workflows/pages.yml` after tests pass.

Field testing: see [docs/FIELD-TEST.md](docs/FIELD-TEST.md).

## Repository layout

```
src/core/      ledger engine, permissions, GS1 parser, scan identification (no UI dependencies)
src/demo/      fictional two-hub seed data (Hawaii + Germany)
src/app/       Phase 1 proof-of-concept UI (React + Vite), IndexedDB storage, camera scanner
tests/         unit and property tests
e2e/           scripted browser tests (Playwright)
docs/          architecture decisions and implementation status
```

## Running it

```bash
npm install
npm test            # unit + property tests
npm run typecheck   # strict TypeScript, core and app
npm run dev         # local dev server
npm run build       # production build into dist/
```

## Status

See [docs/STATUS.md](docs/STATUS.md) for what is designed, implemented and tested — and what is not.
