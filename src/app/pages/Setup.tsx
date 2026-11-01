import { useState, type FormEvent, type ReactElement } from 'react';
import { ROLE_LABEL } from '../../core/permissions';
import type { CatalogItem, ItemCategory, Location, LocationKind, Person, Role } from '../../core/types';
import { normalizeGtin, referencedIds, shortId } from '../reference';
import { store, useStore } from '../store';
import { Empty, Field, href, OutcomeBanner, Section, useRecorder, useSession, type Outcome } from '../ui';

type Tab = 'items' | 'locations' | 'people' | 'equipment';
const TABS: [Tab, string][] = [['items', 'Items'], ['locations', 'Locations'], ['people', 'People'], ['equipment', 'Register equipment']];

const KIND_LABEL: Record<LocationKind, string> = { HUB: 'Hub', STORAGE: 'Storage area', DEPLOYMENT_SITE: 'Deployment site', KIT: 'Kit / bag' };
const ZONES = ['Pacific/Honolulu', 'Europe/Berlin', 'UTC', 'America/Los_Angeles', 'America/New_York', 'Asia/Tokyo', 'Asia/Seoul', 'Pacific/Guam', 'Australia/Sydney', 'Europe/London'];

export function SetupPage({ params }: { params: URLSearchParams }) {
  const tab = (params.get('tab') as Tab) || 'items';
  const { mode, ref } = useStore();
  return (
    <>
      <div className="page-head">
        <h1>Setup</h1>
        <span className="sub">Your catalog, locations and people. Changes apply going forward; recorded transactions are never rewritten.</span>
      </div>
      {mode === 'demo' && (
        <div className="banner info"><strong>Demo data</strong><span>You are editing the fictional demo. To set up your own field test from scratch, use <a href={href('about')}>About → Start my own field test</a>.</span></div>
      )}
      {mode === 'own' && ref.items.length === 0 && (
        <div className="banner info"><strong>Getting started</strong><span>1. Add storage areas, sites and kits under each hub. 2. Add your team. 3. Add the items you track. 4. Receive stock (Transact → Receive) and register equipment.</span></div>
      )}
      <div className="tabs" role="tablist">
        {TABS.map(([t, label]) => <a key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'tab on' : 'tab'} href={href('setup', { tab: t })}>{label}</a>)}
      </div>
      {tab === 'items' && <ItemsTab />}
      {tab === 'locations' && <LocationsTab />}
      {tab === 'people' && <PeopleTab />}
      {tab === 'equipment' && <EquipmentTab />}
    </>
  );
}

function useSaver() {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const save = async (mutate: (r: ReturnType<typeof store.getSnapshot>['ref']) => ReturnType<typeof store.getSnapshot>['ref'], okText: string) => {
    const err = await store.saveReference(mutate(store.getSnapshot().ref));
    setOutcome(err ? { ok: false, text: err } : { ok: true, text: okText, event: undefined as never });
    return !err;
  };
  return { save, outcome, setOutcome };
}

function Saved({ outcome, onClose }: { outcome: Outcome; onClose: () => void }) {
  if (!outcome) return null;
  return (
    <div className={`banner ${outcome.ok ? 'ok' : 'bad'}`} role={outcome.ok ? 'status' : 'alert'}>
      <strong>{outcome.ok ? 'Saved' : 'Not saved'}</strong><span>{outcome.text}</span>
      <button className="link" onClick={onClose}>Dismiss</button>
    </div>
  );
}

// ------------------------------------------------------------------- items

function ItemsTab() {
  const { ref, p } = useStore();
  const used = referencedIds(p.events).items;
  const [edit, setEdit] = useState<CatalogItem | 'new' | null>(null);
  const { save, outcome, setOutcome } = useSaver();
  const remove = (i: CatalogItem) => {
    if (!window.confirm(`Remove ${i.name} from the catalog?`)) return;
    void save((r) => ({ ...r, items: r.items.filter((x) => x.id !== i.id) }), `${i.name} removed.`);
  };
  return (
    <div className="grid2">
      <Section title={`Catalog (${ref.items.length})`} actions={<button className="btn small" onClick={() => setEdit('new')}>Add item</button>}>
        {ref.items.length === 0 ? <Empty>No items yet.</Empty> : (
          <ul className="list">
            {ref.items.map((i) => (
              <li key={i.id}>
                <strong>{i.name}</strong> <span className="sub">{i.category === 'MEDICATION' ? 'medication' : 'consumable'} · {i.unit} · reorder {i.reorderPoint}{i.requiresWitness ? ' · witness' : ''}{i.gtin ? ` · ${i.gtin}` : ''}</span>{' '}
                <button className="link" onClick={() => { setEdit(i); setOutcome(null); }}>Edit</button>{' '}
                {!used.has(i.id) && <button className="link danger" onClick={() => remove(i)}>Remove</button>}
              </li>
            ))}
          </ul>
        )}
        <Saved outcome={outcome} onClose={() => setOutcome(null)} />
      </Section>
      {edit && <ItemForm key={edit === 'new' ? 'new' : edit.id} item={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} save={save} />}
    </div>
  );
}

function ItemForm({ item, onDone, save }: { item?: CatalogItem; onDone: () => void; save: ReturnType<typeof useSaver>['save'] }) {
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState<ItemCategory>(item?.category ?? 'CONSUMABLE');
  const [unit, setUnit] = useState(item?.unit ?? 'each');
  const [reorder, setReorder] = useState(String(item?.reorderPoint ?? 0));
  const [witness, setWitness] = useState(item?.requiresWitness ?? false);
  const [gtin, setGtin] = useState(item?.gtin ?? '');
  const [form, setForm] = useState(item?.form ?? '');
  const [storage, setStorage] = useState(item?.storage ?? '');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    const g = normalizeGtin(gtin);
    if ('error' in g) return setErr(g.error);
    const next: CatalogItem = {
      ...(item ?? { id: shortId('itm') }), name: name.trim(), category, unit: unit.trim(), reorderPoint: Number(reorder),
      requiresWitness: witness, gtin: g.gtin, form: form.trim() || undefined, storage: storage.trim() || undefined,
    };
    const ok = await save((r) => ({ ...r, items: item ? r.items.map((x) => (x.id === item.id ? next : x)) : [...r.items, next] }), `${next.name} ${item ? 'updated' : 'added'}.`);
    if (ok) onDone();
  };
  return (
    <Section title={item ? `Edit ${item.name}` : 'Add item'}>
      <form onSubmit={submit}>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tourniquet, windlass" required /></Field>
        <Field label="Type" hint="Medications can only be handled by people with medication authority.">
          <select value={category} onChange={(e) => setCategory(e.target.value as ItemCategory)}>
            <option value="CONSUMABLE">Consumable / supply</option>
            <option value="MEDICATION">Medication</option>
          </select>
        </Field>
        <Field label="Counted in" hint="The unit every quantity is counted in: vial, each, box, kit…"><input value={unit} onChange={(e) => setUnit(e.target.value)} required /></Field>
        <Field label="Reorder point (per hub)"><input type="number" min={0} step={1} inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} required /></Field>
        <label className="check-row"><input type="checkbox" checked={witness} onChange={(e) => setWitness(e.target.checked)} /> Requires a witness to issue, waste or dispose</label>
        <Field label="Product barcode (optional)" hint="GTIN / UPC / EAN from the package, so scanning the box finds this item."><input value={gtin} onChange={(e) => setGtin(e.target.value)} inputMode="numeric" /></Field>
        <Field label="Package / form (optional)"><input value={form} onChange={(e) => setForm(e.target.value)} placeholder="e.g. 10 mL vial" /></Field>
        <Field label="Storage note (optional)"><input value={storage} onChange={(e) => setStorage(e.target.value)} placeholder="e.g. Keep dry" /></Field>
        {err && <div className="banner bad"><span>{err}</span></div>}
        <div className="actions-row"><button className="btn primary" type="submit">{item ? 'Save changes' : 'Add item'}</button><button className="btn secondary" type="button" onClick={onDone}>Cancel</button></div>
      </form>
    </Section>
  );
}

// --------------------------------------------------------------- locations

function LocationsTab() {
  const { ref, p, L } = useStore();
  const used = referencedIds(p.events).locations;
  const [edit, setEdit] = useState<Location | 'new' | null>(null);
  const { save, outcome, setOutcome } = useSaver();
  const remove = (l: Location) => {
    if (!window.confirm(`Remove ${l.name}?`)) return;
    void save((r) => ({ ...r, locations: r.locations.filter((x) => x.id !== l.id) }), `${l.name} removed.`);
  };
  const tree = (parent: string | undefined, depth: number): ReactElement[] =>
    ref.locations.filter((l) => l.parentId === parent).flatMap((l) => [
      <li key={l.id} style={{ paddingLeft: depth * 18 }}>
        <strong>{l.name}</strong> <span className="sub">{KIND_LABEL[l.kind]}{l.timeZone ? ` · ${l.timeZone}` : ''}{l.custodianId ? ` · custodian ${L.personName(l.custodianId)}` : ''}</span>{' '}
        <button className="link" onClick={() => { setEdit(l); setOutcome(null); }}>Edit</button>{' '}
        {!used.has(l.id) && !ref.locations.some((c) => c.parentId === l.id) && !ref.people.some((x) => x.homeLocationId === l.id) && <button className="link danger" onClick={() => remove(l)}>Remove</button>}
      </li>,
      ...tree(l.id, depth + 1),
    ]);
  return (
    <div className="grid2">
      <Section title={`Locations (${ref.locations.length})`} actions={<button className="btn small" onClick={() => setEdit('new')}>Add location</button>}>
        <ul className="list">{tree(undefined, 0)}</ul>
        <Saved outcome={outcome} onClose={() => setOutcome(null)} />
      </Section>
      {edit && <LocationForm key={edit === 'new' ? 'new' : edit.id} loc={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} save={save} />}
    </div>
  );
}

function LocationForm({ loc, onDone, save }: { loc?: Location; onDone: () => void; save: ReturnType<typeof useSaver>['save'] }) {
  const { ref } = useStore();
  const [name, setName] = useState(loc?.name ?? '');
  const [kind, setKind] = useState<LocationKind>(loc?.kind ?? 'STORAGE');
  const [parent, setParent] = useState(loc?.parentId ?? ref.locations.find((l) => l.kind === 'HUB')?.id ?? '');
  const [tz, setTz] = useState(loc?.timeZone ?? '');
  const [custodian, setCustodian] = useState(loc?.custodianId ?? '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Location = {
      ...(loc ?? { id: shortId('loc') }), name: name.trim(), kind,
      parentId: kind === 'HUB' ? undefined : parent, timeZone: kind === 'HUB' ? tz.trim() || undefined : undefined, custodianId: custodian || undefined,
    };
    const ok = await save((r) => ({ ...r, locations: loc ? r.locations.map((x) => (x.id === loc.id ? next : x)) : [...r.locations, next] }), `${next.name} ${loc ? 'updated' : 'added'}.`);
    if (ok) onDone();
  };
  return (
    <Section title={loc ? `Edit ${loc.name}` : 'Add location'}>
      <form onSubmit={submit}>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bay 2, shelf C" required /></Field>
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
            {(Object.keys(KIND_LABEL) as LocationKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        {kind === 'HUB' ? (
          <Field label="Time zone" hint="Times on this hub's screens are shown in this zone.">
            <input list="zones" value={tz} onChange={(e) => setTz(e.target.value)} placeholder="e.g. Pacific/Honolulu" />
            <datalist id="zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
          </Field>
        ) : (
          <Field label="Inside">
            <select value={parent} onChange={(e) => setParent(e.target.value)} required>
              <option value="">— choose —</option>
              {ref.locations.filter((l) => l.id !== loc?.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Accountable custodian (optional)">
          <select value={custodian} onChange={(e) => setCustodian(e.target.value)}>
            <option value="">— none —</option>
            {ref.people.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
          </select>
        </Field>
        <div className="actions-row"><button className="btn primary" type="submit">{loc ? 'Save changes' : 'Add location'}</button><button className="btn secondary" type="button" onClick={onDone}>Cancel</button></div>
      </form>
    </Section>
  );
}

// ------------------------------------------------------------------ people

const ROLES: Role[] = ['HUB_LOGISTICS_MANAGER', 'DEPLOYMENT_LOGISTICS_OFFICER', 'MEDICAL_PROVIDER', 'TEAM_MEMBER', 'ENTERPRISE_ADMIN', 'ANALYST', 'AUDITOR'];

function PeopleTab() {
  const { ref, p, L } = useStore();
  const used = referencedIds(p.events).people;
  const [edit, setEdit] = useState<Person | 'new' | null>(null);
  const { save, outcome, setOutcome } = useSaver();
  const remove = (x: Person) => {
    if (!window.confirm(`Remove ${x.displayName}?`)) return;
    void save((r) => ({ ...r, people: r.people.filter((y) => y.id !== x.id) }), `${x.displayName} removed.`);
  };
  return (
    <div className="grid2">
      <Section title={`People (${ref.people.length})`} actions={<button className="btn small" onClick={() => setEdit('new')}>Add person</button>}>
        <p className="sub">Logistics roles only — no personal identifiers are needed. A display name like “SSgt Lee” or “Pharmacy tech 2” is enough.</p>
        <ul className="list">
          {ref.people.map((x) => (
            <li key={x.id}>
              <strong>{x.displayName}</strong> <span className="sub">{ROLE_LABEL[x.role]}{x.medicationAuthority ? ' · med authority' : ''} · {L.locationName(x.homeLocationId)}</span>{' '}
              <button className="link" onClick={() => { setEdit(x); setOutcome(null); }}>Edit</button>{' '}
              {!used.has(x.id) && ref.people.length > 1 && <button className="link danger" onClick={() => remove(x)}>Remove</button>}
            </li>
          ))}
        </ul>
        <Saved outcome={outcome} onClose={() => setOutcome(null)} />
      </Section>
      {edit && <PersonForm key={edit === 'new' ? 'new' : edit.id} person={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} save={save} />}
    </div>
  );
}

function PersonForm({ person, onDone, save }: { person?: Person; onDone: () => void; save: ReturnType<typeof useSaver>['save'] }) {
  const { ref } = useStore();
  const [name, setName] = useState(person?.displayName ?? '');
  const [role, setRole] = useState<Role>(person?.role ?? 'TEAM_MEMBER');
  const [med, setMed] = useState(person?.medicationAuthority ?? false);
  const [home, setHome] = useState(person?.homeLocationId ?? ref.locations.find((l) => l.kind === 'HUB')?.id ?? '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Person = { ...(person ?? { id: shortId('per') }), displayName: name.trim(), role, medicationAuthority: med, homeLocationId: home || undefined };
    const ok = await save((r) => ({ ...r, people: person ? r.people.map((x) => (x.id === person.id ? next : x)) : [...r.people, next] }), `${next.displayName} ${person ? 'updated' : 'added'}.`);
    if (ok) onDone();
  };
  return (
    <Section title={person ? `Edit ${person.displayName}` : 'Add person'}>
      <form onSubmit={submit}>
        <Field label="Display name"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Role" hint="Decides which transactions they may record.">
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        </Field>
        <label className="check-row"><input type="checkbox" checked={med} onChange={(e) => setMed(e.target.checked)} /> Medication-handling authority</label>
        <Field label="Works from" hint="Puts them under a hub for the hub views.">
          <select value={home} onChange={(e) => setHome(e.target.value)}>
            <option value="">— enterprise (no hub) —</option>
            {ref.locations.filter((l) => l.kind === 'HUB' || l.kind === 'DEPLOYMENT_SITE').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <div className="actions-row"><button className="btn primary" type="submit">{person ? 'Save changes' : 'Add person'}</button><button className="btn secondary" type="button" onClick={onDone}>Cancel</button></div>
      </form>
    </Section>
  );
}

// --------------------------------------------------------------- equipment

function EquipmentTab() {
  const { ref, L } = useStore();
  const { scope } = useSession();
  const { record, outcome, setOutcome, busy } = useRecorder();
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [tag, setTag] = useState('');
  const [cal, setCal] = useState('');
  const [loc, setLoc] = useState('');
  const [custodian, setCustodian] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = shortId('ast');
    const ok = await record({
      type: 'ASSET_REGISTER', locationId: loc, custodianId: custodian || undefined,
      asset: { id, name: name.trim(), manufacturer: manufacturer.trim() || 'Unknown', model: model.trim() || '—', serial: serial.trim(), assetTag: tag.trim() || serial.trim(), calibrationDue: cal || undefined },
    });
    if (ok) { setName(''); setSerial(''); setTag(''); setModel(''); setCal(''); }
  };
  return (
    <div className="card form-card">
      <form onSubmit={submit}>
        <h2>Register equipment</h2>
        <p className="sub">Recorded in the ledger. If it has no asset tag, register it, then print a FieldLine label for it from Labels.</p>
        <Field label="What is it"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monitor/defibrillator" required /></Field>
        <Field label="Manufacturer"><input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} /></Field>
        <Field label="Model"><input value={model} onChange={(e) => setModel(e.target.value)} /></Field>
        <Field label="Serial number" hint="You can scan it with a handheld scanner into this box."><input value={serial} onChange={(e) => setSerial(e.target.value)} autoCapitalize="characters" required /></Field>
        <Field label="Asset tag (optional)" hint="Leave blank to use the serial number."><input value={tag} onChange={(e) => setTag(e.target.value)} autoCapitalize="characters" /></Field>
        <Field label="Calibration / service due (optional)"><input type="date" value={cal} onChange={(e) => setCal(e.target.value)} /></Field>
        <Field label="Location">
          <select value={loc} onChange={(e) => setLoc(e.target.value)} required>
            <option value="">— choose —</option>
            {L.locationsInScope(scope).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Custodian (optional)">
          <select value={custodian} onChange={(e) => setCustodian(e.target.value)}>
            <option value="">— held by the location —</option>
            {ref.people.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
          </select>
        </Field>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Register'}</button>
        <OutcomeBanner outcome={outcome} onClose={() => setOutcome(null)} />
      </form>
    </div>
  );
}
