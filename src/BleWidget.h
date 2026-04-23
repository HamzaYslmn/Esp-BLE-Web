/*
 * BleWidget - abstract base for everything the bus knows about.
 *
 * Each concrete widget owns its id + label + state (if any) and contributes:
 *
 *   catalogLine() : the "widget:..." string broadcast on system:ping
 *   handle(act)   : returns true if the widget consumed the action
 *   stateLine()   : the "<id>:<...>:Confirmed" line broadcast as state
 *                   (only used when hasState() returns true)
 *   poll(nowUs)   : cooperative tick driven by EspBleWeb::loop()
 *                   (BleTimer overrides this to advance its countdown)
 *   attach(...)   : one-time hook so the widget can grab the bus's
 *                   send + dispatch lambdas (timer needs this)
 *
 * EspBleWeb keeps a single std::vector<BleWidget*> and walks it for
 * catalog generation, command dispatch, state broadcast, and ticking.
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
  virtual bool   hasState()  const                { return false; }
  virtual String stateLine() const                { return String(); }

  // Cooperative tick from EspBleWeb::loop(). Default no-op; BleTimer
  // overrides to advance its countdown without spawning a task.
  // `nowUs` comes from esp_timer_get_time() so deadlines stay accurate
  // regardless of delay() / interrupt latency in user code.
  virtual void   poll(int64_t /*nowUs*/) {}

  virtual void attach(SendFn /*send*/, DispatchFn /*dispatch*/) {}
};
