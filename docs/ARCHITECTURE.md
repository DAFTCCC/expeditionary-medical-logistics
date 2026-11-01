# FieldLine Architecture Decisions

Each decision records what was chosen, why, and what would make us revisit it.

## ADR-001 — Quantities are derived from an append-only ledger

**Decision.** No table, store, or module holds an inventory quantity. Every change is a `LedgerEvent` (RECEIVE, ISSUE, CONSUME, WASTE, RETURN, RETURN_ACCEPT, QUARANTINE, DISPOSE, TRANSFER_SHIP, TRANSFER_RECEIVE, DISCREPANCY, asset and label events). Balances are computed by folding events in order (`src/core/ledger.ts`).

**Why.**
- "Issued ≠ consumed" becomes structural: ISSUE moves units AVAILABLE → CUSTODY; only CONSUME moves CUSTODY → consumed.
- All five subsystems read one projection, so they cannot disagree.
- The audit trail *is* the data, not a log bolted on afterwards.
- Offline sync becomes "send the events the server hasn't seen" — no last-write-wins on quantities.

**Invariant (tested).** For every lot: `received = Σ buckets + consumed + wasted + disposed`. A 2,000-step randomized test asserts this and that no balance goes negative.

**Revisit if** projection rebuild time becomes a problem at scale → add server-side snapshots; events remain the source of truth.

## ADR-002 — Buckets, not statuses

Units of a lot are always in exactly one bucket at one holder:

| Bucket | Holder | Issuable? |
|---|---|---|
| AVAILABLE | location | Yes (if not expired) |
| CUSTODY | person | — |
| PENDING_RETURN | location | **No** — awaits inspection |
| QUARANTINE | location | **No** |
| IN_TRANSIT | destination | **No** — shipped, not acknowledged |
| MISSING | location | **No** — discrepancy under investigation |

Terminal outcomes (leave inventory permanently): CONSUMED (by use context), WASTED, DISPOSED. "Expired" is derived from the lot date, not a bucket, so an expired lot is still visibly accounted for where it sits.

## ADR-003 — Rules enforced in the ledger, not the UI

The same `validate()` runs for every event regardless of where it came from (UI today, sync tomorrow). Current rules:

- Positive whole quantities; never more than the source bucket holds.
- Role permissions per event type; **medication handling additionally requires `medicationAuthority`** on the person (logging in grants nothing).
- Expired lots cannot be issued (usable through the end of the printed date).
- Witness required for self-issue, for items flagged `requiresWitness`, and for all disposals; witness ≠ recorder.
- Segregation of duties: a return is accepted by someone other than the returner; a shipment is acknowledged by someone other than the shipper.
- Only quarantined stock can be disposed.
- Transfer shortfalls become MISSING at the destination — never silently dropped.
- Label codes are never reused.

## ADR-004 — Device-generated UUIDs and sync states

Every event gets a UUID on the recording device. Applying a known ID is a no-op (`DUPLICATE`), which makes upload retries safe. Each event carries `sync: LOCAL | PENDING | SYNCED | CONFLICT | REJECTED`. The POC has no server, so everything is honestly `LOCAL`.

**Phase 3 design note.** When two offline devices spend the same stock, the server's re-validation will reject the later event. That event must surface as CONFLICT for human reconciliation — never auto-corrected. This is why rules live in `validate()`.

## ADR-005 — Identification strategy

Resolution order for any scanned or typed string (`src/core/identify.ts`):

1. **FieldLine label** `FL-<type>-<6 chars><check>` — Crockford base32, Luhn mod-32 check character, opaque and non-sensitive. Tolerates lowercase, missing dashes, O/0 and I/L/1 confusion.
2. **GS1 element string** (DataMatrix, GS1-128, GS1 QR) — GTIN (01), lot (10), expiry (17), serial (21) and more. Known GTIN + unseen lot → offers a receipt prefilled from the barcode.
3. **Plain GTIN/UPC/EAN** → product.
4. **Asset tag / manufacturer serial** → equipment.
5. **Lot number** (manual) → lot, refusing ambiguous matches.

Manufacturer identifiers are preferred; FieldLine labels are issued only where none exist (equipment without tags, locations, kits, repackaged stock).

**A scan never executes a transaction.** It resolves a record; the user chooses and confirms an action.

## ADR-006 — Stack

| Concern | Choice | Alternatives considered |
|---|---|---|
| UI | React + TypeScript | Svelte (smaller), Angular (heavier). React chosen for hiring pool and maintainability. |
| Build | Vite (target) / esbuild (current, see Status) | — |
| Local storage | IndexedDB | localStorage (too small, synchronous), SQLite-WASM (stronger, heavier — revisit for Phase 3) |
| Camera scanning | zxing-wasm via BarcodeDetector ponyfill | html5-qrcode (unmaintained), native BarcodeDetector only (no Safari/Firefox/iOS) |
| Server (Phase 2) | PostgreSQL + typed API | Event store products; Postgres with an append-only events table is enough and easier to administer. |

## ADR-007 — Demo data and hosting

The POC uses fictional people, locations and lots. GTINs use the GS1 restricted-circulation range (prefix 02) so they can never collide with real products. Demo data lives in the browser only and is labeled as such on every screen. The repository is public, therefore no real records, credentials, or deployment details may ever be committed.

## ADR-008 — Two central hubs: Hawaii and Germany

_Status: accepted 2026-11-01 (hubs confirmed by the product owner). Supersedes the single-hub assumption in the README._

**Context.** FieldLine deploys teams worldwide from two central hubs, one in Hawaii and one in Germany. Each hub receives, stores, issues and ships stock; teams draw from a hub; the enterprise needs a single accountable picture across both.

**Decision.**

1. **Hubs are ordinary `HUB` locations.** No new entity. Every other location (storage, deployment site, kit) hangs under exactly one hub through `parentId`. A location's hub is found by walking up the tree. People carry an optional `homeLocationId`; their hub is the hub of that location.
2. **Hub-to-hub movement uses the existing transfer events.** `TRANSFER_SHIP` (Hawaii → Germany or the reverse) puts stock `IN_TRANSIT` at the destination; `TRANSFER_RECEIVE` by a different person at the receiving hub makes it `AVAILABLE`, and any shortfall becomes `MISSING` at the destination. No special case — the same rules (segregation of duties, conservation) apply as for hub-to-site transfers.
3. **Views.** Every screen takes a scope: _Enterprise_ (both hubs), _Hawaii hub_, or _Germany hub_. A balance is in a hub's scope if its holder is a location under that hub, or a person whose home location is under that hub. Stock in transit counts toward the **destination** hub (it is that hub's to receive). The enterprise view is the sum of the two hub views and shows them side by side.
4. **Time.** All timestamps are stored in UTC (unchanged, ADR-004). Hubs carry an IANA `timeZone` (`Pacific/Honolulu`, `Europe/Berlin`). Hub-scoped screens display times in that hub's zone; the enterprise view displays in the viewer's device zone and labels the zone. Expiry remains a calendar date compared against the UTC date (see Status — time-zone limitation, which matters more now that the hubs are 11–12 hours apart).
5. **Which hub supplies which team is not encoded yet.** A site's parent hub is the hub that supports it in the demo data. Whether support is fixed by region or either hub may supply any team is an open question; the data model allows either because a transfer can move stock from any hub to any location.

**Items to investigate — not compliance claims.** Operating a hub in Germany may bring requirements that the Hawaii hub does not have. These are flagged for review by qualified people; FieldLine makes no claim to satisfy any of them:

- GDPR for personal data of people recorded in the ledger (names, roles, custody history): lawful basis, retention, data subject rights, cross-border transfer between the EU and US systems.
- German and EU rules for storing, handling, transporting and disposing of medicines, including any controlled substances (e.g., narcotics record-keeping and witness requirements), and whether military or government exemptions apply.
- Cross-border shipment documentation between the two hubs (customs, export/import of medicines).
- Language and date/number formats for German-speaking users.

**Consequences.**

- Two optional fields were added to the core types: `Location.timeZone` and `Person.homeLocationId`. Ledger rules are unchanged; all existing tests still pass.
- Demo data seeds both hubs, each with storage, a supported deployment site, people, equipment and lots, plus a completed Hawaii → Germany transfer with a shortfall and an open Germany → Hawaii shipment.
- Per-hub permissions (e.g., a Germany manager may not record at Hawaii) are **not** enforced yet; roles apply enterprise-wide in the POC.
