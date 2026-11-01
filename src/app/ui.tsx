import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ApplyResult } from '../core/ledger';
import type { LedgerEvent, Lot, Person } from '../core/types';
import { describeEvent, expiryState, formatTime, todayUTC, daysBetween, type Scope } from './model';
import { loadPref, savePref, store, useStore, type NewEvent } from './store';
import { ROLE_LABEL } from '../core/permissions';

// ------------------------------------------------------------------ router

export interface Route { path: string[]; params: URLSearchParams }

function parse(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  const [p, q = ''] = h.split('?');
  return { path: p.split('/').filter(Boolean), params: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => {
      setR(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function href(path: string, params?: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v) q.set(k, v);
  const s = q.toString();
  return `#/${path}${s ? `?${s}` : ''}`;
}

export function go(path: string, params?: Record<string, string | undefined>) {
  location.hash = href(path, params);
}

// ----------------------------------------------------------------- session

interface Session {
  actorId: string;
  setActorId: (id: string) => void;
  scope: Scope;
  setScope: (s: Scope) => void;
  actor?: Person;
  tz?: string;
}

const SessionCtx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { L, ready } = useStore();
  const [actorId, setA] = useState(() => loadPref('actor', 'p-kalani'));
  const [scope, setS] = useState<Scope>(() => loadPref('scope', 'ALL'));
  const actor = L.people.get(actorId);
  useEffect(() => {
    if (ready && !actor && L.ref.people.length) setA(L.ref.people[0].id);
  }, [ready, actor, L]);
  const value: Session = {
    actorId, actor, scope, tz: L.scopeTimeZone(scope),
    setActorId: (id) => { setA(id); savePref('actor', id); },
    setScope: (s) => { setS(s); savePref('scope', s); },
  };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('SessionProvider missing');
  return s;
}

// ---------------------------------------------------------------- recording

export type Outcome = { ok: true; text: string; event: LedgerEvent } | { ok: false; text: string } | null;

/** Record an event as the acting person; returns a user-facing outcome. */
export function useRecorder() {
  const { actorId } = useSession();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  const record = async (fields: NewEvent): Promise<boolean> => {
    setBusy(true);
    const res: ApplyResult & { event?: LedgerEvent } = await store.record(actorId, fields);
    setBusy(false);
    if (res.status === 'ACCEPTED' && res.event) {
      const { p, L } = store.getSnapshot();
      setOutcome({ ok: true, text: describeEvent(res.event, p, L), event: res.event });
      return true;
    }
    setOutcome({ ok: false, text: res.status === 'REJECTED' ? res.reason : 'Already recorded.' });
    return false;
  };
  return { record, outcome, setOutcome, busy };
}

export function OutcomeBanner({ outcome, onClose }: { outcome: Outcome; onClose?: () => void }) {
  if (!outcome) return null;
  return (
    <div className={`banner ${outcome.ok ? 'ok' : 'bad'}`} role={outcome.ok ? 'status' : 'alert'}>
      <strong>{outcome.ok ? 'Recorded' : 'Not recorded'}</strong>
      <span>{outcome.text}</span>
      {outcome.ok && <a href={href('history')}>View history</a>}
      {onClose && <button className="link" onClick={onClose} aria-label="Dismiss">Dismiss</button>}
    </div>
  );
}

// ------------------------------------------------------------------- bits

export function ExpiryBadge({ lot, now = new Date() }: { lot: Lot; now?: Date }) {
  const s = expiryState(lot, now);
  const days = daysBetween(todayUTC(now), lot.expiry);
  if (s === 'EXPIRED') return <span className="badge bad">Expired {lot.expiry}</span>;
  if (s === 'SOON') return <span className="badge warn">Exp {lot.expiry} · {days}d</span>;
  return <span className="badge muted">Exp {lot.expiry}</span>;
}

export function Time({ iso }: { iso: string }) {
  const { tz } = useSession();
  return <time dateTime={iso} title={`${iso} (stored UTC)`}>{formatTime(iso, tz)}</time>;
}

export function PersonLabel({ person }: { person?: Person }) {
  if (!person) return <span>—</span>;
  return (
    <span>
      {person.displayName} <span className="sub">{ROLE_LABEL[person.role]}{person.medicationAuthority ? ' · med authority' : ''}</span>
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}
