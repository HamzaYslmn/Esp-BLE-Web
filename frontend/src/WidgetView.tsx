import { useEffect, useRef, useState } from 'react';
import { useApp } from './store';
import type { WidgetSpec } from './widgets';

interface Props {
  spec:    WidgetSpec;
  send:    (cmd: string) => Promise<void>;
}

/** Briefly highlights a card when a Denied reply is observed for `device`. */
function useDenied(device: string): boolean {
  // Subscribe only to the timestamp of the last denied reply for THIS
  // device (undefined if it wasn't us) so unrelated denies don't
  // re-render every card on the board.
  const ts = useApp((s) => (s.denied?.id === device ? s.denied.ts : undefined));
  const [hi, setHi] = useState(false);
  useEffect(() => {
    if (!ts) return;
    setHi(true);
    const t = setTimeout(() => setHi(false), 600);
    return () => clearTimeout(t);
  }, [ts]);
  return hi;
}

export function WidgetCard(props: Props) {
  switch (props.spec.kind) {
    case 'switch':    return <SwitchCard    {...props} />;
    case 'button':    return <ButtonCard    {...props} />;
    case 'slider':    return <SliderCard    {...props} />;
    case 'timer':     return <TimerCard     {...props} />;
    case 'separator': return <SeparatorCard {...props} />;
  }
}

/* ---------------- Switch ---------------- */
function SwitchCard({ spec, send }: Props) {
  const state  = useApp((s) => s.deviceStates[spec.id]);
  const denied = useDenied(spec.id);
  const on = state === 'ON';
  return (
    <button
      className={`card card-switch ${on ? 'on' : ''} ${denied ? 'denied' : ''}`}
      onClick={() => void send(`${spec.id}:${on ? 'OFF' : 'ON'}`)}
    >
      <div className="card-title">{spec.label}</div>
      <div className="toggle" aria-pressed={on}>
        <span className="toggle-thumb" />
      </div>
      <div className="card-foot">
        <span className="card-id">{spec.id}</span>
        <span className="card-state">{on ? 'ON' : 'OFF'}</span>
      </div>
    </button>
  );
}

/* ---------------- Button ---------------- */
function ButtonCard({ spec, send }: Props) {
  const denied = useDenied(spec.id);
  const action = spec.action ?? 'ON';
  return (
    <button
      className={`card card-button ${denied ? 'denied' : ''}`}
      onClick={() => void send(`${spec.id}:${action}`)}
    >
      <div className="card-title">{spec.label}</div>
      <div className="press-pad">TAP</div>
      <div className="card-foot">
        <span className="card-id">{spec.id}</span>
        <span className="card-state">{action}</span>
      </div>
    </button>
  );
}

/* ---------------- Slider ---------------- */
function SliderCard({ spec, send }: Props) {
  const state    = useApp((s) => s.deviceStates[spec.id]);
  const denied   = useDenied(spec.id);
  const min      = spec.min     ?? 0;
  const max      = spec.max     ?? 100;
  const initial  = spec.initial ?? min;

  // Server-confirmed value, parsed from the "<id>:set:<n>" reply line.
  const confirmed =
    typeof state === 'string' && state.startsWith('set:')
      ? Number(state.slice(4))
      : initial;

  // Local optimistic value while the user is dragging, so the UI
  // never feels laggy even on slow BLE links.
  const [local, setLocal] = useState<number>(confirmed);
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) setLocal(confirmed); }, [confirmed]);

  // 500 ms trailing debounce: send the value only after the slider has
  // been still for half a second, so the BLE bus isn't blocked by a
  // flood of writes while the user drags.
  const debounceTimer = useRef<number | null>(null);
  const pending       = useRef<number | null>(null);
  function scheduleSend(v: number) {
    pending.current = v;
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      debounceTimer.current = null;
      if (pending.current !== null) {
        void send(`${spec.id}:set:${pending.current}`);
        pending.current = null;
      }
    }, 500);
  }
  useEffect(() => () => {
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
  }, []);

  const span = Math.max(1, max - min);
  const pct  = Math.round(((local - min) / span) * 100);

  return (
    <div className={`card card-slider ${denied ? 'denied' : ''}`}>
      <div className="card-title">{spec.label}</div>
      <input
        className="slider-input"
        type="range"
        min={min}
        max={max}
        value={local}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onPointerDown={() => { dragging.current = true; }}
        onPointerUp={()   => { dragging.current = false; }}
        onChange={(e) => {
          const v = Number(e.currentTarget.value);
          setLocal(v);
          scheduleSend(v);
        }}
      />
      <div className="card-foot">
        <span className="card-id">{spec.id}</span>
        <span className="card-state">{local}</span>
      </div>
    </div>
  );
}

/* ---------------- Timer ---------------- */
function TimerCard({ spec, send }: Props) {
  const state  = useApp((s) => s.deviceStates[spec.id]);
  const denied = useDenied(spec.id);
  const remaining = state && /^\d+$/.test(state) && Number(state) > 0 ? Number(state) : null;
  const seconds = spec.seconds ?? 0;
  const onCompleteCmd = spec.onCompleteCmd ?? '';
  const startCmd = onCompleteCmd
    ? `${spec.id}:start:${seconds}:${onCompleteCmd}`
    : `${spec.id}:start:${seconds}`;
  const running = remaining !== null;
  const pct = running && seconds > 0
    ? Math.max(0, Math.min(100, (remaining! / seconds) * 100))
    : 0;

  return (
    <button
      className={`card card-timer ${running ? 'running' : ''} ${denied ? 'denied' : ''}`}
      onClick={() => void send(running ? `${spec.id}:cancel` : startCmd)}
    >
      <div className="card-head">
        <div className="card-title">{spec.label}</div>
        {onCompleteCmd && (
          <div className="card-sub" title="Sent when the countdown reaches zero (set on the device)">
            <span className="card-sub-icon">→</span>
            <span className="card-sub-cmd">{onCompleteCmd}</span>
          </div>
        )}
      </div>
      <div className="timer-value">{formatHMS(running ? remaining! : seconds)}</div>
      <div className="card-foot">
        <span className="card-id">{spec.id}</span>
        <span className="card-state">{running ? 'TAP TO CANCEL' : 'TAP TO START'}</span>
      </div>
      {running && (
        <span className="timer-progress"><span style={{ width: `${pct}%` }} /></span>
      )}
    </button>
  );
}

/* ---------------- Separator ---------------- */
function SeparatorCard({ spec }: Props) {
  if (!spec.label) return <hr className="separator-line" />;
  return (
    <div className="separator-titled">
      <span className="separator-rule" />
      <span className="separator-text">{spec.label}</span>
      <span className="separator-rule" />
    </div>
  );
}

function formatHMS(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/* ---------------- Inline rename card (edit mode) ---------------- */
export function RenameCard({
  id,
  original,
  current,
  onChange,
  onCommit,
}: {
  id:       string;
  original: string;
  current:  string | undefined;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  const [draft, setDraft] = useState(current ?? original);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setDraft(current ?? original); }, [current, original]);
  useEffect(() => {
    const el = inputRef.current;
    if (el) { el.focus(); el.select(); }
  }, []);
  return (
    <div className="card card-edit">
      <div className="card-title">Rename</div>
      <input
        ref={inputRef}
        className="rename-input"
        type="text"
        value={draft}
        placeholder={original || id}
        onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur(); }}
        onBlur={onCommit}
      />
      <div className="card-foot">
        <span className="card-id">{id}</span>
        <span className="card-state">auto-saved</span>
      </div>
    </div>
  );
}

/* ---------------- Inline edit card for timers (name + duration) ---------------- */
export function EditTimerCard({
  id,
  originalLabel,
  originalSeconds,
  onCompleteCmd,
  currentLabel,
  currentSeconds,
  onLabelChange,
  onSecondsChange,
  onCommit,
}: {
  id:               string;
  originalLabel:    string;
  originalSeconds:  number;
  onCompleteCmd?:   string;
  currentLabel:     string | undefined;
  currentSeconds:   number | undefined;
  onLabelChange:    (v: string)   => void;
  onSecondsChange:  (n: number | null) => void;   // null = clear override
  onCommit:         () => void;
}) {
  const [name, setName] = useState(currentLabel ?? originalLabel);
  const [mins, setMins] = useState(String(Math.round((currentSeconds ?? originalSeconds) / 60)));
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = nameRef.current;
    if (el) { el.focus(); el.select(); }
  }, []);

  function commitMins(v: string) {
    const n = parseInt(v, 10);
    if (!isFinite(n) || n <= 0) { onSecondsChange(null); return; }
    const secs = n * 60;
    if (secs === originalSeconds) onSecondsChange(null);
    else                          onSecondsChange(secs);
  }

  return (
    <div className="card card-edit card-edit-timer">
      <div className="card-title">Edit Timer</div>
      <div className="edit-fields">
        <input
          ref={nameRef}
          className="rename-input"
          type="text"
          value={name}
          placeholder={originalLabel || id}
          onChange={(e) => { setName(e.target.value); onLabelChange(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur(); }}
        />
        <div className="mins-row">
          <input
            className="rename-input mins-input"
            type="number"
            min={1}
            value={mins}
            onChange={(e) => { setMins(e.target.value); commitMins(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur(); }}
          />
          <span className="mins-suffix">min</span>
        </div>
      </div>
      {onCompleteCmd && (
        <div className="on-complete-row">
          <span className="on-complete-label">On complete</span>
          <code className="on-complete-cmd">{onCompleteCmd}</code>
          <span className="on-complete-hint">set on device</span>
        </div>
      )}
      <div className="card-foot">
        <span className="card-id">{id}</span>
        <button className="edit-done tiny" onClick={onCommit}>Done</button>
      </div>
    </div>
  );
}
