import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { apply, bucketTotal, conservationHolds, emptyProjection, project, qty, totalsFor } from '../src/core/ledger';
import type { LedgerEvent } from '../src/core/types';
import { ev, lotKET, lotOLD, lotOND, ref } from './fixtures';

describe('Master prompt scenario: issued does not mean consumed', () => {
  const events: LedgerEvent[] = [
    ev('RECEIVE', { actorId: 'hub', lot: lotOND, qty: 20, toLocationId: 'HUB', source: 'PO-1' }),
    ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: 8, fromLocationId: 'HUB', toPersonId: 'prov', purpose: 'Mission' }),
    ev('CONSUME', { actorId: 'prov', lotId: 'L1', qty: 5, personId: 'prov', context: 'PATIENT_CARE' }),
    ev('WASTE', { actorId: 'prov', lotId: 'L1', qty: 1, personId: 'prov', reason: 'Vial dropped' }),
  ];
  const ret = ev('RETURN', { actorId: 'prov', lotId: 'L1', qty: 2, personId: 'prov', toLocationId: 'HUB' });
  events.push(ret, ev('RETURN_ACCEPT', { actorId: 'hub', returnEventId: ret.id, qty: 2, disposition: 'AVAILABLE' }));
  const p = project(ref, events);

  it('accepts every event', () => assert.equal(p.rejected.length, 0, JSON.stringify(p.rejected)));
  it('reports the exact table from the requirements', () => {
    const t = totalsFor(p, 'L1');
    assert.equal(t.received, 20);
    assert.equal(t.issued, 8);
    assert.equal(t.consumed, 5);
    assert.equal(t.wasted, 1);
    assert.equal(t.returnAccepted, 2);
    assert.equal(qty(p, 'L1', 'AVAILABLE', 'HUB'), 14);
    assert.equal(bucketTotal(p, 'L1', 'CUSTODY'), 0);
  });
  it('never reports issued as consumed', () => assert.notEqual(totalsFor(p, 'L1').consumed, totalsFor(p, 'L1').issued));
  it('conserves every unit', () => assert.ok(conservationHolds(p, 'L1')));
});

describe('Returns', () => {
  it('a returned item is NOT available until accepted', () => {
    const p = project(ref, [
      ev('RECEIVE', { actorId: 'hub', lot: lotOND, qty: 10, toLocationId: 'HUB', source: 'x' }),
      ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: 4, fromLocationId: 'HUB', toPersonId: 'prov', purpose: 'x' }),
      ev('RETURN', { actorId: 'prov', lotId: 'L1', qty: 4, personId: 'prov', toLocationId: 'HUB' }),
    ]);
    assert.equal(qty(p, 'L1', 'AVAILABLE', 'HUB'), 6);
    assert.equal(qty(p, 'L1', 'PENDING_RETURN', 'HUB'), 4);
  });
  it('the returner cannot accept their own return', () => {
    const p = emptyProjection();
    apply(p, ref, ev('RECEIVE', { actorId: 'hub', lot: lotOND, qty: 10, toLocationId: 'HUB', source: 'x' }));
    apply(p, ref, ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: 4, fromLocationId: 'HUB', toPersonId: 'dlo', purpose: 'x' }));
    const r = ev('RETURN', { actorId: 'dlo', lotId: 'L1', qty: 4, personId: 'dlo', toLocationId: 'HUB' });
    apply(p, ref, r);
    const res = apply(p, ref, ev('RETURN_ACCEPT', { actorId: 'dlo', returnEventId: r.id, qty: 4, disposition: 'AVAILABLE' }));
    assert.equal(res.status, 'REJECTED');
  });
  it('returns accepted into quarantine cannot be issued', () => {
    const p = emptyProjection();
    apply(p, ref, ev('RECEIVE', { actorId: 'hub', lot: lotOND, qty: 2, toLocationId: 'HUB', source: 'x' }));
    apply(p, ref, ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: 2, fromLocationId: 'HUB', toPersonId: 'prov', purpose: 'x' }));
    const r = ev('RETURN', { actorId: 'prov', lotId: 'L1', qty: 2, personId: 'prov', toLocationId: 'HUB' });
    apply(p, ref, r);
    apply(p, ref, ev('RETURN_ACCEPT', { actorId: 'hub', returnEventId: r.id, qty: 2, disposition: 'QUARANTINE' }));
    const res = apply(p, ref, ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: 1, fromLocationId: 'HUB', toPersonId: 'prov', purpose: 'x' }));
    assert.equal(res.status, 'REJECTED');
    assert.ok(conservationHolds(p, 'L1'));
  });
});

describe('Validation and authority', () => {
  const base = () => {
    const p = emptyProjection();
    apply(p, ref, ev('RECEIVE', { actorId: 'hub', lot: lotOND, qty: 5, toLocationId: 'HUB', source: 'x' }));
    return p;
  };
  it('cannot issue more than available', () => {
    const r = apply(base(), ref, ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: 6, fromLocationId: 'HUB', toPersonId: 'prov', purpose: 'x' }));
    assert.equal(r.status, 'REJECTED');
  });
  it('cannot consume more than in custody', () => {
    const p = base();
    apply(p, ref, ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: 2, fromLocationId: 'HUB', toPersonId: 'prov', purpose: 'x' }));
    const r = apply(p, ref, ev('CONSUME', { actorId: 'prov', lotId: 'L1', qty: 3, personId: 'prov', context: 'PATIENT_CARE' }));
    assert.equal(r.status, 'REJECTED');
  });
  it('medications cannot be issued to someone without medication authority', () => {
    const r = apply(base(), ref, ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: 1, fromLocationId: 'HUB', toPersonId: 'tm', purpose: 'x' }));
    assert.equal(r.status, 'REJECTED');
  });
  it('read-only roles cannot record anything', () => {
    const r = apply(base(), ref, ev('QUARANTINE', { actorId: 'aud', lotId: 'L1', qty: 1, locationId: 'HUB', reason: 'x' }));
    assert.equal(r.status, 'REJECTED');
  });
  it('self-issue requires a witness', () => {
    const p = base();
    const a = apply(p, ref, ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: 1, fromLocationId: 'HUB', toPersonId: 'hub', purpose: 'x' }));
    assert.equal(a.status, 'REJECTED');
    const b = apply(p, ref, ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: 1, fromLocationId: 'HUB', toPersonId: 'hub', purpose: 'x', witnessId: 'dlo' }));
    assert.equal(b.status, 'ACCEPTED');
  });
  it('witness-required items need a witness who is not the recorder', () => {
    const p = emptyProjection();
    apply(p, ref, ev('RECEIVE', { actorId: 'hub', lot: lotKET, qty: 4, toLocationId: 'HUB', source: 'x' }));
    const issue = (witnessId?: string) =>
      apply(p, ref, ev('ISSUE', { actorId: 'hub', lotId: 'L2', qty: 1, fromLocationId: 'HUB', toPersonId: 'prov', purpose: 'x', witnessId }));
    assert.equal(issue().status, 'REJECTED');
    assert.equal(issue('hub').status, 'REJECTED');
    assert.equal(issue('dlo').status, 'ACCEPTED');
  });
  it('expired lots cannot be issued', () => {
    const p = emptyProjection();
    apply(p, ref, ev('RECEIVE', { actorId: 'hub', lot: lotOLD, qty: 3, toLocationId: 'HUB', source: 'x', at: '2026-08-01T00:00:00Z' }));
    const r = apply(p, ref, ev('ISSUE', { actorId: 'hub', lotId: 'L3', qty: 1, fromLocationId: 'HUB', toPersonId: 'prov', purpose: 'x', at: '2026-10-01T00:00:00Z' }));
    assert.equal(r.status, 'REJECTED');
    assert.match((r as { reason: string }).reason, /expired/);
  });
  it('a lot is usable through the end of its printed expiry date', () => {
    const p = emptyProjection();
    apply(p, ref, ev('RECEIVE', { actorId: 'hub', lot: lotOLD, qty: 3, toLocationId: 'HUB', source: 'x', at: '2026-08-01T00:00:00Z' }));
    const r = apply(p, ref, ev('ISSUE', { actorId: 'hub', lotId: 'L3', qty: 1, fromLocationId: 'HUB', toPersonId: 'prov', purpose: 'x', at: '2026-09-30T23:00:00Z' }));
    assert.equal(r.status, 'ACCEPTED');
  });
  it('only quarantined stock may be disposed, and disposal always needs a witness', () => {
    const p = base();
    assert.equal(apply(p, ref, ev('DISPOSE', { actorId: 'hub', lotId: 'L1', qty: 1, locationId: 'HUB', method: 'x', witnessId: 'dlo' })).status, 'REJECTED');
    apply(p, ref, ev('QUARANTINE', { actorId: 'hub', lotId: 'L1', qty: 2, locationId: 'HUB', reason: 'Temp excursion' }));
    assert.equal(apply(p, ref, ev('DISPOSE', { actorId: 'hub', lotId: 'L1', qty: 1, locationId: 'HUB', method: 'x' })).status, 'REJECTED');
    assert.equal(apply(p, ref, ev('DISPOSE', { actorId: 'hub', lotId: 'L1', qty: 1, locationId: 'HUB', method: 'x', witnessId: 'dlo' })).status, 'ACCEPTED');
    assert.ok(conservationHolds(p, 'L1'));
  });
  it('rejects a conflicting lot record', () => {
    const p = base();
    const r = apply(p, ref, ev('RECEIVE', { actorId: 'hub', lot: { ...lotOND, expiry: '2028-01-01' }, qty: 1, toLocationId: 'HUB', source: 'x' }));
    assert.equal(r.status, 'REJECTED');
  });
});

describe('Transfers distinguish shipped from received', () => {
  it('stock in transit is not available anywhere; shortfall becomes a discrepancy', () => {
    const p = emptyProjection();
    apply(p, ref, ev('RECEIVE', { actorId: 'hub', lot: lotOND, qty: 10, toLocationId: 'HUB', source: 'x' }));
    const ship = ev('TRANSFER_SHIP', { actorId: 'hub', lotId: 'L1', qty: 6, fromLocationId: 'HUB', toLocationId: 'FWD' });
    apply(p, ref, ship);
    assert.equal(qty(p, 'L1', 'AVAILABLE', 'FWD'), 0);
    assert.equal(qty(p, 'L1', 'IN_TRANSIT', 'FWD'), 6);
    assert.equal(apply(p, ref, ev('TRANSFER_RECEIVE', { actorId: 'hub', shipEventId: ship.id, qtyReceived: 6 })).status, 'REJECTED', 'shipper cannot self-acknowledge');
    assert.equal(apply(p, ref, ev('TRANSFER_RECEIVE', { actorId: 'dlo', shipEventId: ship.id, qtyReceived: 5 })).status, 'ACCEPTED');
    assert.equal(qty(p, 'L1', 'AVAILABLE', 'FWD'), 5);
    assert.equal(qty(p, 'L1', 'MISSING', 'FWD'), 1);
    assert.equal(qty(p, 'L1', 'IN_TRANSIT', 'FWD'), 0);
    assert.ok(conservationHolds(p, 'L1'));
  });
});

describe('Idempotency (foundation for offline sync)', () => {
  it('re-applying the same event id is a no-op', () => {
    const p = emptyProjection();
    const r = ev('RECEIVE', { actorId: 'hub', lot: lotOND, qty: 10, toLocationId: 'HUB', source: 'x' });
    assert.equal(apply(p, ref, r).status, 'ACCEPTED');
    assert.equal(apply(p, ref, r).status, 'DUPLICATE');
    assert.equal(qty(p, 'L1', 'AVAILABLE', 'HUB'), 10);
  });
  it('replaying the full log yields the identical projection', () => {
    const events = [
      ev('RECEIVE', { actorId: 'hub', lot: lotOND, qty: 10, toLocationId: 'HUB', source: 'x' }),
      ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: 3, fromLocationId: 'HUB', toPersonId: 'prov', purpose: 'x' }),
      ev('CONSUME', { actorId: 'prov', lotId: 'L1', qty: 1, personId: 'prov', context: 'TRAINING' }),
    ];
    const a = project(ref, events), b = project(ref, [...events, ...events]);
    assert.deepEqual([...a.balances], [...b.balances]);
    assert.deepEqual(totalsFor(a, 'L1'), totalsFor(b, 'L1'));
  });
  it('separates patient care from training consumption', () => {
    const p = project(ref, [
      ev('RECEIVE', { actorId: 'hub', lot: lotOND, qty: 10, toLocationId: 'HUB', source: 'x' }),
      ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: 5, fromLocationId: 'HUB', toPersonId: 'prov', purpose: 'x' }),
      ev('CONSUME', { actorId: 'prov', lotId: 'L1', qty: 2, personId: 'prov', context: 'PATIENT_CARE' }),
      ev('CONSUME', { actorId: 'prov', lotId: 'L1', qty: 3, personId: 'prov', context: 'TRAINING' }),
    ]);
    assert.deepEqual(totalsFor(p, 'L1').consumedByContext, { PATIENT_CARE: 2, TRAINING: 3 });
  });
});

describe('Property: random valid sequences always conserve units', () => {
  it('holds over 2,000 random operations', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const p = emptyProjection();
    apply(p, ref, ev('RECEIVE', { actorId: 'hub', lot: lotOND, qty: 500, toLocationId: 'HUB', source: 'x' }));
    const pendingReturns: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const q = 1 + Math.floor(rnd() * 5);
      const r = rnd();
      if (r < 0.3) apply(p, ref, ev('ISSUE', { actorId: 'hub', lotId: 'L1', qty: q, fromLocationId: 'HUB', toPersonId: 'prov', purpose: 'x' }));
      else if (r < 0.5) apply(p, ref, ev('CONSUME', { actorId: 'prov', lotId: 'L1', qty: q, personId: 'prov', context: 'PATIENT_CARE' }));
      else if (r < 0.6) apply(p, ref, ev('WASTE', { actorId: 'prov', lotId: 'L1', qty: q, personId: 'prov', reason: 'x' }));
      else if (r < 0.75) {
        const e = ev('RETURN', { actorId: 'prov', lotId: 'L1', qty: q, personId: 'prov', toLocationId: 'HUB' });
        if (apply(p, ref, e).status === 'ACCEPTED') pendingReturns.push(e.id);
      } else if (r < 0.9 && pendingReturns.length) {
        const id = pendingReturns.shift()!;
        apply(p, ref, ev('RETURN_ACCEPT', { actorId: 'hub', returnEventId: id, qty: p.returns.get(id)!.remaining, disposition: rnd() < 0.8 ? 'AVAILABLE' : 'QUARANTINE' }));
      } else apply(p, ref, ev('QUARANTINE', { actorId: 'hub', lotId: 'L1', qty: q, locationId: 'HUB', reason: 'x' }));
      assert.ok(conservationHolds(p, 'L1'), `broke at step ${i}`);
      for (const [, v] of p.balances) assert.ok(v >= 0, `negative balance at step ${i}`);
    }
  });
});
