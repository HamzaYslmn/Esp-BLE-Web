/*
 * BleSeparator - non-interactive layout marker. Broadcasts a
 * "widget:<id>:separator[:<label>]" line so the PWA can group
 * widgets visually. Accepts no commands.
 */
#pragma once

#include "BleWidget.h"

class BleSeparator : public BleWidget {
public:
  BleSeparator(const char* id, const char* label = "")
    : _id(id), _label(label) {}

  const String& id() const override { return _id; }

  String catalogLine() const override {
    return _label.length()
      ? "widget:" + _id + ":separator:" + _label
      : "widget:" + _id + ":separator";
  }

private:
  String _id;
  String _label;
};
