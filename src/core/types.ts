/**
 * FieldLine core domain types.
 *
 * Governing rule: inventory quantities are NEVER stored. They are derived by
 * folding an append-only list of LedgerEvents over reference data. Every module
 * (inventory, custody, consumption, readiness, analytics) reads the same
 * projection, so no module can hold a conflicting quantity.
 */

export type ISODateTime = string; // UTC, e.g. 2026-10-31T21:00:00.000Z
export type ISODate = string; // calendar date, e.g. 2027-03-31

// ---------------------------------------------------------------- reference

export type Role =
  | 'ENTERPRISE_ADMIN'
  | 'HUB_LOGISTICS_MANAGER'
  | 'DEPLOYMENT_LOGISTICS_OFFICER'
  | 'MEDICAL_PROVIDER'
  | 'TEAM_MEMBER'
  | 'ANALYST'
  | 'AUDITOR';

export interface Person {
  id: string;
  displayName: string;
  role: Role;
  teamId?: string;
  /**
   * Explicit grant to handle/issue medications. Separate from role and from
   * authentication: logging in never implies medication authority.
   */
  medicationAuthority: boolean;
}

export type LocationKind = 'HUB' | 'STORAGE' | 'DEPLOYMENT_SITE' | 'KIT';

export interface Location {
  id: string;
  name: string;
  kind: LocationKind;
  parentId?: string;
  /** Accountable custodian for a KIT or site, if any. */
  custodianId?: string;
}

export type ItemCategory = 'MEDICATION' | 'CONSUMABLE';

export interface CatalogItem {
  id: string;
  name: string; // generic / descriptive name
  brand?: string;
  category: ItemCategory;
  gtin?: string; // GTIN-14, manufacturer identifier when available
  ndc?: string;
  strength?: string;
  form?: string;
  /** Unit of measure that ledger quantities are counted in (vial, tablet, each). */
  unit: string;
  packageDescription?: string;
  storage?: string;
  reorderPoint: number;
  unitCost?: number;
  /** Requires independent witness for issue, waste and disposal. */
  requiresWitness: boolean;
}

export interface Lot {
  id: string;
  itemId: string;
  lotNumber: string;
  expiry: ISODate;
  serial?: string;
  gtin?: string;
}

export type AssetStatus = 'OPERATIONAL' | 'NEEDS_MAINTENANCE' | 'NON_OPERATIONAL' | 'RETIRED';

export interface Asset {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  serial: string;
  assetTag: string;
  calibrationDue?: ISODate;
}

// ------------------------------------------------------------------ ledger

/** Where a quantity of a lot currently sits. Quantities only move between buckets. */
export type Bucket =
  | 'AVAILABLE' // at a location, may be issued
  | 'CUSTODY' // signed out to a person
  | 'PENDING_RETURN' // physically handed back, not yet inspected/accepted
  | 'QUARANTINE' // at a location, may NOT be issued
  | 'IN_TRANSIT' // shipped, receipt not yet acknowledged
  | 'MISSING'; // discrepancy, under investigation

/** Terminal outcomes. Quantity leaves the accountable inventory forever. */
export type Outcome = 'CONSUMED' | 'WASTED' | 'DISPOSED';

export type UseContext = 'PATIENT_CARE' | 'TRAINING' | 'EXERCISE' | 'TESTING' | 'MAINTENANCE';

export type SyncState = 'LOCAL' | 'PENDING' | 'SYNCED' | 'CONFLICT' | 'REJECTED';

interface EventBase {
  /** UUID generated on the recording device. Idempotency key for sync. */
  id: string;
  /** When it happened, UTC. */
  at: ISODateTime;
  /** Person who recorded the event. */
  actorId: string;
  deviceId: string;
  sync: SyncState;
  note?: string;
}

export type LedgerEvent =
  | (EventBase & {
      type: 'RECEIVE';
      lot: Lot; // created on first receipt of a lot
      qty: number;
      toLocationId: string;
      source: string; // supplier / shipment reference
    })
  | (EventBase & {
      type: 'ISSUE';
      lotId: string;
      qty: number;
      fromLocationId: string;
      toPersonId: string;
      purpose: string;
      witnessId?: string;
    })
  | (EventBase & {
      type: 'CONSUME';
      lotId: string;
      qty: number;
      personId: string; // whose custody it came out of
      context: UseContext;
      encounterCategory?: string;
      interventionCategory?: string;
      /** De-identified reference only. Never a name or DoD ID. */
      encounterRef?: string;
    })
  | (EventBase & {
      type: 'WASTE';
      lotId: string;
      qty: number;
      personId: string;
      reason: string;
      witnessId?: string;
    })
  | (EventBase & {
      type: 'RETURN';
      lotId: string;
      qty: number;
      personId: string;
      toLocationId: string;
    })
  | (EventBase & {
      type: 'RETURN_ACCEPT';
      returnEventId: string;
      qty: number;
      disposition: 'AVAILABLE' | 'QUARANTINE';
    })
  | (EventBase & {
      type: 'QUARANTINE';
      lotId: string;
      qty: number;
      locationId: string;
      reason: string;
    })
  | (EventBase & {
      type: 'DISPOSE';
      lotId: string;
      qty: number;
      locationId: string; // from QUARANTINE at this location
      method: string;
      witnessId?: string;
    })
  | (EventBase & {
      type: 'TRANSFER_SHIP';
      lotId: string;
      qty: number;
      fromLocationId: string;
      toLocationId: string;
    })
  | (EventBase & {
      type: 'TRANSFER_RECEIVE';
      shipEventId: string;
      qtyReceived: number;
    })
  | (EventBase & {
      type: 'DISCREPANCY';
      lotId: string;
      qty: number; // quantity that cannot be found
      locationId: string;
    })
  | (EventBase & { type: 'ASSET_REGISTER'; asset: Asset; locationId: string; custodianId?: string })
  | (EventBase & { type: 'ASSET_ASSIGN'; assetId: string; locationId: string; custodianId?: string })
  | (EventBase & { type: 'ASSET_CONFIRM'; assetId: string; locationId: string })
  | (EventBase & { type: 'ASSET_STATUS'; assetId: string; status: AssetStatus; condition: string })
  | (EventBase & {
      type: 'LABEL_ISSUE';
      code: string;
      targetType: LabelTarget;
      targetId: string;
      reason: 'NEW' | 'REPLACEMENT';
    })
  | (EventBase & { type: 'LABEL_RETIRE'; code: string; reason: string });

export type LedgerEventType = LedgerEvent['type'];
export type LabelTarget = 'LOT' | 'ASSET' | 'LOCATION' | 'ITEM';

export interface ReferenceData {
  people: Person[];
  locations: Location[];
  items: CatalogItem[];
}
