import { useSyncExternalStore } from 'react';
import { apply, emptyProjection, project, replay, validate, type ApplyResult, type Projection } from '../core/ledger';
import type { LedgerEvent, ReferenceData } from '../core/types';
import { buildSeed } from '../demo/seed';
import { Lookup } from './model';
import { blankReference, validateReference, type BlankSetup } from './reference';

/**
 * Browser persistence for the POC (ADR-006: IndexedDB).
 *
 * The ledger is append-only on disk too: events are only ever added, in
 * order, and the projection is rebuilt from them on load. A new event is
 * validated, then written, and only applied to the in-memory projection once
 * the write has succeeded — so the screen never shows something that was not
 * saved.
 */

const DB_NAME = 'fieldline-demo';
const DB_VERSION = 1;

export type NewEvent = { [K in LedgerEvent['type']]: Omit<Extract<LedgerEvent, { type: K }>, 'id' | 'at' | 'deviceId' | 'sync' | 'actorId'> }[LedgerEvent['type']];

export type DataMode = 'demo' | 'own';

export interface Snapshot {
  ready: boolean;
  /** 'demo' = fictional seed; 'own' = the user's field-test data. */
  mode: DataMode;
  error?: string;
  persistent: boolean; // false → IndexedDB unavailable, running in memory only
  ref: ReferenceData;
  L: Lookup;
  p: Projection;
  version: number;
  deviceId: string;
  seededAt?: string;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB not available'));
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'seq', autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Database is open in another tab with an older version. Close other FieldLine tabs.'));
  });
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

class Store {
  private db?: IDBDatabase;
  private listeners = new Set<() => void>();
  private snap: Snapshot;

  constructor() {
    const ref: ReferenceData = { people: [], locations: [], items: [] };
    this.snap = { ready: false, mode: 'demo', persistent: false, ref, L: new Lookup(ref), p: emptyProjection(), version: 0, deviceId: '' };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch, version: this.snap.version + 1 };
    for (const fn of this.listeners) fn();
  }

  async init(): Promise<void> {
    try {
      this.db = await openDB();
      const tx = this.db.transaction(['meta', 'events'], 'readonly');
      const [refRow, devRow, seededRow, modeRow, rows] = await Promise.all([
        req(tx.objectStore('meta').get('ref')),
        req(tx.objectStore('meta').get('deviceId')),
        req(tx.objectStore('meta').get('seededAt')),
        req(tx.objectStore('meta').get('mode')),
        req(tx.objectStore('events').getAll()),
      ]);
      if (!refRow) return this.seed();
      const ref = refRow.v as ReferenceData;
      const events = (rows as { seq: number; e: LedgerEvent }[]).sort((a, b) => a.seq - b.seq).map((r) => r.e);
      // Stored events were accepted when recorded; replay them as history (see core replay()).
      const p = replay(events);
      this.set({
        ready: true, persistent: true, mode: (modeRow?.v as DataMode) ?? 'demo', ref, L: new Lookup(ref), p,
        deviceId: devRow?.v ?? 'unknown', seededAt: seededRow?.v,
        error: p.rejected.length ? `${p.rejected.length} stored event(s) could not be replayed.` : undefined,
      });
    } catch (err) {
      // Private browsing or storage disabled: run the demo in memory so it is still usable.
      const { ref, events } = buildSeed();
      this.db = undefined;
      this.set({
        ready: true, persistent: false, mode: 'demo', ref, L: new Lookup(ref), p: project(ref, events),
        deviceId: `mem-${uuid().slice(0, 8)}`, seededAt: new Date().toISOString(),
        error: `Browser storage unavailable (${(err as Error).message}). Changes will be lost when you close this tab.`,
      });
    }
  }

  /** Replace everything on this device with the given dataset. */
  private async replaceAll(ref: ReferenceData, events: LedgerEvent[], mode: DataMode): Promise<void> {
    const now = new Date().toISOString();
    const deviceId = this.snap.deviceId || `dev-${uuid().slice(0, 8)}`;
    const p = replay(events);
    if (this.snap.persistent || !this.snap.ready) {
      if (!this.db) this.db = await openDB();
      const tx = this.db.transaction(['meta', 'events'], 'readwrite');
      const ev = tx.objectStore('events');
      const meta = tx.objectStore('meta');
      ev.clear();
      meta.put({ k: 'ref', v: ref });
      meta.put({ k: 'deviceId', v: deviceId });
      meta.put({ k: 'seededAt', v: now });
      meta.put({ k: 'mode', v: mode });
      for (const e of p.events) ev.add({ e });
      await txDone(tx);
    }
    this.set({ ready: true, persistent: this.snap.persistent || !this.snap.ready, mode, ref, L: new Lookup(ref), p, deviceId, seededAt: now, error: undefined });
  }

  /** Wipe and load the fictional demo data. */
  async seed(): Promise<void> {
    const { ref, events } = buildSeed(new Date());
    await this.replaceAll(ref, events, 'demo');
  }

  async reset(): Promise<void> {
    await this.seed();
  }

  /** Wipe and start an empty dataset for the user's own field test. */
  async startBlank(setup: BlankSetup): Promise<string | null> {
    const ref = blankReference(setup);
    const err = validateReference(ref);
    if (err) return err;
    await this.replaceAll(ref, [], 'own');
    return null;
  }

  /** Save edited people / locations / items. Recorded history is never rewritten. */
  async saveReference(ref: ReferenceData): Promise<string | null> {
    const err = validateReference(ref, this.snap.p.events);
    if (err) return err;
    if (this.db) {
      try {
        const tx = this.db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ k: 'ref', v: ref });
        await txDone(tx);
      } catch (e) {
        return `Could not save to this device: ${(e as Error).message}`;
      }
    }
    this.set({ ref, L: new Lookup(ref) });
    return null;
  }

  /** Restore a ledger export (from this or another device). Replaces everything here. */
  async importLedger(json: string): Promise<string | null> {
    let data: { format?: string; reference?: ReferenceData; events?: LedgerEvent[]; demo?: boolean; mode?: DataMode };
    try { data = JSON.parse(json); } catch { return 'That file is not valid JSON.'; }
    if (data.format !== 'fieldline-ledger-export' || !data.reference || !Array.isArray(data.events)) return 'That file is not a FieldLine ledger export.';
    const err = validateReference(data.reference, data.events);
    if (err) return `The export's reference data is inconsistent: ${err}`;
    const p = replay(data.events);
    if (p.rejected.length) return `${p.rejected.length} event(s) in the file refer to records that do not exist; nothing was imported.`;
    await this.replaceAll(data.reference, data.events, data.mode ?? (data.demo ? 'demo' : 'own'));
    return null;
  }

  /** Validate → persist → apply. Returns the ledger's verdict. */
  async record(actorId: string, fields: NewEvent): Promise<ApplyResult & { event?: LedgerEvent }> {
    const e = { ...fields, id: uuid(), at: new Date().toISOString(), actorId, deviceId: this.snap.deviceId, sync: 'LOCAL' } as LedgerEvent;
    const reason = validate(this.snap.p, this.snap.ref, e);
    if (reason) return { status: 'REJECTED', reason };
    if (this.db) {
      try {
        const tx = this.db.transaction('events', 'readwrite');
        tx.objectStore('events').add({ e });
        await txDone(tx);
      } catch (err) {
        return { status: 'REJECTED', reason: `Could not save to this device: ${(err as Error).message}` };
      }
    }
    const res = apply(this.snap.p, this.snap.ref, e);
    this.set({});
    return { ...res, event: e };
  }

  exportLedger(): string {
    return JSON.stringify({
      format: 'fieldline-ledger-export', version: 1, exportedAt: new Date().toISOString(),
      deviceId: this.snap.deviceId, mode: this.snap.mode, demo: this.snap.mode === 'demo', reference: this.snap.ref, events: this.snap.p.events,
    }, null, 2);
  }
}

export const store = new Store();
export const useStore = (): Snapshot => useSyncExternalStore(store.subscribe, store.getSnapshot);

// ------------------------------------------------------- small UI prefs

export function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`fieldline.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}
export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(`fieldline.${key}`, value);
  } catch {
    /* preferences are a convenience only */
  }
}
