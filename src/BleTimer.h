/*
 * BleTimer - cooperative countdown widget. No FreeRTOS task, no
 * semaphores, no per-instance mutex — the countdown advances from
 * EspBleWeb::loop() via the BleWidget::poll() hook.
 *
 *   ble.addTimer("timer1", "Auto-off", 20*60, "relay1:OFF");
 *
 * Wire protocol:
 *   widget:<id>:timer:<label>:<seconds>:<onComplete>      catalog
 *   <id>:start:<sec>[:<onComplete>]                       write (start)
 *   <id>:cancel                                           write (abort)
 *   <id>:<remaining_seconds>:Confirmed                    tick (every 1 s)
 *   <id>:0:Confirmed                                      tick (expired)
 *
 * Timing source: esp_timer_get_time() — 64-bit µs hardware clock,
 * unaffected by delay() in user code, immune to millis() rollover.
 *
 * On expiry the dispatch hook re-enters the bus with `<onComplete>`,
 * so a timer can drive any other widget by id (e.g. "relay1:OFF").
 *
 * Concurrency: handle() runs in the BLE host task under EspBleWeb's
 * recursive bus mutex; poll() runs in the main loop task also under
 * the bus mutex (taken by EspBleWeb::loop). Therefore the fields
 * below are always touched by exactly one task at a time — no extra
 * locking needed inside this class.
 */
#pragma once

#include "BleWidget.h"
#include <esp_timer.h>

class BleTimer : public BleWidget {
public:
  BleTimer(const char* id, const char* label, uint32_t seconds, const char* onComplete)
    : _id(id), _label(label), _onComplete(onComplete), _seconds(seconds) {}

  const String& id() const override { return _id; }

  String catalogLine() const override {
    return "widget:" + _id + ":timer:" + _label + ":" + String(_seconds) + ":" + _onComplete;
  }

  void attach(SendFn send, DispatchFn dispatch) override {
    _send     = send;
    _dispatch = dispatch;
  }

  // MARK: handle (start / cancel from bus)
  bool handle(const String& action) override {
    if (action == "cancel") { _running = false; return true; }
    if (!action.startsWith("start:")) return false;

    String rest = action.substring(6);              // "<sec>" or "<sec>:<onComplete>"
    int p = rest.indexOf(':');
    uint32_t secs = (uint32_t)(p < 0 ? rest.toInt() : rest.substring(0, p).toInt());
    if (secs == 0) return false;

    _activeOnComplete = (p < 0) ? _onComplete : rest.substring(p + 1);
    int64_t nowUs     = esp_timer_get_time();
    _endUs            = nowUs + (int64_t)secs * 1000000LL;
    _nextTickUs       = nowUs + 1000000LL;
    _running          = true;
    return true;
  }

  // MARK: poll (cooperative 1 Hz tick + expiry)
  void poll(int64_t nowUs) override {
    if (!_running) return;

    if (nowUs >= _endUs) {
      // Expired — copy onComplete first because _dispatch() may
      // re-enter and trigger a new start, which would overwrite
      // _activeOnComplete underneath us.
      String onc = _activeOnComplete;
      _running = false;
      if (_send)            _send(_id + ":0:Confirmed");
      if (onc.length() && _dispatch) _dispatch(onc);
      return;
    }

    if (nowUs >= _nextTickUs) {
      int64_t remainingUs = _endUs - nowUs;
      uint32_t remaining  = (uint32_t)((remainingUs + 999999LL) / 1000000LL);
      if (_send) _send(_id + ":" + String(remaining) + ":Confirmed");
      // Absolute schedule (zero drift); skip past any missed ticks.
      _nextTickUs += 1000000LL;
      if (_nextTickUs <= nowUs) _nextTickUs = nowUs + 1000000LL;
    }
  }

private:
  // MARK: state
  String   _id;
  String   _label;
  String   _onComplete;          // default action fired on expiry
  String   _activeOnComplete;    // override from current start command
  uint32_t _seconds = 0;         // catalog-time default duration

  // Countdown state. Touched under EspBleWeb's bus mutex, never both
  // at once from two tasks, so no extra synchronisation here.
  int64_t _endUs      = 0;
  int64_t _nextTickUs = 0;
  bool    _running    = false;

  SendFn     _send;
  DispatchFn _dispatch;
};
