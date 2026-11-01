import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { qty } from '../../core/ledger';
import { fefoLot } from '../../core/identify';
import type { Lot, UseContext } from '../../core/types';
import { expiryState, todayUTC, unitLabel } from '../model';
import { useStore } from '../store';
import { Field, href, OutcomeBanner, PersonLabel, useRecorder, useSession } from '../ui';

const ACTIONS: [string, string][] = [
  ['issue', 'Issue'],
  ['consume', 'Use'],
  ['waste', 'Waste'],
  ['return', 'Return'],
  ['accept', 'Accept return'],
  ['receive', 'Receive'],
  ['ship', 'Ship transfer'],
  ['transfer-receive', 'Receive transfer'],
];

export function ActPage({ action = 'issue', params }: { action?: string; params: URLSearchParams }) {
  const { actor, actorId, scope } = useSession();
  // Remount the form when the acting person or hub changes so no stale result is shown.
  const key = `${params.toString()}|${actorId}|${scope}`;
  return (
    <>
      <div className="page-head">
        <h1>Transact</h1>
        <span className="sub">Recording as <PersonLabel person={actor} /> — change “Acting as” at the top. Rules are enforced by the ledger, not this form.</span>
      </div>
      <div className="tabs" role="tablist">
        {ACTIONS.map(([a, label]) => (
          <a key={a} role="tab" aria-selected={a === action} className={a === action ? 'tab on' : 'tab'} href={href(`act/${a}`)}>{label}</a>
        ))}
      </div>
      <div className="card form-card" key={action + key}>
        {action === 'issue' && <IssueForm params={params} />}
        {action === 'consume' && <CustodyForm kind="CONSUME" params={params} />}
        {action === 'waste' && <CustodyForm kind="WASTE" params={params} />}
        {action === 'return' && <CustodyForm kind="RETURN" params={params} />}
        {action === 'accept' && <AcceptForm params={params} />}
        {action === 'receive' && <ReceiveForm params={params} />}
        {action === 'ship' && <ShipForm params={params} />}
        {action === 'transfer-receive' && <TransferReceiveForm params={params} />}
      </div>
    </>
  );
}

function useLotLabel() {
  const { p, L } = useStore();
  return (lotId: string, extra = '') => {
    const lot = p.lots.get(lotId);
    if (!lot) return lotId;
    const item = L.items.get(lot.itemId);
    const st = expiryState(lot);
    return `${item?.name} · lot ${lot.lotNumber} · exp ${lot.expiry}${st === 'EXPIRED' ? ' (EXPIRED)' : st === 'SOON' ? ' (expiring)' : ''}${extra}`;
  };
}

function QtyField({ value, onChange, max, unit }: { value: string; onChange: (v: string) => void; max?: number; unit?: string }) {
  return (
    <Field label={`Quantity${unit ? ` (${unitLabel(unit, 2)})` : ''}`} hint={max !== undefined ? `${max} available to this action` : undefined}>
      <input type="number" inputMode="numeric" min={1} step={1} value={value} onChange={(e) => onChange(e.target.value)} required />
    </Field>
  );
}

function WitnessField({ value, onChange, required }: { value: string; onChange: (v: string) => void; required: boolean }) {
  const { ref } = useStore();
  const { actorId, scope } = useSession();
  const { L } = useStore();
  return (
    <Field
      label={`Witness${required ? ' (required)' : ' (optional)'}`}
      hint="POC limitation: the witness is selected, not authenticated. A deployed system must have the witness confirm on their own credentials."
    >
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— none —</option>
        {L.peopleInScope(scope).concat(scope === 'ALL' ? [] : ref.people.filter((x) => !L.hubOfPerson(x.id)))
          .filter((x) => x.id !== actorId)
          .map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
      </select>
    </Field>
  );
}

function Submit({ busy, label }: { busy: boolean; label: string }) {
  return <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : label}</button>;
}

// ------------------------------------------------------------------- issue

function IssueForm({ params }: { params: URLSearchParams }) {
  const { p, L, ref } = useStore();
  const { scope, actorId } = useSession();
  const lotLabel = useLotLabel();
  const { record, outcome, setOutcome, busy } = useRecorder();
  const sources = L.locationsInScope(scope).filter((l) => [...p.lots.keys()].some((id) => qty(p, id, 'AVAILABLE', l.id) > 0));
  const [from, setFrom] = useState(params.get('from') ?? sources[0]?.id ?? '');
  const lotsHere = [...p.lots.values()].filter((l) => qty(p, l.id, 'AVAILABLE', from) > 0).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const [lotId, setLotId] = useState(params.get('lot') ?? '');
  const [n, setN] = useState('1');
  const [to, setTo] = useState(params.get('person') ?? '');
  const [purpose, setPurpose] = useState('');
  const [witness, setWitness] = useState('');
  const lot = p.lots.get(lotId);
  const item = lot && L.items.get(lot.itemId);
  const today = todayUTC();
  const fefo = lot ? fefoLot(p, lot.itemId, from, today) : undefined;
  const people = L.peopleInScope(scope).length ? L.peopleInScope(scope) : ref.people;
  const witnessRequired = !!item?.requiresWitness || to === actorId;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await record({ type: 'ISSUE', lotId, qty: Number(n), fromLocationId: from, toPersonId: to, purpose: purpose.trim() || 'Not stated', witnessId: witness || undefined });
    if (ok) { setN('1'); setWitness(''); }
  };

  return (
    <form onSubmit={submit}>
      <h2>Issue to a person</h2>
      <p className="sub">Moves stock from a location into someone’s custody. Issued is not consumed — they must later record use, waste or return.</p>
      <Field label="From location">
        <select value={from} onChange={(e) => { setFrom(e.target.value); setLotId(''); setOutcome(null); }} required>
          <option value="">— choose —</option>
          {sources.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          {from && !sources.some((s) => s.id === from) && <option value={from}>{L.locationName(from)}</option>}
        </select>
      </Field>
      <Field label="Lot" hint={fefo && lot && fefo.id !== lot.id ? `FEFO: lot ${fefo.lotNumber} expires sooner (${fefo.expiry}) — issue that first unless there is a reason not to.` : undefined}>
        <select value={lotId} onChange={(e) => setLotId(e.target.value)} required>
          <option value="">— choose —</option>
          {lotsHere.map((l) => <option key={l.id} value={l.id}>{lotLabel(l.id, ` · ${qty(p, l.id, 'AVAILABLE', from)} avail`)}</option>)}
          {lotId && !lotsHere.some((l) => l.id === lotId) && <option value={lotId}>{lotLabel(lotId, ' · none available here')}</option>}
        </select>
      </Field>
      <QtyField value={n} onChange={setN} max={lot ? qty(p, lot.id, 'AVAILABLE', from) : undefined} unit={item?.unit} />
      <Field label="Issue to">
        <select value={to} onChange={(e) => setTo(e.target.value)} required>
          <option value="">— choose —</option>
          {people.map((x) => <option key={x.id} value={x.id}>{x.displayName}{x.medicationAuthority ? '' : ' (no med authority)'}</option>)}
        </select>
      </Field>
      <Field label="Purpose"><input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Exercise coverage, kit restock" /></Field>
      <WitnessField value={witness} onChange={setWitness} required={witnessRequired} />
      <Submit busy={busy} label="Record issue" />
      <OutcomeBanner outcome={outcome} onClose={() => setOutcome(null)} />
    </form>
  );
}

// ------------------------------------------------- consume / waste / return

const CONTEXTS: UseContext[] = ['PATIENT_CARE', 'TRAINING', 'EXERCISE', 'TESTING', 'MAINTENANCE'];

function CustodyForm({ kind, params }: { kind: 'CONSUME' | 'WASTE' | 'RETURN'; params: URLSearchParams }) {
  const { p, L } = useStore();
  const { scope, actorId } = useSession();
  const lotLabel = useLotLabel();
  const { record, outcome, setOutcome, busy } = useRecorder();
  const holders = useMemo(() => {
    const ids = new Set<string>();
    for (const [k, v] of p.balances) {
      const [, b, h] = k.split('|');
      if (b === 'CUSTODY' && v > 0 && L.inScope(scope, L.hubOfPerson(h))) ids.add(h);
    }
    return [...ids];
  }, [p, L, scope, p.events.length]);
  const [person, setPerson] = useState(params.get('person') ?? (holders.includes(actorId) ? actorId : holders[0] ?? actorId));
  const held = [...p.lots.values()].filter((l) => qty(p, l.id, 'CUSTODY', person) > 0);
  const [lotId, setLotId] = useState(params.get('lot') ?? '');
  useEffect(() => {
    if (!lotId && held.length === 1) setLotId(held[0].id);
  }, [person]); // eslint-disable-line react-hooks/exhaustive-deps
  const [n, setN] = useState('1');
  const [context, setContext] = useState<UseContext>('PATIENT_CARE');
  const [category, setCategory] = useState('');
  const [encRef, setEncRef] = useState('');
  const [reason, setReason] = useState('');
  const [witness, setWitness] = useState('');
  const [toLoc, setToLoc] = useState(L.people.get(person)?.homeLocationId ?? '');
  const lot = p.lots.get(lotId);
  const item = lot && L.items.get(lot.itemId);
  const refOk = /^[A-Za-z0-9-]{0,24}$/.test(encRef);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const base = { lotId, qty: Number(n), personId: person };
    let ok = false;
    if (kind === 'CONSUME') {
      if (!refOk) return setOutcome({ ok: false, text: 'Encounter reference may only contain letters, digits and dashes — never a name or ID number.' });
      ok = await record({ type: 'CONSUME', ...base, context, encounterCategory: category.trim() || undefined, encounterRef: encRef.trim() || undefined });
    } else if (kind === 'WASTE') {
      if (!reason.trim()) return setOutcome({ ok: false, text: 'A reason is required for waste.' });
      ok = await record({ type: 'WASTE', ...base, reason: reason.trim(), witnessId: witness || undefined });
    } else {
      ok = await record({ type: 'RETURN', ...base, toLocationId: toLoc });
    }
    if (ok) { setN('1'); setEncRef(''); setReason(''); setWitness(''); }
  };

  const title = kind === 'CONSUME' ? 'Record use' : kind === 'WASTE' ? 'Record waste' : 'Return to stock';
  const desc = kind === 'CONSUME'
    ? 'Removes units from someone’s custody because they were used.'
    : kind === 'WASTE' ? 'Removes units from custody that were damaged, contaminated or partially used and discarded.'
    : 'Hands units back. They stay pending — not usable — until someone else inspects and accepts them.';

  return (
    <form onSubmit={submit}>
      <h2>{title}</h2>
      <p className="sub">{desc}</p>
      <Field label="Custodian" hint={person !== actorId ? 'Recording on someone else’s behalf requires a logistics officer role.' : undefined}>
        <select value={person} onChange={(e) => { setPerson(e.target.value); setLotId(''); setToLoc(L.people.get(e.target.value)?.homeLocationId ?? ''); setOutcome(null); }}>
          {!holders.includes(person) && <option value={person}>{L.personName(person)} (nothing in custody)</option>}
          {holders.map((h) => <option key={h} value={h}>{L.personName(h)}</option>)}
        </select>
      </Field>
      <Field label="Lot in custody">
        <select value={lotId} onChange={(e) => setLotId(e.target.value)} required>
          <option value="">— choose —</option>
          {held.map((l: Lot) => <option key={l.id} value={l.id}>{lotLabel(l.id, ` · ${qty(p, l.id, 'CUSTODY', person)} held`)}</option>)}
        </select>
      </Field>
      <QtyField value={n} onChange={setN} max={lot ? qty(p, lot.id, 'CUSTODY', person) : undefined} unit={item?.unit} />
      {kind === 'CONSUME' && (
        <>
          <Field label="Context">
            <select value={context} onChange={(e) => setContext(e.target.value as UseContext)}>
              {CONTEXTS.map((c) => <option key={c} value={c}>{c.replace('_', ' ').toLowerCase()}</option>)}
            </select>
          </Field>
          <Field label="Encounter category (optional)"><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Hemorrhage control" /></Field>
          <Field label="De-identified encounter reference (optional)" hint="Never a name, DoD ID or other identifier. Letters, digits and dashes only.">
            <input value={encRef} onChange={(e) => setEncRef(e.target.value)} placeholder="e.g. ENC-K-0012" aria-invalid={!refOk} />
          </Field>
        </>
      )}
      {kind === 'WASTE' && (
        <>
          <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Partial vial discarded" required /></Field>
          <WitnessField value={witness} onChange={setWitness} required={!!item?.requiresWitness} />
        </>
      )}
      {kind === 'RETURN' && (
        <Field label="Return to location">
          <select value={toLoc} onChange={(e) => setToLoc(e.target.value)} required>
            <option value="">— choose —</option>
            {L.locationsInScope(scope).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
      )}
      <Submit busy={busy} label={title} />
      <OutcomeBanner outcome={outcome} onClose={() => setOutcome(null)} />
    </form>
  );
}

// ----------------------------------------------------------------- accept

function AcceptForm({ params }: { params: URLSearchParams }) {
  const { p, L } = useStore();
  const { scope } = useSession();
  const lotLabel = useLotLabel();
  const { record, outcome, setOutcome, busy } = useRecorder();
  const open = [...p.returns.values()].filter((r) => r.remaining > 0 && L.inScope(scope, L.hubOfLocation(r.locationId)));
  const [rid, setRid] = useState(params.get('return') ?? open[0]?.eventId ?? '');
  const r = p.returns.get(rid);
  const [n, setN] = useState(String(r?.remaining ?? 1));
  const [disp, setDisp] = useState<'AVAILABLE' | 'QUARANTINE'>('AVAILABLE');
  const [note, setNote] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await record({ type: 'RETURN_ACCEPT', returnEventId: rid, qty: Number(n), disposition: disp, note: note.trim() || undefined });
    if (ok) setNote('');
  };

  return (
    <form onSubmit={submit}>
      <h2>Inspect and accept a return</h2>
      <p className="sub">Must be done by someone other than the person who returned it. Accepted units become available again, or go to quarantine.</p>
      {open.length === 0 && !r ? <p className="empty">No returns are waiting in this scope.</p> : (
        <>
          <Field label="Pending return">
            <select value={rid} onChange={(e) => { setRid(e.target.value); setN(String(p.returns.get(e.target.value)?.remaining ?? 1)); setOutcome(null); }} required>
              {open.map((x) => <option key={x.eventId} value={x.eventId}>{x.remaining} × {lotLabel(x.lotId)} — from {L.personName(x.personId)} at {L.locationName(x.locationId)}</option>)}
              {r && r.remaining === 0 && <option value={rid}>Already fully accepted</option>}
            </select>
          </Field>
          <QtyField value={n} onChange={setN} max={r?.remaining} />
          <Field label="Disposition">
            <select value={disp} onChange={(e) => setDisp(e.target.value as 'AVAILABLE' | 'QUARANTINE')}>
              <option value="AVAILABLE">Serviceable — back to available stock</option>
              <option value="QUARANTINE">Questionable — quarantine (not issuable)</option>
            </select>
          </Field>
          <Field label="Inspection note"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Seal intact, within date" /></Field>
          <Submit busy={busy} label="Accept return" />
        </>
      )}
      <OutcomeBanner outcome={outcome} onClose={() => setOutcome(null)} />
    </form>
  );
}

// ---------------------------------------------------------------- receive

function ReceiveForm({ params }: { params: URLSearchParams }) {
  const { p, L, ref } = useStore();
  const { scope } = useSession();
  const { record, outcome, setOutcome, busy } = useRecorder();
  const [itemId, setItemId] = useState(params.get('item') ?? '');
  const [lotNumber, setLotNumber] = useState(params.get('lot') ?? '');
  const [expiry, setExpiry] = useState(params.get('exp') ?? '');
  const [serial] = useState(params.get('serial') ?? '');
  const [n, setN] = useState('1');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [source, setSource] = useState('');
  const item = L.items.get(itemId);
  const existing = [...p.lots.values()].find((l) => l.itemId === itemId && l.lotNumber === lotNumber.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const lot = existing ?? {
      id: `lot-${(crypto.randomUUID?.() ?? String(Date.now())).slice(0, 13)}`,
      itemId, lotNumber: lotNumber.trim(), expiry, gtin: item?.gtin, serial: serial || undefined,
    };
    await record({ type: 'RECEIVE', lot, qty: Number(n), toLocationId: to, source: source.trim() || 'Not stated' });
  };

  return (
    <form onSubmit={submit}>
      <h2>Receive stock</h2>
      <p className="sub">Records new stock arriving from a supplier. Scanning a GS1 barcode with an unknown lot opens this form prefilled.</p>
      <Field label="Item">
        <select value={itemId} onChange={(e) => { setItemId(e.target.value); setOutcome(null); }} required>
          <option value="">— choose —</option>
          {ref.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </Field>
      <Field label="Lot number" hint={existing ? `Lot already known (exp ${existing.expiry}); this adds to it.` : undefined}>
        <input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} required />
      </Field>
      <Field label="Expiration date">
        <input type="date" value={existing?.expiry ?? expiry} onChange={(e) => setExpiry(e.target.value)} disabled={!!existing} required />
      </Field>
      <QtyField value={n} onChange={setN} unit={item?.unit} />
      <Field label="Into location">
        <select value={to} onChange={(e) => setTo(e.target.value)} required>
          <option value="">— choose —</option>
          {L.locationsInScope(scope).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
      <Field label="Source / shipment reference"><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. PO-2291" /></Field>
      <Submit busy={busy} label="Record receipt" />
      <OutcomeBanner outcome={outcome} onClose={() => setOutcome(null)} />
    </form>
  );
}

// -------------------------------------------------------------- transfers

function ShipForm({ params }: { params: URLSearchParams }) {
  const { p, L, ref } = useStore();
  const { scope } = useSession();
  const lotLabel = useLotLabel();
  const { record, outcome, setOutcome, busy } = useRecorder();
  const sources = L.locationsInScope(scope).filter((l) => [...p.lots.keys()].some((id) => qty(p, id, 'AVAILABLE', l.id) > 0));
  const [from, setFrom] = useState(params.get('from') ?? sources[0]?.id ?? '');
  const lotsHere = [...p.lots.values()].filter((l) => qty(p, l.id, 'AVAILABLE', from) > 0).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const [lotId, setLotId] = useState(params.get('lot') ?? '');
  const [n, setN] = useState('1');
  const [to, setTo] = useState('');
  const lot = p.lots.get(lotId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await record({ type: 'TRANSFER_SHIP', lotId, qty: Number(n), fromLocationId: from, toLocationId: to });
  };

  return (
    <form onSubmit={submit}>
      <h2>Ship a transfer</h2>
      <p className="sub">Between hubs (Hawaii ⇄ Germany) or from a hub to a site. Stock is in transit until someone at the destination receives it.</p>
      <Field label="From">
        <select value={from} onChange={(e) => { setFrom(e.target.value); setLotId(''); setOutcome(null); }} required>
          <option value="">— choose —</option>
          {sources.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
      <Field label="Lot">
        <select value={lotId} onChange={(e) => setLotId(e.target.value)} required>
          <option value="">— choose —</option>
          {lotsHere.map((l) => <option key={l.id} value={l.id}>{lotLabel(l.id, ` · ${qty(p, l.id, 'AVAILABLE', from)} avail`)}</option>)}
        </select>
      </Field>
      <QtyField value={n} onChange={setN} max={lot ? qty(p, lot.id, 'AVAILABLE', from) : undefined} />
      <Field label="To (any hub or site)">
        <select value={to} onChange={(e) => setTo(e.target.value)} required>
          <option value="">— choose —</option>
          {L.hubs().map((h) => (
            <optgroup key={h.id} label={h.name}>
              {ref.locations.filter((l) => L.hubOfLocation(l.id) === h.id && l.id !== from).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      <Submit busy={busy} label="Record shipment" />
      <OutcomeBanner outcome={outcome} onClose={() => setOutcome(null)} />
    </form>
  );
}

function TransferReceiveForm({ params }: { params: URLSearchParams }) {
  const { p, L } = useStore();
  const { scope } = useSession();
  const lotLabel = useLotLabel();
  const { record, outcome, setOutcome, busy } = useRecorder();
  const open = [...p.shipments.values()].filter((s) => s.remaining > 0 && L.inScope(scope, L.hubOfLocation(s.toLocationId)));
  const [sid, setSid] = useState(params.get('ship') ?? open[0]?.eventId ?? '');
  const s = p.shipments.get(sid);
  const [n, setN] = useState(String(s?.remaining ?? 0));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await record({ type: 'TRANSFER_RECEIVE', shipEventId: sid, qtyReceived: Number(n) });
  };

  return (
    <form onSubmit={submit}>
      <h2>Receive a transfer</h2>
      <p className="sub">Count what physically arrived. Anything short is recorded as missing at the destination — never silently dropped. The shipper cannot receive their own shipment.</p>
      {open.length === 0 && !s ? <p className="empty">No shipments are inbound to this scope.</p> : (
        <>
          <Field label="Inbound shipment">
            <select value={sid} onChange={(e) => { setSid(e.target.value); setN(String(p.shipments.get(e.target.value)?.remaining ?? 0)); setOutcome(null); }} required>
              {open.map((x) => <option key={x.eventId} value={x.eventId}>{x.remaining} × {lotLabel(x.lotId)} — {L.locationName(x.fromLocationId)} → {L.locationName(x.toLocationId)}</option>)}
              {s && s.remaining === 0 && <option value={sid}>Already received</option>}
            </select>
          </Field>
          <Field label="Quantity counted on arrival" hint={s ? `${s.remaining} shipped` : undefined}>
            <input type="number" inputMode="numeric" min={0} step={1} value={n} onChange={(e) => setN(e.target.value)} required />
          </Field>
          <Submit busy={busy} label="Record receipt" />
        </>
      )}
      <OutcomeBanner outcome={outcome} onClose={() => setOutcome(null)} />
    </form>
  );
}
