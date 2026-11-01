import type { LedgerEvent, Lot, ReferenceData } from '../src/core/types';

export const ref: ReferenceData = {
  people: [
    { id: 'hub', displayName: 'Hub Manager', role: 'HUB_LOGISTICS_MANAGER', medicationAuthority: true },
    { id: 'dlo', displayName: 'Deployment LO', role: 'DEPLOYMENT_LOGISTICS_OFFICER', medicationAuthority: true },
    { id: 'prov', displayName: 'Provider', role: 'MEDICAL_PROVIDER', medicationAuthority: true },
    { id: 'tm', displayName: 'Team Member', role: 'TEAM_MEMBER', medicationAuthority: false },
    { id: 'aud', displayName: 'Auditor', role: 'AUDITOR', medicationAuthority: false },
  ],
  locations: [
    { id: 'HUB', name: 'Hub', kind: 'HUB' },
    { id: 'FWD', name: 'Forward site', kind: 'DEPLOYMENT_SITE' },
  ],
  items: [
    { id: 'ond', name: 'Ondansetron 2 mg/mL', category: 'MEDICATION', unit: 'vial', reorderPoint: 10, requiresWitness: false, gtin: '00312345678906' },
    { id: 'ket', name: 'Ketamine 50 mg/mL', category: 'MEDICATION', unit: 'vial', reorderPoint: 5, requiresWitness: true },
    { id: 'gauze', name: 'Hemostatic gauze', category: 'CONSUMABLE', unit: 'each', reorderPoint: 20, requiresWitness: false },
  ],
};

let n = 0;
export function ev<T extends LedgerEvent['type']>(
  type: T,
  fields: Omit<Extract<LedgerEvent, { type: T }>, 'id' | 'at' | 'deviceId' | 'sync' | 'type'> & { at?: string; id?: string },
): Extract<LedgerEvent, { type: T }> {
  n++;
  return {
    id: fields.id ?? `e${n}`,
    at: fields.at ?? '2026-10-01T12:00:00.000Z',
    deviceId: 'test',
    sync: 'LOCAL',
    type,
    ...fields,
  } as Extract<LedgerEvent, { type: T }>;
}

export const lotOND: Lot = { id: 'L1', itemId: 'ond', lotNumber: 'A100', expiry: '2027-06-30', gtin: '00312345678906' };
export const lotKET: Lot = { id: 'L2', itemId: 'ket', lotNumber: 'K7', expiry: '2027-01-31' };
export const lotOLD: Lot = { id: 'L3', itemId: 'ond', lotNumber: 'OLD1', expiry: '2026-09-30' };
