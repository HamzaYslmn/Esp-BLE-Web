/*
 * EspBleWeb - minimal BLE command bus + widget catalog,
 * paired with the Web Bluetooth PWA at
 * https://github.com/HamzaYslmn/Esp-BLE-Web
 *
 * Wire protocol (one line per message, terminated by '\n'):
 *
 *   App  -> Device:   "<id>:<action>"
 *   Device -> App:    "<id>:<action>:Confirmed"
 *                or   "<id>:<action>:Denied"
 *
 * Widget catalog (broadcast on `system:ping`):
 *   widget:<id>:switch:<label>
 *   widget:<id>:button:<label>:press
 *   widget:<id>:slider:<label>:<min>:<max>:<initial>
 *   widget:<id>:timer:<label>:<seconds>:<onComplete>
 *   widget:<id>:separator[:<label>]
 *   widgets:end                                      (sentinel)
 * Labels MUST NOT contain ':'.
 *
 * Built-in handlers:
 *   - "system:ping"   -> rebroadcast catalog + every stateful widget's
 *                        current value, then reply "system:ping:Confirmed".
 *
 * Usage:
 *   1. addSwitch / addButton / addSlider / addTimer / addSeparator at setup;
 *   2. call ble.begin(name) once;
 *   3. call ble.loop() from Arduino loop() (which is already a FreeRTOS
 *      task on ESP32) and yield with vTaskDelay so the BLE host stack
 *      can run.
 *
 * Header-only.
 */
#pragma once

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>
#include <esp_timer.h>
#include <vector>
#include <functional>

#include "BleWidget.h"
#include "BleSwitch.h"
#include "BleButton.h"
#include "BleSlider.h"
#include "BleTimer.h"
#include "BleSeparator.h"

class EspBleWeb : public BLEServerCallbacks, public BLECharacteristicCallbacks {
public:
  static constexpr const char* DEFAULT_SVC_UUID  = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
  static constexpr const char* DEFAULT_CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

  ~EspBleWeb() {
    // MARK: cleanup — only meaningful in tests; in real sketches the
    // EspBleWeb instance is global and lives forever.
    for (auto* w : _widgets) delete w;
    _widgets.clear();
    if (_busMutex) { vSemaphoreDelete(_busMutex); _busMutex = nullptr; }
  }

  /* ---------------- lifecycle ---------------- */

  void begin(const char* deviceName,
             const char* svcUuid  = DEFAULT_SVC_UUID,
             const char* charUuid = DEFAULT_CHAR_UUID) {
    // MARK: recursive bus mutex — sendLine() is called from BLE host task
    // (replies, ping) AND from the BleTimer task (1 Hz ticks). Without
    // serialisation they race over _chr->setValue/notify and over the
    // _widgets iteration in dispatch(). Recursive so dispatch() can call
    // sendLine() while already holding the lock.
    if (!_busMutex) _busMutex = xSemaphoreCreateRecursiveMutex();

    BLEDevice::init(deviceName);
    BLEDevice::setMTU(247);   // larger so catalog lines fit in one notification

    setupGatt(svcUuid, charUuid);
    setupAdvertising(deviceName, svcUuid);
    _started = true;

    // Hand each already-registered widget its send / dispatch hooks
    // (timers spawn their FreeRTOS task here). Widgets registered
    // *after* begin() are attached on the fly inside add().
    for (auto* w : _widgets) attachWidget(w);

    Serial.printf("[BLE] Ready: %s (%u widgets)\n", deviceName, (unsigned)_widgets.size());
  }

  void loop() {
    if (_needsAdvertise && (int32_t)(millis() - _advertiseAtMs) >= 0) {
      _needsAdvertise = false;
      if (_adv) _adv->start();
    }

    // MARK: cooperative widget tick. BleTimer's countdown lives here —
    // no FreeRTOS task per timer (~3 KB stack saved each). esp_timer
    // gives the deadline; this loop just polls. Run under the bus
    // mutex so handle() (BLE host task) and poll() (this task) never
    // touch a widget's fields concurrently.
    {
      BusLock lock(_busMutex);
      int64_t nowUs = esp_timer_get_time();
      for (auto* w : _widgets) w->poll(nowUs);
    }
  }

  /* ---------------- widget registration (factory helpers) ---------------- */

  void addSwitch(const char* id, const char* label,
                 BleSwitch::Callback cb, bool initial = false) {
    add(new BleSwitch(id, label, cb, initial));
  }
  void addButton(const char* id, const char* label, BleButton::Callback cb) {
    add(new BleButton(id, label, cb));
  }
  void addSlider(const char* id, const char* label,
                 int minV, int maxV, int initial, BleSlider::Callback cb) {
    add(new BleSlider(id, label, minV, maxV, initial, cb));
  }
  void addTimer(const char* id, const char* label,
                uint32_t seconds, const char* onComplete) {
    add(new BleTimer(id, label, seconds, onComplete));
  }
  void addSeparator(const char* id, const char* label = "") {
    add(new BleSeparator(id, label));
  }

  /* ---------------- output ---------------- */

  /** Push a raw line (will append '\n'). Long payloads are chunked so
   *  they fit within the negotiated ATT MTU (data = MTU - 3 bytes). */
  void sendLine(const String& s) {
    BusLock lock(_busMutex);                       // MARK: serialise BLE writes
    String out;
    out.reserve(s.length() + 1);                   // avoid the '+= "\n"' realloc
    out = s;
    if (!out.endsWith("\n")) out += "\n";
    Serial.print(out);
    if (!_connected || !_chr) return;

    const uint8_t* p   = (const uint8_t*)out.c_str();
    size_t         len = out.length();
    int            mtu = BLEDevice::getMTU();
    size_t         max = (mtu > 3 ? (size_t)(mtu - 3) : 20);
    bool           first = true;
    while (len) {
      // MARK: yield between chunks so the BLE host task can drain its
      // notify queue under bursty traffic (e.g. catalog rebroadcast).
      if (!first) vTaskDelay(1);
      size_t n = len > max ? max : len;
      _chr->setValue((uint8_t*)p, n);
      _chr->notify();
      p += n; len -= n;
      first = false;
    }
  }

private:
  // MARK: RAII guard for the recursive bus mutex.
  struct BusLock {
    SemaphoreHandle_t m;
    explicit BusLock(SemaphoreHandle_t mutex) : m(mutex) {
      if (m) xSemaphoreTakeRecursive(m, portMAX_DELAY);
    }
    ~BusLock() { if (m) xSemaphoreGiveRecursive(m); }
    BusLock(const BusLock&) = delete;
    BusLock& operator=(const BusLock&) = delete;
  };

  /* ---------------- setup helpers ---------------- */

  void setupGatt(const char* svcUuid, const char* charUuid) {
    BLEServer*  srv = BLEDevice::createServer();
    srv->setCallbacks(this);

    BLEService* svc = srv->createService(svcUuid);
    _chr = svc->createCharacteristic(
      charUuid,
      BLECharacteristic::PROPERTY_WRITE |
      BLECharacteristic::PROPERTY_WRITE_NR |
      BLECharacteristic::PROPERTY_NOTIFY);
    _chr->addDescriptor(new BLE2902());
    _chr->setCallbacks(this);
    svc->start();
  }

  void setupAdvertising(const char* deviceName, const char* svcUuid) {
    BLEAdvertisementData advData;
    advData.setFlags(0x06);
    advData.setCompleteServices(BLEUUID(svcUuid));

    BLEAdvertisementData scanResp;
    scanResp.setName(deviceName);

    _adv = BLEDevice::getAdvertising();
    _adv->setAdvertisementData(advData);
    _adv->setScanResponseData(scanResp);
    _adv->setScanResponse(true);
    BLEDevice::startAdvertising();
  }

  void add(BleWidget* w) {
    _widgets.push_back(w);
    if (_started) attachWidget(w);
  }

  void attachWidget(BleWidget* w) {
    w->attach([this](const String& s){ this->sendLine(s); },
              [this](const String& s){ this->dispatch(s); });
  }

  /* ---------------- BLE callbacks ---------------- */

  void onConnect(BLEServer*, esp_ble_gatts_cb_param_t* p) override {
    _connected = true;
    const uint8_t* a = p->connect.remote_bda;
    Serial.printf("[BLE] Connected: %02X:%02X:%02X:%02X:%02X:%02X\n",
                  a[0], a[1], a[2], a[3], a[4], a[5]);
  }
  void onDisconnect(BLEServer*, esp_ble_gatts_cb_param_t* p) override {
    _connected = false;
    const uint8_t* a = p->disconnect.remote_bda;
    Serial.printf("[BLE] Disconnected: %02X:%02X:%02X:%02X:%02X:%02X (reason 0x%02X)\n",
                  a[0], a[1], a[2], a[3], a[4], a[5], p->disconnect.reason);
    _advertiseAtMs  = millis() + 50;
    _needsAdvertise = true;
  }
  void onWrite(BLECharacteristic* c) override {
    // MARK: iterate std::string in place; one String allocation per
    // *line* instead of two per character buffer.
    std::string buf = c->getValue();
    size_t start = 0;
    for (size_t i = 0; i <= buf.size(); ++i) {
      char ch = (i < buf.size()) ? buf[i] : '\n';
      if (ch == '\n' || ch == '\r') {
        if (i > start) {
          String line; line.reserve(i - start);
          line.concat(buf.data() + start, i - start);
          dispatch(line);
        }
        start = i + 1;
      }
    }
  }

  /* ---------------- dispatch ---------------- */

  void dispatch(String line) {
    BusLock lock(_busMutex);                       // MARK: serialise dispatch
    line.trim();
    if (!line.length()) return;

    Serial.printf("[Command] %s\n", line.c_str());

    int colon = line.indexOf(':');
    if (colon < 0) { sendLine(line + ":Denied"); return; }

    String device = line.substring(0, colon);
    String action = line.substring(colon + 1);

    if (device == "system" && action == "ping") {
      broadcastCatalog();
      broadcastStates();
      sendLine("system:ping:Confirmed");
      return;
    }

    // Single dispatch loop: find the widget by id, let it handle the action.
    for (auto* w : _widgets) {
      if (w->id() == device) {
        bool ok = w->handle(action);
        // Sliders echo their authoritative (clamped) value; everything
        // else just gets the standard <id>:<action>:Confirmed reply.
        if (ok && w->hasState() && action.startsWith("set:")) {
          sendLine(w->stateLine());
        } else {
          reply(device, action, ok);
        }
        return;
      }
    }
    reply(device, action, false);
  }

  void reply(const String& device, const String& action, bool ok) {
    sendLine(device + ":" + action + (ok ? ":Confirmed" : ":Denied"));
  }

  /* ---------------- catalog / state broadcast ---------------- */

  void broadcastCatalog() {
    for (auto* w : _widgets) sendLine(w->catalogLine());
    sendLine("widgets:end");
  }
  void broadcastStates() {
    for (auto* w : _widgets) if (w->hasState()) sendLine(w->stateLine());
  }

  /* ---------------- state ---------------- */

  BLECharacteristic* _chr            = nullptr;
  BLEAdvertising*    _adv            = nullptr;
  bool               _connected      = false;
  bool               _started        = false;
  volatile bool      _needsAdvertise = false;
  uint32_t           _advertiseAtMs  = 0;
  SemaphoreHandle_t  _busMutex       = nullptr;   // MARK: serialises BLE bus access

  std::vector<BleWidget*> _widgets;
};
