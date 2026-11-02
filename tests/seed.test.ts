import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { conservationHolds, project, qty } from '../src/core/ledger';
import { dashboard, inventory, Lookup, rowsInScope } from '../src/app/model';
import { buildSeed, demoReference, HUB_DE, HUB_HI } from '../src/demo/seed';
import { gtinCheckDigitValid } from '../src/core/gs1';
import { normalizeLabelCode, resolveScan } from '../src/core/identify';

const NOW = new Date('2026-11-01T20:30:00.000Z');
const seed = buildSeed(NOW);
const p = project(seed.ref, seed.events);
const L = new Lookup(seed.ref);

describe('two-hub demo seed (ADR-008)', () => {
  it('every seed event is accepted by the ledger', () => {
    assert.deepEqual(p.rejected.map((r) => `${r.event.id} ${r.event.type}: ${r.reason}`), []);
    assert.equal(p.events.length, seed.events.length);
  });

  it('is deterministic for a given date', () => {
    assert.deepEqual(buildSeed(NOW).events, seed.events);
  });

  it('conservation holds for every lot', () => {
    for (const lotId of p.lots.keys()) assert.ok(conservationHolds(p, lotId), lotId);
  });

  it('has exactly two hubs, Hawaii and Germany, each with a time zone', () => {
    const hubs = L.hubs();
    assert.deepEqual(hubs.map((h) => h.id).sort(), [HUB_DE, HUB_HI]);
    assert.equal(L.locations.get(HUB_HI)!.timeZone, 'Pacific/Honolulu');
    assert.equal(L.locations.get(HUB_DE)!.timeZone, 'Europe/Berlin');
  });

  it('every non-hub location and every person with a home sits under one hub', () => {
    for (const l of demoReference.locations) assert.ok(L.hubOfLocation(l.id), l.id);
    for (const person of demoReference.people) if (person.homeLocationId) assert.ok(L.hubOfPerson(person.id), person.id);
  });

  it('uses restricted-circulation GTINs with valid check digits', () => {
    for (const i of demoReference.items) {
      assert.ok(i.gtin && gtinCheckDigitValid(i.gtin), i.id);
      assert.ok(i.gtin.startsWith('02'), i.id);
    }
  });

  it('hub-to-hub transfer Hawaii → Germany: 20 shipped, 19 received, 1 missing at Germany', () => {
    assert.equal(qty(p, 'lot-tq-hi', 'AVAILABLE', 'DE-WH'), 19);
    assert.equal(qty(p, 'lot-tq-hi', 'MISSING', 'DE-WH'), 1);
    assert.equal(qty(p, 'lot-tq-hi', 'AVAILABLE', 'HI-WH'), 20);
  });

  it('open Germany → Hawaii shipment counts toward the destination hub', () => {
    assert.equal(qty(p, 'lot-txa-de', 'IN_TRANSIT', 'HI-PHARM'), 5);
    const hi = inventory(p, L, HUB_HI, NOW).find((r) => r.item.id === 'txa')!;
    const de = inventory(p, L, HUB_DE, NOW).find((r) => r.item.id === 'txa')!;
    assert.equal(hi.inTransit, 5);
    assert.equal(de.inTransit, 0);
  });

  it('enterprise view is exactly the sum of the two hub views', () => {
    const all = rowsInScope(p, L, 'ALL');
    const hi = rowsInScope(p, L, HUB_HI);
    const de = rowsInScope(p, L, HUB_DE);
    assert.equal(all.length, hi.length + de.length);
    const sum = (rows: typeof all) => rows.reduce((n, r) => n + r.qty, 0);
    assert.equal(sum(all), sum(hi) + sum(de));
  });

  it('issued is not consumed at Koa: 10 issued → 3 used, 1 wasted, 2 pending return, 4 held', () => {
    assert.equal(qty(p, 'lot-ond-hi1', 'CUSTODY', 'p-tanaka'), 4);
    assert.equal(qty(p, 'lot-ond-hi1', 'PENDING_RETURN', 'SITE-KOA'), 2);
  });

  it('dashboard surfaces the planted conditions', () => {
    const d = dashboard(p, L, 'ALL', NOW);
    assert.ok(d.lotsExpiredWithStock.some((l) => l.lot.lotNumber === 'E880'));
    assert.ok(d.lotsExpiringSoon.some((l) => l.lot.lotNumber === 'A2390'));
    assert.equal(d.pendingReturns.length, 1);
    assert.equal(d.shipmentsInTransit.length, 1);
    assert.equal(d.missing.reduce((n, r) => n + r.qty, 0), 1);
    assert.ok(d.equipmentOverdueConfirm >= 1);
    assert.ok(d.equipmentNotOperational >= 1);
    const de = dashboard(p, L, HUB_DE, NOW);
    assert.ok(de.itemsBelowReorder.some((i) => i.item.id === 'ivkit'));
    // An item low at either hub is low for the enterprise.
    const lowAll = d.itemsBelowReorder.map((i) => i.item.id).sort();
    const lowHubs = [...new Set([...de.itemsBelowReorder, ...dashboard(p, L, HUB_HI, NOW).itemsBelowReorder].map((i) => i.item.id))].sort();
    assert.deepEqual(lowAll, lowHubs);
  });

  it('seeded labels resolve, and the retired one is reported as retired', () => {
    const labels = [...p.labels.values()];
    for (const l of labels) assert.ok(normalizeLabelCode(l.code), l.code);
    const retired = labels.find((l) => !l.active)!;
    assert.equal(resolveScan(retired.code, p, seed.ref).kind, 'RETIRED_LABEL');
    const loc = labels.find((l) => l.active && l.targetType === 'LOCATION')!;
    assert.equal(resolveScan(loc.code.toLowerCase(), p, seed.ref).kind, 'LOCATION');
  });

  it('expired lot cannot be issued', () => {
    const before = p.events.length;
    const res = project(seed.ref, [...seed.events, {
      id: 'x1', at: NOW.toISOString(), actorId: 'p-kalani', deviceId: 't', sync: 'LOCAL', type: 'ISSUE',
      lotId: 'lot-epi-hi-old', qty: 1, fromLocationId: 'HI-PHARM', toPersonId: 'p-tanaka', purpose: 'test',
    }]);
    assert.equal(res.events.length, before);
    assert.match(res.rejected[0].reason, /expired/);
  });
});

describe('country-level map (ADR-009)', () => {
  it('locations inherit their country from the nearest ancestor', () => {
    assert.equal(L.countryOf('HI-PHARM'), 'United States of America');
    assert.equal(L.countryOf('KIT-KOA-1'), 'Philippines');
    assert.equal(L.countryOf('DE-WH'), 'Germany');
  });

  it('pins add up to the same stock as the inventory, per scope', async () => {
    const { mapData, inventory } = await import('../src/app/model');
    for (const scope of ['ALL', HUB_HI, HUB_DE]) {
      const m = mapData(p, L, scope, NOW);
      const inv = inventory(p, L, scope, NOW);
      assert.equal(m.pins.reduce((n, x) => n + x.usable, 0), inv.reduce((n, i) => n + i.available, 0), scope);
      assert.equal(m.pins.reduce((n, x) => n + x.custody, 0), inv.reduce((n, i) => n + i.custody, 0), scope);
      assert.deepEqual(m.unplaced, []);
    }
  });

  it('shows hub countries, the open Germany → USA shipment, and the missing unit in Germany', async () => {
    const { mapData } = await import('../src/app/model');
    const m = mapData(p, L, 'ALL', NOW);
    assert.deepEqual(m.pins.map((x) => x.country), ['Germany', 'Philippines', 'Poland', 'United States of America']);
    assert.ok(m.pins.find((x) => x.country === 'Germany')!.isHubCountry);
    assert.deepEqual(m.links, [{ from: 'Germany', to: 'United States of America', qty: 5, shipments: 1 }]);
    assert.equal(m.pins.find((x) => x.country === 'Germany')!.missing, 1);
    assert.equal(m.pins.find((x) => x.country === 'Philippines')!.custody > 0, true);
  });
});
