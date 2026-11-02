import { gtinCheckDigitValid, toGtin14 } from '../core/gs1';
import type { LedgerEvent, ReferenceData } from '../core/types';

/**
 * Reference data (people, locations, catalog items) for a field-test dataset.
 * Pure functions, unit tested. Reference data is configuration, not ledger:
 * edits apply going forward and never rewrite recorded history (see replay()).
 */

export function shortId(prefix: string): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(16).slice(2) + Date.now().toString(16);
  return `${prefix}-${r.replace(/-/g, '').slice(0, 8)}`;
}

/** Normalize an optional GTIN/UPC/EAN typed by a user; returns GTIN-14, undefined for blank, or an error. */
export function normalizeGtin(input: string): { gtin?: string } | { error: string } {
  const t = input.replace(/\s/g, '');
  if (!t) return {};
  if (!/^\d{8}$|^\d{12,14}$/.test(t)) return { error: 'Product code must be 8, 12, 13 or 14 digits.' };
  if (!gtinCheckDigitValid(t)) return { error: 'Product code check digit is wrong — re-scan or re-type it.' };
  return { gtin: toGtin14(t) };
}

/** Every reference id that the recorded history depends on. */
export function referencedIds(events: LedgerEvent[]): { people: Set<string>; locations: Set<string>; items: Set<string> } {
  const people = new Set<string>(), locations = new Set<string>(), items = new Set<string>();
  const loc = (id?: string) => id && locations.add(id);
  const per = (id?: string) => id && people.add(id);
  for (const e of events) {
    per(e.actorId);
    switch (e.type) {
      case 'RECEIVE': items.add(e.lot.itemId); loc(e.toLocationId); break;
      case 'ISSUE': loc(e.fromLocationId); per(e.toPersonId); per(e.witnessId); break;
      case 'CONSUME': per(e.personId); break;
      case 'WASTE': per(e.personId); per(e.witnessId); break;
      case 'RETURN': per(e.personId); loc(e.toLocationId); break;
      case 'QUARANTINE': case 'DISCREPANCY': loc(e.locationId); break;
      case 'DISPOSE': loc(e.locationId); per(e.witnessId); break;
      case 'TRANSFER_SHIP': loc(e.fromLocationId); loc(e.toLocationId); break;
      case 'ASSET_REGISTER': case 'ASSET_ASSIGN': loc(e.locationId); per(e.custodianId); break;
      case 'ASSET_CONFIRM': loc(e.locationId); break;
      case 'LABEL_ISSUE':
        if (e.targetType === 'LOCATION') loc(e.targetId);
        if (e.targetType === 'ITEM') items.add(e.targetId);
        break;
    }
  }
  return { people, locations, items };
}

/** Returns a user-facing problem, or null if the reference data is consistent. */
export function validateReference(ref: ReferenceData, events: LedgerEvent[] = []): string | null {
  const dup = (ids: string[]) => ids.find((id, i) => ids.indexOf(id) !== i);
  for (const [label, list] of [['person', ref.people], ['location', ref.locations], ['item', ref.items]] as const) {
    const d = dup(list.map((x) => x.id));
    if (d) return `Duplicate ${label} id ${d}.`;
    if (list.some((x) => !('name' in x ? x.name : x.displayName).trim())) return `Every ${label} needs a name.`;
  }
  if (!ref.locations.some((l) => l.kind === 'HUB')) return 'At least one hub is required.';
  if (!ref.people.length) return 'At least one person is required.';

  const locs = new Map(ref.locations.map((l) => [l.id, l]));
  for (const l of ref.locations) {
    if (l.kind === 'HUB') {
      if (l.parentId) return `${l.name} is a hub and cannot sit inside another location.`;
      if (l.timeZone) {
        try { new Intl.DateTimeFormat('en', { timeZone: l.timeZone }); } catch { return `${l.name}: "${l.timeZone}" is not a known time zone.`; }
      }
      continue;
    }
    if (!l.parentId || !locs.has(l.parentId)) return `${l.name} must sit under an existing hub or location.`;
    const seen = new Set<string>([l.id]);
    let cur = locs.get(l.parentId);
    while (cur && cur.kind !== 'HUB') {
      if (seen.has(cur.id)) return `${l.name} is inside a loop of locations.`;
      seen.add(cur.id);
      cur = cur.parentId ? locs.get(cur.parentId) : undefined;
    }
    if (!cur) return `${l.name} does not lead up to a hub.`;
  }
  for (const p of ref.people) if (p.homeLocationId && !locs.has(p.homeLocationId)) return `${p.displayName}'s home location no longer exists.`;
  for (const i of ref.items) {
    if (!i.unit.trim()) return `${i.name} needs a counting unit (e.g. vial, each).`;
    if (!Number.isInteger(i.reorderPoint) || i.reorderPoint < 0) return `${i.name}: reorder point must be a whole number, 0 or more.`;
    if (i.gtin && !gtinCheckDigitValid(i.gtin)) return `${i.name}: product code check digit is wrong.`;
  }
  const gtins = ref.items.map((i) => i.gtin).filter(Boolean) as string[];
  const g = dup(gtins);
  if (g) return `Two items share product code ${g}.`;

  const used = referencedIds(events);
  for (const id of used.people) if (!ref.people.some((x) => x.id === id)) return 'A person who appears in the transaction history cannot be removed.';
  for (const id of used.locations) if (!locs.has(id)) return 'A location that appears in the transaction history cannot be removed.';
  for (const id of used.items) if (!ref.items.some((x) => x.id === id)) return 'An item that appears in the transaction history cannot be removed.';
  return null;
}

export interface BlankSetup {
  yourName: string;
  hubs: { name: string; timeZone: string; country?: string }[];
}

/** Minimal starting reference data for a user's own field test. */
export function blankReference(s: BlankSetup): ReferenceData {
  const hubs = s.hubs.filter((h) => h.name.trim()).map((h) => ({ id: shortId('hub'), name: h.name.trim(), kind: 'HUB' as const, timeZone: h.timeZone || undefined, country: h.country || undefined }));
  return {
    locations: hubs,
    people: [{ id: shortId('per'), displayName: s.yourName.trim() || 'Me', role: 'HUB_LOGISTICS_MANAGER', medicationAuthority: true, homeLocationId: hubs[0]?.id }],
    items: [],
  };
}
