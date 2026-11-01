import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blankReference, normalizeGtin, validateReference } from '../src/app/reference';
import { buildSeed } from '../src/demo/seed';
import type { ReferenceData } from '../src/core/types';

const seed = buildSeed(new Date('2026-11-01T20:30:00Z'));

describe('reference data for field tests', () => {
  it('the demo reference data is valid with its own history', () => {
    assert.equal(validateReference(seed.ref, seed.events), null);
  });

  it('a blank setup with two hubs is valid and has a manager with medication authority', () => {
    const ref = blankReference({ yourName: 'Test Lead', hubs: [{ name: 'Hawaii Hub', timeZone: 'Pacific/Honolulu' }, { name: 'Germany Hub', timeZone: 'Europe/Berlin' }] });
    assert.equal(validateReference(ref), null);
    assert.equal(ref.locations.length, 2);
    assert.equal(ref.people[0].role, 'HUB_LOGISTICS_MANAGER');
    assert.equal(ref.people[0].medicationAuthority, true);
  });

  it('refuses removing anything the history refers to', () => {
    const noPerson: ReferenceData = { ...seed.ref, people: seed.ref.people.filter((p) => p.id !== 'p-tanaka') };
    assert.match(validateReference(noPerson, seed.events)!, /person/);
    const noItem: ReferenceData = { ...seed.ref, items: seed.ref.items.filter((i) => i.id !== 'ond') };
    assert.match(validateReference(noItem, seed.events)!, /item/);
    const noLoc: ReferenceData = { ...seed.ref, locations: seed.ref.locations.filter((l) => l.id !== 'SITE-KOA'), people: seed.ref.people.map((p) => ({ ...p, homeLocationId: p.homeLocationId === 'SITE-KOA' ? 'HUB-HI' : p.homeLocationId })) };
    assert.match(validateReference(noLoc, seed.events)!, /location/);
  });

  it('refuses location loops, orphans, hubs inside locations and bad time zones', () => {
    const base = seed.ref;
    const loop: ReferenceData = { ...base, locations: [...base.locations, { id: 'A', name: 'A', kind: 'STORAGE', parentId: 'B' }, { id: 'B', name: 'B', kind: 'STORAGE', parentId: 'A' }] };
    assert.match(validateReference(loop)!, /loop/);
    const orphan: ReferenceData = { ...base, locations: [...base.locations, { id: 'O', name: 'Orphan', kind: 'KIT' }] };
    assert.match(validateReference(orphan)!, /must sit under/);
    const nested: ReferenceData = { ...base, locations: [...base.locations, { id: 'H', name: 'Nested hub', kind: 'HUB', parentId: 'HUB-HI' }] };
    assert.match(validateReference(nested)!, /hub/);
    const tz: ReferenceData = { ...base, locations: base.locations.map((l) => (l.id === 'HUB-DE' ? { ...l, timeZone: 'Mars/Olympus' } : l)) };
    assert.match(validateReference(tz)!, /time zone/);
  });

  it('normalizes product codes and rejects bad check digits', () => {
    assert.deepEqual(normalizeGtin(''), {});
    assert.deepEqual(normalizeGtin('0200 0000 0100 14'), { gtin: '02000000010014' });
    assert.ok('error' in normalizeGtin('02000000010015'));
    assert.ok('error' in normalizeGtin('12345'));
  });
});
