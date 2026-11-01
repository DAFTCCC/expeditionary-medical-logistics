import { useState } from 'react';
import { store, useStore } from '../store';
import { Section, Time } from '../ui';

export function AboutPage() {
  const s = useStore();
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    if (!window.confirm('Erase everything recorded in this browser and reload the fictional demo data?')) return;
    setBusy(true);
    await store.reset();
    setBusy(false);
    location.hash = '#/';
  };
  const download = () => {
    const blob = new Blob([store.exportLedger()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fieldline-ledger-${s.deviceId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="page-head"><h1>About this demo</h1></div>
      <Section title="What this is">
        <p>FieldLine is a proof of concept for offline-first medical logistics across two hubs — <strong>Hawaii</strong> and <strong>Germany</strong> — and the teams they support. Every quantity on screen is computed from an append-only ledger of transactions; nothing stores a count that could drift.</p>
        <p><strong>All data is fictional.</strong> Do not enter real patient information, real medication records, names, ID numbers or deployment details. Data stays in this browser only.</p>
        <dl className="kv">
          <dt>Device</dt><dd><code>{s.deviceId}</code></dd>
          <dt>Storage</dt><dd>{s.persistent ? 'IndexedDB in this browser' : 'Memory only — will be lost on close'}</dd>
          <dt>Ledger events</dt><dd>{s.p.events.length}</dd>
          {s.seededAt && <><dt>Demo data loaded</dt><dd><Time iso={s.seededAt} /></dd></>}
        </dl>
        <div className="actions-row">
          <button className="btn secondary" onClick={download}>Export ledger (JSON)</button>
          <button className="btn danger" onClick={() => void reset()} disabled={busy}>{busy ? 'Resetting…' : 'Reset demo data'}</button>
        </div>
      </Section>
      <Section title="Not in this proof of concept">
        <ul className="list">
          <li>No server, sign-in or synchronization between devices. “Acting as” is a demo switch, not authentication.</li>
          <li>Witnesses are selected, not authenticated.</li>
          <li>Roles apply across both hubs; per-hub permissions are not enforced yet.</li>
          <li>No offline installation (service worker) yet — the page must be loaded once with a connection, and a cleared browser cache loses it.</li>
          <li>Quarantine, disposal and discrepancy have ledger support but no screens yet.</li>
          <li>Package conversions (box → vial) are not modeled.</li>
          <li>No compliance claim of any kind (see ADR-008 for items flagged for review, including GDPR and German/EU medicines rules).</li>
        </ul>
      </Section>
    </>
  );
}
