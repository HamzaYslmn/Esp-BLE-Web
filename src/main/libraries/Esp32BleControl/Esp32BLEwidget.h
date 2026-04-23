/*
 * BleWidget - abstract base for everything that lives in the catalog.
 *
 * Every concrete widget (switch / button / slider / timer / separator)
 * implements a small interface. Esp32BleControl just keeps a single
 * `std::vector<BleWidget*>` and routes incoming commands by id. There
 * are no per-kind arrays, dispatch loops, or capacity limits.
 *
 * Subclass contract:
 *   - id()              stable identifier used in the wire protocol
 *   - catalogLine()     "widget:<id>:<kind>:..." line broadcast on ping
 *   - handle(action)    called when the central writes "<id>:<action>";
 *                       return true on success, false to reply :Denied
 *   - hasState()        override to true if the widget exposes a value
 *   - stateLine()       broadcast on ping (only if hasState() is true)
 *   - attach(send,dsp)  optional hook for widgets that need to send
 *                       lines on their own (timer countdown, etc.)
 */
#pragma once

#include <Arduino.h>
#include <functional>

class BleWidget {
public:
  using SendFn     = std::function<void(const String&)>;
  using DispatchFn = std::function<void(const String&)>;

  virtual ~BleWidget() = default;

  virtual const String& id() const = 0;
  virtual String catalogLine() const = 0;

  virtual bool   handle(const String& /*action*/) { return false; }
  virtual bool   hasState() const                 { return false;  }
  virtual String stateLine() const                { return "";     }

  // Default no-op. Timers override this to spawn their FreeRTOS task.
  virtual void attach(SendFn /*send*/, DispatchFn /*dispatch*/) {}
};
