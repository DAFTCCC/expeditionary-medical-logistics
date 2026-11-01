import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { humanReadableGS1 } from '../../core/gs1';
import { newLabelCode } from '../../core/identify';
import type { LabelTarget } from '../../core/types';
import { labelTargetName } from '../model';
import { loadPref, savePref, useStore } from '../store';
import { Field, OutcomeBanner, Section, useRecorder } from '../ui';

function QR({ text, size = 132 }: { text: string; size?: number }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(''));
    return () => { live = false; };
  }, [text]);
  return <div className="qr" style={{ width: size, height: size }} role="img" aria-label={`QR code for ${text}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function DataMatrix({ text, gs1, size = 120 }: { text: string; gs1?: boolean; size?: number }) {
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    import('../barcodes')
      .then(({ dataMatrixSvg }) => dataMatrixSvg(text, gs1))
      .then((s) => live && setSvg(s))
      .catch((e: Error) => live && setErr(e.message));
    return () => { live = false; };
  }, [text, gs1]);
  if (err) return <div className="qr err" style={{ width: size, height: size }}>DataMatrix failed: {err}</div>;
  return <div className="qr dm" style={{ width: size, height: size }} role="img" aria-label={`DataMatrix for ${text}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

type Symbology = 'qr' | 'datamatrix';

interface Card { code: string; title: string; sub?: string; payload?: string; test?: boolean; symbology?: Symbology; gs1?: boolean }

export function LabelsPage({ params }: { params: URLSearchParams }) {
  const { p, L, ref } = useStore();
  const { record, outcome, setOutcome, busy } = useRecorder();
  const [type, setType] = useState<LabelTarget>((params.get('type') as LabelTarget) ?? 'ASSET');
  const [target, setTarget] = useState(params.get('target') ?? '');
  const [sheet, setSheet] = useState<string[]>([]);
  const [sym, setSym] = useState<Symbology>(() => (loadPref('labelSymbology', 'qr') as Symbology));
  const pickSym = (v: Symbology) => { setSym(v); savePref('labelSymbology', v); };

  const targets: { id: string; name: string }[] = useMemo(() => {
    if (type === 'LOT') return [...p.lots.values()].map((l) => ({ id: l.id, name: labelTargetName(p, L, 'LOT', l.id) }));
    if (type === 'ASSET') return [...p.assets.values()].map((a) => ({ id: a.asset.id, name: `${a.asset.name} ${a.asset.assetTag}` }));
    if (type === 'LOCATION') return ref.locations.map((l) => ({ id: l.id, name: l.name }));
    return ref.items.map((i) => ({ id: i.id, name: i.name }));
  }, [type, p, L, ref, p.events.length]);

  const active = [...p.labels.values()].filter((l) => l.active).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));

  const issue = async () => {
    let code = newLabelCode(type);
    while (p.labels.has(code)) code = newLabelCode(type);
    const ok = await record({ type: 'LABEL_ISSUE', code, targetType: type, targetId: target, reason: 'NEW' });
    if (ok) setSheet((s) => [code, ...s]);
  };
  const retire = async (code: string) => {
    const reason = window.prompt(`Why is ${code} being retired? (e.g. damaged, replaced)`);
    if (!reason?.trim()) return;
    const ok = await record({ type: 'LABEL_RETIRE', code, reason: reason.trim() });
    if (ok) setSheet((s) => s.filter((c) => c !== code));
  };

  const cards: Card[] = sheet.map((code) => {
    const l = p.labels.get(code);
    const name = l ? labelTargetName(p, L, l.targetType, l.targetId) : code;
    let sub = l?.targetType === 'LOCATION' ? L.locationName(L.hubOfLocation(l.targetId)) : undefined;
    if (l?.targetType === 'LOT') sub = `Exp ${p.lots.get(l.targetId)?.expiry}`;
    if (l?.targetType === 'ASSET') sub = `S/N ${p.assets.get(l.targetId)?.asset.serial}`;
    return { code, title: name, sub, symbology: sym };
  });

  // Test codes built from this dataset's own records, so every scan path can be tried without real packaging.
  const withGtin = ref.items.filter((i) => i.gtin);
  const today = new Date().toISOString().slice(0, 10);
  const hasStock = (lotId: string) => [...p.balances.entries()].some(([k, v]) => k.startsWith(lotId + '|') && v > 0);
  const known = [...p.lots.values()].find((l) => withGtin.some((i) => i.id === l.itemId) && l.expiry >= today && hasStock(l.id));
  const knownItem = known && ref.items.find((i) => i.id === known.itemId);
  const newItem = withGtin[0];
  const plainItem = withGtin[1] ?? withGtin[0];
  const asset = [...p.assets.values()][0];
  const later = new Date(Date.now() + 700 * 86_400_000).toISOString().slice(0, 10);
  const newGs1 = newItem?.gtin ? humanReadableGS1({ gtin: newItem.gtin, expiry: later, lot: 'TEST7731', serial: 'SN0001' }) : '';
  const testCards: Card[] = ([
    known && knownItem?.gtin ? { code: humanReadableGS1({ gtin: knownItem.gtin, expiry: known.expiry, lot: known.lotNumber }), title: 'GS1 DataMatrix — existing lot', sub: `${knownItem.name} lot ${known.lotNumber}`, test: true, symbology: 'datamatrix', gs1: true } : null,
    newGs1 ? { code: newGs1, title: 'GS1 DataMatrix — lot never received', sub: `${newItem.name} · opens a prefilled receipt`, test: true, symbology: 'datamatrix', gs1: true } : null,
    newGs1 ? { code: newGs1, title: 'Same, as QR', sub: 'For cameras or scanners without DataMatrix', test: true, symbology: 'qr' } : null,
    plainItem?.gtin ? { code: plainItem.gtin, title: 'Product code only (no lot)', sub: plainItem.name, test: true, symbology: 'qr' } : null,
    asset ? { code: asset.asset.assetTag, title: 'Asset tag', sub: asset.asset.name, test: true, symbology: 'qr' } : null,
  ] as (Card | null)[]).filter((c): c is Card => !!c && !!c.code);

  return (
    <>
      <div className="page-head">
        <h1>Labels</h1>
        <span className="sub">FieldLine labels are issued only where no manufacturer barcode exists. Codes are opaque, never reused, and carry a check character.</span>
      </div>
      <div className="grid2 no-print">
        <Section title="Issue a new label">
          <Field label="Label for">
            <select value={type} onChange={(e) => { setType(e.target.value as LabelTarget); setTarget(''); setOutcome(null); }}>
              <option value="ASSET">Equipment</option>
              <option value="LOCATION">Location / shelf / kit</option>
              <option value="LOT">Lot (repackaged stock)</option>
              <option value="ITEM">Catalog item</option>
            </select>
          </Field>
          <Field label="Which one">
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">— choose —</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <button className="btn primary" disabled={!target || busy} onClick={() => void issue()}>Issue label and add to sheet</button>
          <OutcomeBanner outcome={outcome} onClose={() => setOutcome(null)} />
        </Section>
        <Section title={`Active labels (${active.length})`}>
          <ul className="list compact">
            {active.map((l) => (
              <li key={l.code}>
                <code>{l.code}</code> {labelTargetName(p, L, l.targetType, l.targetId)}{' '}
                <button className="link" onClick={() => setSheet((s) => (s.includes(l.code) ? s : [...s, l.code]))}>Add to sheet</button>{' '}
                <button className="link danger" onClick={() => void retire(l.code)}>Retire</button>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title={`Print sheet (${cards.length})`} actions={<div className="no-print actions-row">
          <select value={sym} onChange={(e) => pickSym(e.target.value as Symbology)} aria-label="Barcode type" style={{ width: 'auto' }}>
            <option value="qr">QR code</option>
            <option value="datamatrix">DataMatrix</option>
          </select><button className="btn" disabled={!cards.length} onClick={() => window.print()}>Print</button>{cards.length > 0 && <button className="btn secondary" onClick={() => setSheet([])}>Clear</button>}</div>}>
        {cards.length === 0 ? <p className="empty no-print">Issue a label or add active labels to build a sheet.</p> : (
          <div className="sheet">{cards.map((c) => <LabelCard key={c.code} c={c} />)}</div>
        )}
      </Section>

      <Section title="Test codes">
        <p className="sub no-print">Scan these from another screen, or print them, to try each scan path. Built from this dataset's own catalog{ref.items.some((i) => i.gtin) ? '' : ' — add a product barcode to an item in Setup to get GS1 test codes'}.</p>
        {testCards.length === 0 ? <p className="empty">No test codes yet for this dataset.</p> : <div className="sheet test">{testCards.map((c, i) => <LabelCard key={c.code + i} c={c} />)}</div>}
      </Section>
    </>
  );
}

function LabelCard({ c }: { c: Card }) {
  return (
    <figure className={`label ${c.test ? 'test' : ''}`}>
      {c.symbology === 'datamatrix' ? <DataMatrix text={c.payload ?? c.code} gs1={c.gs1} /> : <QR text={c.payload ?? c.code} />}
      <figcaption>
        <strong>{c.title}</strong>
        {c.sub && <span>{c.sub}</span>}
        <code>{c.code}</code>
        <span className="tiny">{c.test ? 'TEST CODE' : 'FieldLine'}{c.symbology === 'datamatrix' ? ' · DataMatrix' : ''}</span>
      </figcaption>
    </figure>
  );
}
