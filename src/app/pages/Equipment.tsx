import { useState, type FormEvent } from 'react';
import type { AssetState } from '../../core/ledger';
import type { AssetStatus } from '../../core/types';
import { CONFIRM_OVERDUE_DAYS, daysBetween, describeEvent, todayUTC } from '../model';
import { useStore } from '../store';
import { Empty, Field, href, OutcomeBanner, Time, useRecorder, useSession } from '../ui';

const STATUSES: AssetStatus[] = ['OPERATIONAL', 'NEEDS_MAINTENANCE', 'NON_OPERATIONAL', 'RETIRED'];

export function EquipmentPage({ focus }: { focus?: string }) {
  const { p, L } = useStore();
  const { scope } = useSession();
  const at = new URLSearchParams(location.hash.split('?')[1] ?? '').get('at');
  const assets = [...p.assets.values()]
    .filter((a) => L.inScope(scope, L.hubOfLocation(a.locationId)) || a.asset.id === focus)
    .filter((a) => !at || a.locationId === at)
    .sort((a, b) => a.asset.assetTag.localeCompare(b.asset.assetTag));

  return (
    <>
      <div className="page-head">
        <h1>Equipment custody</h1>
        <span className="sub">Who is accountable, where it was last physically confirmed, and when. {at && <>Showing {L.locationName(at)} only · <a href={href('equipment')}>show all</a></>}</span>
      </div>
      {assets.length === 0 && <Empty>No equipment in this scope.</Empty>}
      {assets.map((a) => <AssetCard key={a.asset.id} a={a} open={a.asset.id === focus} />)}
    </>
  );
}

function AssetCard({ a, open: initiallyOpen }: { a: AssetState; open: boolean }) {
  const { p, L, ref } = useStore();
  const [open, setOpen] = useState(initiallyOpen);
  const ageDays = Math.floor((Date.now() - Date.parse(a.lastConfirmedAt)) / 86_400_000);
  const overdue = ageDays > CONFIRM_OVERDUE_DAYS;
  const cal = a.asset.calibrationDue ? daysBetween(todayUTC(), a.asset.calibrationDue) : undefined;
  const statusTone = a.status === 'OPERATIONAL' ? 'ok' : a.status === 'NEEDS_MAINTENANCE' ? 'warn' : 'bad';

  return (
    <section className={`card asset ${initiallyOpen ? 'focus' : ''}`}>
      <header className="card-head">
        <div>
          <h2>{a.asset.name} <span className="tag">{a.asset.assetTag}</span></h2>
          <span className="sub">{a.asset.manufacturer} {a.asset.model} · S/N {a.asset.serial}</span>
        </div>
        <span className={`badge ${statusTone}`}>{a.status.replace('_', ' ').toLowerCase()}</span>
      </header>
      <dl className="kv">
        <dt>Location</dt><dd>{L.locationName(a.locationId)}</dd>
        <dt>Custodian</dt><dd>{L.personName(a.custodianId)}</dd>
        <dt>Last confirmed</dt>
        <dd><Time iso={a.lastConfirmedAt} /> by {L.personName(a.lastConfirmedBy)} {overdue ? <span className="badge warn">{ageDays} days ago — overdue</span> : <span className="sub">({ageDays} d ago)</span>}</dd>
        <dt>Condition</dt><dd>{a.condition}</dd>
        {cal !== undefined && <><dt>Calibration due</dt><dd>{a.asset.calibrationDue} {cal < 0 ? <span className="badge bad">overdue</span> : cal <= 30 ? <span className="badge warn">in {cal} d</span> : null}</dd></>}
      </dl>
      <button className="btn secondary" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Close' : 'Confirm · reassign · status'}</button>
      {open && <AssetActions a={a} />}
      {open && (
        <details className="sub">
          <summary>Custody history ({a.history.length})</summary>
          <ul className="timeline">
            {[...a.history].reverse().map((id) => {
              const e = p.events.find((x) => x.id === id);
              return e ? <li key={id}><Time iso={e.at} /> — {describeEvent(e, p, L)} <span className="sub">by {L.personName(e.actorId)}</span></li> : null;
            })}
          </ul>
        </details>
      )}
      <span hidden>{ref.locations.length}</span>
    </section>
  );
}

function AssetActions({ a }: { a: AssetState }) {
  const { L, ref } = useStore();
  const { record, outcome, setOutcome, busy } = useRecorder();
  const [loc, setLoc] = useState(a.locationId);
  const [custodian, setCustodian] = useState(a.custodianId ?? '');
  const [status, setStatus] = useState<AssetStatus>(a.status);
  const [condition, setCondition] = useState('');

  const confirm = () => record({ type: 'ASSET_CONFIRM', assetId: a.asset.id, locationId: loc });
  const assign = (e: FormEvent) => { e.preventDefault(); void record({ type: 'ASSET_ASSIGN', assetId: a.asset.id, locationId: loc, custodianId: custodian || undefined }); };
  const setStat = (e: FormEvent) => {
    e.preventDefault();
    if (!condition.trim()) return setOutcome({ ok: false, text: 'Describe the condition.' });
    void record({ type: 'ASSET_STATUS', assetId: a.asset.id, status, condition: condition.trim() }).then((ok) => ok && setCondition(''));
  };

  return (
    <div className="asset-actions">
      <form onSubmit={assign}>
        <Field label="Location">
          <select value={loc} onChange={(e) => setLoc(e.target.value)}>
            {L.hubs().map((h) => (
              <optgroup key={h.id} label={h.name}>
                {ref.locations.filter((l) => L.hubOfLocation(l.id) === h.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <div className="actions-row">
          <button type="button" className="btn primary" disabled={busy} onClick={() => void confirm()}>I can see it here — confirm</button>
        </div>
        <Field label="Custodian">
          <select value={custodian} onChange={(e) => setCustodian(e.target.value)}>
            <option value="">— no individual custodian (held by location) —</option>
            {ref.people.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
          </select>
        </Field>
        <button className="btn" type="submit" disabled={busy}>Reassign</button>
      </form>
      <form onSubmit={setStat}>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as AssetStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
          </select>
        </Field>
        <Field label="Condition"><input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="e.g. Passed functional check" /></Field>
        <button className="btn" type="submit" disabled={busy}>Update status</button>
      </form>
      <OutcomeBanner outcome={outcome} onClose={() => setOutcome(null)} />
    </div>
  );
}
