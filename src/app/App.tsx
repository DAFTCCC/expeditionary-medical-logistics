import { ROLE_LABEL } from '../core/permissions';
import { useStore } from './store';
import { applyUpdate, useOffline } from './offline';
import { href, useRoute, useSession } from './ui';
import { DashboardPage } from './pages/Dashboard';
import { InventoryPage, LotPage } from './pages/Inventory';
import { ScanPage } from './pages/Scan';
import { ActPage } from './pages/Act';
import { EquipmentPage } from './pages/Equipment';
import { LabelsPage } from './pages/Labels';
import { HistoryPage } from './pages/History';
import { AboutPage } from './pages/About';
import { SetupPage } from './pages/Setup';
import { lazy, Suspense } from 'react';
const MapPage = lazy(() => import('./pages/Map').then((m) => ({ default: m.MapPage })));

const NAV: [string, string][] = [
  ['', 'Dashboard'],
  ['inventory', 'Inventory'],
  ['map', 'Map'],
  ['scan', 'Scan'],
  ['act', 'Transact'],
  ['equipment', 'Equipment'],
  ['labels', 'Labels'],
  ['history', 'History'],
  ['setup', 'Setup'],
  ['about', 'About'],
];

const OFFLINE_TEXT: Record<string, string> = {
  ready: 'works offline ✓', installing: 'preparing offline use…', update: 'update ready', unsupported: 'offline not supported by this browser',
  dev: 'dev mode (no offline cache)', error: 'offline setup failed',
};

export function App() {
  const s = useStore();
  const off = useOffline();
  const { path, params } = useRoute();
  const { actorId, setActorId, scope, setScope, actor } = useSession();
  const top = path[0] ?? '';

  if (!s.ready) return <div className="loading">Loading ledger…</div>;

  let page;
  switch (top) {
    case '': page = <DashboardPage />; break;
    case 'inventory': page = <InventoryPage />; break;
    case 'lot': page = <LotPage lotId={path[1] ?? ''} />; break;
    case 'scan': page = <ScanPage />; break;
    case 'act': page = <ActPage action={path[1]} params={params} />; break;
    case 'equipment': page = <EquipmentPage focus={params.get('asset') ?? undefined} />; break;
    case 'labels': page = <LabelsPage params={params} />; break;
    case 'history': page = <HistoryPage params={params} />; break;
    case 'map': page = <Suspense fallback={<p className="empty">Loading map…</p>}><MapPage /></Suspense>; break;
    case 'setup': page = <SetupPage params={params} />; break;
    case 'about': page = <AboutPage />; break;
    default: page = <p className="empty">Page not found. <a href="#/">Go to the dashboard</a>.</p>;
  }

  return (
    <div className="shell">
      {s.mode === 'demo'
        ? <div className="demo-strip" role="note">DEMONSTRATION · all people, places, lots and codes are fictional · data stays in this browser</div>
        : <div className="demo-strip own" role="note">FIELD TEST · logistics data only — never patient information · stored on this device only, no sync</div>}
      <header className="topbar">
        <a className="brand" href="#/"><span className="mark" aria-hidden>F</span>FieldLine</a>
        <div className="controls">
          <label>
            <span>Hub</span>
            <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Hub scope">
              <option value="ALL">Enterprise — both hubs</option>
              {s.L.hubs().map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
          <label>
            <span>Acting as</span>
            <select value={actorId} onChange={(e) => setActorId(e.target.value)} aria-label="Acting as">
              {s.L.hubs().map((h) => (
                <optgroup key={h.id} label={h.name}>
                  {s.ref.people.filter((p) => s.L.hubOfPerson(p.id) === h.id).map((p) => (
                    <option key={p.id} value={p.id}>{p.displayName} — {ROLE_LABEL[p.role]}</option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="Enterprise">
                {s.ref.people.filter((p) => !s.L.hubOfPerson(p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName} — {ROLE_LABEL[p.role]}</option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>
      </header>
      <nav className="nav" aria-label="Main">
        {NAV.map(([p, label]) => (
          <a key={p} href={href(p)} className={top === p || (p === 'inventory' && top === 'lot') ? 'active' : ''}>{label}</a>
        ))}
      </nav>
      {off.sw === 'update' && (
        <div className="banner info" role="status"><strong>Update ready</strong><span>A new version of FieldLine has downloaded. Your records are kept.</span><button className="btn small" onClick={applyUpdate}>Reload now</button></div>
      )}
      {!off.online && <div className="banner info" role="status"><strong>Offline</strong><span>No connection. Everything still works and saves on this device.</span></div>}
      {s.error && <div className="banner bad" role="alert"><strong>Storage</strong><span>{s.error}</span></div>}
      {actor && !actor.medicationAuthority && ['act', 'scan'].includes(top) && (
        <div className="banner info"><strong>Note</strong><span>{actor.displayName} has no medication-handling authority. Medication transactions will be refused by the ledger.</span></div>
      )}
      <main className="main">{page}</main>
      <footer className="foot">
        Device {s.deviceId} · {s.p.events.length} ledger events · {s.persistent ? 'saved on this device' : 'memory only'} · {OFFLINE_TEXT[off.sw]} · sync between devices: not yet (Phase 2)
      </footer>
    </div>
  );
}
