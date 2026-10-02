#include <M5Cardputer.h>

#include <BLEAdvertising.h>
#include <BLEDevice.h>
#include <BLEHIDDevice.h>
#include <BLEServer.h>
#include <BLESecurity.h>
#include <esp_gap_ble_api.h>

#include <atomic>

// Cardputer display in landscape orientation (rotation 1): 240 x 135 px.
constexpr int kScreenWidth = 240;
constexpr int kScreenHeight = 135;
constexpr uint32_t kBackground = 0x10141C;
constexpr uint32_t kCard = 0x202733;
constexpr uint32_t kSelected = 0x314A68;
constexpr uint32_t kText = 0xF2F5F7;
constexpr uint32_t kMuted = 0x9AA8B5;
constexpr uint32_t kAccent = 0x55B9FF;

constexpr char kBleName[] = "Cardputer Macro";
static_assert(sizeof(kBleName) - 1 + 2 + 3 + 4 + 4 <= 31,
              "BLE advertising payload exceeds 31 bytes");
constexpr uint8_t kReportId = 1;
constexpr uint8_t kFirstFunctionUsage = 0x68;  // F13 (through F24).
constexpr uint32_t kHighlightMs = 700;
constexpr uint32_t kDefaultTimerMs = 5 * 60 * 1000;

// The physical 3-6 keys switch modes, so the twelve macros use the left
// QWER / ASDF / ZXCV block instead of the old MicroPython 4567 row.
struct Macro {
  char key;
  const char* label;
};

constexpr Macro kMacros[] = {
    {'q', "Chrome"}, {'w', "Slack"}, {'e', "Term"}, {'r', "Code"},
    {'a', "Finder"}, {'s', "Safari"}, {'d', "Mail"}, {'f', "Cal"},
    {'z', "Notes"}, {'x', "Music"}, {'c', "ChatGPT"}, {'v', "Setup"},
};
constexpr size_t kMacroCount = sizeof(kMacros) / sizeof(kMacros[0]);

// Keyboard report: modifiers, reserved, and six key slots. Report ID 1 is
// supplied by the HID Report Reference descriptor created by BLEHIDDevice.
uint8_t kKeyboardReportMap[] = {
    0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x85, kReportId,
    0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7, 0x15, 0x00,
    0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02,
    0x95, 0x01, 0x75, 0x08, 0x81, 0x01,
    0x95, 0x05, 0x75, 0x01, 0x05, 0x08, 0x19, 0x01,
    0x29, 0x05, 0x91, 0x02, 0x95, 0x01, 0x75, 0x03,
    0x91, 0x01, 0x95, 0x06, 0x75, 0x08, 0x15, 0x00,
    0x25, 0x65, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65,
    0x81, 0x00, 0xC0,
};

enum class Mode : uint8_t { Macro = 3, Timer = 4, Slot5 = 5, Slot6 = 6 };
Mode currentMode = Mode::Macro;
BLECharacteristic* inputReport = nullptr;
std::atomic<bool> bleConnected{false};
std::atomic<bool> bleAuthenticated{false};
std::atomic<bool> bleStatusChanged{false};

bool modeWasDown[4] = {};
bool macroWasDown[kMacroCount] = {};
bool timerWasDown[4] = {};
int selectedMacro = -1;
uint32_t selectedUntil = 0;

uint32_t timerPresetMs = kDefaultTimerMs;
uint32_t timerRemainingMs = kDefaultTimerMs;
uint32_t timerLastTickMs = 0;
uint32_t timerLastDrawnSecond = UINT32_MAX;
bool timerRunning = false;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    bleConnected = true;
    bleAuthenticated = false;
    bleStatusChanged = true;
    Serial.println("BLE connected; waiting for encryption");
  }

  void onDisconnect(BLEServer*) override {
    bleConnected = false;
    bleAuthenticated = false;
    bleStatusChanged = true;
    BLEDevice::startAdvertising();
    Serial.println("BLE disconnected; advertising again");
  }
};

class SecurityCallbacks : public BLESecurityCallbacks {
  uint32_t onPassKeyRequest() override { return 0; }
  void onPassKeyNotify(uint32_t) override {}
  bool onSecurityRequest() override { return true; }
  bool onConfirmPIN(uint32_t) override { return true; }

  void onAuthenticationComplete(esp_ble_auth_cmpl_t result) override {
    bleAuthenticated = result.success;
    bleStatusChanged = true;
    Serial.printf("BLE authentication %s; stored bonds: %d\n",
                  result.success ? "succeeded" : "failed",
                  esp_ble_get_bond_device_num());
  }
};

ServerCallbacks serverCallbacks;
SecurityCallbacks securityCallbacks;

void beginBleKeyboard() {
  BLEDevice::init(kBleName);
  BLEDevice::setSecurityCallbacks(&securityCallbacks);
  BLEDevice::setEncryptionLevel(ESP_BLE_SEC_ENCRYPT);

  // Encrypted HID report permissions in BLEHIDDevice trigger pairing. The
  // ESP32 Bluedroid stack stores bond keys in NVS across power cycles.
  BLESecurity security;
  security.setAuthenticationMode(ESP_LE_AUTH_REQ_SC_BOND);
  security.setCapability(ESP_IO_CAP_NONE);
  security.setKeySize(16);
  security.setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
  security.setRespEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);

  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(&serverCallbacks);
  BLEHIDDevice* hid = new BLEHIDDevice(server);
  inputReport = hid->inputReport(kReportId);
  hid->outputReport(kReportId);
  hid->manufacturer()->setValue("Cardputer Projects");
  hid->hidInfo(0x00, 0x02);
  hid->reportMap(kKeyboardReportMap, sizeof(kKeyboardReportMap));
  hid->startServices();

  BLEAdvertising* advertising = BLEDevice::getAdvertising();
  // Keep the legacy advertisement below its 31-byte limit, including the
  // full name, HID service UUID, and keyboard appearance.
  BLEAdvertisementData payload;
  payload.setFlags(0x06);
  payload.setCompleteServices(BLEUUID(static_cast<uint16_t>(0x1812)));
  payload.setAppearance(HID_KEYBOARD);
  payload.setName(kBleName);
  advertising->setAdvertisementData(payload);
  advertising->setScanResponse(false);
  BLEDevice::startAdvertising();
  Serial.printf("BLE advertising; stored bonds: %d\n",
                esp_ble_get_bond_device_num());
}

const char* bleStatus() {
  if (!bleConnected) return "WAIT";
  return bleAuthenticated ? "READY" : "PAIR";
}

void drawHeader(const char* title) {
  auto& display = M5Cardputer.Display;
  display.fillScreen(kBackground);
  display.setTextColor(kText, kBackground);
  display.setTextSize(1);
  display.drawString(title, 5, 3);
  display.setTextColor(kMuted, kBackground);
  char status[16];
  snprintf(status, sizeof(status), "B%d %s", esp_ble_get_bond_device_num(),
           bleStatus());
  display.drawString(status, 177, 3);
  display.drawLine(4, 20, kScreenWidth - 5, 20, kMuted);
}

void drawMacroScreen() {
  auto& display = M5Cardputer.Display;
  drawHeader("3 MACRO  4 TIMER  5/6 MORE");
  for (size_t i = 0; i < kMacroCount; ++i) {
    const int x = 4 + (i % 4) * 59;
    const int y = 26 + (i / 4) * 35;
    const bool selected = static_cast<int>(i) == selectedMacro;
    display.fillRoundRect(x, y, 55, 31, 4, selected ? kSelected : kCard);
    display.drawRoundRect(x, y, 55, 31, 4, selected ? kAccent : kMuted);
    char keyLabel[2] = {static_cast<char>(kMacros[i].key - 32), '\0'};
    display.setTextColor(kAccent, selected ? kSelected : kCard);
    display.drawString(keyLabel, x + 4, y + 3);
    display.setTextColor(kText, selected ? kSelected : kCard);
    display.drawString(kMacros[i].label, x + 4, y + 18);
  }
}

void drawTimerScreen() {
  drawHeader("4 TIMER    SPACE start/pause");
  auto& display = M5Cardputer.Display;
  const uint32_t seconds = (timerRemainingMs + 999) / 1000;
  char timeText[12];
  snprintf(timeText, sizeof(timeText), "%02lu:%02lu",
           static_cast<unsigned long>(seconds / 60),
           static_cast<unsigned long>(seconds % 60));
  display.setTextColor(kText, kBackground);
  display.setTextSize(4);
  display.drawCentreString(timeText, kScreenWidth / 2, 42);
  display.setTextSize(1);
  display.drawCentreString(timerRemainingMs == 0 ? "DONE" :
                           (timerRunning ? "RUNNING" : "PAUSED"),
                           kScreenWidth / 2, 92);
  display.drawCentreString("= / -: 1 min    R: reset", kScreenWidth / 2, 116);
}

void drawReservedScreen() {
  drawHeader(currentMode == Mode::Slot5 ? "5 RESERVED" : "6 RESERVED");
  auto& display = M5Cardputer.Display;
  display.setTextColor(kText, kBackground);
  display.drawCentreString("Future mode", kScreenWidth / 2, 56);
  display.drawCentreString("Press 3 for macros", kScreenWidth / 2, 78);
}

void drawScreen() {
  switch (currentMode) {
    case Mode::Macro: drawMacroScreen(); break;
    case Mode::Timer: drawTimerScreen(); break;
    case Mode::Slot5:
    case Mode::Slot6: drawReservedScreen(); break;
  }
}

void tapFunctionKey(uint8_t usage) {
  if (!bleConnected || !bleAuthenticated || inputReport == nullptr) return;
  uint8_t report[8] = {0, 0, usage, 0, 0, 0, 0, 0};
  inputReport->setValue(report, sizeof(report));
  inputReport->notify();
  delay(20);
  report[2] = 0;
  inputReport->setValue(report, sizeof(report));
  inputReport->notify();
}

void syncModeKeyEdges() {
  for (size_t i = 0; i < kMacroCount; ++i) {
    macroWasDown[i] = M5Cardputer.Keyboard.isKeyPressed(kMacros[i].key);
  }
  const char timerKeys[] = {' ', '=', '-', 'r'};
  for (size_t i = 0; i < 4; ++i) {
    timerWasDown[i] = M5Cardputer.Keyboard.isKeyPressed(timerKeys[i]);
  }
}

void updateTimer(uint32_t now) {
  if (!timerRunning) return;
  const uint32_t elapsed = now - timerLastTickMs;
  timerLastTickMs = now;
  if (elapsed >= timerRemainingMs) {
    timerRemainingMs = 0;
    timerRunning = false;
  } else {
    timerRemainingMs -= elapsed;
  }
}

void handleKeyboard(uint32_t now) {
  const char modeKeys[] = {'3', '4', '5', '6'};
  for (size_t i = 0; i < 4; ++i) {
    const bool down = M5Cardputer.Keyboard.isKeyPressed(modeKeys[i]);
    if (down && !modeWasDown[i]) {
      currentMode = static_cast<Mode>(i + 3);
      selectedMacro = -1;
      timerLastDrawnSecond = UINT32_MAX;
      syncModeKeyEdges();
      drawScreen();
      modeWasDown[i] = down;
      return;
    }
    modeWasDown[i] = down;
  }

  if (currentMode == Mode::Macro) {
    for (size_t i = 0; i < kMacroCount; ++i) {
      const bool down = M5Cardputer.Keyboard.isKeyPressed(kMacros[i].key);
      if (down && !macroWasDown[i]) {
        selectedMacro = static_cast<int>(i);
        selectedUntil = now + kHighlightMs;
        tapFunctionKey(kFirstFunctionUsage + i);
        drawMacroScreen();
        Serial.printf("%c -> F%u (%s)\n", kMacros[i].key,
                      static_cast<unsigned>(13 + i), kMacros[i].label);
      }
      macroWasDown[i] = down;
    }
  } else if (currentMode == Mode::Timer) {
    const char timerKeys[] = {' ', '=', '-', 'r'};
    for (size_t i = 0; i < 4; ++i) {
      const bool down = M5Cardputer.Keyboard.isKeyPressed(timerKeys[i]);
      if (down && !timerWasDown[i]) {
        if (i == 0 && timerRemainingMs > 0) {
          timerRunning = !timerRunning;
          timerLastTickMs = now;
        } else if (i == 1 && !timerRunning && timerPresetMs < 99 * 60 * 1000) {
          timerPresetMs += 60 * 1000;
          timerRemainingMs = timerPresetMs;
        } else if (i == 2 && !timerRunning && timerPresetMs > 60 * 1000) {
          timerPresetMs -= 60 * 1000;
          timerRemainingMs = timerPresetMs;
        } else if (i == 3) {
          timerRunning = false;
          timerRemainingMs = timerPresetMs;
        }
        timerLastDrawnSecond = UINT32_MAX;
      }
      timerWasDown[i] = down;
    }
  }
}

void setup() {
  Serial.begin(115200);
  auto cfg = M5.config();
  M5Cardputer.begin(cfg, true);
  M5Cardputer.Display.setRotation(1);
  M5Cardputer.Display.setTextSize(1);
  beginBleKeyboard();
  drawScreen();
}

void loop() {
  M5Cardputer.update();
  const uint32_t now = millis();
  updateTimer(now);
  handleKeyboard(now);

  if (currentMode == Mode::Macro && selectedMacro >= 0 &&
      static_cast<int32_t>(now - selectedUntil) >= 0) {
    selectedMacro = -1;
    drawMacroScreen();
  }
  if (currentMode == Mode::Timer) {
    const uint32_t second = (timerRemainingMs + 999) / 1000;
    if (second != timerLastDrawnSecond) {
      timerLastDrawnSecond = second;
      drawTimerScreen();
    }
  }
  if (bleStatusChanged.exchange(false)) drawScreen();
  delay(5);
}
