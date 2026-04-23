/*
 * BleSwitch - 2-state ON/OFF widget.
 *
 *   ble.addSwitch("relay1", "Lamp", [](bool on) {
 *     digitalWrite(26, on ? LOW : HIGH);
 *   });
 *
 * Owns its own bool state and runs the callback whenever the central
 * writes "<id>:ON" or "<id>:OFF".
 */
#pragma once

#include "Esp32BLEwidget.h"

class BleSwitch : public BleWidget {
public:
  using Callback = std::function<void(bool)>;

  BleSwitch(const char* id, const char* label, Callback cb, bool initial = false)
    : _id(id), _label(label), _cb(cb), _state(initial) {}

  const String& id() const override { return _id; }

  String catalogLine() const override {
    return "widget:" + _id + ":switch:" + _label;
  }

  bool   hasState()  const override { return true; }
  String stateLine() const override {
    return _id + ":" + (_state ? "ON" : "OFF") + ":Confirmed";
  }

  bool handle(const String& action) override {
    if (action == "ON")  { _state = true;  if (_cb) _cb(true);  return true; }
    if (action == "OFF") { _state = false; if (_cb) _cb(false); return true; }
    return false;
  }

private:
  String   _id;
  String   _label;
  Callback _cb;
  bool     _state = false;
};
