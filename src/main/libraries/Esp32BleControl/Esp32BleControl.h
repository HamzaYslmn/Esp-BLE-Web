/*
 * Esp32BleControl - minimal BLE command bus + widget catalog.
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
#include <vector>
#include <functional>

#include "Esp32BLEwidget.h"
#include "Esp32BLEswitch.h"
#include "Esp32BLEbutton.h"
#include "Esp32BLEslider.h"
#include "Esp32BLEtimer.h"
#include "Esp32BLEseparator.h"

class Esp32BleControl : public BLEServerCallbacks, public BLECharacteristicCallbacks {
public:
  static constexpr const char* DEFAULT_SVC_UUID  = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
  static constexpr const char* DEFAULT_CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

  /* ---------------- lifecycle ---------------- */

  void begin(const char* deviceName,
             const char* svcUuid  = DEFAULT_SVC_UUID,
             const char* charUuid = DEFAULT_CHAR_UUID) {
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
    String out = s;
    if (!out.endsWith("\n")) out += "\n";
    Serial.print(out);
    if (!_connected || !_chr) return;

    const uint8_t* p   = (const uint8_t*)out.c_str();
    size_t         len = out.length();
    int            mtu = BLEDevice::getMTU();
    size_t         max = (mtu > 3 ? (size_t)(mtu - 3) : 20);
    while (len) {
      size_t n = len > max ? max : len;
      _chr->setValue((uint8_t*)p, n);
      _chr->notify();
      p += n; len -= n;
    }
  }

private:
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
    String buf(c->getValue().c_str());
    int start = 0;
    for (int i = 0; i <= (int)buf.length(); i++) {
      char ch = (i < (int)buf.length()) ? buf[i] : '\n';
      if (ch == '\n' || ch == '\r') {
        if (i > start) dispatch(buf.substring(start, i));
        start = i + 1;
      }
    }
  }

  /* ---------------- dispatch ---------------- */

  void dispatch(String line) {
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

  std::vector<BleWidget*> _widgets;
};
