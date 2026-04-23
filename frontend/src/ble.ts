// Generic Web Bluetooth client.
//
// connect()      – user-driven: opens the browser chooser.
// tryReconnect() – silent: re-uses a previously-permitted device id and
//                  resolves only after the device replies to "system:ping".
//
// The app remembers every device the user has ever connected to in a
// single localStorage list (esp32-ble:known-devices). Each entry is
// { id, name, lastSeen }. The most-recent entry powers the welcome
// screen's "Reconnect to X" button; the full list powers Settings.
//
// Wire protocol is plain text, '\n' / '\r' / ';' separated. See the
// Esp32BleControl library README for the message shape.
export const SVC      = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const CHAR_ID  = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
export const ESP_NAME_PREFIX = 'ESP32-BLE';

const KNOWN_DEVICES_KEY = 'esp32-ble:known-devices';
const PING_TIMEOUT_MS   = 2000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export type IncomingHandler = (line: string) => void;

export interface Connection {
  name: string;
  hasCommandChar: boolean;
  send: (cmd: string) => Promise<void>;
  subscribe: (cb: IncomingHandler) => () => void;
  disconnect: () => void;
}

export interface KnownDevice {
  id:       string;
  name:     string;
  lastSeen: number;
}

interface BluetoothExt {
  getDevices?: () => Promise<BluetoothDevice[]>;
}

/** True when the browser exposes navigator.bluetooth.getDevices(),
 *  which is required for silent (no-chooser) reconnect. */
export function autoReconnectAvailable(): boolean {
  const bt = navigator.bluetooth as (typeof navigator.bluetooth | undefined) & BluetoothExt;
  return typeof bt?.getDevices === 'function';
}

/* ---------------- known-device storage ---------------- */

export function loadKnownDevices(): KnownDevice[] {
  try {
    const raw = localStorage.getItem(KNOWN_DEVICES_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as KnownDevice[];
    return list.sort((a, b) => b.lastSeen - a.lastSeen);
  } catch { return []; }
}

function saveKnownDevices(list: KnownDevice[]): void {
  try { localStorage.setItem(KNOWN_DEVICES_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function rememberDevice(id: string, name: string): void {
  const list = loadKnownDevices().filter(d => d.id !== id);
  list.unshift({ id, name, lastSeen: Date.now() });
  saveKnownDevices(list);
}

export function forgetDevice(id: string): void {
  saveKnownDevices(loadKnownDevices().filter(d => d.id !== id));
}

export function forgetAllDevices(): void {
  saveKnownDevices([]);
}

export function lastKnownDevice(): KnownDevice | null {
  return loadKnownDevices()[0] ?? null;
}

/* ---------------- connection ---------------- */

async function wire(device: BluetoothDevice, onClosed: () => void): Promise<Connection> {
  device.addEventListener('gattserverdisconnected', () => onClosed());

  // Buffer lines that arrive before any subscriber attaches (e.g. the widget
  // catalog broadcast that the firmware emits ~500ms after BLE connect, while
  // tryReconnect is still awaiting the ping reply). Each new subscriber gets
  // the buffered lines replayed. Buffering stops once the catalog terminator
  // is seen, so it doesn't grow with later state replies.
  const subs = new Set<IncomingHandler>();
  const buffer: string[] = [];
  let bufferActive = true;
  const subscribe = (cb: IncomingHandler) => {
    subs.add(cb);
    for (const line of buffer) cb(line);
    return () => { subs.delete(cb); };
  };

  let chr: BluetoothRemoteGATTCharacteristic | null = null;
  // Accumulate bytes across notifications: a long line may arrive in
  // multiple fragments because BLE notifications cap at MTU - 3 bytes.
  let pending = '';
  const tag = `[${device.name || device.id}]`;
  const emit = (line: string) => {
    if (!line) return;
    console.log(tag, line);
    if (bufferActive) {
      buffer.push(line);
      if (line === 'widgets:end') bufferActive = false;
    }
    subs.forEach(cb => cb(line));
  };
  try {
    const svc = await device.gatt!.getPrimaryService(SVC);
    chr       = await svc.getCharacteristic(CHAR_ID);
    await chr.startNotifications();
    chr.addEventListener('characteristicvaluechanged', (ev) => {
      const value = (ev.target as BluetoothRemoteGATTCharacteristic).value!;
      pending += dec.decode(value);
      const parts = pending.split(/[\r\n]+/);
      pending = parts.pop() ?? '';   // last fragment may be incomplete
      for (const raw of parts) emit(raw.trim());
    });
  } catch {
    // Picked device doesn't expose our service – send() becomes a no-op.
  }

  const send = async (cmd: string) => {
    if (!chr) return;
    await chr.writeValueWithoutResponse(enc.encode(cmd + '\n'));
  };

  // Ping doubles as a "hello": the firmware re-broadcasts the catalog
  // and current states in response. Sending it here, after CCCD is
  // enabled, removes any race against the auto-broadcast on connect.
  if (chr) {
    try { await send('system:ping'); } catch { /* ignore */ }
  }

  return {
    name: device.name || device.id,
    hasCommandChar: !!chr,
    send,
    subscribe,
    disconnect: () => { try { device.gatt?.disconnect(); } catch { /* ignore */ } },
  };
}

export async function connect(onClosed: () => void): Promise<Connection> {
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [SVC],
  });
  await device.gatt!.connect();
  const conn = await wire(device, onClosed);
  rememberDevice(device.id, conn.name);
  return conn;
}

/** Silent reconnect. With no argument, targets the most-recent device. */
export async function tryReconnect(
  onClosed: () => void,
  targetId?: string,
): Promise<Connection | null> {
  const id = targetId ?? lastKnownDevice()?.id ?? null;
  const bt = navigator.bluetooth as (typeof navigator.bluetooth) & BluetoothExt;
  if (!id || !bt?.getDevices) return null;

  let device: BluetoothDevice | undefined;
  try {
    const devices = await bt.getDevices();
    device = devices.find(d => d.id === id);
  } catch { return null; }
  if (!device) { forgetDevice(id); return null; }

  try {
    await device.gatt!.connect();
    const conn = await wire(device, onClosed);
    if (!conn.hasCommandChar) { conn.disconnect(); return null; }

    const got = await new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => { unsub(); resolve(false); }, PING_TIMEOUT_MS);
      const unsub = conn.subscribe((line) => {
        if (line === 'system:ping:Confirmed') {
          window.clearTimeout(timer); unsub(); resolve(true);
        }
      });
      conn.send('system:ping').catch(() => { window.clearTimeout(timer); unsub(); resolve(false); });
    });

    if (!got) { conn.disconnect(); return null; }
    rememberDevice(id, conn.name);
    return conn;
  } catch { return null; }
}

/* ---------------- protocol helpers ---------------- */

export interface ParsedReply {
  device: string;
  action: string;
  status: 'Confirmed' | 'Denied';
}

/** Parse "<device>:<action>:Confirmed" or "<device>:<action>:Denied". */
export function parseReply(line: string): ParsedReply | null {
  const m = /^([^:]+):(.*):(Confirmed|Denied)$/.exec(line);
  if (!m) return null;
  return { device: m[1], action: m[2], status: m[3] as 'Confirmed' | 'Denied' };
}
