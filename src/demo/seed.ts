import { gtinCheckDigit } from '../core/gs1';
import { newLabelCode } from '../core/identify';
import type { Asset, CatalogItem, LabelTarget, LedgerEvent, Location, Lot, Person, ReferenceData } from '../core/types';

/**
 * FICTIONAL demonstration data for two hubs (ADR-008). Every person, place,
 * lot, serial number and product code here is invented. GTINs use the GS1
 * restricted-circulation range (prefix 02) so they cannot match real products.
 *
 * Dates are relative to `now` so expiry warnings stay meaningful whenever the
 * demo is first opened. The output is deterministic for a given `now`.
 */

export const HUB_HI = 'HUB-HI';
export const HUB_DE = 'HUB-DE';

/** Restricted-circulation GTIN-14 from a 10-digit serial: 0 + 2 + 0 + serial + check. */
export function demoGtin(n: number): string {
  const body = `020${String(n).padStart(10, '0')}`;
  return body + gtinCheckDigit(body);
}

const locations: Location[] = [
  { id: HUB_HI, name: 'Hawaii Hub', kind: 'HUB', timeZone: 'Pacific/Honolulu' },
  { id: 'HI-PHARM', name: 'Hawaii Hub · Pharmacy cage', kind: 'STORAGE', parentId: HUB_HI },
  { id: 'HI-WH', name: 'Hawaii Hub · Warehouse bay 3', kind: 'STORAGE', parentId: HUB_HI },
  { id: 'SITE-KOA', name: 'Exercise Site Koa', kind: 'DEPLOYMENT_SITE', parentId: HUB_HI, custodianId: 'p-reyes' },
  { id: 'KIT-KOA-1', name: 'Koa trauma kit 1', kind: 'KIT', parentId: 'SITE-KOA', custodianId: 'p-tanaka' },
  { id: HUB_DE, name: 'Germany Hub', kind: 'HUB', timeZone: 'Europe/Berlin' },
  { id: 'DE-PHARM', name: 'Germany Hub · Pharmacy cage', kind: 'STORAGE', parentId: HUB_DE },
  { id: 'DE-WH', name: 'Germany Hub · Warehouse hall B', kind: 'STORAGE', parentId: HUB_DE },
  { id: 'SITE-LINDE', name: 'Exercise Site Linde', kind: 'DEPLOYMENT_SITE', parentId: HUB_DE, custodianId: 'p-novak' },
  { id: 'KIT-LINDE-1', name: 'Linde trauma kit 1', kind: 'KIT', parentId: 'SITE-LINDE', custodianId: 'p-schmidt' },
];

const people: Person[] = [
  { id: 'p-kalani', displayName: 'M. Kalani', role: 'HUB_LOGISTICS_MANAGER', medicationAuthority: true, homeLocationId: HUB_HI },
  { id: 'p-reyes', displayName: 'J. Reyes', role: 'DEPLOYMENT_LOGISTICS_OFFICER', medicationAuthority: true, homeLocationId: 'SITE-KOA' },
  { id: 'p-tanaka', displayName: 'A. Tanaka (provider)', role: 'MEDICAL_PROVIDER', medicationAuthority: true, homeLocationId: 'SITE-KOA' },
  { id: 'p-okafor', displayName: 'S. Okafor', role: 'TEAM_MEMBER', medicationAuthority: false, homeLocationId: 'SITE-KOA' },
  { id: 'p-weber', displayName: 'K. Weber', role: 'HUB_LOGISTICS_MANAGER', medicationAuthority: true, homeLocationId: HUB_DE },
  { id: 'p-novak', displayName: 'L. Novak', role: 'DEPLOYMENT_LOGISTICS_OFFICER', medicationAuthority: true, homeLocationId: 'SITE-LINDE' },
  { id: 'p-schmidt', displayName: 'R. Schmidt (provider)', role: 'MEDICAL_PROVIDER', medicationAuthority: true, homeLocationId: 'SITE-LINDE' },
  { id: 'p-brandt', displayName: 'T. Brandt', role: 'TEAM_MEMBER', medicationAuthority: false, homeLocationId: 'SITE-LINDE' },
  { id: 'p-admin', displayName: 'Enterprise Admin', role: 'ENTERPRISE_ADMIN', medicationAuthority: false, homeLocationId: HUB_HI },
  { id: 'p-audit', displayName: 'Auditor', role: 'AUDITOR', medicationAuthority: false },
];

const items: CatalogItem[] = [
  { id: 'ond', name: 'Ondansetron 2 mg/mL injection', category: 'MEDICATION', gtin: demoGtin(1001), strength: '2 mg/mL', form: '2 mL vial', unit: 'vial', reorderPoint: 20, requiresWitness: false, storage: '20–25 °C' },
  { id: 'txa', name: 'Tranexamic acid 100 mg/mL injection', category: 'MEDICATION', gtin: demoGtin(1002), strength: '100 mg/mL', form: '10 mL vial', unit: 'vial', reorderPoint: 10, requiresWitness: false, storage: '20–25 °C' },
  { id: 'ket', name: 'Ketamine 50 mg/mL injection', category: 'MEDICATION', gtin: demoGtin(1003), strength: '50 mg/mL', form: '10 mL vial', unit: 'vial', reorderPoint: 5, requiresWitness: true, storage: 'Locked cabinet' },
  { id: 'epi', name: 'Epinephrine 1 mg/mL injection', category: 'MEDICATION', gtin: demoGtin(1004), strength: '1 mg/mL', form: '1 mL ampule', unit: 'ampule', reorderPoint: 10, requiresWitness: false, storage: 'Protect from light' },
  { id: 'gauze', name: 'Hemostatic gauze, z-fold', category: 'CONSUMABLE', gtin: demoGtin(2001), unit: 'each', reorderPoint: 30, requiresWitness: false },
  { id: 'tq', name: 'Tourniquet, windlass', category: 'CONSUMABLE', gtin: demoGtin(2002), unit: 'each', reorderPoint: 20, requiresWitness: false },
  { id: 'ivkit', name: 'IV start kit', category: 'CONSUMABLE', gtin: demoGtin(2003), unit: 'kit', reorderPoint: 25, requiresWitness: false },
];

export const demoReference: ReferenceData = { people, locations, items };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Seed {
  ref: ReferenceData;
  events: LedgerEvent[];
}

export function buildSeed(now: Date = new Date()): Seed {
  const DAY = 86_400_000;
  const at = (daysAgo: number, hourUTC = 20) => {
    const d = new Date(now.getTime() - daysAgo * DAY);
    d.setUTCHours(hourUTC, 0, 0, 0);
    if (d > now) d.setTime(now.getTime() - 60_000 * (daysAgo + 1));
    return d.toISOString();
  };
  const expiry = (daysFromNow: number) => new Date(now.getTime() + daysFromNow * DAY).toISOString().slice(0, 10);
  const rand = mulberry32(20261101);

  const events: LedgerEvent[] = [];
  let n = 0;
  const push = <T extends LedgerEvent['type']>(
    type: T,
    actorId: string,
    when: string,
    fields: Omit<Extract<LedgerEvent, { type: T }>, 'id' | 'at' | 'deviceId' | 'sync' | 'type' | 'actorId'>,
  ): string => {
    const id = `seed-${String(++n).padStart(4, '0')}`;
    events.push({ id, at: when, actorId, deviceId: 'demo-seed', sync: 'LOCAL', type, ...fields } as unknown as LedgerEvent);
    return id;
  };

  const lots: Record<string, Lot> = {};
  const receive = (key: string, itemId: string, lotNumber: string, expDays: number, qty: number, loc: string, actor: string, daysAgo: number) => {
    const item = items.find((i) => i.id === itemId)!;
    const lot: Lot = { id: `lot-${key}`, itemId, lotNumber, expiry: expiry(expDays), gtin: item.gtin };
    lots[key] = lot;
    push('RECEIVE', actor, at(daysAgo), { lot, qty, toLocationId: loc, source: `Demo supplier PO-${1000 + n}` });
  };

  // ---- Hawaii hub receipts
  receive('ond-hi1', 'ond', 'A2401', 400, 60, 'HI-PHARM', 'p-kalani', 60);
  receive('ond-hi2', 'ond', 'A2390', 45, 20, 'HI-PHARM', 'p-kalani', 60);
  receive('txa-hi', 'txa', 'T551', 200, 30, 'HI-PHARM', 'p-kalani', 58);
  receive('ket-hi', 'ket', 'K19', 250, 12, 'HI-PHARM', 'p-kalani', 58);
  receive('epi-hi-old', 'epi', 'E880', -10, 8, 'HI-PHARM', 'p-kalani', 120);
  receive('epi-hi', 'epi', 'E901', 180, 30, 'HI-PHARM', 'p-kalani', 50);
  receive('gauze-hi', 'gauze', 'G1001', 700, 100, 'HI-WH', 'p-kalani', 55);
  receive('tq-hi', 'tq', 'TQ77', 1500, 40, 'HI-WH', 'p-kalani', 55);
  receive('iv-hi', 'ivkit', 'IV3', 80, 50, 'HI-WH', 'p-kalani', 55);

  // ---- Germany hub receipts
  receive('ond-de', 'ond', 'B771', 300, 40, 'DE-PHARM', 'p-weber', 57);
  receive('txa-de', 'txa', 'T560', 500, 25, 'DE-PHARM', 'p-weber', 57);
  receive('ket-de', 'ket', 'K22', 260, 10, 'DE-PHARM', 'p-weber', 57);
  receive('epi-de', 'epi', 'E902', 60, 15, 'DE-PHARM', 'p-weber', 52);
  receive('gauze-de', 'gauze', 'G1002', 700, 60, 'DE-WH', 'p-weber', 52);
  receive('iv-de', 'ivkit', 'IV4', 365, 18, 'DE-WH', 'p-weber', 52);

  // ---- Hub-to-hub: Hawaii → Germany tourniquets, one short on arrival
  const shipTq = push('TRANSFER_SHIP', 'p-kalani', at(30), { lotId: lots['tq-hi'].id, qty: 20, fromLocationId: 'HI-WH', toLocationId: 'DE-WH', note: 'Hub-to-hub resupply' });
  push('TRANSFER_RECEIVE', 'p-weber', at(22, 9), { shipEventId: shipTq, qtyReceived: 19, note: 'Carton count 19 of 20; discrepancy opened' });

  // ---- Hub-to-hub: Germany → Hawaii TXA, still in transit
  push('TRANSFER_SHIP', 'p-weber', at(2, 9), { lotId: lots['txa-de'].id, qty: 5, fromLocationId: 'DE-PHARM', toLocationId: 'HI-PHARM', note: 'Cross-level to Hawaii' });

  // ---- Hub → supported sites
  const shipKoa = push('TRANSFER_SHIP', 'p-kalani', at(20), { lotId: lots['ond-hi1'].id, qty: 15, fromLocationId: 'HI-PHARM', toLocationId: 'SITE-KOA' });
  push('TRANSFER_RECEIVE', 'p-reyes', at(19), { shipEventId: shipKoa, qtyReceived: 15 });
  const shipKoaG = push('TRANSFER_SHIP', 'p-kalani', at(20), { lotId: lots['gauze-hi'].id, qty: 30, fromLocationId: 'HI-WH', toLocationId: 'SITE-KOA' });
  push('TRANSFER_RECEIVE', 'p-reyes', at(19), { shipEventId: shipKoaG, qtyReceived: 30 });
  const shipLinde = push('TRANSFER_SHIP', 'p-weber', at(18, 9), { lotId: lots['gauze-de'].id, qty: 20, fromLocationId: 'DE-WH', toLocationId: 'SITE-LINDE' });
  push('TRANSFER_RECEIVE', 'p-novak', at(17, 9), { shipEventId: shipLinde, qtyReceived: 20 });

  // ---- Koa: issued is not consumed (10 issued → 3 used, 1 wasted, 2 returned pending, 4 still held)
  push('ISSUE', 'p-reyes', at(10), { lotId: lots['ond-hi1'].id, qty: 10, fromLocationId: 'SITE-KOA', toPersonId: 'p-tanaka', purpose: 'Exercise Koa medical coverage' });
  push('CONSUME', 'p-tanaka', at(8), { lotId: lots['ond-hi1'].id, qty: 3, personId: 'p-tanaka', context: 'PATIENT_CARE', encounterCategory: 'Nausea/vomiting', encounterRef: 'ENC-K-0007' });
  push('WASTE', 'p-tanaka', at(7), { lotId: lots['ond-hi1'].id, qty: 1, personId: 'p-tanaka', reason: 'Vial dropped and cracked' });
  push('RETURN', 'p-tanaka', at(1), { lotId: lots['ond-hi1'].id, qty: 2, personId: 'p-tanaka', toLocationId: 'SITE-KOA', note: 'End of shift return — awaiting inspection' });

  // ---- Witnessed ketamine issue at Hawaii
  push('ISSUE', 'p-kalani', at(9), { lotId: lots['ket-hi'].id, qty: 2, fromLocationId: 'HI-PHARM', toPersonId: 'p-tanaka', purpose: 'Exercise Koa — controlled stock', witnessId: 'p-reyes' });
  push('CONSUME', 'p-tanaka', at(6), { lotId: lots['ket-hi'].id, qty: 1, personId: 'p-tanaka', context: 'PATIENT_CARE', encounterCategory: 'Analgesia', encounterRef: 'ENC-K-0011' });

  // ---- Linde: consumables issued to a team member, part returned and accepted
  push('ISSUE', 'p-novak', at(12, 9), { lotId: lots['gauze-de'].id, qty: 10, fromLocationId: 'SITE-LINDE', toPersonId: 'p-brandt', purpose: 'Combat casualty care lane' });
  push('CONSUME', 'p-brandt', at(11, 9), { lotId: lots['gauze-de'].id, qty: 4, personId: 'p-brandt', context: 'TRAINING' });
  const ret = push('RETURN', 'p-brandt', at(10, 9), { lotId: lots['gauze-de'].id, qty: 3, personId: 'p-brandt', toLocationId: 'SITE-LINDE' });
  push('RETURN_ACCEPT', 'p-novak', at(10, 10), { returnEventId: ret, qty: 3, disposition: 'AVAILABLE', note: 'Packaging intact' });
  push('ISSUE', 'p-weber', at(9, 9), { lotId: lots['ond-de'].id, qty: 6, fromLocationId: 'DE-PHARM', toPersonId: 'p-schmidt', purpose: 'Exercise Linde medical coverage' });
  push('CONSUME', 'p-schmidt', at(5, 9), { lotId: lots['ond-de'].id, qty: 2, personId: 'p-schmidt', context: 'EXERCISE' });

  // ---- Equipment
  const asset = (a: Asset, loc: string, custodian: string | undefined, actor: string, daysAgo: number) =>
    push('ASSET_REGISTER', actor, at(daysAgo), { asset: a, locationId: loc, custodianId: custodian });
  asset({ id: 'as-hi-1', name: 'Monitor/defibrillator', manufacturer: 'Harbor Medical (fictional)', model: 'HM-500', serial: 'HM5-00412', assetTag: 'HI-EQ-0001', calibrationDue: expiry(120) }, 'SITE-KOA', 'p-reyes', 'p-kalani', 40);
  asset({ id: 'as-hi-2', name: 'Transport ventilator', manufacturer: 'Pacific Biomed (fictional)', model: 'PV-2', serial: 'PV2-11873', assetTag: 'HI-EQ-0002', calibrationDue: expiry(20) }, 'HI-WH', undefined, 'p-kalani', 45);
  asset({ id: 'as-hi-3', name: 'Pulse oximeter', manufacturer: 'Harbor Medical (fictional)', model: 'HM-OX1', serial: 'OX1-55120', assetTag: 'HI-EQ-0003' }, 'SITE-KOA', 'p-tanaka', 'p-kalani', 40);
  asset({ id: 'as-de-1', name: 'Portable suction unit', manufacturer: 'Rhein Medtech (fictional)', model: 'RS-30', serial: 'RS30-2291', assetTag: 'DE-EQ-0001', calibrationDue: expiry(200) }, 'SITE-LINDE', 'p-novak', 'p-weber', 35);
  asset({ id: 'as-de-2', name: 'Handheld ultrasound', manufacturer: 'Rhein Medtech (fictional)', model: 'RU-1', serial: 'RU1-0077', assetTag: 'DE-EQ-0002', calibrationDue: expiry(-5) }, 'DE-WH', undefined, 'p-weber', 35);
  push('ASSET_CONFIRM', 'p-reyes', at(5), { assetId: 'as-hi-1', locationId: 'SITE-KOA' });
  push('ASSET_CONFIRM', 'p-tanaka', at(12), { assetId: 'as-hi-3', locationId: 'SITE-KOA' });
  push('ASSET_CONFIRM', 'p-novak', at(3, 9), { assetId: 'as-de-1', locationId: 'SITE-LINDE' });
  push('ASSET_STATUS', 'p-weber', at(15, 9), { assetId: 'as-de-2', status: 'NEEDS_MAINTENANCE', condition: 'Probe cable intermittent; calibration overdue' });

  // ---- FieldLine labels (only where no manufacturer identifier exists, ADR-005)
  const label = (type: LabelTarget, targetId: string, actor: string, daysAgo: number, reason: 'NEW' | 'REPLACEMENT' = 'NEW') => {
    const code = newLabelCode(type, rand);
    push('LABEL_ISSUE', actor, at(daysAgo), { code, targetType: type, targetId, reason });
    return code;
  };
  for (const l of locations) label('LOCATION', l.id, l.id.startsWith('HI') || l.id.includes('KOA') ? 'p-kalani' : 'p-weber', 59);
  label('ASSET', 'as-hi-2', 'p-kalani', 44);
  label('ASSET', 'as-de-2', 'p-weber', 34);
  const worn = label('ASSET', 'as-hi-1', 'p-kalani', 39);
  push('LABEL_RETIRE', 'p-kalani', at(14), { code: worn, reason: 'Label worn and unreadable' });
  label('ASSET', 'as-hi-1', 'p-kalani', 14, 'REPLACEMENT');
  label('LOT', lots['ket-hi'].id, 'p-kalani', 57);
  label('LOT', lots['ket-de'].id, 'p-weber', 56);

  events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return { ref: demoReference, events };
}
