# Esp32BleControl

Header-only Arduino library implementing a tiny BLE command bus for the
Esp32 BLE PWA. Each widget kind lives in its own header:

| Header               | Class       | Catalog line                                 |
|----------------------|-------------|----------------------------------------------|
| `Esp32BLEswitch.h`   | `BleSwitch` | `widget:<id>:switch:<label>`                 |
| `Esp32BLEbutton.h`   | `BleButton` | `widget:<id>:button:<label>:<action>`        |
| `Esp32BLEtimer.h`    | `BleTimer`  | `widget:<id>:timer:<label>:<sec>:<onComplete>` |
| `Esp32BleControl.h`  | bus         | orchestrates the above                       |

Each `BleTimer` runs its own FreeRTOS task; countdowns happen
independently of the BLE callback thread and of every other timer.

## Wire protocol

One line per message, terminated with `\n`.

| Direction       | Format                              | Example                  |
|-----------------|-------------------------------------|--------------------------|
| App → Device    | `<device>:<action>`                 | `relay1:ON`              |
| Device → App    | `<device>:<action>:Confirmed`       | `relay1:ON:Confirmed`    |
| Device → App    | `<device>:<action>:Denied`          | `relay1:ON:Denied`       |

State broadcasts on connect look identical to confirmation lines, so the
PWA only ever parses one message shape.

## Built-in handlers

| Request                                       | Notes |
|-----------------------------------------------|-------|
| `system:ping`                                 | Re-broadcasts the catalog + every switch's current state, then replies `system:ping:Confirmed`. The PWA sends this right after enabling notifications. |
| `<id>:start:<sec>`                            | Start a registered timer; ticks every second |
| `<id>:start:<sec>:<dev>:<act>`                | Same, plus runs `<dev>:<act>` at expiry (overrides the default `onComplete`) |
| `<id>:cancel`                                 | Cancel and reply `Confirmed` |

While a timer is running it emits one line per second:

```
timer1:30:Confirmed
timer1:29:Confirmed
...
timer1:0:Confirmed
```

## Sketch usage

```cpp
#include "libraries/Esp32BleControl/Esp32BleControl.h"

Esp32BleControl ble;
bool relayState = false;

void setup() {
  Serial.begin(115200);
  ble.begin("ESP32-BLE-Relay");
  ble.onAction([](const String& device, const String& action) -> bool {
    // return true for Confirmed, false for Denied
    return false;
  });
  ble.addSwitch("relay1", "Relay 1",          &relayState);
  ble.addButton("buzz",   "Buzz",             "PRESS");
  ble.addTimer ("timer1", "Auto-off (20 min)", 20 * 60, "relay1:OFF");
}

void loop() {
  // Arduino loop() is already a FreeRTOS task on ESP32; service the
  // BLE bus and yield with vTaskDelay (never blocking delay()).
  ble.loop();
  vTaskDelay(pdMS_TO_TICKS(50));
}
```
