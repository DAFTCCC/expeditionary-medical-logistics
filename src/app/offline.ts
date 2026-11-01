import { useSyncExternalStore } from 'react';

/** Service-worker registration and connectivity status for the UI. */

export interface OfflineState {
  sw: 'unsupported' | 'dev' | 'installing' | 'ready' | 'update' | 'error';
  online: boolean;
  error?: string;
}

let state: OfflineState = { sw: 'installing', online: typeof navigator === 'undefined' ? true : navigator.onLine };
const listeners = new Set<() => void>();
const set = (patch: Partial<OfflineState>) => {
  state = { ...state, ...patch };
  listeners.forEach((f) => f());
};
let waiting: ServiceWorker | null = null;

export function registerOffline(): void {
  addEventListener('online', () => set({ online: true }));
  addEventListener('offline', () => set({ online: false }));
  if (import.meta.env.DEV) return set({ sw: 'dev' });
  if (!('serviceWorker' in navigator)) return set({ sw: 'unsupported' });
  const swUrl = `${import.meta.env.BASE_URL}sw.js`;
  navigator.serviceWorker.register(swUrl, { scope: import.meta.env.BASE_URL }).then((reg) => {
    const track = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed') {
          if (navigator.serviceWorker.controller) { waiting = w; set({ sw: 'update' }); } else set({ sw: 'ready' });
        }
        if (w.state === 'activated' && !navigator.serviceWorker.controller) set({ sw: 'ready' });
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) { waiting = reg.waiting; set({ sw: 'update' }); }
    else if (reg.active) set({ sw: 'ready' });
    track(reg.installing);
    reg.addEventListener('updatefound', () => track(reg.installing));
    // Check for a new version when the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update().catch(() => undefined); });
  }).catch((e: Error) => set({ sw: 'error', error: e.message }));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !waiting) return;
    reloading = true;
    location.reload();
  });
}

/** Activate the waiting version; the page reloads when it takes over. */
export function applyUpdate(): void {
  waiting?.postMessage('skipWaiting');
}

export const useOffline = (): OfflineState =>
  useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => state);
