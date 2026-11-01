# Implementation Status

Levels: **Designed** → **Implemented** → **Unit tested** → **Integration tested** → **Browser tested** → **Device tested** → **Operationally validated**.

_Last updated: 2026-10-31_

| Capability | Level | Notes |
|---|---|---|
| Ledger engine (events, buckets, projection) | Unit tested | `tests/ledger.test.ts` |
| Issued ≠ consumed (20-vial scenario) | Unit tested | Matches requirements table exactly |
| Conservation invariant | Unit tested | Randomized 2,000-step property test |
| Returns pending until accepted | Unit tested | Includes quarantine disposition |
| Segregation of duties (returns, transfers) | Unit tested | |
| Medication authority separate from role | Unit tested | |
| Witness rules | Unit tested | Self-issue, flagged items, disposal |
| Expiry blocks issue | Unit tested | Inclusive of printed date |
| Transfers: shipped vs received, shortfall → missing | Unit tested | |
| Idempotent replay (sync foundation) | Unit tested | |
| GS1 parser (raw, human-readable, wedge separator) | Unit tested | `tests/identify.test.ts` |
| FieldLine label codes with check character | Unit tested | |
| Scan resolution order | Unit tested | |
| FEFO lot recommendation | Unit tested | |
| POC user interface | Not started | Blocked on packages, see below |
| Camera scanning | Designed | Needs zxing-wasm |
| QR / DataMatrix label generation | Designed | Needs a QR library |
| Handheld scanner (keyboard wedge) | Designed | |
| IndexedDB persistence | Designed | |
| Server, auth, sync | Designed (ADR-004) | Phase 2–3 |

## Known limitations / blockers

- **npm registry blocked in the build environment** (2026-10-31). Camera scanning, label generation and the Vite toolchain cannot be installed until `registry.npmjs.org` is allowed.
- **No server.** Nothing is centrally synchronized; all sync states are `LOCAL`.
- **Time zones.** Expiry comparisons use the UTC date of the event. A team in UTC+12 recording at 08:00 local on the expiry date is still the previous UTC day — acceptable, but must be reviewed with users.
- **Package conversions** (e.g., box of 10 vials → vials) are not yet modeled; quantities are in the catalog item's unit.

## Decisions

- **Two central hubs: Hawaii and Germany** (confirmed 2026-11-01). See ADR-008.

## Open questions

1. Which hub supports which deployments — fixed by region, or either hub can supply any team?
2. Which items require witnessed issue/waste in your operations (controlled substances, high-cost items)?
3. Which handheld scanner models are in use, and can they be configured to send the GS1 group separator?
