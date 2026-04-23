// Global app state (Zustand).
//
// Holds the BLE connection handle, the broadcast widget catalog,
// last-known state for every widget id, and the most recent Denied
// reply (single-slot, so it cannot grow unbounded over uptime).
import { create } from 'zustand';
import {
  forgetAllDevices,
  forgetDevice,
  loadKnownDevices,
  parseReply,
  type Connection,
  type KnownDevice,
} from './ble';
import { forgetLabels, forgetTimerOverrides, parseWidgetLine, type WidgetSpec } from './widgets';

interface AppState {
  conn:           Connection | null;
  probing:        boolean;
  error:          string | null;
  knownDevices:   KnownDevice[];
  catalog:        WidgetSpec[];
  catalogReady:   boolean;
  deviceStates:   Record<string, string>;
  // Last observed Denied reply. Single nullable slot (overwritten)
  // instead of a Record so it cannot grow over long uptime.
  denied:         { id: string; ts: number } | null;
  editing:        boolean;

  setConn:       (c: Connection | null) => void;
  setProbing:    (b: boolean) => void;
  setError:      (e: string | null) => void;
  refreshKnown:  () => void;
  forget:        (id: string, name: string) => void;
  forgetAll:     () => void;
  applyLine:     (line: string) => void;
  clearStates:   () => void;
  clearCatalog:  () => void;
  setEditing:    (b: boolean) => void;
  toggleEditing: () => void;
}

export const useApp = create<AppState>((set) => ({
  conn:         null,
  probing:      true,
  error:        null,
  knownDevices: loadKnownDevices(),
  catalog:      [],
  catalogReady: false,
  deviceStates: {},
  denied:       null,
  editing:      false,

  setConn:    (conn)    => set({ conn }),
  setProbing: (probing) => set({ probing }),
  setError:   (error)   => set({ error }),

  refreshKnown: () => set({ knownDevices: loadKnownDevices() }),

  forget: (id, name) => {
    forgetDevice(id);
    forgetLabels(name);
    forgetTimerOverrides(name);
    set({ knownDevices: loadKnownDevices() });
  },
  forgetAll: () => {
    const all = loadKnownDevices();
    for (const d of all) { forgetLabels(d.name); forgetTimerOverrides(d.name); }
    forgetAllDevices();
    set({ knownDevices: [] });
  },

  clearStates:  () => set({ deviceStates: {}, denied: null }),
  clearCatalog: () => set({ catalog: [], catalogReady: false, editing: false }),

  setEditing:    (b)   => set({ editing: b }),
  toggleEditing: ()    => set((s) => ({ editing: !s.editing })),

  applyLine: (line) => {
    // MARK: catalog lines
    if (line === 'widgets:end') {
      set({ catalogReady: true });
      return;
    }
    const w = parseWidgetLine(line);
    if (w) {
      set((s) => {
        // Replace in place if the id already exists, else append.
        const idx = s.catalog.findIndex(c => c.id === w.id);
        if (idx < 0) return { catalog: [...s.catalog, w] };
        const next = s.catalog.slice();
        next[idx] = w;
        return { catalog: next };
      });
      return;
    }
    // MARK: state / denied replies
    const r = parseReply(line);
    if (!r) return;
    if (r.status === 'Confirmed') {
      set((s) => ({ deviceStates: { ...s.deviceStates, [r.device]: r.action } }));
    } else {
      set({ denied: { id: r.device, ts: Date.now() } });
    }
  },
}));
