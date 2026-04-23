# BLE Relay PWA (React + Vite)

Offline-first PWA that controls the ESP32 relay firmware in
`../src/main/main.ino` over Web Bluetooth (Nordic UART Service).

## Stack

- React 18 + TypeScript
- Vite 5
- `vite-plugin-pwa` (Workbox) for full offline support

## Setup

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # outputs dist/
pnpm preview      # serve the production build
```

Web Bluetooth requires **HTTPS** or **localhost** and works in Chrome/Edge on
desktop and Android. iOS Safari does not support it.

## Use

1. Power up the ESP32 (advertises as `ESP32-Relay`).
2. Open the app, tap **Connect**, pick the device.
3. Toggle relays. The ESP32 echoes a `STATUS` line and the UI syncs from it.
