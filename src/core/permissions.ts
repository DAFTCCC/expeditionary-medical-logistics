import type { LedgerEventType, Person, Role } from './types';

/**
 * Which event types each role may RECORD. Medication-moving events additionally
 * require Person.medicationAuthority (checked in the ledger), so a role grant
 * alone is never enough to handle medications.
 */
const ALL_STOCK: LedgerEventType[] = [
  'RECEIVE', 'ISSUE', 'CONSUME', 'WASTE', 'RETURN', 'RETURN_ACCEPT',
  'QUARANTINE', 'DISPOSE', 'TRANSFER_SHIP', 'TRANSFER_RECEIVE', 'DISCREPANCY',
];
const ALL_ASSET: LedgerEventType[] = ['ASSET_REGISTER', 'ASSET_ASSIGN', 'ASSET_CONFIRM', 'ASSET_STATUS'];
const LABELS: LedgerEventType[] = ['LABEL_ISSUE', 'LABEL_RETIRE'];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<LedgerEventType>> = {
  ENTERPRISE_ADMIN: new Set([...ALL_ASSET, ...LABELS]), // administers, does not move stock
  HUB_LOGISTICS_MANAGER: new Set([...ALL_STOCK, ...ALL_ASSET, ...LABELS]),
  DEPLOYMENT_LOGISTICS_OFFICER: new Set([...ALL_STOCK, ...ALL_ASSET, ...LABELS]),
  MEDICAL_PROVIDER: new Set<LedgerEventType>(['ISSUE', 'CONSUME', 'WASTE', 'RETURN', 'ASSET_CONFIRM', 'ASSET_STATUS']),
  TEAM_MEMBER: new Set<LedgerEventType>(['CONSUME', 'WASTE', 'RETURN', 'ASSET_CONFIRM']),
  ANALYST: new Set(),
  AUDITOR: new Set(),
};

/** Event types that physically move medication and so need medicationAuthority. */
export const MEDICATION_HANDLING: ReadonlySet<LedgerEventType> = new Set([
  'ISSUE', 'CONSUME', 'WASTE', 'RETURN', 'RETURN_ACCEPT', 'DISPOSE',
]);

export function canRecord(person: Person, type: LedgerEventType): boolean {
  return ROLE_PERMISSIONS[person.role].has(type);
}

export const ROLE_LABEL: Record<Role, string> = {
  ENTERPRISE_ADMIN: 'Enterprise Administrator',
  HUB_LOGISTICS_MANAGER: 'Hub Logistics Manager',
  DEPLOYMENT_LOGISTICS_OFFICER: 'Deployment Logistics Officer',
  MEDICAL_PROVIDER: 'Medical Provider',
  TEAM_MEMBER: 'Team Member',
  ANALYST: 'Analyst',
  AUDITOR: 'Auditor',
};
