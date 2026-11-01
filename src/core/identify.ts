import { gtinCheckDigitValid, looksLikeGS1, parseGS1, toGtin14, type GS1Result } from './gs1';
import { qty, type AssetState, type Projection } from './ledger';
import type { CatalogItem, LabelTarget, Location, Lot, ReferenceData } from './types';

/**
 * Internal label codes: FL-<type>-<6 chars><check>, e.g. FL-L-7K2M9QX.
 * Opaque, non-sensitive, resolve only through the app. Crockford base32
 * (no I, L, O, U) with a Luhn mod-32 check character to catch typing errors
 * during manual fallback entry.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TYPE_CODE: Record<LabelTarget, string> = { LOT: 'L', ASSET: 'A', LOCATION: 'P', ITEM: 'I' };
const CODE_TYPE: Record<string, LabelTarget> = { L: 'LOT', A: 'ASSET', P: 'LOCATION', I: 'ITEM' };

function luhn32(body: string): string {
  let factor = 2, sum = 0;
  for (let i = body.length - 1; i >= 0; i--) {
    let addend = factor * ALPHABET.indexOf(body[i]);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 32) + (addend % 32);
    sum += addend;
  }
  return ALPHABET[(32 - (sum % 32)) % 32];
}

export function newLabelCode(type: LabelTarget, random: () => number = Math.random): string {
  let body = '';
  for (let i = 0; i < 6; i++) body += ALPHABET[Math.floor(random() * 32)];
  return `FL-${TYPE_CODE[type]}-${body}${luhn32(body)}`;
}

/** Normalize typed or scanned input to canonical form, or null if it isn't an FL code. */
export function normalizeLabelCode(input: string): { code: string; type: LabelTarget } | { error: string } | null {
  const s = input.trim().toUpperCase().replace(/[\s_]/g, '');
  const m = /^FL-?([LAPI])-?([0-9A-Z]{7})$/.exec(s);
  if (!m) return null;
  const body = m[2].replace(/O/g, '0').replace(/[IL]/g, '1');
  if (/[U]/.test(body)) return { error: 'Label code contains an invalid character.' };
  const code = body.slice(0, 6), check = body[6];
  if (luhn32(code) !== check) return { error: 'Label code check character does not match — re-scan or re-type it.' };
  return { code: `FL-${m[1]}-${body}`, type: CODE_TYPE[m[1]] };
}

// ---------------------------------------------------------------- resolve

export type ScanMatch =
  | { kind: 'LOT'; lot: Lot; item: CatalogItem; via: string; gs1?: GS1Result }
  | { kind: 'ITEM'; item: CatalogItem; via: string; gs1?: GS1Result }
  /** Known product, lot never received here: offer RECEIVE prefilled from the barcode. */
  | { kind: 'NEW_LOT'; item: CatalogItem; gs1: GS1Result; via: string }
  | { kind: 'ASSET'; asset: AssetState; via: string }
  | { kind: 'LOCATION'; location: Location; via: string }
  | { kind: 'RETIRED_LABEL'; code: string; via: string }
  | { kind: 'NOT_FOUND'; reason: string; gs1?: GS1Result };

export interface ScanOptions { gs1Separator?: string; now?: Date }

export function resolveScan(raw: string, p: Projection, ref: ReferenceData, opts: ScanOptions = {}): ScanMatch {
  const input = raw.replace(/[\r\n]+$/, '');
  if (!input.trim()) return { kind: 'NOT_FOUND', reason: 'Nothing was scanned.' };

  // 1. FieldLine internal label
  const fl = normalizeLabelCode(input);
  if (fl && 'error' in fl) return { kind: 'NOT_FOUND', reason: fl.error };
  if (fl) {
    const label = p.labels.get(fl.code);
    if (!label) return { kind: 'NOT_FOUND', reason: `Label ${fl.code} is valid but was never issued in this system.` };
    if (!label.active) return { kind: 'RETIRED_LABEL', code: fl.code, via: 'FieldLine label' };
    return resolveTarget(label.targetType, label.targetId, p, ref, `FieldLine label ${fl.code}`);
  }

  // 2. GS1 element string (DataMatrix / GS1-128 / GS1 QR)
  if (looksLikeGS1(input) || (opts.gs1Separator && input.includes(opts.gs1Separator))) {
    const g = parseGS1(input, { separator: opts.gs1Separator, now: opts.now });
    if (!g.gtin) return { kind: 'NOT_FOUND', reason: g.errors[0] ?? 'GS1 barcode has no GTIN.', gs1: g };
    const item = ref.items.find((i) => i.gtin && toGtin14(i.gtin) === g.gtin);
    if (!item) return { kind: 'NOT_FOUND', reason: `GTIN ${g.gtin} is not in the catalog.`, gs1: g };
    if (g.lot) {
      const lot = [...p.lots.values()].find((l) => l.itemId === item.id && l.lotNumber === g.lot);
      if (lot) return { kind: 'LOT', lot, item, via: 'GS1 barcode', gs1: g };
      return { kind: 'NEW_LOT', item, gs1: g, via: 'GS1 barcode' };
    }
    return { kind: 'ITEM', item, via: 'GS1 barcode (no lot encoded)', gs1: g };
  }

  const t = input.trim();

  // 3. Plain GTIN / UPC / EAN (linear barcodes on packaging)
  if (/^\d{8}$|^\d{12,14}$/.test(t) && gtinCheckDigitValid(t)) {
    const item = ref.items.find((i) => i.gtin && toGtin14(i.gtin) === toGtin14(t));
    if (item) return { kind: 'ITEM', item, via: 'UPC/EAN/GTIN' };
    return { kind: 'NOT_FOUND', reason: `Product code ${t} is not in the catalog.` };
  }

  // 4. Equipment serial or asset tag (manufacturer Code 128 labels, manual entry)
  const up = t.toUpperCase();
  for (const a of p.assets.values()) {
    if (a.asset.assetTag.toUpperCase() === up) return { kind: 'ASSET', asset: a, via: 'Asset tag' };
    if (a.asset.serial.toUpperCase() === up) return { kind: 'ASSET', asset: a, via: 'Serial number' };
  }

  // 5. Lot number typed by hand (may be ambiguous across products)
  const lots = [...p.lots.values()].filter((l) => l.lotNumber.toUpperCase() === up);
  if (lots.length === 1) {
    const item = ref.items.find((i) => i.id === lots[0].itemId)!;
    return { kind: 'LOT', lot: lots[0], item, via: 'Lot number' };
  }
  if (lots.length > 1) return { kind: 'NOT_FOUND', reason: `Lot ${t} exists for ${lots.length} products — scan the product barcode instead.` };

  return { kind: 'NOT_FOUND', reason: `No record matches "${t}".` };
}

function resolveTarget(type: LabelTarget, id: string, p: Projection, ref: ReferenceData, via: string): ScanMatch {
  if (type === 'LOT') {
    const lot = p.lots.get(id);
    const item = lot && ref.items.find((i) => i.id === lot.itemId);
    if (lot && item) return { kind: 'LOT', lot, item, via };
  } else if (type === 'ASSET') {
    const a = p.assets.get(id);
    if (a) return { kind: 'ASSET', asset: a, via };
  } else if (type === 'LOCATION') {
    const l = ref.locations.find((x) => x.id === id);
    if (l) return { kind: 'LOCATION', location: l, via };
  } else {
    const item = ref.items.find((x) => x.id === id);
    if (item) return { kind: 'ITEM', item, via };
  }
  return { kind: 'NOT_FOUND', reason: 'Label points to a record that no longer exists.' };
}

/** Earliest-expiry-first: the non-expired lot of an item to issue first from a location. */
export function fefoLot(p: Projection, itemId: string, locationId: string, today: string): Lot | undefined {
  return [...p.lots.values()]
    .filter((l) => l.itemId === itemId && l.expiry >= today && qty(p, l.id, 'AVAILABLE', locationId) > 0)
    .sort((a, b) => a.expiry.localeCompare(b.expiry))[0];
}
