import { balanceRows, isExpired, totalsFor, type BalanceRow, type Projection } from '../core/ledger';
import type { Bucket, CatalogItem, LedgerEvent, Location, Lot, Person, ReferenceData } from '../core/types';

/**
 * Pure view-model helpers. No DOM, no storage: everything here is computed
 * from reference data + the ledger projection and is unit tested.
 */

export type Scope = 'ALL' | string; // 'ALL' = enterprise, otherwise a HUB location id

export const BUCKET_LABEL: Record<Bucket, string> = {
  AVAILABLE: 'Available',
  CUSTODY: 'In custody',
  PENDING_RETURN: 'Pending return',
  QUARANTINE: 'Quarantine',
  IN_TRANSIT: 'In transit',
  MISSING: 'Missing',
};

export const EVENT_LABEL: Record<LedgerEvent['type'], string> = {
  RECEIVE: 'Receive', ISSUE: 'Issue', CONSUME: 'Consume', WASTE: 'Waste', RETURN: 'Return',
  RETURN_ACCEPT: 'Accept return', QUARANTINE: 'Quarantine', DISPOSE: 'Dispose',
  TRANSFER_SHIP: 'Transfer — ship', TRANSFER_RECEIVE: 'Transfer — receive', DISCREPANCY: 'Discrepancy',
  ASSET_REGISTER: 'Register equipment', ASSET_ASSIGN: 'Assign equipment', ASSET_CONFIRM: 'Confirm equipment location',
  ASSET_STATUS: 'Equipment status', LABEL_ISSUE: 'Issue label', LABEL_RETIRE: 'Retire label',
};

export class Lookup {
  readonly people: Map<string, Person>;
  readonly locations: Map<string, Location>;
  readonly items: Map<string, CatalogItem>;
  constructor(readonly ref: ReferenceData) {
    this.people = new Map(ref.people.map((x) => [x.id, x]));
    this.locations = new Map(ref.locations.map((x) => [x.id, x]));
    this.items = new Map(ref.items.map((x) => [x.id, x]));
  }
  hubs(): Location[] {
    return this.ref.locations.filter((l) => l.kind === 'HUB');
  }
  /** The HUB a location belongs to (walking up parentId), or undefined. */
  hubOfLocation(id: string | undefined): string | undefined {
    const seen = new Set<string>();
    let cur = id ? this.locations.get(id) : undefined;
    while (cur && !seen.has(cur.id)) {
      if (cur.kind === 'HUB') return cur.id;
      seen.add(cur.id);
      cur = cur.parentId ? this.locations.get(cur.parentId) : undefined;
    }
    return undefined;
  }
  hubOfPerson(id: string): string | undefined {
    return this.hubOfLocation(this.people.get(id)?.homeLocationId);
  }
  /** Hub owning a balance row. Custody follows the person; everything else the location (in transit = destination). */
  hubOfRow(r: Pick<BalanceRow, 'bucket' | 'holderId'>): string | undefined {
    return r.bucket === 'CUSTODY' ? this.hubOfPerson(r.holderId) : this.hubOfLocation(r.holderId);
  }
  inScope(scope: Scope, hubId: string | undefined): boolean {
    return scope === 'ALL' || hubId === scope;
  }
  locationsInScope(scope: Scope): Location[] {
    return this.ref.locations.filter((l) => this.inScope(scope, this.hubOfLocation(l.id)));
  }
  peopleInScope(scope: Scope): Person[] {
    return this.ref.people.filter((p) => scope === 'ALL' || this.hubOfPerson(p.id) === scope);
  }
  holderName(r: Pick<BalanceRow, 'bucket' | 'holderId'>): string {
    return r.bucket === 'CUSTODY'
      ? this.people.get(r.holderId)?.displayName ?? r.holderId
      : this.locations.get(r.holderId)?.name ?? r.holderId;
  }
  personName(id: string | undefined): string {
    return id ? this.people.get(id)?.displayName ?? id : '—';
  }
  locationName(id: string | undefined): string {
    return id ? this.locations.get(id)?.name ?? id : '—';
  }
  scopeTimeZone(scope: Scope): string | undefined {
    return scope === 'ALL' ? undefined : this.locations.get(scope)?.timeZone;
  }
  scopeName(scope: Scope): string {
    return scope === 'ALL' ? 'Enterprise (both hubs)' : this.locationName(scope);
  }
}

export function rowsInScope(p: Projection, L: Lookup, scope: Scope): BalanceRow[] {
  return balanceRows(p).filter((r) => L.inScope(scope, L.hubOfRow(r)));
}

// ------------------------------------------------------------------ dates

/** "vial" → "vials"; "each" stays "each". */
export function unitLabel(unit: string, n: number): string {
  return n === 1 || unit === 'each' ? unit : `${unit}s`;
}

export function todayUTC(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function daysBetween(fromISODate: string, toISODate: string): number {
  return Math.round((Date.parse(toISODate + 'T00:00:00Z') - Date.parse(fromISODate + 'T00:00:00Z')) / 86_400_000);
}

export type ExpiryState = 'EXPIRED' | 'SOON' | 'OK';
export const EXPIRY_SOON_DAYS = 90;

export function expiryState(lot: Lot, now: Date = new Date()): ExpiryState {
  if (isExpired(lot, now.toISOString())) return 'EXPIRED';
  return daysBetween(todayUTC(now), lot.expiry) <= EXPIRY_SOON_DAYS ? 'SOON' : 'OK';
}

export function formatTime(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// -------------------------------------------------------------- inventory

export interface LotRow {
  lot: Lot;
  item: CatalogItem;
  byBucket: Record<Bucket, number>;
  holders: BalanceRow[];
  onHand: number; // everything still accountable in scope (all buckets except MISSING)
  expiry: ExpiryState;
}

export interface ItemRow {
  item: CatalogItem;
  lots: LotRow[];
  available: number; // usable: available and not expired
  availableExpired: number;
  custody: number;
  inTransit: number;
  pendingReturn: number;
  belowReorder: boolean;
  /** Hubs where usable stock is below the item's reorder point (reorder points are per hub). */
  lowAt: string[];
}

const emptyBuckets = (): Record<Bucket, number> => ({
  AVAILABLE: 0, CUSTODY: 0, PENDING_RETURN: 0, QUARANTINE: 0, IN_TRANSIT: 0, MISSING: 0,
});

export function inventory(p: Projection, L: Lookup, scope: Scope, now: Date = new Date()): ItemRow[] {
  const rows = inventoryRows(p, L, scope, now);
  const hubs = scope === 'ALL' ? L.hubs().map((h) => h.id) : [scope];
  const perHub = new Map(hubs.map((h) => [h, scope === 'ALL' ? inventoryRows(p, L, h, now) : rows]));
  for (const r of rows) {
    r.lowAt = hubs.filter((h) => {
      const hr = perHub.get(h)!.find((x) => x.item.id === r.item.id);
      return (hr?.available ?? 0) < r.item.reorderPoint;
    });
    r.belowReorder = r.lowAt.length > 0;
  }
  return rows;
}

function inventoryRows(p: Projection, L: Lookup, scope: Scope, now: Date): ItemRow[] {
  const byLot = new Map<string, LotRow>();
  for (const r of rowsInScope(p, L, scope)) {
    const lot = p.lots.get(r.lotId);
    const item = lot && L.items.get(lot.itemId);
    if (!lot || !item) continue;
    let row = byLot.get(lot.id);
    if (!row) byLot.set(lot.id, (row = { lot, item, byBucket: emptyBuckets(), holders: [], onHand: 0, expiry: expiryState(lot, now) }));
    row.byBucket[r.bucket] += r.qty;
    row.holders.push(r);
    if (r.bucket !== 'MISSING') row.onHand += r.qty;
  }
  const out: ItemRow[] = [];
  for (const item of L.ref.items) {
    const lots = [...byLot.values()].filter((l) => l.item.id === item.id).sort((a, b) => a.lot.expiry.localeCompare(b.lot.expiry));
    const sum = (f: (l: LotRow) => number) => lots.reduce((n, l) => n + f(l), 0);
    const available = sum((l) => (l.expiry === 'EXPIRED' ? 0 : l.byBucket.AVAILABLE));
    out.push({
      item, lots, available,
      availableExpired: sum((l) => (l.expiry === 'EXPIRED' ? l.byBucket.AVAILABLE : 0)),
      custody: sum((l) => l.byBucket.CUSTODY),
      inTransit: sum((l) => l.byBucket.IN_TRANSIT),
      pendingReturn: sum((l) => l.byBucket.PENDING_RETURN),
      belowReorder: false,
      lowAt: [],
    });
  }
  return out;
}

// -------------------------------------------------------------- dashboard

export const CONFIRM_OVERDUE_DAYS = 30;

export interface Dashboard {
  itemsBelowReorder: ItemRow[];
  lotsExpiringSoon: LotRow[];
  lotsExpiredWithStock: LotRow[];
  unitsAvailable: number;
  unitsInCustody: number;
  pendingReturns: { eventId: string; lotId: string; personId: string; locationId: string; remaining: number }[];
  shipmentsInTransit: { eventId: string; lotId: string; fromLocationId: string; toLocationId: string; remaining: number }[];
  missing: BalanceRow[];
  equipmentTotal: number;
  equipmentOverdueConfirm: number;
  equipmentNotOperational: number;
  equipmentCalibrationDue: number;
}

export function dashboard(p: Projection, L: Lookup, scope: Scope, now: Date = new Date()): Dashboard {
  const inv = inventory(p, L, scope, now);
  const lots = inv.flatMap((i) => i.lots);
  const rows = rowsInScope(p, L, scope);
  const assets = [...p.assets.values()].filter((a) => L.inScope(scope, L.hubOfLocation(a.locationId)) && a.status !== 'RETIRED');
  const today = todayUTC(now);
  return {
    itemsBelowReorder: inv.filter((i) => i.belowReorder),
    lotsExpiringSoon: lots.filter((l) => l.expiry === 'SOON' && l.onHand > 0),
    lotsExpiredWithStock: lots.filter((l) => l.expiry === 'EXPIRED' && l.onHand > 0),
    unitsAvailable: inv.reduce((n, i) => n + i.available, 0),
    unitsInCustody: inv.reduce((n, i) => n + i.custody, 0),
    pendingReturns: [...p.returns.values()]
      .filter((r) => r.remaining > 0 && L.inScope(scope, L.hubOfLocation(r.locationId)))
      .map((r) => ({ eventId: r.eventId, lotId: r.lotId, personId: r.personId, locationId: r.locationId, remaining: r.remaining })),
    shipmentsInTransit: [...p.shipments.values()]
      .filter((s) => s.remaining > 0 && (L.inScope(scope, L.hubOfLocation(s.toLocationId)) || L.inScope(scope, L.hubOfLocation(s.fromLocationId))))
      .map((s) => ({ eventId: s.eventId, lotId: s.lotId, fromLocationId: s.fromLocationId, toLocationId: s.toLocationId, remaining: s.remaining })),
    missing: rows.filter((r) => r.bucket === 'MISSING'),
    equipmentTotal: assets.length,
    equipmentOverdueConfirm: assets.filter((a) => (now.getTime() - Date.parse(a.lastConfirmedAt)) / 86_400_000 > CONFIRM_OVERDUE_DAYS).length,
    equipmentNotOperational: assets.filter((a) => a.status !== 'OPERATIONAL').length,
    equipmentCalibrationDue: assets.filter((a) => a.asset.calibrationDue && daysBetween(today, a.asset.calibrationDue) <= 30).length,
  };
}

// ---------------------------------------------------------------- history

/** Hub(s) an event touches, for scoping the transaction history. */
export function eventHubs(e: LedgerEvent, p: Projection, L: Lookup): Set<string | undefined> {
  const hubs = new Set<string | undefined>();
  const loc = (id?: string) => id && hubs.add(L.hubOfLocation(id));
  const per = (id?: string) => id && hubs.add(L.hubOfPerson(id));
  switch (e.type) {
    case 'RECEIVE': loc(e.toLocationId); break;
    case 'ISSUE': loc(e.fromLocationId); per(e.toPersonId); break;
    case 'CONSUME': case 'WASTE': per(e.personId); break;
    case 'RETURN': per(e.personId); loc(e.toLocationId); break;
    case 'RETURN_ACCEPT': loc(p.returns.get(e.returnEventId)?.locationId); break;
    case 'QUARANTINE': case 'DISPOSE': case 'DISCREPANCY': loc(e.locationId); break;
    case 'TRANSFER_SHIP': loc(e.fromLocationId); loc(e.toLocationId); break;
    case 'TRANSFER_RECEIVE': { const s = p.shipments.get(e.shipEventId); loc(s?.fromLocationId); loc(s?.toLocationId); break; }
    case 'ASSET_REGISTER': case 'ASSET_ASSIGN': case 'ASSET_CONFIRM': loc(e.locationId); break;
    case 'ASSET_STATUS': loc(p.assets.get(e.assetId)?.locationId); break;
    case 'LABEL_ISSUE': case 'LABEL_RETIRE': per(e.actorId); break;
  }
  return hubs;
}

export function describeEvent(e: LedgerEvent, p: Projection, L: Lookup): string {
  const lotText = (lotId: string) => {
    const lot = p.lots.get(lotId);
    const item = lot && L.items.get(lot.itemId);
    return lot && item ? `${item.name} · lot ${lot.lotNumber}` : lotId;
  };
  const unit = (lotId: string) => {
    const lot = p.lots.get(lotId);
    return (lot && L.items.get(lot.itemId)?.unit) ?? 'unit';
  };
  const n = (q: number, lotId: string) => `${q} ${unitLabel(unit(lotId), q)}`;
  const w = (id?: string) => (id ? `, witnessed by ${L.personName(id)}` : '');
  switch (e.type) {
    case 'RECEIVE': return `Received ${n(e.qty, e.lot.id)} of ${lotText(e.lot.id)} into ${L.locationName(e.toLocationId)} (${e.source}).`;
    case 'ISSUE': return `Issued ${n(e.qty, e.lotId)} of ${lotText(e.lotId)} from ${L.locationName(e.fromLocationId)} to ${L.personName(e.toPersonId)} — ${e.purpose}${w(e.witnessId)}.`;
    case 'CONSUME': return `${L.personName(e.personId)} used ${n(e.qty, e.lotId)} of ${lotText(e.lotId)} (${e.context.replace('_', ' ').toLowerCase()}${e.encounterRef ? `, ref ${e.encounterRef}` : ''}).`;
    case 'WASTE': return `${L.personName(e.personId)} wasted ${n(e.qty, e.lotId)} of ${lotText(e.lotId)}: ${e.reason}${w(e.witnessId)}.`;
    case 'RETURN': return `${L.personName(e.personId)} returned ${n(e.qty, e.lotId)} of ${lotText(e.lotId)} to ${L.locationName(e.toLocationId)} — pending acceptance.`;
    case 'RETURN_ACCEPT': {
      const r = p.returns.get(e.returnEventId);
      return r ? `Accepted ${n(e.qty, r.lotId)} of ${lotText(r.lotId)} returned by ${L.personName(r.personId)} → ${e.disposition.toLowerCase()}.` : `Accepted return ${e.returnEventId}.`;
    }
    case 'QUARANTINE': return `Quarantined ${n(e.qty, e.lotId)} of ${lotText(e.lotId)} at ${L.locationName(e.locationId)}: ${e.reason}.`;
    case 'DISPOSE': return `Disposed ${n(e.qty, e.lotId)} of ${lotText(e.lotId)} at ${L.locationName(e.locationId)} (${e.method})${w(e.witnessId)}.`;
    case 'TRANSFER_SHIP': return `Shipped ${n(e.qty, e.lotId)} of ${lotText(e.lotId)} from ${L.locationName(e.fromLocationId)} to ${L.locationName(e.toLocationId)}.`;
    case 'TRANSFER_RECEIVE': {
      const s = p.shipments.get(e.shipEventId);
      if (!s) return `Received shipment ${e.shipEventId}.`;
      const short = s.qty - e.qtyReceived;
      return `Received ${n(e.qtyReceived, s.lotId)} of ${s.qty} shipped (${lotText(s.lotId)}) at ${L.locationName(s.toLocationId)}${short > 0 ? ` — ${short} short, recorded as missing` : ''}.`;
    }
    case 'DISCREPANCY': return `Reported ${n(e.qty, e.lotId)} of ${lotText(e.lotId)} missing at ${L.locationName(e.locationId)}.`;
    case 'ASSET_REGISTER': return `Registered ${e.asset.name} ${e.asset.assetTag} (S/N ${e.asset.serial}) at ${L.locationName(e.locationId)}${e.custodianId ? `, custodian ${L.personName(e.custodianId)}` : ''}.`;
    case 'ASSET_ASSIGN': return `Assigned ${assetName(p, e.assetId)} to ${L.locationName(e.locationId)}${e.custodianId ? `, custodian ${L.personName(e.custodianId)}` : ', no custodian'}.`;
    case 'ASSET_CONFIRM': return `Confirmed ${assetName(p, e.assetId)} is at ${L.locationName(e.locationId)}.`;
    case 'ASSET_STATUS': return `${assetName(p, e.assetId)} status → ${e.status.replace('_', ' ').toLowerCase()}: ${e.condition}.`;
    case 'LABEL_ISSUE': return `Issued ${e.reason === 'REPLACEMENT' ? 'replacement ' : ''}label ${e.code} for ${labelTargetName(p, L, e.targetType, e.targetId)}.`;
    case 'LABEL_RETIRE': return `Retired label ${e.code}: ${e.reason}.`;
  }
}

function assetName(p: Projection, id: string): string {
  const a = p.assets.get(id);
  return a ? `${a.asset.name} ${a.asset.assetTag}` : id;
}

export function labelTargetName(p: Projection, L: Lookup, type: string, id: string): string {
  if (type === 'LOT') {
    const lot = p.lots.get(id);
    const item = lot && L.items.get(lot.itemId);
    return lot && item ? `${item.name} · lot ${lot.lotNumber}` : id;
  }
  if (type === 'ASSET') return assetName(p, id);
  if (type === 'LOCATION') return L.locationName(id);
  return L.items.get(id)?.name ?? id;
}

export { totalsFor };
