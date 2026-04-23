// Widget catalog parsing + per-widget overrides (label + timer seconds).
//
// The widget catalog is broadcast by the ESP32 sketch on connect:
//
//   widget:<id>:switch:<label>
//   widget:<id>:button:<label>:<action>
//   widget:<id>:slider:<label>:<min>:<max>:<initial>
//   widget:<id>:timer:<label>:<seconds>:<onComplete>
//   widget:<id>:separator                       (no label = thin divider)
//   widget:<id>:separator:<label>               (titled section header)
//   widgets:end
//
// Layout is just catalog order — no per-cell positioning. Users can
// rename a widget's display label, or override the configured timer
// duration; both overrides are stored locally per device-name.

export type WidgetKind = 'switch' | 'button' | 'slider' | 'timer' | 'separator';

export interface WidgetSpec {
  kind:           WidgetKind;
  id:             string;
  label:          string;
  action?:        string;     // button only
  min?:           number;     // slider only
  max?:           number;     // slider only
  initial?:       number;     // slider only
  seconds?:       number;     // timer only
  onCompleteCmd?: string;     // timer only
}

/** Parse "widget:<id>:<kind>[:<label>[:<extra>...]]" into a WidgetSpec. */
export function parseWidgetLine(line: string): WidgetSpec | null {
  if (!line.startsWith('widget:')) return null;
  const parts = line.split(':');
  if (parts.length < 3) return null;
  const [, id, kind, ...rest] = parts;
  const label = rest.shift() ?? '';
  switch (kind) {
    case 'switch':
      return { kind, id, label };
    case 'button':
      return { kind, id, label, action: rest.join(':') || 'ON' };
    case 'slider': {
      const min     = Number(rest.shift() ?? 0);
      const max     = Number(rest.shift() ?? 100);
      const initial = Number(rest.shift() ?? min);
      return { kind, id, label, min, max, initial };
    }
    case 'timer': {
      const seconds = Number(rest.shift() ?? 0);
      const onCompleteCmd = rest.join(':');
      return { kind, id, label, seconds, onCompleteCmd };
    }
    case 'separator':
      return { kind, id, label };
  }
  return null;
}

// MARK: localStorage helpers (generic)

function loadJson<T extends object>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch { /* ignore */ }
  return {} as T;
}

function saveJson<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function removeKey(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// MARK: per-widget label overrides

const LABELS_KEY = 'esp32-ble:labels';
const labelsKey  = (deviceName: string) => `${LABELS_KEY}:${deviceName}`;
export type Labels = Record<string, string>;   // keyed by widget id

export const loadLabels   = (deviceName: string): Labels => loadJson<Labels>(labelsKey(deviceName));
export const saveLabels   = (deviceName: string, labels: Labels): void => saveJson(labelsKey(deviceName), labels);
export const forgetLabels = (deviceName: string): void => removeKey(labelsKey(deviceName));

// MARK: per-timer duration overrides

const TIMER_KEY = 'esp32-ble:timer-seconds';
const timerKey  = (deviceName: string) => `${TIMER_KEY}:${deviceName}`;
export type TimerOverrides = Record<string, number>;   // keyed by timer id

export const loadTimerOverrides   = (deviceName: string): TimerOverrides => loadJson<TimerOverrides>(timerKey(deviceName));
export const saveTimerOverrides   = (deviceName: string, overrides: TimerOverrides): void => saveJson(timerKey(deviceName), overrides);
export const forgetTimerOverrides = (deviceName: string): void => removeKey(timerKey(deviceName));
