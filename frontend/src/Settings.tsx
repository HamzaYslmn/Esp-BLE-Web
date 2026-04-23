import { autoReconnectAvailable, type KnownDevice } from './ble';
import { useApp } from './store';

interface Props {
  onClose:   () => void;
  onConnect: (id: string) => void;
}

function fmtAge(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60)         return `${s}s ago`;
  if (s < 3600)       return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)      return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function Settings({ onClose, onConnect }: Props) {
  const known     = useApp((s) => s.knownDevices);
  const conn      = useApp((s) => s.conn);
  const forget    = useApp((s) => s.forget);
  const forgetAll = useApp((s) => s.forgetAll);
  const silent    = autoReconnectAvailable();

  const handleForget = (d: KnownDevice) => {
    if (!confirm(`Forget "${d.name}" and delete its saved widgets?`)) return;
    forget(d.id, d.name);
  };

  const handleForgetAll = () => {
    if (!confirm('Forget every paired device and delete all saved widget layouts?')) return;
    forgetAll();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="bar">
          <strong>Settings</strong>
          <button onClick={onClose}>Close</button>
        </header>

        <section className="modal-body">
          <h3>Paired devices</h3>
          {known.length === 0 && (
            <p className="muted">No paired devices yet.</p>
          )}
          {known.length > 0 && (
            <ul className="device-list">
              {known.map((d) => {
                const isCurrent = conn?.name === d.name;
                return (
                  <li key={d.id} className="device-row">
                    <div className="device-info">
                      <div className="device-name">
                        {d.name} {isCurrent && <span className="muted">(connected)</span>}
                      </div>
                      <div className="muted small">Last seen {fmtAge(d.lastSeen)}</div>
                    </div>
                    <div className="device-actions">
                      {silent && !isCurrent && (
                        <button onClick={() => onConnect(d.id)}>Connect</button>
                      )}
                      <button
                        className="danger"
                        onClick={() => handleForget(d)}
                        disabled={isCurrent}
                        title={isCurrent ? 'Disconnect first' : 'Forget device'}
                      >
                        Forget
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {known.length > 0 && (
            <div className="modal-footer">
              <button className="danger" onClick={handleForgetAll}>
                Forget all devices
              </button>
            </div>
          )}

          {!silent && (
            <p className="muted small">
              For one-tap auto-reconnect to a saved device, enable
              <br />
              <code>chrome://flags/#enable-experimental-web-platform-features</code>
              <br />
              and restart your browser.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
