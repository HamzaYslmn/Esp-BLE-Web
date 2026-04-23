import { useEffect, useRef } from 'react';
// Provided by vite-plugin-pwa (registerType: 'autoUpdate'):
import { useRegisterSW } from 'virtual:pwa-register/react';

const RECHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly

/**
 * Silently auto-applies new app versions:
 *  - Service worker is registered (autoUpdate mode in vite.config.ts).
 *  - Periodically asks the browser to re-check for an updated SW.
 *  - When a new version is ready, applies it and reloads the page in the
 *    background. No UI is shown.
 */
export function PWAUpdater() {
  const regRef = useRef<ServiceWorkerRegistration | null>(null);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_url, registration) { regRef.current = registration ?? null; },
  });

  useEffect(() => {
    const tick = () => regRef.current?.update().catch(() => {});
    const id = setInterval(tick, RECHECK_INTERVAL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    if (needRefresh) updateServiceWorker(true);
  }, [needRefresh, updateServiceWorker]);

  return null;
}
