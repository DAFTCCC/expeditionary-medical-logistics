# Implementation Status

Levels: **Designed** → **Implemented** → **Unit tested** → **Integration tested** → **Browser tested** → **Device tested** → **Operationally validated**.

_Last updated: 2026-11-01 (field-test build)_

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
| Two hubs, Hawaii + Germany (ADR-008) | Unit tested | `tests/seed.test.ts`: scoping, hub-to-hub transfers, enterprise = sum of hubs |
| Two-hub demo seed | Unit tested | Every seed event accepted; conservation holds for every lot |
| POC UI: dashboard, inventory by lot/expiry, transactions, equipment custody, labels, history | Browser tested (local) | Headless Chrome, 25 scripted workflow steps against the production build served locally. The live GitHub Pages site has **not** been opened by a browser yet |
| Camera scanning (zxing-wasm, bundled WASM) | Browser tested (decoder only) | Decoding verified from an image file in Chrome. **Live camera not tested** — needs a real device |
| QR label generation | Browser tested | QR rendered, then decoded back by the scanner |
| DataMatrix label generation (incl. GS1) | Browser tested (local) | Generated, then decoded by the camera reader |
| Handheld scanner (keyboard wedge) | Browser tested (simulated keystrokes) | **No physical scanner tested**; GS separator substitutes configurable |
| IndexedDB persistence | Browser tested | Events survive reload |
| Offline install (service worker + manifest) | Browser tested (local) | Pre-caches all files incl. both WASM; reload and transact with network off verified in headless Chrome. Not yet verified on iOS/Android devices |
| Quarantine / witnessed disposal / missing-report screens | Browser tested (local) | |
| Own field-test data: start blank, edit items/locations/people, register equipment | Unit + browser tested (local) | Reference edits never rewrite history (core `replay()`) |
| Backup export / restore | Browser tested (local) | Replaces device data; no merge |
| Server, auth, sync | Designed (ADR-004) | Phase 2–3 |

## Known limitations / blockers

- **GitHub Pages source is still "Deploy from a branch".** GitHub's own Jekyll build of `main` runs on every push alongside the app deploy; the workflow waits for it and deploys afterwards, so for a minute after each push the site may show a blank page. Switching Settings → Pages → Source to **GitHub Actions** removes the race.

- **No authentication.** "Acting as" is a demo switch. Witnesses are selected, not authenticated.
- **Roles are enterprise-wide.** Per-hub permissions are not enforced (ADR-008).
- **No server.** Nothing is centrally synchronized; all sync states are `LOCAL`.
- **Time zones.** Expiry comparisons use the UTC date of the event. Hawaii (UTC−10) and Germany (UTC+1/+2) disagree with UTC about "today" for part of each day, so a lot can show as usable or expired a few hours early or late relative to local time. Must be reviewed with users.
- **Package conversions** (e.g., box of 10 vials → vials) are not yet modeled; quantities are in the catalog item's unit.

## Decisions

- **Two central hubs: Hawaii and Germany** (confirmed 2026-11-01). See ADR-008.
- **Reorder points are per hub.** The enterprise view flags an item if it is below its reorder point at either hub.

## Open questions

1. Which hub supports which deployments — fixed by region, or either hub can supply any team?
2. Which items require witnessed issue/waste in your operations (controlled substances, high-cost items)?
3. Which handheld scanner models are in use, and can they be configured to send the GS1 group separator?
