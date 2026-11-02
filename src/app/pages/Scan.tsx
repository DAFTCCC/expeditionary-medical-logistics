import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { qty } from '../../core/ledger';
import { fefoLot, resolveScan, type ScanMatch } from '../../core/identify';
import { BUCKET_LABEL, todayUTC } from '../model';
import { loadPref, savePref, useStore } from '../store';
import { ExpiryBadge, Field, href, Time, useSession } from '../ui';
import type { CameraSession, Detected } from '../scanner';
import { allowCameraSteps, CameraError, cameraEnv, openCamera, type CameraEnv } from '../camera';

type Mode = 'camera' | 'handheld' | 'manual';

const SEPARATORS: [string, string][] = [
  ['', 'None / scanner sends ASCII 29 (GS)'],
  ['|', 'Pipe |'],
  ['~', 'Tilde ~'],
  ['^', 'Caret ^'],
];

export function ScanPage() {
  const [mode, setMode] = useState<Mode>(() => (loadPref('scanMode', navigator.maxTouchPoints > 0 ? 'camera' : 'handheld') as Mode));
  const [last, setLast] = useState<{ raw: string; source: string; format?: string } | null>(null);
  const [sep, setSep] = useState(() => loadPref('gsSep', ''));
  const pick = (m: Mode) => { setMode(m); savePref('scanMode', m); };
  const got = (raw: string, source: string, format?: string) => setLast({ raw, source, format });

  return (
    <>
      <div className="page-head">
        <h1>Scan</h1>
        <span className="sub">A scan only finds a record. Nothing is recorded until you choose an action and confirm it.</span>
      </div>
      <div className="tabs" role="tablist">
        {(['camera', 'handheld', 'manual'] as Mode[]).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'tab on' : 'tab'} onClick={() => pick(m)}>
            {m === 'camera' ? 'Camera' : m === 'handheld' ? 'Handheld scanner' : 'Type it in'}
          </button>
        ))}
      </div>
      <div className="card">
        {mode === 'camera' && <CameraMode onResult={(d) => got(d.raw, 'camera', d.format)} />}
        {mode === 'handheld' && <WedgeMode sep={sep} onResult={(r) => got(r, 'handheld scanner')} />}
        {mode === 'manual' && <ManualMode onResult={(r) => got(r, 'manual entry')} />}
        {mode === 'handheld' && (
          <Field label="GS1 group-separator substitute" hint="Many keyboard-wedge scanners cannot send ASCII 29. If yours is programmed to send another character between GS1 fields, choose it here.">
            <select value={sep} onChange={(e) => { setSep(e.target.value); savePref('gsSep', e.target.value); }}>
              {SEPARATORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        )}
      </div>
      {last && <ScanResult raw={last.raw} source={last.source} format={last.format} sep={sep} />}
      <p className="sub">Need something to scan? The <a href={href('labels')}>Labels</a> page prints FieldLine QR labels and fictional GS1 test codes.</p>
    </>
  );
}

function CameraMode({ onResult }: { onResult: (d: Detected) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<CameraSession | null>(null);
  const [env, setEnv] = useState<CameraEnv | null>(null);
  const [state, setState] = useState<'idle' | 'starting' | 'live' | 'error'>('idle');
  const [err, setErr] = useState<{ text: string; kind: CameraError['kind'] | 'decoder' } | null>(null);
  const [fileMsg, setFileMsg] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void cameraEnv().then(setEnv);
    void import('../scanner'); // warm the decoder so it is ready when the camera starts
  }, []);
  const stop = () => { session.current?.stop(); session.current = null; setState('idle'); };
  useEffect(() => stop, []);

  const start = async () => {
    if (!env) return;
    setState('starting'); setErr(null);
    let stream: MediaStream;
    try {
      stream = await openCamera(env); // straight from the tap — some phone browsers require it
    } catch (e) {
      setState('error');
      setErr({ text: (e as Error).message, kind: e instanceof CameraError ? e.kind : 'other' });
      void cameraEnv().then(setEnv);
      return;
    }
    try {
      const { startScanning } = await import('../scanner');
      session.current = await startScanning(video.current!, stream, (d) => { setState('idle'); session.current = null; onResult(d); }, (m) => setErr({ text: m, kind: 'decoder' }));
      setState('live');
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      setState('error'); setErr({ text: (e as Error).message, kind: 'other' });
    }
  };

  const fromFile = async (f: File | undefined) => {
    if (!f) return;
    setFileMsg('Decoding…');
    try {
      const { detectInFile } = await import('../scanner');
      const d = await detectInFile(f);
      if (d) { setFileMsg(''); onResult(d); } else setFileMsg('No barcode found in that photo. Hold the phone 10–20 cm away, fill the frame, avoid glare, and try again.');
    } catch (e) {
      setFileMsg(`Could not read the photo: ${(e as Error).message}`);
    }
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(location.href.split('#')[0]); setCopied(true); } catch { setCopied(false); }
  };

  const inApp = env?.inAppBrowser;
  const blocked = env?.permission === 'denied';
  const steps = env ? allowCameraSteps(env) : [];
  const realBrowser = env?.platform === 'ios' ? 'Safari' : env?.platform === 'android' ? 'Chrome' : 'your browser';

  return (
    <div className="camera">
      {inApp && state !== 'live' && (
        <div className="banner bad cam-help" role="alert">
          <strong>Open in {realBrowser} to use the camera</strong>
          <span>This page is open inside {inApp}. Built-in app browsers usually block the camera. Use the menu (⋯ or ⋮) → “Open in {realBrowser}”, or copy the link and paste it into {realBrowser}.</span>
          <button className="btn small" onClick={() => void copyLink()}>{copied ? 'Link copied ✓' : 'Copy link'}</button>
        </div>
      )}
      {!inApp && blocked && state !== 'live' && (
        <div className="banner bad cam-help" role="alert">
          <strong>Camera is blocked for this site</strong>
          <ol>{steps.map((t) => <li key={t}>{t}</li>)}</ol>
        </div>
      )}
      <div className={`viewfinder ${state === 'live' ? 'live' : ''}`}>
        <video ref={video} aria-label="Camera preview" playsInline muted autoPlay />
        {state !== 'live' && <span className="vf-hint">{state === 'starting' ? 'Starting camera… allow access if your phone asks' : 'Camera off'}</span>}
        {state === 'live' && <span className="vf-frame" aria-hidden />}
      </div>
      <div className="actions-row">
        {state === 'live'
          ? <button className="btn" onClick={stop}>Stop camera</button>
          : <button className="btn primary big" onClick={() => void start()} disabled={state === 'starting' || !env}>Start camera</button>}
        <label className="btn secondary file-btn">
          Scan from photo
          <input type="file" accept="image/*" capture="environment" onChange={(e) => { void fromFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      {err && (
        <div className="banner bad cam-help" role="alert">
          <strong>Camera didn’t start</strong>
          <span>{err.text}</span>
          {err.kind === 'denied' && <ol>{steps.map((t) => <li key={t}>{t}</li>)}</ol>}
          {err.kind === 'in-app' && <span>Open this page in {realBrowser} instead (menu → “Open in {realBrowser}”).</span>}
          {err.kind !== 'decoder' && <span>Meanwhile, <strong>Scan from photo</strong> uses your phone’s normal camera and works in almost every browser.</span>}
        </div>
      )}
      {fileMsg && <p className="sub">{fileMsg}</p>}
      <p className="hint">Reads QR, DataMatrix (incl. GS1 on drug packaging), Code 128, EAN/UPC. Decoding happens on this device; nothing is uploaded.</p>
      {env && (
        <details className="sub diag">
          <summary>Camera check</summary>
          <ul>
            <li>Secure page: {env.secure ? 'yes' : 'NO'}</li>
            <li>Browser allows camera from web pages: {env.hasApi ? 'yes' : 'NO'}</li>
            <li>Opened inside another app: {env.inAppBrowser ?? 'no'}</li>
            <li>Camera permission: {env.permission}</li>
            <li>Installed app mode: {env.standalone ? 'yes' : 'no'} · device: {env.platform}</li>
          </ul>
          <code className="ua">{navigator.userAgent}</code>
        </details>
      )}
    </div>
  );
}

function WedgeMode({ onResult, sep }: { onResult: (r: string) => void; sep: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [v, setV] = useState('');
  const [focused, setFocused] = useState(false);
  useEffect(() => { input.current?.focus(); }, []);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (v.trim()) onResult(v);
      setV('');
    }
  };
  return (
    <div>
      <p>Point the handheld scanner and pull the trigger. The scanner types into the box below and presses Enter.</p>
      <input
        ref={input} className={`wedge ${focused ? 'armed' : ''}`} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={onKey}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-label="Handheld scanner input"
        placeholder={focused ? 'Ready — scan now' : 'Tap here to arm the scanner'}
      />
      <p className="hint">{focused ? 'Armed.' : 'Not armed — tap the box first.'} Separator setting: {sep ? `“${sep}”` : 'ASCII 29'}.</p>
    </div>
  );
}

function ManualMode({ onResult }: { onResult: (r: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onResult(v); }}>
      <Field label="Code" hint="FieldLine label (FL-A-…), GS1 text like (01)…(17)…(10)…, a GTIN/UPC, asset tag, serial number, or lot number.">
        <input value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      </Field>
      <button className="btn primary" type="submit">Look up</button>
    </form>
  );
}

function ScanResult({ raw, source, format, sep }: { raw: string; source: string; format?: string; sep: string }) {
  const { p, ref, L } = useStore();
  const { actorId, scope } = useSession();
  const m: ScanMatch = resolveScan(raw, p, ref, { gs1Separator: sep || undefined });
  const shown = raw.replace(/\u001d/g, '<GS>');
  const head = <p className="sub">From {source}{format ? ` (${format.replace('_', ' ')})` : ''}: <code>{shown}</code></p>;

  if (m.kind === 'NOT_FOUND') return <section className="card result bad">{head}<h2>No match</h2><p>{m.reason}</p>{m.gs1?.gtin && <p className="sub">GS1: GTIN {m.gs1.gtin}{m.gs1.lot ? ` · lot ${m.gs1.lot}` : ''}{m.gs1.expiry ? ` · exp ${m.gs1.expiry}` : ''}</p>}</section>;
  if (m.kind === 'RETIRED_LABEL') return <section className="card result bad">{head}<h2>Retired label</h2><p>Label {m.code} was retired and must not be used. Find the replacement label or look the item up by its serial number.</p></section>;

  if (m.kind === 'NEW_LOT') {
    return (
      <section className="card result warn">
        {head}
        <h2>{m.item.name} — new lot {m.gs1.lot}</h2>
        <p>This product is in the catalog but lot {m.gs1.lot} has never been received. {m.gs1.expiry && <>Barcode expiry {m.gs1.expiry}.</>}</p>
        <a className="btn primary" href={href('act/receive', { item: m.item.id, lot: m.gs1.lot, exp: m.gs1.expiry, serial: m.gs1.serial })}>Receive this lot</a>
      </section>
    );
  }

  if (m.kind === 'LOT') {
    const rows = [...p.balances.entries()].map(([k, v]) => ({ k: k.split('|'), v })).filter((r) => r.k[0] === m.lot.id && r.v > 0);
    const mine = qty(p, m.lot.id, 'CUSTODY', actorId);
    return (
      <section className="card result ok">
        {head}
        <h2>{m.item.name} · lot {m.lot.lotNumber}</h2>
        <p><ExpiryBadge lot={m.lot} /> <span className="sub">matched by {m.via}</span></p>
        <ul className="list">{rows.map((r) => <li key={r.k.join()}>{r.v} {BUCKET_LABEL[r.k[1] as keyof typeof BUCKET_LABEL].toLowerCase()} — {r.k[1] === 'CUSTODY' ? L.personName(r.k[2]) : L.locationName(r.k[2])}</li>)}</ul>
        <div className="actions-row">
          {rows.filter((r) => r.k[1] === 'AVAILABLE').map((r) => <a key={r.k[2]} className="btn" href={href('act/issue', { lot: m.lot.id, from: r.k[2] })}>Issue from {L.locationName(r.k[2])}</a>)}
          {mine > 0 && <a className="btn" href={href('act/consume', { lot: m.lot.id, person: actorId })}>Record use ({mine} held)</a>}
          {mine > 0 && <a className="btn" href={href('act/return', { lot: m.lot.id, person: actorId })}>Return</a>}
          <a className="btn secondary" href={href(`lot/${m.lot.id}`)}>Lot details</a>
        </div>
      </section>
    );
  }

  if (m.kind === 'ITEM') {
    const locs = L.locationsInScope(scope);
    const options = locs.map((l) => ({ l, lot: fefoLot(p, m.item.id, l.id, todayUTC()) })).filter((x) => x.lot);
    return (
      <section className="card result ok">
        {head}
        <h2>{m.item.name}</h2>
        <p className="sub">Matched by {m.via}. No lot was encoded, so pick a lot. Earliest-expiring usable lot at each location:</p>
        <ul className="list">
          {options.map(({ l, lot }) => (
            <li key={l.id}>{l.name}: lot {lot!.lotNumber} <ExpiryBadge lot={lot!} /> ({qty(p, lot!.id, 'AVAILABLE', l.id)} avail) <a className="btn small" href={href('act/issue', { lot: lot!.id, from: l.id })}>Issue</a></li>
          ))}
          {!options.length && <li>No usable stock in this scope.</li>}
        </ul>
      </section>
    );
  }

  if (m.kind === 'ASSET') {
    const a = m.asset;
    return (
      <section className="card result ok">
        {head}
        <h2>{a.asset.name} {a.asset.assetTag}</h2>
        <p>S/N {a.asset.serial} · {a.asset.manufacturer} {a.asset.model} · status {a.status.replace('_', ' ').toLowerCase()} <span className="sub">matched by {m.via}</span></p>
        <p>At {L.locationName(a.locationId)} · custodian {L.personName(a.custodianId)} · last confirmed <Time iso={a.lastConfirmedAt} /> by {L.personName(a.lastConfirmedBy)}</p>
        <a className="btn primary" href={href('equipment', { asset: a.asset.id })}>Confirm location / reassign</a>
      </section>
    );
  }

  // LOCATION
  const loc = m.location;
  const here = [...p.balances.entries()].map(([k, v]) => ({ k: k.split('|'), v })).filter((r) => r.k[2] === loc.id && r.v > 0 && r.k[1] === 'AVAILABLE');
  const assetsHere = [...p.assets.values()].filter((a) => a.locationId === loc.id);
  return (
    <section className="card result ok">
      {head}
      <h2>{loc.name}</h2>
      <p className="sub">{loc.kind.replace('_', ' ').toLowerCase()} · {L.locationName(L.hubOfLocation(loc.id))} · matched by {m.via}</p>
      <p><strong>{here.length}</strong> lots available here · <strong>{assetsHere.length}</strong> pieces of equipment recorded here</p>
      <div className="actions-row">
        <a className="btn" href={href('act/issue', { from: loc.id })}>Issue from here</a>
        <a className="btn" href={href('act/receive', { to: loc.id })}>Receive into here</a>
        <a className="btn secondary" href={href('equipment', { at: loc.id })}>Equipment here</a>
      </div>
    </section>
  );
}
