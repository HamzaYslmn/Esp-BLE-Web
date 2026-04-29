/*
 * BleSwitch - ON/OFF widget. Owns its boolean state.
 *
 *   ble.addSwitch("relay1", "Lamp", [](bool on){ digitalWrite(26, on); });
 *
 * Wire protocol:
 *   widget:<id>:switch:<label>      catalog
 *   <id>:ON | <id>:OFF | <id>:TOGGLE  write
 *   <id>:ON:Confirmed               reply / state
 */
#pragma once

#include "BleWidget.h"

class BleSwitch : public BleWidget {
public:
  using Callback = std::function<void(bool)>;

  BleSwitch(const char* id, const char* label, Callback cb, bool initial = false)
    : _id(id), _label(label), _state(initial), _cb(cb) {}

  const String& id() const override { return _id; }
  bool state() const                { return _state; }

  String catalogLine() const override { return "widget:" + _id + ":switch:" + _label; }
  bool   hasState()    const override { return true; }
  String stateLine()   const override { return _id + ":" + (_state ? "ON" : "OFF") + ":Confirmed"; }

  bool handle(const String& action) override {
    if (action == "ON")          _state = true;
    else if (action == "OFF")    _state = false;
    else if (action == "TOGGLE") _state = !_state;
    else                         return false;
    if (_cb) _cb(_state);
    return true;
  }

private:
  String   _id;
  String   _label;
  bool     _state;
  Callback _cb;
};
