/*
 * BleSlider - analog 1-D widget. Useful for PWM, DAC, dimming, fan
 * speed, anything with a numeric range.
 *
 *   ble.addSlider("led", "Brightness", 0, 255, 0, [](int v) {
 *     analogWrite(2, v);
 *   });
 *
 * Wire protocol:
 *   widget:<id>:slider:<label>:<min>:<max>:<initial>      catalog
 *   <id>:set:<value>                                      write
 *   <id>:set:<value>:Confirmed                            reply / state
 */
#pragma once

#include "Esp32BLEwidget.h"

class BleSlider : public BleWidget {
public:
  using Callback = std::function<void(int)>;

  BleSlider(const char* id, const char* label,
            int minV, int maxV, int initial, Callback cb)
    : _id(id), _label(label),
      _minV(minV), _maxV(maxV),
      _value(clampToRange(initial, minV, maxV)),
      _cb(cb) {}

  const String& id() const override { return _id; }
  int value() const                 { return _value; }

  String catalogLine() const override {
    return "widget:" + _id + ":slider:" + _label + ":" +
           String(_minV) + ":" + String(_maxV) + ":" + String(_value);
  }

  bool   hasState()  const override { return true; }
  String stateLine() const override {
    return _id + ":set:" + String(_value) + ":Confirmed";
  }

  bool handle(const String& action) override {
    if (!action.startsWith("set:")) return false;
    int v = action.substring(4).toInt();
    _value = clampToRange(v, _minV, _maxV);
    if (_cb) _cb(_value);
    return true;
  }

private:
  static int clampToRange(int v, int lo, int hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  String   _id;
  String   _label;
  int      _minV;
  int      _maxV;
  int      _value;
  Callback _cb;
};
