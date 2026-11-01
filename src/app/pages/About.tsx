import { useState, type FormEvent } from 'react';
import { useOffline } from '../offline';
import { store, useStore } from '../store';
import { Field, Section, Time } from '../ui';

export function AboutPage() {
  const s = useStore();
  const off = useOffline();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reset = async () => {
    if (!window.confirm('Erase everything on this device and load the fictional demo data? Export a backup first if you need it.')) return;
    setBusy(true);
    await store.reset();
    setBusy(false);
    location.hash = '#/';
  };
  const download = () => {
    const blob = new Blob([store.exportLedger()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fieldline-${s.mode === 'demo' ? 'demo' : 'backup'}-${s.deviceId}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const restore = async (f: File | undefined) => {
    if (!f) return;
    if (!window.confirm(`Replace everything on this device with the contents of ${f.name}?`)) return;
    setBusy(true);
    const err = await store.importLedger(await f.text());
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: `Restored from ${f.name}.` });
  };

  return (
    <>
      <div className="page-head"><h1>About &amp; data</h1></div>

      <Section title="This device">
        <dl className="kv">
          <dt>Data</dt><dd>{s.mode === 'demo' ? 'Fictional demo data' : 'Your own field-test data'}</dd>
          <dt>Device</dt><dd><code>{s.deviceId}</code></dd>
          <dt>Storage</dt><dd>{s.persistent ? 'Saved on this device (IndexedDB)' : 'Memory only — will be lost on close'}</dd>
          <dt>Offline</dt><dd>{off.sw === 'ready' ? 'Ready — works with no connection' : off.sw === 'unsupported' ? 'Not supported by this browser' : off.sw === 'error' ? `Setup failed: ${off.error}` : off.sw === 'update' ? 'Update downloaded — reload to apply' : 'Preparing…'}</dd>
          <dt>Ledger events</dt><dd>{s.p.events.length}</dd>
          {s.seededAt && <><dt>Dataset started</dt><dd><Time iso={s.seededAt} /></dd></>}
        </dl>
        <div className="actions-row">
          <button className="btn" onClick={download}>Export backup (JSON)</button>
          <label className="btn secondary file-btn">
            Restore from backup
            <input type="file" accept="application/json,.json" disabled={busy} onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <p className="hint">There is no sync between devices yet. Export a backup regularly — clearing the browser's site data deletes everything on this device. A backup restored on another device replaces what is there.</p>
        {msg && <div className={`banner ${msg.ok ? 'ok' : 'bad'}`}><span>{msg.text}</span></div>}
      </Section>

      <StartOwn />

      <Section title="Install on a phone or tablet">
        <ul className="list">
          <li><strong>iPhone / iPad (Safari):</strong> Share → Add to Home Screen.</li>
          <li><strong>Android (Chrome):</strong> menu ⋮ → Install app (or Add to Home screen).</li>
          <li>Open it once with a connection; after that it opens and scans with no signal. When an update downloads, a “Reload now” bar appears — your records are kept.</li>
        </ul>
      </Section>

      <Section title="Not in this version">
        <ul className="list">
          <li>No server, sign-in or sync between devices. “Acting as” is a switch, not a login — anyone holding the device can act as anyone.</li>
          <li>Witnesses are selected, not authenticated.</li>
          <li>Roles apply across both hubs; per-hub permissions are not enforced.</li>
          <li>Package conversions (box → vial) are not modeled; count in one unit per item.</li>
          <li>For logistics data only. Never record patient information. No compliance claim of any kind (see ADR-008).</li>
        </ul>
        <div className="actions-row">
          <button className="btn danger" onClick={() => void reset()} disabled={busy}>{busy ? 'Working…' : 'Erase and load demo data'}</button>
        </div>
      </Section>
    </>
  );
}

function StartOwn() {
  const s = useStore();
  const [name, setName] = useState('');
  const [hubs, setHubs] = useState([
    { on: true, name: 'Hawaii Hub', timeZone: 'Pacific/Honolulu' },
    { on: true, name: 'Germany Hub', timeZone: 'Europe/Berlin' },
  ]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!window.confirm(`Erase everything on this device${s.mode === 'own' ? ' (including your current field-test data — export a backup first)' : ''} and start an empty field test?`)) return;
    setBusy(true);
    const r = await store.startBlank({ yourName: name, hubs: hubs.filter((h) => h.on) });
    setBusy(false);
    if (r) setErr(r);
    else location.hash = '#/setup?tab=locations';
  };
  const upd = (i: number, patch: Partial<(typeof hubs)[number]>) => setHubs(hubs.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  return (
    <Section title="Start my own field test">
      <p>Clears this device and gives you an empty system with your hubs and you as Hub Logistics Manager. Then add locations, people and items under Setup, and start receiving stock.</p>
      <form onSubmit={submit}>
        <Field label="Your display name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Logistics lead" required /></Field>
        <div className="hub-rows">
          {hubs.map((h, i) => (
            <div key={i} className="hub-row">
              <input type="checkbox" checked={h.on} onChange={(e) => upd(i, { on: e.target.checked })} aria-label={`Include ${h.name}`} style={{ width: 22, height: 22, minHeight: 0 }} />
              <input value={h.name} onChange={(e) => upd(i, { name: e.target.value })} aria-label="Hub name" />
              <input value={h.timeZone} onChange={(e) => upd(i, { timeZone: e.target.value })} aria-label="Hub time zone" />
            </div>
          ))}
        </div>
        {err && <div className="banner bad"><span>{err}</span></div>}
        <button className="btn primary" type="submit" disabled={busy || !hubs.some((h) => h.on)}>{busy ? 'Starting…' : 'Erase this device and start'}</button>
      </form>
    </Section>
  );
}
