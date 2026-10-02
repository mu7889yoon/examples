"""Display a minimal Hello World on an M5Stack Cardputer running UIFlow2 MicroPython."""

import M5


BLACK = 0x000000
WHITE = 0xFFFFFF
MESSAGE = "helloworld"

lcd = M5.Lcd
lcd.fillScreen(BLACK)
lcd.setTextSize(3)
lcd.setTextColor(WHITE, BLACK)

x = (lcd.width() - lcd.textWidth(MESSAGE)) // 2
y = (lcd.height() - 24) // 2
lcd.drawString(MESSAGE, x, y)
