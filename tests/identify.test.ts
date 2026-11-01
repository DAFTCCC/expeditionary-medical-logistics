import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildGS1, gs1Date, gtinCheckDigit, gtinCheckDigitValid, humanReadableGS1, parseGS1 } from '../src/core/gs1';
import { fefoLot, newLabelCode, normalizeLabelCode, resolveScan } from '../src/core/identify';
import { apply, emptyProjection } from '../src/core/ledger';
import { ev, lotOND, ref } from './fixtures';

const NOW = new Date('2026-10-31T00:00:00Z');

describe('GS1 parsing', () => {
  it('validates GTIN check digits', () => {
    assert.ok(gtinCheckDigitValid('00312345678906'));
    assert.ok(!gtinCheckDigitValid('00312345678907'));
    assert.equal(gtinCheckDigit('0031234567890'), 6);
  });
  it('parses raw DataMatrix with symbology id and GS separator', () => {
    const g = parseGS1(']d2010031234567890617270630' + '10A100\u001d21SN0001', { now: NOW });
    assert.ok(g.ok, g.errors.join());
    assert.equal(g.gtin, '00312345678906');
    assert.equal(g.expiry, '2027-06-30');
    assert.equal(g.lot, 'A100');
    assert.equal(g.serial, 'SN0001');
    assert.equal(g.ndc10, '1234567890');
  });
  it('parses human-readable form', () => {
    const g = parseGS1('(01)00312345678906(17)270630(10)A100(21)XYZ', { now: NOW });
    assert.equal(g.lot, 'A100');
    assert.equal(g.serial, 'XYZ');
  });
  it('accepts a substitute separator from keyboard-wedge scanners', () => {
    const g = parseGS1('010031234567890617270630' + '10A100|21XYZ', { separator: '|', now: NOW });
    assert.equal(g.lot, 'A100');
    assert.equal(g.serial, 'XYZ');
  });
  it('resolves DD=00 to the last day of the month, including leap years', () => {
    assert.equal(gs1Date('280200', NOW), '2028-02-29');
    assert.equal(gs1Date('270600', NOW), '2027-06-30');
  });
  it('applies the GS1 century sliding window', () => {
    assert.equal(gs1Date('991231', NOW), '1999-12-31');
    assert.equal(gs1Date('761231', NOW), '2076-12-31');
    assert.equal(gs1Date('771231', NOW), '1977-12-31');
  });
  it('rejects an invalid date and a bad GTIN', () => {
    assert.ok(!parseGS1('0100312345678906171313011', { now: NOW }).ok);
    assert.ok(!parseGS1('0100312345678907', { now: NOW }).ok);
  });
  it('round-trips what buildGS1 produces', () => {
    const f = { gtin: '00312345678906', expiry: '2027-06-30', lot: 'A100', serial: 'S9' };
    const a = parseGS1(buildGS1(f), { now: NOW }), b = parseGS1(humanReadableGS1(f), { now: NOW });
    for (const g of [a, b]) {
      assert.equal(g.gtin, f.gtin);
      assert.equal(g.expiry, f.expiry);
      assert.equal(g.lot, f.lot);
      assert.equal(g.serial, f.serial);
    }
  });
});

describe('FieldLine label codes', () => {
  it('generates codes that validate, and catches typos', () => {
    for (let i = 0; i < 500; i++) {
      const c = newLabelCode('LOT');
      const n = normalizeLabelCode(c);
      assert.ok(n && !('error' in n) && n.code === c, c);
    }
    const c = newLabelCode('ASSET');
    const chars = c.split('');
    const pos = 7;
    chars[pos] = chars[pos] === '2' ? '3' : '2';
    const bad = normalizeLabelCode(chars.join(''));
    assert.ok(bad && 'error' in bad);
  });
  it('tolerates lowercase, missing dashes and O/0 confusion', () => {
    const c = newLabelCode('LOT', () => 0); // FL-L-000000?
    const sloppy = c.toLowerCase().replace(/-/g, '').replace(/0/g, 'o');
    const n = normalizeLabelCode(sloppy);
    assert.ok(n && !('error' in n) && n.code === c);
  });
});

describe('Scan resolution', () => {
  const setup = () => {
    const p = emptyProjection();
    apply(p, ref, ev('RECEIVE', { actorId: 'hub', lot: lotOND, qty: 10, toLocationId: 'HUB', source: 'x' }));
    apply(p, ref, ev('ASSET_REGISTER', { actorId: 'hub', asset: { id: 'A1', name: 'Monitor', manufacturer: 'Acme', model: 'M1', serial: 'SN-77', assetTag: 'FLA-0001' }, locationId: 'HUB' }));
    return p;
  };
  it('GS1 barcode for a received lot resolves to that lot', () => {
    const m = resolveScan(buildGS1({ gtin: '00312345678906', expiry: '2027-06-30', lot: 'A100' }), setup(), ref, { now: NOW });
    assert.equal(m.kind, 'LOT');
  });
  it('GS1 barcode for an unseen lot offers a prefilled receipt', () => {
    const m = resolveScan(buildGS1({ gtin: '00312345678906', expiry: '2028-01-31', lot: 'NEW9' }), setup(), ref, { now: NOW });
    assert.equal(m.kind, 'NEW_LOT');
    if (m.kind === 'NEW_LOT') assert.equal(m.gs1.expiry, '2028-01-31');
  });
  it('plain UPC on the carton resolves to the product', () => {
    assert.equal(resolveScan('312345678906', setup(), ref).kind, 'ITEM');
  });
  it('asset tag and serial resolve to equipment (with trailing Enter from a wedge scanner)', () => {
    assert.equal(resolveScan('FLA-0001\r\n', setup(), ref).kind, 'ASSET');
    assert.equal(resolveScan('sn-77', setup(), ref).kind, 'ASSET');
  });
  it('issued labels resolve; retired labels warn; unknown codes are reported', () => {
    const p = setup();
    const code = newLabelCode('LOT');
    apply(p, ref, ev('LABEL_ISSUE', { actorId: 'hub', code, targetType: 'LOT', targetId: 'L1', reason: 'NEW' }));
    assert.equal(resolveScan(code, p, ref).kind, 'LOT');
    assert.equal(apply(p, ref, ev('LABEL_ISSUE', { actorId: 'hub', code, targetType: 'LOT', targetId: 'L1', reason: 'NEW' })).status, 'REJECTED', 'no duplicate codes');
    apply(p, ref, ev('LABEL_RETIRE', { actorId: 'hub', code, reason: 'Damaged' }));
    assert.equal(resolveScan(code, p, ref).kind, 'RETIRED_LABEL');
    assert.equal(resolveScan(newLabelCode('LOT'), p, ref).kind, 'NOT_FOUND');
  });
  it('FEFO picks the earliest non-expired lot with stock', () => {
    const p = setup();
    apply(p, ref, ev('RECEIVE', { actorId: 'hub', lot: { id: 'L9', itemId: 'ond', lotNumber: 'B2', expiry: '2027-01-31' }, qty: 3, toLocationId: 'HUB', source: 'x' }));
    apply(p, ref, ev('RECEIVE', { actorId: 'hub', lot: { id: 'L8', itemId: 'ond', lotNumber: 'B1', expiry: '2026-10-01' }, qty: 3, toLocationId: 'HUB', source: 'x' }));
    assert.equal(fefoLot(p, 'ond', 'HUB', '2026-10-31')?.id, 'L9');
  });
});
