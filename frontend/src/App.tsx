import { useEffect, useRef, useState } from 'react';
import {
  autoReconnectAvailable,
  connect,
  ESP_NAME_PREFIX,
  tryReconnect,
  type Connection,
} from './ble';
import { Board } from './Board';
import { InstallButton } from './InstallButton';
import { Settings } from './Settings';
import { useApp } from './store';

const APP_TITLE = 'Esp32 BLE';

async function acquireWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    return await (navigator as Navigator & {
      wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> };
    }).wakeLock?.request('screen') ?? null;
  } catch { return null; }
}

async function ensureNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

function notify(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(title, { body, tag: 'esp32-ble', icon: 'icon.svg', silent: true });
}

export function App() {
  const conn         = useApp((s) => s.conn);
  const probing      = useApp((s) => s.probing);
  const error        = useApp((s) => s.error);
  const knownDevices = useApp((s) => s.knownDevices);
  const editing      = useApp((s) => s.editing);
  const setConn      = useApp((s) => s.setConn);
  const setProbing   = useApp((s) => s.setProbing);
  const setError     = useApp((s) => s.setError);
  const refreshKnown = useApp((s) => s.refreshKnown);
  const clearStates  = useApp((s) => s.clearStates);
  const clearCatalog = useApp((s) => s.clearCatalog);
  const applyLine    = useApp((s) => s.applyLine);
  const toggleEditing = useApp((s) => s.toggleEditing);

  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const lastDevice = knownDevices[0] ?? null;

  const handleClosed = () => {
    setConn(null);
    clearStates();
    clearCatalog();
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    notify(APP_TITLE, 'Disconnected');
  };

  const adoptConnection = async (c: Connection) => {
    c.subscribe((line) => { if (document.hidden) notify(APP_TITLE, line); });
    c.subscribe((line) => applyLine(line));
    wakeLockRef.current = await acquireWakeLock();
    refreshKnown();
    setConn(c);
  };

  // MARK: silent reconnect on page load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await tryReconnect(handleClosed);
      if (cancelled) { c?.disconnect(); return; }
      if (c) { await adoptConnection(c); notify(APP_TITLE, `Reconnected to ${c.name}`); }
      setProbing(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState === 'visible' && conn && !wakeLockRef.current) {
        wakeLockRef.current = await acquireWakeLock();
      }
    };
    const onPageHide = (e: PageTransitionEvent) => {
      if (!e.persisted) conn?.disconnect();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [conn]);

  const handleScan = async () => {
    setError(null);
    await ensureNotificationPermission();
    try {
      const c = await connect(handleClosed);
      await adoptConnection(c);
      notify(APP_TITLE, `Connected to ${c.name}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // MARK: reconnect / connect handler (button click)
  const handleReconnect = async (id?: string) => {
    setError(null);
    await ensureNotificationPermission();
    try {
      // Try silent reconnect first; fall back to chooser when blocked.
      const silent = await tryReconnect(handleClosed, id);
      const c = silent ?? await connect(handleClosed);      await adoptConnection(c);
      notify(APP_TITLE, `Connected to ${c.name}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleConnectFromSettings = (id: string) => {
    setShowSettings(false);
    void handleReconnect(id);
  };

  const handleDisconnect = () => {
    setDisconnecting(true);
    conn?.disconnect();
    setConn(null);
    clearStates();
    clearCatalog();
    window.setTimeout(() => setDisconnecting(false), 3000);
  };

  if (disconnecting) {
    return (
      <main className="center">
        <p className="muted">Disconnecting…</p>
      </main>
    );
  }

  if (probing) {
    return (
      <main className="center">
        <p className="muted">Reconnecting…</p>
      </main>
    );
  }

  if (!conn) {
    return (
      <>
        <button
          className="settings-fab"
          onClick={() => setShowSettings(true)}
          aria-label="Settings"
          title="Settings"
        >
          ⚙
        </button>
        <main className="center">
          <div className="welcome">
            <h1>Esp32 BLE</h1>
            <p>Tap a button below to start.</p>
            {lastDevice && (
              <button
                className="primary"
                onClick={() => handleReconnect(lastDevice.id)}
                disabled={!navigator.bluetooth}
              >
                Reconnect to {lastDevice.name}
              </button>
            )}
            <button
              className={lastDevice ? '' : 'primary'}
              onClick={handleScan}
              disabled={!navigator.bluetooth}
            >
              Scan for BLE devices
            </button>
            {knownDevices.length > 0 && (
              <button onClick={() => setShowSettings(true)}>
                Manage paired devices ({knownDevices.length})
              </button>
            )}
            <p className="muted small">
              Looks for any nearby BLE device. ESP32 boards starting with{' '}
              <strong>{ESP_NAME_PREFIX}</strong> get a ready-made control board.
            </p>
            {!navigator.bluetooth && (
              <p className="muted">Web Bluetooth not available in this browser.</p>
            )}
            {navigator.bluetooth && lastDevice && !autoReconnectAvailable() && (
              <p className="muted">
                For one-tap auto-reconnect, enable
                <br />
                <code>chrome://flags/#enable-experimental-web-platform-features</code>
                <br />
                and restart the browser.
              </p>
            )}
            {error && <p className="error">{error}</p>}
            <InstallButton />
          </div>
        </main>
        {showSettings && (
          <Settings
            onClose={() => setShowSettings(false)}
            onConnect={handleConnectFromSettings}
          />
        )}
      </>
    );
  }

  return (
    <>
      <main>
        <header className="bar">
          <span className="bar-title">{conn.name}</span>
          <div className="bar-actions">
            {conn.hasCommandChar && (
              <button
                className={`icon-btn ${editing ? 'active' : ''}`}
                onClick={toggleEditing}
                aria-label={editing ? 'Done renaming' : 'Rename widgets'}
                title={editing ? 'Done' : 'Rename widgets'}
              >
                {editing ? '✓' : '✎'}
              </button>
            )}
            <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings">⚙</button>
            <button className="danger" onClick={handleDisconnect}>Disconnect</button>
          </div>
        </header>

        {conn.hasCommandChar ? (
          <Board deviceName={conn.name} send={conn.send} />
        ) : (
          <section className="center" style={{ flex: 1 }}>
            <p className="muted">
              Connected, but this device doesn't expose a writable
              <br />
              <strong>ESP32-BLE</strong> command characteristic.
            </p>
          </section>
        )}
      </main>
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onConnect={handleConnectFromSettings}
        />
      )}
    </>
  );
}
