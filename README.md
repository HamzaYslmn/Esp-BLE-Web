# Esp32-BLE-Relay

> Control an ESP32 from your phone or laptop over **Web Bluetooth** — no app store, no cloud, no Wi-Fi router. The PWA discovers the device's widgets at runtime, so adding a switch / slider / timer on the firmware automatically makes it appear in the UI.

**Live PWA:** https://hamzayslmn.github.io/Esp-BLE-Web/

---

## Highlights

- **Zero-config UI** — the ESP32 broadcasts a *widget catalog* on connect; the web app builds the screen from it. No per-device frontend code.
- **5 widget kinds** — `switch`, `button`, `slider` (analog 0..N), `timer`, `separator` (titled section header).
- **Per-widget callbacks on the firmware** — clean Arduino sketches with no global string parsing:
  ```cpp
  ble.addSwitch ("relay1", "Lamp", [](bool on) { digitalWrite(26, on ? LOW : HIGH); });
  ble.addSlider ("led",   "Brightness", 0, 255, 0, [](int v) { analogWrite(2, v); });
  ble.addTimer  ("timer1","Auto-off", 20*60, "relay1:OFF");
  ```
- **Installable PWA** — works offline after first load, installs to home screen, dark Obsidian-style UI.
- **Web Bluetooth direct** — the browser talks to BLE GATT directly (Chrome / Edge / Opera on Android, macOS, Windows, Linux).
- **Auto-reconnect to known devices** — once you've granted access, the app reconnects on its own.
- **Per-device customisation, stored locally** — rename any widget, override timer durations.
- **Real edit mode** — pencil icon turns the board green; tap any card to rename or change its duration; auto-saved.
- **Read-only on-device facts shown in the UI** — e.g. timer cards display the on-complete command (`→ relay1:OFF`) so you can see exactly what the firmware will fire.
- **Self-contained timers** — every timer runs its own FreeRTOS task on the ESP32; cancelling one doesn't affect the others.
- **Insertion-order catalog** — sketches can interleave `addSeparator(...)` between widgets to visually group them in the app.

---

## Repository layout

```
.
├── frontend/                      Vite + React + TS PWA (Web Bluetooth client)
│   ├── src/
│   │   ├── App.tsx               Top bar, screens
│   │   ├── Board.tsx             Widget grid + edit mode
│   │   ├── WidgetView.tsx        Switch / Button / Slider / Timer / Separator cards
│   │   ├── widgets.ts            Catalog parsing + label & duration overrides
│   │   ├── ble.ts                Web Bluetooth wrapper, MTU 247
│   │   ├── store.ts              Zustand global state
│   │   └── styles.css            Obsidian-style theme (Tailwind palette)
│   ├── vite.config.ts            base: '/Esp-BLE-Web/' (GH Pages)
│   └── package.json
├── src/                            EspBleWeb Arduino library (header-only)
│   ├── EspBleWeb.h                 BLE server, widget registry, dispatcher
│   ├── BleWidget.h                 Abstract base class for every widget
│   ├── BleSwitch.h                 ON/OFF widget (callback)
│   ├── BleButton.h                 Momentary press widget (callback)
│   ├── BleSlider.h                 Analog 1-D widget (callback)
│   ├── BleTimer.h                  Self-running countdown widget (FreeRTOS task)
│   └── BleSeparator.h              Visual section divider in the catalog
├── examples/
│   └── BasicRelay/BasicRelay.ino   Demo: 2 relays + 1 dimmer + 1 timer
├── library.properties              Arduino Library Manager metadata
├── keywords.txt                    Arduino IDE syntax highlighting
├── .github/workflows/static.yml    Builds frontend/ and deploys to GH Pages
└── LICENSE
```

---

## Wire protocol

A single line-oriented protocol over one BLE characteristic (write+notify), terminated by `\n`.

### App → Device

```
<id>:<action>
```

| Widget   | Action(s)                              | Example                        |
|----------|----------------------------------------|--------------------------------|
| switch   | `ON` / `OFF`                           | `relay1:ON`                    |
| button   | `press`                                | `buzz:press`                   |
| slider   | `set:<int>`                            | `led:set:128`                  |
| timer    | `start:<seconds>[:<onComplete>]`, `cancel` | `timer1:start:1200:relay1:OFF` |
| system   | `ping` (rebroadcast catalog + state)   | `system:ping`                  |

### Device → App

```
<id>:<action>:Confirmed         on success
<id>:<action>:Denied            on failure
<id>:<remaining_seconds>        timer countdown tick
```

### Catalog (broadcast on `system:ping` in **insertion order**)

```
widget:<id>:switch:<label>
widget:<id>:button:<label>:press
widget:<id>:slider:<label>:<min>:<max>:<initial>
widget:<id>:timer:<label>:<seconds>:<onComplete>
widget:<id>:separator                       # plain divider
widget:<id>:separator:<label>               # titled section header
widgets:end                                 # sentinel
```

> Labels MUST NOT contain `:`. The PWA also lets the user rename any widget locally — the override is keyed by device name + widget id and stored in `localStorage`.

### BLE service

| | |
|--|--|
| Service UUID         | `4fafc201-1fb5-459e-8fcc-c5c9c331914b` |
| Characteristic UUID  | `beb5483e-36e1-4688-b7f5-ea07361b26a8` |
| Properties           | WRITE, WRITE_NR, NOTIFY |
| Requested ATT MTU    | 247 (so catalog lines fit in one notification) |

---

## Firmware quick start

`examples/BasicRelay/BasicRelay.ino`:

```cpp
#include <EspBleWeb.h>

#define DEVICE_NAME   "ESP32-BLE-Relay"
#define ACTIVE_LEVEL  LOW           // active-LOW relay boards

#define RELAY1_PIN    26
#define RELAY2_PIN    25
#define LED_PIN       2

EspBleWeb ble;

void setRelay(uint8_t pin, bool on) {
  digitalWrite(pin, on ? ACTIVE_LEVEL : !ACTIVE_LEVEL);
}

void onRelay1(bool on)       { setRelay(RELAY1_PIN, on); }
void onRelay2(bool on)       { setRelay(RELAY2_PIN, on); }
void onBrightness(int value) { analogWrite(LED_PIN, value); }   // 0..255

void setup() {
  Serial.begin(115200);
  pinMode(RELAY1_PIN, OUTPUT); setRelay(RELAY1_PIN, false);
  pinMode(RELAY2_PIN, OUTPUT); setRelay(RELAY2_PIN, false);
  pinMode(LED_PIN,    OUTPUT); analogWrite(LED_PIN, 0);

  ble.begin(DEVICE_NAME);

  ble.addSeparator("sec1", "Relays");
  ble.addSwitch   ("relay1", "Lamp", onRelay1);
  ble.addSwitch   ("relay2", "Fan",  onRelay2);

  ble.addSeparator("sec2", "Dimmer");
  ble.addSlider   ("led", "Brightness", 0, 255, 0, onBrightness);

  ble.addSeparator("sec3", "Timers");
  ble.addTimer    ("timer1", "Auto-off", 20 * 60, "relay1:OFF");
}

void loop() {
  ble.loop();                       // serve advertising restarts
  vTaskDelay(pdMS_TO_TICKS(50));    // yield to BLE host + idle task
  delay(10);                        // ESP idle-current saver, see Hackaday article
}
```

### Library API

```cpp
// Switches — own their state, fire callback on toggle ---------------
ble.addSwitch(id, label, [](bool on){ ... }, /*initial=*/false);

// Buttons — wire action is "press" -----------------------------------
ble.addButton(id, label, [](){ ... });

// Sliders — analog 0..N --------------------------------------------
ble.addSlider(id, label, /*min*/0, /*max*/255, /*initial*/0,
              [](int v){ analogWrite(PIN, v); });

// Timers — own FreeRTOS task, fires `onComplete` line on the bus ---
ble.addTimer(id, label, /*seconds*/20*60, /*onComplete*/"relay1:OFF");

// Visual grouping --------------------------------------------------
ble.addSeparator(id);                                 // thin divider
ble.addSeparator(id, "Section title");                // titled rule
```

Every widget inherits from `BleWidget` (see `BleWidget.h`). The control class keeps a single `std::vector<BleWidget*>` and routes incoming commands by id — there is **no per-kind capacity limit**, no `MAX_SWITCHES`/`MAX_TIMERS` constants. Add a new widget kind by writing one header that inherits from `BleWidget` and a one-line factory in `EspBleWeb.h`.

### Limits

None. Widgets are stored in a `std::vector<BleWidget*>` and grow as you register them.

### Install & flash

**Option A — Library Manager (once published):** search for `EspBleWeb` in *Arduino IDE → Library Manager* and install.

**Option B — Local install:** clone this repo into your sketchbook's `libraries/` folder, e.g.
```
~/Documents/Arduino/libraries/Esp-BLE-Web/
```
then restart the Arduino IDE.

1. Open `examples/BasicRelay/BasicRelay.ino` (`File → Examples → EspBleWeb → BasicRelay` after install).
2. Make sure the **ESP32 boards package** is installed; pick your board + port.
3. **Upload**, then open the Serial Monitor at 115200 to see `[BLE] Ready: ESP32-BLE-Relay`.

---

## Web app quick start

### Use the hosted version

Just open https://hamzayslmn.github.io/Esp-BLE-Web/ in **Chrome / Edge / Opera** (Android, macOS, Windows, Linux). Tap **Connect**, pick `ESP32-BLE-Relay`, and the widgets appear automatically.

> Web Bluetooth requires HTTPS or `localhost`, and a Chromium-based browser. iOS Safari does not support Web Bluetooth (use the Bluefy browser as a workaround).

### Run locally

```powershell
cd frontend
pnpm install
pnpm dev          # http://localhost:5173 — Web Bluetooth works on localhost
pnpm build        # production build into dist/, base = /Esp-BLE-Web/
pnpm preview      # serves the built dist/
```

### Install as a PWA

Open the site in Chrome / Edge → menu → *Install app* (or *Add to Home Screen* on Android). After install, the app runs offline; the SW caches all assets and revalidates on the next visit.

### App features

- **Device picker** with auto-reconnect to previously-connected devices (Web Bluetooth `getDevices()` + a localStorage allow-list).
- **Live state sync** — switch state, slider value, and timer countdown are pushed from the device via NOTIFY.
- **Edit mode** (pencil icon, top right):
  - Click any card to rename it (auto-saved).
  - Click a timer card to change its duration in minutes (auto-saved, override stored locally).
  - Cards get a green border so you know editing is on.
- **Sliders** drag to set value; outgoing writes are throttled (~20 Hz) so the BLE bus isn't flooded; final value is committed on pointer-up.
- **Timer cards** show the on-complete command read-only (`→ relay1:OFF`); the command itself can only be changed in the firmware.
- **Settings** (gear icon) — manage / forget known devices, clear all local overrides.
- **Theme** — Obsidian-style graphite + a single violet accent (Tailwind `violet-500`); emerald (`emerald-500`) for edit mode; red (`red-500`) for Disconnect.

---

## GitHub Pages deployment

The `.github/workflows/static.yml` workflow:

1. Triggers on `push` to `main` **only when the commit message contains `release`**, or on manual dispatch.
2. Installs pnpm + Node 20, then builds `frontend/` (`vite build` sets `NODE_ENV=production`, which switches `base` to `/Esp-BLE-Web/`).
3. Uploads `frontend/dist/` and deploys it to the `github-pages` environment.

To publish a new version:

```bash
git commit -am "release: slider widget + per-widget callbacks"
git push
```

Or trigger manually from GitHub → *Actions* → *Deploy static content to Pages* → *Run workflow*.

---

## Browser support

| Browser | Web Bluetooth | PWA install |
|---------|---------------|-------------|
| Chrome / Edge / Opera (Android, Windows, macOS, Linux) | ✅ | ✅ |
| Chrome OS | ✅ | ✅ |
| Safari (macOS / iOS / iPadOS) | ❌ (use Bluefy on iOS) | partial |
| Firefox | ❌ (behind disabled flag) | ✅ |

---

## License

[MIT](LICENSE)
