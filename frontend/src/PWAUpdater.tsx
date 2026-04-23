import { useEffect, useRef } from 'react';
// Provided by vite-plugin-pwa (registerType: 'autoUpdate'):
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Silently auto-applies new app versions.
 *
 * The browser already polls for service-worker updates in the
 * background; we just nudge a re-check whenever the page becomes
 * visible again, then auto-reload the page as soon as a fresh SW is
 * ready. No user prompt, no visible UI.
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
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        regRef.current?.update().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    if (needRefresh) updateServiceWorker(true);
  }, [needRefresh, updateServiceWorker]);

  return null;
}
