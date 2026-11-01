# FieldLine

Offline-first medical logistics and readiness management for expeditionary medical teams, with central accountability through the Hawaii logistics hub.

> **Demonstration project.** All data is fictional. This repository is public — never commit real patient information, medication accountability records, credentials, or deployment details.

## What it answers

What we have · who has it · where it is · what we scanned · what we used · what we returned · what we need · what we learned.

## Core idea

Inventory quantities are never stored. Every receipt, issue, consumption, waste, return, transfer and disposal is an immutable event; balances are computed from the event history. This makes "issued" and "consumed" impossible to confuse, gives a complete audit trail by construction, and is the foundation for safe offline synchronization. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
src/core/      ledger engine, permissions, GS1 parser, scan identification (no UI dependencies)
tests/         unit and property tests for the core
docs/          architecture decisions and implementation status
```

## Running the tests

```bash
npx tsx --test tests/*.test.ts
npx tsc -p tsconfig.core.json
```

## Status

See [docs/STATUS.md](docs/STATUS.md) for what is designed, implemented and tested — and what is not.
