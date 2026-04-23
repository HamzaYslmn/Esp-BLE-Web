/*
 * BleWidget - abstract base for everything the bus knows about.
 *
 * Each concrete widget owns its id + label + state (if any) and
 * contributes:
 *
 *   catalogLine() : the "widget:..." string broadcast on system:ping
 *   handle(act)   : returns true if the widget consumed the action
 *   stateLine()   : the "<id>:<...>:Confirmed" line broadcast as state
 *                   (only used when hasState() returns true)
 *   attach(...)   : one-time hook so the widget can grab the bus's
 *                   send + dispatch lambdas (only timer needs this)
 *
 * The control class keeps a single std::vector<BleWidget*> and walks
 * it for both catalog generation and command dispatch.
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

  virtual void attach(SendFn /*send*/, DispatchFn /*dispatch*/) {}
};
