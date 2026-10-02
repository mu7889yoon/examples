# Cardputer BLE Macro Pad - UiFlow2 / MicroPython
#
# Phase 1:
# - Draw a 4 x 3 macro-pad layout on the Cardputer display.
# - Read the selected 12 Cardputer keys.
# - Highlight the selected macro and print its planned F13-F24 mapping.
#
# BLE HID is implemented in ble_hid_keyboard.py because UiFlow2's standard
# BLE blocks are generic BLE data communication, not a macOS keyboard profile.

import time

import M5
from M5 import *
from hardware import MatrixKeyboard

from ble_hid_keyboard import BleHidKeyboard


SCREEN_WIDTH = 240
SCREEN_HEIGHT = 135

BACKGROUND = 0x10141C
CARD_COLOR = 0x202733
CARD_SELECTED = 0x314A68
BORDER_COLOR = 0x536277
BORDER_SELECTED = 0x55B9FF
TEXT_COLOR = 0xF2F5F7
MUTED_COLOR = 0x9AA8B5

KEY_LAYOUT = (
    ("4", "5", "6", "7"),
    ("r", "t", "y", "u"),
    ("d", "f", "g", "h"),
)

# Labels are deliberately short so they remain readable in 55px-wide cards.
MACROS = (
    ("4", "Chrome", "chrome"),
    ("5", "Slack", "slack"),
    ("6", "Term", "terminal"),
    ("7", "Code", "code"),
    ("R", "Finder", "finder"),
    ("T", "Safari", "safari"),
    ("Y", "Mail", "mail"),
    ("U", "Cal", "calendar"),
    ("D", "Notes", "notes"),
    ("F", "Music", "music"),
    ("G", "ChatGPT", "chatgpt"),
    ("H", "Setup", "settings"),
)

CARD_X = 4
CARD_Y = 26
CARD_WIDTH = 55
CARD_HEIGHT = 33
CARD_GAP_X = 3
CARD_GAP_Y = 3

matrix_keyboard = None
ble_keyboard = None
selected_index = -1
selected_until = 0

# F13 through F24 are HID usages 0x68 through 0x73.
HID_FUNCTION_KEYS = tuple(range(0x68, 0x74))


def lcd_text(value, x, y, color=TEXT_COLOR):
    """Draw a string using the current M5.Lcd font."""
    M5.Lcd.setTextColor(color, BACKGROUND)
    M5.Lcd.setCursor(x, y)
    M5.Lcd.printf(str(value))


def card_position(index):
    row = index // 4
    column = index % 4
    x = CARD_X + column * (CARD_WIDTH + CARD_GAP_X)
    y = CARD_Y + row * (CARD_HEIGHT + CARD_GAP_Y)
    return x, y


def draw_chrome_icon(x, y):
    center_x = x + 27
    center_y = y + 10
    M5.Lcd.fillCircle(center_x, center_y, 9, 0xEA4335)
    M5.Lcd.fillRect(center_x - 9, center_y, 18, 9, 0xFBBC05)
    M5.Lcd.fillRect(center_x, center_y, 9, 9, 0x34A853)
    M5.Lcd.fillCircle(center_x, center_y, 4, 0x4285F4)


def draw_slack_icon(x, y):
    center_x = x + 27
    center_y = y + 10
    M5.Lcd.fillRoundRect(center_x - 3, center_y - 10, 6, 20, 3, 0x36C5F0)
    M5.Lcd.fillRoundRect(center_x - 10, center_y - 3, 20, 6, 3, 0x2EB67D)
    M5.Lcd.fillCircle(center_x - 7, center_y - 7, 3, 0xE01E5A)
    M5.Lcd.fillCircle(center_x + 7, center_y + 7, 3, 0xECB22E)


def draw_terminal_icon(x, y):
    M5.Lcd.fillRoundRect(x + 17, y + 2, 20, 16, 3, 0x303B48)
    M5.Lcd.drawRoundRect(x + 17, y + 2, 20, 16, 3, 0x7F8C99)
    M5.Lcd.setTextColor(0x78E08F, 0x303B48)
    M5.Lcd.setCursor(x + 20, y + 4)
    M5.Lcd.printf(">_")


def draw_code_icon(x, y):
    M5.Lcd.setTextColor(0x66D9EF, BACKGROUND)
    M5.Lcd.setCursor(x + 18, y + 1)
    M5.Lcd.printf("<>")


def draw_finder_icon(x, y):
    center_x = x + 27
    center_y = y + 10
    M5.Lcd.fillRoundRect(x + 18, y + 1, 18, 18, 5, 0x50A7E8)
    M5.Lcd.drawLine(center_x, y + 3, center_x, y + 17, 0xDDF4FF)
    M5.Lcd.drawLine(x + 21, y + 10, x + 24, y + 8, 0x102B42)
    M5.Lcd.drawLine(x + 30, y + 8, x + 33, y + 10, 0x102B42)
    M5.Lcd.drawLine(x + 23, y + 14, x + 31, y + 14, 0x102B42)


def draw_safari_icon(x, y):
    center_x = x + 27
    center_y = y + 10
    M5.Lcd.fillCircle(center_x, center_y, 9, 0x2D8CFF)
    M5.Lcd.drawCircle(center_x, center_y, 9, 0xD9F0FF)
    M5.Lcd.fillTriangle(center_x, center_y - 6, center_x - 3, center_y + 4, center_x + 4, center_y + 2, 0xFFFFFF)
    M5.Lcd.fillTriangle(center_x, center_y + 6, center_x + 3, center_y - 4, center_x - 4, center_y - 2, 0xF15B5B)


def draw_mail_icon(x, y):
    M5.Lcd.fillRoundRect(x + 17, y + 4, 20, 14, 2, 0xF3F6F8)
    M5.Lcd.drawLine(x + 18, y + 5, x + 27, y + 12, 0x527187)
    M5.Lcd.drawLine(x + 36, y + 5, x + 27, y + 12, 0x527187)


def draw_calendar_icon(x, y):
    M5.Lcd.fillRoundRect(x + 18, y + 2, 18, 17, 3, 0xF05B5B)
    M5.Lcd.fillRect(x + 18, y + 8, 18, 11, 0xF5F7F8)
    M5.Lcd.fillRect(x + 21, y + 4, 2, 5, 0xFFFFFF)
    M5.Lcd.fillRect(x + 31, y + 4, 2, 5, 0xFFFFFF)
    M5.Lcd.drawLine(x + 23, y + 12, x + 31, y + 12, 0xF05B5B)


def draw_notes_icon(x, y):
    M5.Lcd.fillRoundRect(x + 19, y + 1, 16, 18, 2, 0xFFD866)
    M5.Lcd.fillRect(x + 22, y + 6, 10, 2, 0x8A6D1D)
    M5.Lcd.fillRect(x + 22, y + 10, 8, 2, 0x8A6D1D)
    M5.Lcd.fillRect(x + 22, y + 14, 6, 2, 0x8A6D1D)


def draw_music_icon(x, y):
    M5.Lcd.fillCircle(x + 23, y + 15, 4, 0xB975E8)
    M5.Lcd.fillRect(x + 26, y + 4, 3, 12, 0xB975E8)
    M5.Lcd.fillRect(x + 27, y + 4, 8, 3, 0xB975E8)
    M5.Lcd.fillCircle(x + 33, y + 8, 3, 0xB975E8)


def draw_chatgpt_icon(x, y):
    center_x = x + 27
    center_y = y + 10
    M5.Lcd.fillCircle(center_x, center_y, 9, 0x19A974)
    M5.Lcd.drawCircle(center_x, center_y, 5, 0xE5FFF2)
    M5.Lcd.drawLine(center_x - 5, center_y, center_x + 4, center_y - 4, 0xE5FFF2)
    M5.Lcd.drawLine(center_x - 3, center_y + 4, center_x + 5, center_y + 1, 0xE5FFF2)


def draw_settings_icon(x, y):
    center_x = x + 27
    center_y = y + 10
    M5.Lcd.fillCircle(center_x, center_y, 8, 0x7F8C99)
    M5.Lcd.fillCircle(center_x, center_y, 3, BACKGROUND)
    for dx, dy in ((0, -10), (0, 10), (-10, 0), (10, 0)):
        M5.Lcd.fillRect(center_x + dx - 2, center_y + dy - 2, 4, 4, 0x7F8C99)


def draw_icon(kind, x, y):
    if kind == "chrome":
        draw_chrome_icon(x, y)
    elif kind == "slack":
        draw_slack_icon(x, y)
    elif kind == "terminal":
        draw_terminal_icon(x, y)
    elif kind == "code":
        draw_code_icon(x, y)
    elif kind == "finder":
        draw_finder_icon(x, y)
    elif kind == "safari":
        draw_safari_icon(x, y)
    elif kind == "mail":
        draw_mail_icon(x, y)
    elif kind == "calendar":
        draw_calendar_icon(x, y)
    elif kind == "notes":
        draw_notes_icon(x, y)
    elif kind == "music":
        draw_music_icon(x, y)
    elif kind == "chatgpt":
        draw_chatgpt_icon(x, y)
    elif kind == "settings":
        draw_settings_icon(x, y)


def draw_macro(index, selected=False):
    label_key, label, icon = MACROS[index]
    x, y = card_position(index)
    fill_color = CARD_SELECTED if selected else CARD_COLOR
    border_color = BORDER_SELECTED if selected else BORDER_COLOR

    M5.Lcd.fillRoundRect(x, y, CARD_WIDTH, CARD_HEIGHT, 5, fill_color)
    M5.Lcd.drawRoundRect(x, y, CARD_WIDTH, CARD_HEIGHT, 5, border_color)
    draw_icon(icon, x, y)

    # Keep the labels centered enough for the small display without requiring
    # font measurement APIs that differ between UiFlow2 firmware versions.
    text_x = x + 5
    if len(label) <= 3:
        text_x = x + 21
    elif len(label) <= 5:
        text_x = x + 15
    elif len(label) == 6:
        text_x = x + 10
    lcd_text(label, text_x, y + 21, TEXT_COLOR)


def draw_screen():
    M5.Lcd.fillScreen(BACKGROUND)
    M5.Lcd.setFont(M5.Lcd.FONTS.DejaVu9)
    lcd_text("MACRO PAD", 5, 4, TEXT_COLOR)
    lcd_text("BLE HID", 187, 4, MUTED_COLOR)
    M5.Lcd.drawLine(4, 20, SCREEN_WIDTH - 5, 20, BORDER_COLOR)

    for index in range(len(MACROS)):
        draw_macro(index, index == selected_index)


def on_key_pressed(_keyboard):
    global selected_index, selected_until

    keycode = matrix_keyboard.get_key()
    if keycode < 0x20 or keycode > 0x7E:
        return

    key = chr(keycode).lower()
    for index, macro in enumerate(MACROS):
        if macro[0].lower() == key:
            selected_index = index
            selected_until = time.ticks_add(time.ticks_ms(), 700)
            draw_screen()
            ble_keyboard.tap(HID_FUNCTION_KEYS[index])
            print("{} -> F{} ({})".format(key.upper(), 13 + index, macro[1]))
            return


def setup():
    global matrix_keyboard, ble_keyboard

    M5.begin()
    M5.Lcd.setRotation(1)
    ble_keyboard = BleHidKeyboard()
    matrix_keyboard = MatrixKeyboard()
    matrix_keyboard.set_callback(on_key_pressed)
    draw_screen()
    print("Cardputer BLE Macro Pad")
    print("Press one of: 4567 / RTYU / DFGH")


def loop():
    global selected_index

    M5.update()
    ble_keyboard.poll()
    if selected_index >= 0 and time.ticks_diff(time.ticks_ms(), selected_until) >= 0:
        selected_index = -1
        draw_screen()
    time.sleep_ms(10)


if __name__ == "__main__":
    try:
        setup()
        while True:
            loop()
    except (Exception, KeyboardInterrupt) as error:
        try:
            from utility import print_error_msg

            print_error_msg(error)
        except ImportError:
            print(error)
