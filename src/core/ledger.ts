import { canRecord, MEDICATION_HANDLING } from './permissions';
import type {
  Asset, AssetStatus, Bucket, CatalogItem, ISODateTime, LabelTarget, LedgerEvent,
  Location, Lot, Outcome, Person, ReferenceData, UseContext,
} from './types';

/**
 * The ledger projection: everything the app shows is computed here from
 * reference data + accepted events. Nothing else stores a quantity.
 */

export interface LotTotals {
  received: number;
  issued: number;
  returned: number; // handed back (pending or accepted)
  returnAccepted: number;
  consumed: number;
  consumedByContext: Partial<Record<UseContext, number>>;
  wasted: number;
  disposed: number;
  quarantined: number; // ever moved into quarantine
  missing: number; // ever reported missing
}

export interface ReturnRecord {
  eventId: string;
  lotId: string;
  personId: string;
  locationId: string;
  qty: number;
  remaining: number;
}

export interface ShipmentRecord {
  eventId: string;
  lotId: string;
  fromLocationId: string;
  toLocationId: string;
  qty: number;
  remaining: number;
  shippedBy: string;
}

export interface AssetState {
  asset: Asset;
  locationId: string;
  custodianId?: string;
  status: AssetStatus;
  condition: string;
  /** Last time someone physically confirmed the location (scan or record). */
  lastConfirmedAt: ISODateTime;
  lastConfirmedBy: string;
  history: string[]; // event ids
}

export interface LabelState {
  code: string;
  targetType: LabelTarget;
  targetId: string;
  active: boolean;
  issuedAt: ISODateTime;
  history: string[];
}

export interface Projection {
  lots: Map<string, Lot>;
  /** key: lotId|bucket|holderId → qty. holder is a locationId, or a personId for CUSTODY. */
  balances: Map<string, number>;
  totals: Map<string, LotTotals>;
  returns: Map<string, ReturnRecord>;
  shipments: Map<string, ShipmentRecord>;
  assets: Map<string, AssetState>;
  labels: Map<string, LabelState>;
  /** Accepted events in application order. */
  events: LedgerEvent[];
  eventIds: Set<string>;
  rejected: { event: LedgerEvent; reason: string }[];
}

export type ApplyResult =
  | { status: 'ACCEPTED' }
  | { status: 'DUPLICATE' } // same id already applied: idempotent no-op
  | { status: 'REJECTED'; reason: string };

export function emptyProjection(): Projection {
  return {
    lots: new Map(), balances: new Map(), totals: new Map(), returns: new Map(),
    shipments: new Map(), assets: new Map(), labels: new Map(),
    events: [], eventIds: new Set(), rejected: [],
  };
}

// ------------------------------------------------------------------ queries

const key = (lotId: string, bucket: Bucket, holderId: string) => `${lotId}|${bucket}|${holderId}`;

export function qty(p: Projection, lotId: string, bucket: Bucket, holderId: string): number {
  return p.balances.get(key(lotId, bucket, holderId)) ?? 0;
}

export interface BalanceRow { lotId: string; bucket: Bucket; holderId: string; qty: number }

export function balanceRows(p: Projection): BalanceRow[] {
  const rows: BalanceRow[] = [];
  for (const [k, v] of p.balances) {
    if (v === 0) continue;
    const [lotId, bucket, holderId] = k.split('|') as [string, Bucket, string];
    rows.push({ lotId, bucket, holderId, qty: v });
  }
  return rows;
}

/** Sum of a lot in a bucket across all holders. */
export function bucketTotal(p: Projection, lotId: string, bucket: Bucket): number {
  let n = 0;
  for (const r of balanceRows(p)) if (r.lotId === lotId && r.bucket === bucket) n += r.qty;
  return n;
}

export function totalsFor(p: Projection, lotId: string): LotTotals {
  return p.totals.get(lotId) ?? blankTotals();
}

/**
 * Conservation check: every unit ever received is in exactly one bucket or one
 * terminal outcome. If this ever fails, the ledger code is wrong.
 */
export function conservationHolds(p: Projection, lotId: string): boolean {
  const t = totalsFor(p, lotId);
  let inBuckets = 0;
  for (const r of balanceRows(p)) if (r.lotId === lotId) inBuckets += r.qty;
  return t.received === inBuckets + t.consumed + t.wasted + t.disposed;
}

export function isExpired(lot: Lot, atISO: string): boolean {
  // Usable through the end of the printed expiry date (UTC date comparison).
  return atISO.slice(0, 10) > lot.expiry;
}

// ------------------------------------------------------------------- apply

function blankTotals(): LotTotals {
  return {
    received: 0, issued: 0, returned: 0, returnAccepted: 0, consumed: 0,
    consumedByContext: {}, wasted: 0, disposed: 0, quarantined: 0, missing: 0,
  };
}

class Ref {
  people: Map<string, Person>;
  locations: Map<string, Location>;
  items: Map<string, CatalogItem>;
  constructor(r: ReferenceData) {
    this.people = new Map(r.people.map((x) => [x.id, x]));
    this.locations = new Map(r.locations.map((x) => [x.id, x]));
    this.items = new Map(r.items.map((x) => [x.id, x]));
  }
}

const refCache = new WeakMap<ReferenceData, Ref>();
function ref(r: ReferenceData): Ref {
  let x = refCache.get(r);
  if (!x) refCache.set(r, (x = new Ref(r)));
  return x;
}

/** Validate an event against the current projection. Returns a reason, or null if valid. */
export function validate(p: Projection, refData: ReferenceData, e: LedgerEvent): string | null {
  const R = ref(refData);
  const actor = R.people.get(e.actorId);
  if (!actor) return 'Unknown recording person.';
  if (!canRecord(actor, e.type)) return `${actor.displayName}'s role may not record ${e.type}.`;

  if ('qty' in e && (!Number.isInteger(e.qty) || e.qty <= 0)) return 'Quantity must be a positive whole number.';

  const lotOf = (lotId: string) => p.lots.get(lotId);
  const itemOfLot = (lotId: string) => {
    const l = lotOf(lotId);
    return l ? R.items.get(l.itemId) : undefined;
  };
  const needsMedAuthority = (lotId: string) =>
    MEDICATION_HANDLING.has(e.type) && itemOfLot(lotId)?.category === 'MEDICATION';
  const checkWitness = (witnessId: string | undefined, required: boolean): string | null => {
    if (!witnessId) return required ? 'An independent witness is required for this transaction.' : null;
    const w = R.people.get(witnessId);
    if (!w) return 'Unknown witness.';
    if (witnessId === e.actorId) return 'The witness must be a different person from the one recording.';
    return null;
  };
  const requireLot = (lotId: string) => (lotOf(lotId) ? null : 'Unknown lot.');
  const requireLoc = (id: string) => (R.locations.has(id) ? null : 'Unknown location.');

  if ('lotId' in e) {
    const err = requireLot(e.lotId);
    if (err) return err;
    if (needsMedAuthority(e.lotId) && !actor.medicationAuthority)
      return `${actor.displayName} does not hold medication-handling authority.`;
  }

  switch (e.type) {
    case 'RECEIVE': {
      if (!R.items.has(e.lot.itemId)) return 'Unknown catalog item.';
      const err = requireLoc(e.toLocationId);
      if (err) return err;
      if (!e.lot.lotNumber.trim()) return 'Lot number is required.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.lot.expiry)) return 'Expiration date is required (YYYY-MM-DD).';
      const existing = lotOf(e.lot.id);
      if (existing && (existing.itemId !== e.lot.itemId || existing.lotNumber !== e.lot.lotNumber || existing.expiry !== e.lot.expiry))
        return 'Lot record conflicts with an existing lot (item, lot number or expiry differ).';
      for (const l of p.lots.values()) {
        if (l.id !== e.lot.id && l.itemId === e.lot.itemId && l.lotNumber === e.lot.lotNumber)
          return `Lot ${e.lot.lotNumber} of this item already exists under a different record.`;
      }
      return null;
    }
    case 'ISSUE': {
      const lot = lotOf(e.lotId)!;
      if (isExpired(lot, e.at)) return `Lot ${lot.lotNumber} expired ${lot.expiry}; it cannot be issued.`;
      if (qty(p, e.lotId, 'AVAILABLE', e.fromLocationId) < e.qty) return 'Not enough available stock at that location.';
      const to = R.people.get(e.toPersonId);
      if (!to) return 'Unknown receiving person.';
      if (itemOfLot(e.lotId)?.category === 'MEDICATION' && !to.medicationAuthority)
        return `${to.displayName} is not authorized to take custody of medications.`;
      const selfIssue = e.toPersonId === e.actorId;
      return checkWitness(e.witnessId, selfIssue || !!itemOfLot(e.lotId)?.requiresWitness);
    }
    case 'CONSUME':
    case 'WASTE':
    case 'RETURN': {
      const custodian = R.people.get(e.personId);
      if (!custodian) return 'Unknown custodian.';
      const onBehalf = e.personId !== e.actorId;
      if (onBehalf && !['HUB_LOGISTICS_MANAGER', 'DEPLOYMENT_LOGISTICS_OFFICER'].includes(actor.role))
        return 'Only the custodian or a logistics officer may record against this custody.';
      if (qty(p, e.lotId, 'CUSTODY', e.personId) < e.qty)
        return `${custodian.displayName} has only ${qty(p, e.lotId, 'CUSTODY', e.personId)} in custody.`;
      if (e.type === 'WASTE') return checkWitness(e.witnessId, !!itemOfLot(e.lotId)?.requiresWitness);
      if (e.type === 'RETURN') return requireLoc(e.toLocationId);
      return null;
    }
    case 'RETURN_ACCEPT': {
      const r = p.returns.get(e.returnEventId);
      if (!r) return 'Unknown return.';
      if (!actor.medicationAuthority && itemOfLot(r.lotId)?.category === 'MEDICATION')
        return `${actor.displayName} does not hold medication-handling authority.`;
      if (r.personId === e.actorId) return 'A return must be accepted by someone other than the person returning it.';
      if (e.qty > r.remaining) return `Only ${r.remaining} remain pending on this return.`;
      if (!Number.isInteger(e.qty) || e.qty <= 0) return 'Quantity must be a positive whole number.';
      return null;
    }
    case 'QUARANTINE':
    case 'DISCREPANCY': {
      const err = requireLoc(e.locationId);
      if (err) return err;
      if (qty(p, e.lotId, 'AVAILABLE', e.locationId) < e.qty) return 'Not enough available stock at that location.';
      return null;
    }
    case 'DISPOSE': {
      if (qty(p, e.lotId, 'QUARANTINE', e.locationId) < e.qty)
        return 'Only quarantined stock may be disposed; not enough quarantined at that location.';
      return checkWitness(e.witnessId, true);
    }
    case 'TRANSFER_SHIP': {
      if (e.fromLocationId === e.toLocationId) return 'Source and destination must differ.';
      const err = requireLoc(e.fromLocationId) ?? requireLoc(e.toLocationId);
      if (err) return err;
      if (qty(p, e.lotId, 'AVAILABLE', e.fromLocationId) < e.qty) return 'Not enough available stock at the source.';
      return null;
    }
    case 'TRANSFER_RECEIVE': {
      const s = p.shipments.get(e.shipEventId);
      if (!s) return 'Unknown shipment.';
      if (s.remaining === 0) return 'This shipment has already been received.';
      if (s.shippedBy === e.actorId) return 'Receipt must be acknowledged by someone other than the shipper.';
      if (!Number.isInteger(e.qtyReceived) || e.qtyReceived < 0 || e.qtyReceived > s.remaining)
        return `Received quantity must be between 0 and ${s.remaining}.`;
      return null;
    }
    case 'ASSET_REGISTER': {
      for (const a of p.assets.values()) {
        if (a.asset.id === e.asset.id) return 'Asset already registered.';
        if (a.asset.serial === e.asset.serial && a.asset.manufacturer === e.asset.manufacturer) return 'Duplicate serial number.';
        if (a.asset.assetTag === e.asset.assetTag) return 'Duplicate asset tag.';
      }
      return requireLoc(e.locationId);
    }
    case 'ASSET_ASSIGN':
    case 'ASSET_CONFIRM': {
      const a = p.assets.get(e.assetId);
      if (!a) return 'Unknown asset.';
      if (a.status === 'RETIRED') return 'Asset is retired.';
      if (e.type === 'ASSET_ASSIGN' && e.custodianId && !R.people.has(e.custodianId)) return 'Unknown custodian.';
      return requireLoc(e.locationId);
    }
    case 'ASSET_STATUS':
      return p.assets.has(e.assetId) ? null : 'Unknown asset.';
    case 'LABEL_ISSUE': {
      if (p.labels.has(e.code)) return 'Label code already used. Codes are never reused.';
      const exists =
        (e.targetType === 'LOT' && p.lots.has(e.targetId)) ||
        (e.targetType === 'ASSET' && p.assets.has(e.targetId)) ||
        (e.targetType === 'LOCATION' && R.locations.has(e.targetId)) ||
        (e.targetType === 'ITEM' && R.items.has(e.targetId));
      return exists ? null : 'Label target does not exist.';
    }
    case 'LABEL_RETIRE': {
      const l = p.labels.get(e.code);
      if (!l) return 'Unknown label.';
      return l.active ? null : 'Label already retired.';
    }
  }
}

function move(p: Projection, lotId: string, from: [Bucket, string] | null, to: [Bucket, string] | null, n: number) {
  if (from) {
    const k = key(lotId, from[0], from[1]);
    p.balances.set(k, (p.balances.get(k) ?? 0) - n);
  }
  if (to) {
    const k = key(lotId, to[0], to[1]);
    p.balances.set(k, (p.balances.get(k) ?? 0) + n);
  }
}

function bump(p: Projection, lotId: string, f: (t: LotTotals) => void) {
  let t = p.totals.get(lotId);
  if (!t) p.totals.set(lotId, (t = blankTotals()));
  f(t);
}

function commit(p: Projection, e: LedgerEvent) {
  switch (e.type) {
    case 'RECEIVE':
      if (!p.lots.has(e.lot.id)) p.lots.set(e.lot.id, { ...e.lot });
      move(p, e.lot.id, null, ['AVAILABLE', e.toLocationId], e.qty);
      bump(p, e.lot.id, (t) => (t.received += e.qty));
      break;
    case 'ISSUE':
      move(p, e.lotId, ['AVAILABLE', e.fromLocationId], ['CUSTODY', e.toPersonId], e.qty);
      bump(p, e.lotId, (t) => (t.issued += e.qty));
      break;
    case 'CONSUME':
      move(p, e.lotId, ['CUSTODY', e.personId], null, e.qty);
      bump(p, e.lotId, (t) => {
        t.consumed += e.qty;
        t.consumedByContext[e.context] = (t.consumedByContext[e.context] ?? 0) + e.qty;
      });
      break;
    case 'WASTE':
      move(p, e.lotId, ['CUSTODY', e.personId], null, e.qty);
      bump(p, e.lotId, (t) => (t.wasted += e.qty));
      break;
    case 'RETURN':
      move(p, e.lotId, ['CUSTODY', e.personId], ['PENDING_RETURN', e.toLocationId], e.qty);
      p.returns.set(e.id, { eventId: e.id, lotId: e.lotId, personId: e.personId, locationId: e.toLocationId, qty: e.qty, remaining: e.qty });
      bump(p, e.lotId, (t) => (t.returned += e.qty));
      break;
    case 'RETURN_ACCEPT': {
      const r = p.returns.get(e.returnEventId)!;
      move(p, r.lotId, ['PENDING_RETURN', r.locationId], [e.disposition, r.locationId], e.qty);
      r.remaining -= e.qty;
      bump(p, r.lotId, (t) => {
        t.returnAccepted += e.qty;
        if (e.disposition === 'QUARANTINE') t.quarantined += e.qty;
      });
      break;
    }
    case 'QUARANTINE':
      move(p, e.lotId, ['AVAILABLE', e.locationId], ['QUARANTINE', e.locationId], e.qty);
      bump(p, e.lotId, (t) => (t.quarantined += e.qty));
      break;
    case 'DISPOSE':
      move(p, e.lotId, ['QUARANTINE', e.locationId], null, e.qty);
      bump(p, e.lotId, (t) => (t.disposed += e.qty));
      break;
    case 'DISCREPANCY':
      move(p, e.lotId, ['AVAILABLE', e.locationId], ['MISSING', e.locationId], e.qty);
      bump(p, e.lotId, (t) => (t.missing += e.qty));
      break;
    case 'TRANSFER_SHIP':
      move(p, e.lotId, ['AVAILABLE', e.fromLocationId], ['IN_TRANSIT', e.toLocationId], e.qty);
      p.shipments.set(e.id, {
        eventId: e.id, lotId: e.lotId, fromLocationId: e.fromLocationId, toLocationId: e.toLocationId,
        qty: e.qty, remaining: e.qty, shippedBy: e.actorId,
      });
      break;
    case 'TRANSFER_RECEIVE': {
      const s = p.shipments.get(e.shipEventId)!;
      const short = s.remaining - e.qtyReceived;
      move(p, s.lotId, ['IN_TRANSIT', s.toLocationId], ['AVAILABLE', s.toLocationId], e.qtyReceived);
      if (short > 0) {
        // Shortfall is never silently dropped: it becomes a discrepancy at the destination.
        move(p, s.lotId, ['IN_TRANSIT', s.toLocationId], ['MISSING', s.toLocationId], short);
        bump(p, s.lotId, (t) => (t.missing += short));
      }
      s.remaining = 0;
      break;
    }
    case 'ASSET_REGISTER':
      p.assets.set(e.asset.id, {
        asset: { ...e.asset }, locationId: e.locationId, custodianId: e.custodianId,
        status: 'OPERATIONAL', condition: 'Serviceable', lastConfirmedAt: e.at, lastConfirmedBy: e.actorId, history: [e.id],
      });
      break;
    case 'ASSET_ASSIGN': {
      const a = p.assets.get(e.assetId)!;
      a.locationId = e.locationId;
      a.custodianId = e.custodianId;
      a.lastConfirmedAt = e.at;
      a.lastConfirmedBy = e.actorId;
      a.history.push(e.id);
      break;
    }
    case 'ASSET_CONFIRM': {
      const a = p.assets.get(e.assetId)!;
      a.locationId = e.locationId;
      a.lastConfirmedAt = e.at;
      a.lastConfirmedBy = e.actorId;
      a.history.push(e.id);
      break;
    }
    case 'ASSET_STATUS': {
      const a = p.assets.get(e.assetId)!;
      a.status = e.status;
      a.condition = e.condition;
      a.history.push(e.id);
      break;
    }
    case 'LABEL_ISSUE':
      p.labels.set(e.code, { code: e.code, targetType: e.targetType, targetId: e.targetId, active: true, issuedAt: e.at, history: [e.id] });
      break;
    case 'LABEL_RETIRE': {
      const l = p.labels.get(e.code)!;
      l.active = false;
      l.history.push(e.id);
      break;
    }
  }
}

/** Validate and, if valid, apply one event. Mutates the projection. */
export function apply(p: Projection, refData: ReferenceData, e: LedgerEvent): ApplyResult {
  if (p.eventIds.has(e.id)) return { status: 'DUPLICATE' };
  const reason = validate(p, refData, e);
  if (reason) {
    p.rejected.push({ event: e, reason });
    return { status: 'REJECTED', reason };
  }
  commit(p, e);
  p.events.push(e);
  p.eventIds.add(e.id);
  return { status: 'ACCEPTED' };
}

/** Rebuild the full projection from scratch. */
export function project(refData: ReferenceData, events: Iterable<LedgerEvent>): Projection {
  const p = emptyProjection();
  for (const e of events) apply(p, refData, e);
  return p;
}

export type { Outcome };
