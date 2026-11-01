/**
 * GS1 element-string parser for pharmaceutical / medical-device barcodes
 * (GS1 DataMatrix, GS1-128, GS1 QR).
 *
 * Accepts the forms scanners and people actually produce:
 *  - raw with symbology identifier:   ]d2 0100312345678906 17271231 10ABC GS 21XYZ
 *  - raw without identifier, with GS (ASCII 29) separators
 *  - human-readable:                  (01)00312345678906(17)271231(10)ABC(21)XYZ
 * Keyboard-wedge scanners often cannot emit ASCII 29; callers can pass the
 * character their scanner is configured to send instead (e.g. '|' or '~').
 */

export interface GS1Result {
  ok: boolean;
  gtin?: string;
  lot?: string;
  serial?: string;
  /** Expiry as YYYY-MM-DD (DD=00 resolved to last day of month). */
  expiry?: string;
  productionDate?: string;
  /** NDC-10 (unformatted digits) when the GTIN carries a US NDC. */
  ndc10?: string;
  /** Every AI found, verbatim. */
  elements: Record<string, string>;
  errors: string[];
}

const GS = '\u001d';

/** AIs with a predefined fixed length (AI digits excluded). */
const FIXED: Record<string, number> = {
  '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2,
};
/** Variable-length AIs we recognize and their maximum lengths. */
const VARIABLE: Record<string, number> = {
  '10': 20, '21': 20, '22': 20, '30': 8, '37': 8, '240': 30, '241': 30, '250': 30,
  '400': 30, '710': 20, '711': 20, '712': 20, '713': 20, '714': 20, '715': 20,
};
/** 4-digit measure AIs 31nn–36nn: fixed 6 digits. */
const isMeasure = (s: string) => /^3[1-6]\d\d$/.test(s);

export function looksLikeGS1(input: string): boolean {
  const s = input.trim();
  return /^\]([dCQe])[0-9]/.test(s) || /^\(\d{2,4}\)/.test(s) || s.includes(GS) || /^01\d{14}(1[0-7]|21|30)/.test(s);
}

export function gtinCheckDigitValid(gtin: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(gtin)) return false;
  const digits = gtin.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  digits.reverse().forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)));
  return (10 - (sum % 10)) % 10 === check;
}

/** Compute the check digit for a GTIN body (all digits except the last). */
export function gtinCheckDigit(body: string): number {
  const digits = body.split('').map(Number).reverse();
  let sum = 0;
  digits.forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)));
  return (10 - (sum % 10)) % 10;
}

/** Pad GTIN-8/12/13 to GTIN-14 for comparison. */
export function toGtin14(g: string): string {
  return g.padStart(14, '0');
}

/**
 * GS1 date YYMMDD → YYYY-MM-DD. Century by the GS1 sliding window (General
 * Specifications 7.12): a year more than 50 ahead of `now` is last century,
 * more than 49 behind is next century. DD=00 means last day of the month.
 */
export function gs1Date(yymmdd: string, now = new Date()): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = +yymmdd.slice(0, 2), mm = +yymmdd.slice(2, 4);
  let dd = +yymmdd.slice(4, 6);
  if (mm < 1 || mm > 12) return null;
  const cur = now.getUTCFullYear();
  const curCentury = Math.floor(cur / 100) * 100;
  const diff = yy - (cur % 100);
  let year = curCentury + yy;
  if (diff >= 51) year -= 100;
  else if (diff <= -50) year += 100;
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  if (dd === 0) dd = last;
  if (dd > last) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** US pharma GTIN: GTIN-14 "003" + NDC10 + check. Returns NDC-10 digits. */
export function ndc10FromGtin(gtin14: string): string | undefined {
  return /^003\d{11}$/.test(gtin14) ? gtin14.slice(3, 13) : undefined;
}

function readAI(s: string, i: number): string | null {
  for (const len of [2, 3, 4]) {
    const ai = s.slice(i, i + len);
    if (ai.length < len) break;
    if (len === 2 && (ai in FIXED || ai in VARIABLE)) return ai;
    if (len === 3 && ai in VARIABLE) return ai;
    if (len === 4 && isMeasure(ai)) return ai;
  }
  return null;
}

export function parseGS1(input: string, opts: { separator?: string; now?: Date } = {}): GS1Result {
  const out: GS1Result = { ok: false, elements: {}, errors: [] };
  // Symbology identifier (]d2 DataMatrix, ]C1 GS1-128, ]Q3 QR, ]e0 DataBar) may precede either form.
  let s = input.trim().replace(/^\][A-Za-z]\d/, '');

  if (/^\(\d{2,4}\)/.test(s)) {
    // Human-readable form: split on parentheses.
    const re = /\((\d{2,4})\)([^()]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) out.elements[m[1]] = m[2];
  } else {
    if (opts.separator) s = s.split(opts.separator).join(GS);
    let i = 0;
    while (i < s.length) {
      if (s[i] === GS) { i++; continue; }
      const ai = readAI(s, i);
      if (!ai) { out.errors.push(`Unrecognized data at position ${i}: "${s.slice(i, i + 6)}…"`); break; }
      i += ai.length;
      let val: string;
      if (ai in FIXED || isMeasure(ai)) {
        const n = isMeasure(ai) ? 6 : FIXED[ai];
        val = s.slice(i, i + n);
        if (val.length < n) out.errors.push(`AI (${ai}) is truncated.`);
        i += n;
      } else {
        const end = s.indexOf(GS, i);
        const stop = end === -1 ? s.length : end;
        val = s.slice(i, Math.min(stop, i + VARIABLE[ai]));
        i += val.length;
      }
      out.elements[ai] = val;
    }
  }

  const el = out.elements;
  if (el['01']) {
    if (!/^\d{14}$/.test(el['01']) || !gtinCheckDigitValid(el['01'])) out.errors.push('GTIN check digit is invalid.');
    else { out.gtin = el['01']; out.ndc10 = ndc10FromGtin(el['01']); }
  }
  if (el['10'] !== undefined) out.lot = el['10'];
  if (el['21'] !== undefined) out.serial = el['21'];
  if (el['17']) {
    const d = gs1Date(el['17'], opts.now);
    if (d) out.expiry = d; else out.errors.push('Expiration date (17) is not a valid date.');
  }
  if (el['11']) out.productionDate = gs1Date(el['11'], opts.now) ?? undefined;
  out.ok = Object.keys(el).length > 0 && out.errors.length === 0;
  return out;
}

/** Build a GS1 element string (GS-separated) — used for synthetic test labels. */
export function buildGS1(f: { gtin: string; expiry?: string; lot?: string; serial?: string }): string {
  let s = `01${f.gtin}`;
  if (f.expiry) s += `17${f.expiry.slice(2, 4)}${f.expiry.slice(5, 7)}${f.expiry.slice(8, 10)}`;
  if (f.lot) s += `10${f.lot}`;
  if (f.serial) s += `${f.lot ? GS : ''}21${f.serial}`;
  return s;
}

export function humanReadableGS1(f: { gtin: string; expiry?: string; lot?: string; serial?: string }): string {
  let s = `(01)${f.gtin}`;
  if (f.expiry) s += `(17)${f.expiry.slice(2, 4)}${f.expiry.slice(5, 7)}${f.expiry.slice(8, 10)}`;
  if (f.lot) s += `(10)${f.lot}`;
  if (f.serial) s += `(21)${f.serial}`;
  return s;
}
