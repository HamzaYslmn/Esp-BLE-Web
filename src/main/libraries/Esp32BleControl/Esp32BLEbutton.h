/*
 * BleButton - momentary press widget.
 *
 *   ble.addButton("buzz", "Buzz", []() {
 *     tone(33, 1000, 200);
 *   });
 *
 * The central sends "<id>:press" on tap; the button fires its callback.
 */
#pragma once

#include "Esp32BLEwidget.h"

class BleButton : public BleWidget {
public:
  using Callback = std::function<void()>;

  BleButton(const char* id, const char* label, Callback cb)
    : _id(id), _label(label), _cb(cb) {}

  const String& id() const override { return _id; }

  String catalogLine() const override {
    return "widget:" + _id + ":button:" + _label + ":press";
  }

  bool handle(const String& action) override {
    if (action != "press") return false;
    if (_cb) _cb();
    return true;
  }

private:
  String   _id;
  String   _label;
  Callback _cb;
};
