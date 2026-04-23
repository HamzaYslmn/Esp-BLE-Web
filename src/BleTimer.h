/*
 * BleTimer - countdown widget with its own FreeRTOS task.
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
 * On expiry the dispatch hook re-enters the bus with `<onComplete>`,
 * so a timer can drive any other widget by id (e.g. "relay1:OFF").
 */
#pragma once

#include "BleWidget.h"
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/semphr.h>
#include <esp_timer.h>   // MARK: RTC-backed 64-bit µs clock, immune to millis() rollover & delay()

class BleTimer : public BleWidget {
public:
  BleTimer(const char* id, const char* label, uint32_t seconds, const char* onComplete)
    : _id(id), _label(label), _seconds(seconds), _onComplete(onComplete) {}

  const String& id() const override { return _id; }

  String catalogLine() const override {
    return "widget:" + _id + ":timer:" + _label + ":" + String(_seconds) + ":" + _onComplete;
  }

  // Spawn the dedicated countdown task once the bus is ready.
  void attach(SendFn send, DispatchFn dispatch) override {
    if (_task) return;
    _send     = send;
    _dispatch = dispatch;
    _sem      = xSemaphoreCreateBinary();
    xTaskCreatePinnedToCore(&BleTimer::trampoline, "bleTimer",
                            3072, this, 1, &_task, APP_CPU_NUM);
  }

  bool handle(const String& action) override {
    if (action == "cancel") {
      _cancelFlag = true;
      if (_sem) xSemaphoreGive(_sem);
      return true;
    }
    if (!action.startsWith("start:")) return false;
    String rest = action.substring(6);            // "<sec>" or "<sec>:<onComplete>"
    int p = rest.indexOf(':');
    uint32_t secs = (uint32_t)(p < 0 ? rest.toInt() : rest.substring(0, p).toInt());
    if (secs == 0) return false;
    _pendingSecs       = secs;
    _pendingOnComplete = (p < 0) ? _onComplete : rest.substring(p + 1);
    _startFlag         = true;
    if (_sem) xSemaphoreGive(_sem);
    return true;
  }

private:
  static void trampoline(void* arg) { static_cast<BleTimer*>(arg)->run(); }

  void run() {
    for (;;) {
      xSemaphoreTake(_sem, portMAX_DELAY);
      if (!_startFlag) { _cancelFlag = false; continue; }
      _startFlag  = false;
      _cancelFlag = false;

      // MARK: absolute deadlines on the ESP32 high-resolution timer (µs, 64-bit).
      // esp_timer_get_time() is driven by hardware and keeps ticking regardless
      // of delay() / interrupt latency in user code, so the countdown stays
      // accurate and tick cadence never drifts.
      uint32_t secs       = _pendingSecs;
      String   onComplete = _pendingOnComplete;
      const int64_t startUs = esp_timer_get_time();
      const int64_t endUs   = startUs + (int64_t)secs * 1000000LL;
      int64_t       nextTickUs = startUs + 1000000LL;
      bool          cancelled  = false;

      while (esp_timer_get_time() < endUs) {
        int64_t now    = esp_timer_get_time();
        int64_t waitUs = nextTickUs - now;
        if (waitUs < 0) waitUs = 0;
        TickType_t waitTicks = pdMS_TO_TICKS((uint32_t)((waitUs + 999) / 1000));
        if (xSemaphoreTake(_sem, waitTicks) == pdTRUE && _cancelFlag) {
          _cancelFlag = false;
          cancelled   = true;
          break;
        }
        int64_t remainingUs = endUs - esp_timer_get_time();
        if (remainingUs > 0) {
          uint32_t remaining = (uint32_t)((remainingUs + 999999LL) / 1000000LL);
          if (_send) _send(_id + ":" + String(remaining) + ":Confirmed");
        }
        // Absolute schedule (no drift accumulation); skip past missed ticks.
        nextTickUs += 1000000LL;
        int64_t catchUp = esp_timer_get_time();
        if (nextTickUs <= catchUp) nextTickUs = catchUp + 1000000LL;
      }

      if (cancelled) continue;
      if (_send) _send(_id + ":0:Confirmed");
      if (onComplete.length() && _dispatch) _dispatch(onComplete);
    }
  }

  String   _id;
  String   _label;
  String   _onComplete;
  uint32_t _seconds = 0;

  TaskHandle_t      _task = nullptr;
  SemaphoreHandle_t _sem  = nullptr;
  volatile bool     _startFlag  = false;
  volatile bool     _cancelFlag = false;
  uint32_t          _pendingSecs = 0;
  String            _pendingOnComplete;
  SendFn            _send;
  DispatchFn        _dispatch;
};
