import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { humanReadableGS1 } from '../../core/gs1';
import { newLabelCode } from '../../core/identify';
import type { LabelTarget } from '../../core/types';
import { labelTargetName } from '../model';
import { useStore } from '../store';
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

interface Card { code: string; title: string; sub?: string; payload?: string; test?: boolean }

export function LabelsPage({ params }: { params: URLSearchParams }) {
  const { p, L, ref } = useStore();
  const { record, outcome, setOutcome, busy } = useRecorder();
  const [type, setType] = useState<LabelTarget>((params.get('type') as LabelTarget) ?? 'ASSET');
  const [target, setTarget] = useState(params.get('target') ?? '');
  const [sheet, setSheet] = useState<string[]>([]);

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
    return { code, title: name, sub };
  });

  // Fictional test codes so every scan path can be exercised without real packaging.
  const ond = ref.items.find((i) => i.id === 'ond');
  const known = [...p.lots.values()].find((l) => l.itemId === 'ond' && l.lotNumber === 'A2401');
  const nextYear = new Date(Date.now() + 700 * 86_400_000).toISOString().slice(0, 10);
  const testCards: Card[] = ([
    known && ond?.gtin ? { code: humanReadableGS1({ gtin: ond.gtin, expiry: known.expiry, lot: known.lotNumber }), title: 'GS1 — existing lot', sub: `${ond.name} lot A2401`, test: true } : null,
    ond?.gtin ? { code: humanReadableGS1({ gtin: ond.gtin, expiry: nextYear, lot: 'N7731', serial: 'SN0001' }), title: 'GS1 — lot never received', sub: 'Opens a prefilled receipt', test: true } : null,
    { code: ref.items.find((i) => i.id === 'gauze')?.gtin ?? '', title: 'GTIN only (no lot)', sub: 'Hemostatic gauze', test: true },
    { code: 'HI-EQ-0003', title: 'Asset tag', sub: 'Pulse oximeter', test: true },
  ] as (Card | null)[]).filter((c): c is Card => !!c && !!c.code);

  return (
    <>
      <div className="page-head">
        <h1>Labels</h1>
        <span className="sub">FieldLine QR labels are issued only where no manufacturer barcode exists. Codes are opaque, never reused, and carry a check character.</span>
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

      <Section title={`Print sheet (${cards.length})`} actions={<div className="no-print actions-row"><button className="btn" disabled={!cards.length} onClick={() => window.print()}>Print</button>{cards.length > 0 && <button className="btn secondary" onClick={() => setSheet([])}>Clear</button>}</div>}>
        {cards.length === 0 ? <p className="empty no-print">Issue a label or add active labels to build a sheet.</p> : (
          <div className="sheet">{cards.map((c) => <LabelCard key={c.code} c={c} />)}</div>
        )}
      </Section>

      <Section title="Test codes (fictional)">
        <p className="sub no-print">Scan these from another screen, or print them, to try each scan path. The GS1 codes use the human-readable bracket form inside a QR so any camera can read them; real pharmaceutical packs use GS1 DataMatrix.</p>
        <div className="sheet test">{testCards.map((c) => <LabelCard key={c.code} c={c} />)}</div>
      </Section>
    </>
  );
}

function LabelCard({ c }: { c: Card }) {
  return (
    <figure className={`label ${c.test ? 'test' : ''}`}>
      <QR text={c.payload ?? c.code} />
      <figcaption>
        <strong>{c.title}</strong>
        {c.sub && <span>{c.sub}</span>}
        <code>{c.code}</code>
        <span className="tiny">{c.test ? 'TEST CODE · FICTIONAL' : 'FieldLine · DEMO'}</span>
      </figcaption>
    </figure>
  );
}
