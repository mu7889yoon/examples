"""Minimal Bluetooth LE HID keyboard for UIFlow2 MicroPython.

The Cardputer-Adv firmware exposes the standard MicroPython ``bluetooth``
module.  This module registers the HID service directly so macOS can pair
with the Cardputer as a keyboard.
"""

import bluetooth
import time
import ubinascii
from micropython import const


_IRQ_CENTRAL_CONNECT = const(1)
_IRQ_CENTRAL_DISCONNECT = const(2)
_IRQ_GATTS_WRITE = const(3)
_IRQ_ENCRYPTION_UPDATE = const(28)
_IRQ_GET_SECRET = const(29)
_IRQ_SET_SECRET = const(30)
_IRQ_PASSKEY_ACTION = const(31)

_FLAG_READ = bluetooth.FLAG_READ
_FLAG_WRITE = bluetooth.FLAG_WRITE
_FLAG_WRITE_NO_RESPONSE = bluetooth.FLAG_WRITE_NO_RESPONSE
_FLAG_NOTIFY = bluetooth.FLAG_NOTIFY

_HID_SERVICE_UUID = bluetooth.UUID(0x1812)
_HID_INFO_UUID = bluetooth.UUID(0x2A4A)
_HID_REPORT_MAP_UUID = bluetooth.UUID(0x2A4B)
_HID_CONTROL_POINT_UUID = bluetooth.UUID(0x2A4C)
_HID_REPORT_UUID = bluetooth.UUID(0x2A4D)
_HID_PROTOCOL_MODE_UUID = bluetooth.UUID(0x2A4E)
_BOOT_KEYBOARD_INPUT_UUID = bluetooth.UUID(0x2A22)
_BOOT_KEYBOARD_OUTPUT_UUID = bluetooth.UUID(0x2A32)
_REPORT_REFERENCE_UUID = bluetooth.UUID(0x2908)

# Keep the complete advertising payload within BLE's 31-byte legacy limit.
DEVICE_NAME = "Cardputer Macro"
_SECRET_PATH = "/flash/ble_hid_secrets.dat"

# Keyboard report: modifiers, reserved byte, then six simultaneous keys.
KEYBOARD_REPORT_DESCRIPTOR = bytes(
    (
        0x05,
        0x01,  # Usage Page (Generic Desktop)
        0x09,
        0x06,  # Usage (Keyboard)
        0xA1,
        0x01,  # Collection (Application)
        0x85,
        0x01,  # Report ID (1)
        0x05,
        0x07,  # Usage Page (Keyboard/Keypad)
        0x19,
        0xE0,  # Usage Minimum (Left Control)
        0x29,
        0xE7,  # Usage Maximum (Right GUI)
        0x15,
        0x00,  # Logical Minimum (0)
        0x25,
        0x01,  # Logical Maximum (1)
        0x75,
        0x01,  # Report Size (1)
        0x95,
        0x08,  # Report Count (8)
        0x81,
        0x02,  # Input (Data, Variable, Absolute)
        0x95,
        0x01,  # Report Count (1)
        0x75,
        0x08,  # Report Size (8)
        0x81,
        0x01,  # Input (Constant)
        0x95,
        0x05,  # Report Count (5)
        0x75,
        0x01,  # Report Size (1)
        0x05,
        0x08,  # Usage Page (LEDs)
        0x19,
        0x01,  # Usage Minimum (Num Lock)
        0x29,
        0x05,  # Usage Maximum (Kana)
        0x91,
        0x02,  # Output (Data, Variable, Absolute)
        0x95,
        0x01,  # Report Count (1)
        0x75,
        0x03,  # Report Size (3)
        0x91,
        0x01,  # Output (Constant)
        0x95,
        0x06,  # Report Count (6)
        0x75,
        0x08,  # Report Size (8)
        0x15,
        0x00,  # Logical Minimum (0)
        0x25,
        0x65,  # Logical Maximum (101)
        0x05,
        0x07,  # Usage Page (Keyboard/Keypad)
        0x19,
        0x00,  # Usage Minimum (Reserved)
        0x29,
        0x65,  # Usage Maximum (Keyboard Application)
        0x81,
        0x00,  # Input (Data, Array, Absolute)
        0xC0,  # End Collection
    )
)


def _advertising_payload(name):
    name_bytes = name.encode("utf-8")
    return (
        bytes((2, 0x01, 0x06))
        + bytes((3, 0x03, 0x12, 0x18))
        + bytes((3, 0x19, 0xC1, 0x03))  # Keyboard appearance (961)
        + bytes((len(name_bytes) + 1, 0x09))
        + name_bytes
    )


class _SecretStore:
    """Small persistent store for BLE bonding secrets.

    The Bluetooth IRQ callback must answer GET_SECRET synchronously, so the
    latest values are kept in RAM and flushed from ``poll()`` instead.
    """

    def __init__(self, path):
        self._path = path
        self._entries = []
        self._dirty = False
        self._load()

    def _load(self):
        try:
            with open(self._path, "r") as stream:
                for line in stream:
                    parts = line.strip().split(":")
                    if len(parts) != 3:
                        continue
                    try:
                        entry = (
                            int(parts[0]),
                            ubinascii.unhexlify(parts[1]),
                            ubinascii.unhexlify(parts[2]),
                        )
                    except (ValueError, TypeError):
                        continue
                    self._replace(entry, mark_dirty=False)
        except OSError:
            pass

    def _replace(self, entry, mark_dirty=True):
        sec_type, key, _value = entry
        for index, old in enumerate(self._entries):
            if old[0] == sec_type and old[1] == key:
                self._entries[index] = entry
                self._dirty = self._dirty or mark_dirty
                return
        self._entries.append(entry)
        self._dirty = self._dirty or mark_dirty

    def get(self, sec_type, index, key):
        if key is None:
            values = [value for entry_type, _key, value in self._entries if entry_type == sec_type]
            return values[index] if index < len(values) else None
        key = bytes(key)
        for entry_type, entry_key, value in self._entries:
            if entry_type == sec_type and entry_key == key:
                return value
        return None

    def set(self, sec_type, key, value):
        key = bytes(key)
        if value is None:
            self._entries = [
                entry
                for entry in self._entries
                if not (entry[0] == sec_type and entry[1] == key)
            ]
            self._dirty = True
            return
        self._replace((sec_type, key, bytes(value)))

    def flush(self):
        if not self._dirty:
            return
        temporary_path = self._path + ".tmp"
        try:
            with open(temporary_path, "w") as stream:
                for sec_type, key, value in self._entries:
                    stream.write(
                        "{}:{}:{}\n".format(
                            sec_type,
                            ubinascii.hexlify(key).decode(),
                            ubinascii.hexlify(value).decode(),
                        )
                    )
            try:
                import os

                os.remove(self._path)
            except OSError:
                pass
            import os

            os.rename(temporary_path, self._path)
            self._dirty = False
        except OSError as error:
            print("BLE secret save failed: {}".format(error))


class BleHidKeyboard:
    def __init__(self, name=DEVICE_NAME):
        self._name = name
        self._ble = bluetooth.BLE()
        self._conn_handle = None
        # The Report Reference descriptor carries Report ID 1.  The BLE HID
        # Report characteristic contains the 8-byte keyboard payload itself.
        self._report = bytes(8)
        self._report_handle = None
        self._boot_protocol = False
        self._pair_at = None
        self._encrypted = False
        self._bonded = False
        self._secrets = _SecretStore(_SECRET_PATH)

        self._ble.active(True)
        try:
            # Use the controller's public address so the identity remains
            # stable across restarts when the firmware provides one.
            self._ble.config(addr_mode=0x00)
        except (TypeError, ValueError):
            pass
        try:
            # Newer MicroPython builds expose these bonding options.  Older
            # UiFlow2 builds reject them, so keep the pairing fallback below.
            self._ble.config(bond=True, mitm=False, le_secure=False, io=3)
            print("BLE HID bonding enabled")
        except (TypeError, ValueError):
            print("BLE HID bonding config unavailable")
        self._ble.irq(self._irq)

        hid_service = (
            _HID_SERVICE_UUID,
            (
                (_HID_INFO_UUID, _FLAG_READ),
                (_HID_REPORT_MAP_UUID, _FLAG_READ),
                (_HID_CONTROL_POINT_UUID, _FLAG_WRITE_NO_RESPONSE),
                (
                    _HID_REPORT_UUID,
                    _FLAG_READ | _FLAG_NOTIFY,
                    ((_REPORT_REFERENCE_UUID, _FLAG_READ),),
                ),
                (
                    _HID_REPORT_UUID,
                    _FLAG_READ | _FLAG_WRITE | _FLAG_WRITE_NO_RESPONSE,
                    ((_REPORT_REFERENCE_UUID, _FLAG_READ),),
                ),
                (_HID_PROTOCOL_MODE_UUID, _FLAG_READ | _FLAG_WRITE_NO_RESPONSE),
                (_BOOT_KEYBOARD_INPUT_UUID, _FLAG_READ | _FLAG_NOTIFY),
                (
                    _BOOT_KEYBOARD_OUTPUT_UUID,
                    _FLAG_READ | _FLAG_WRITE | _FLAG_WRITE_NO_RESPONSE,
                ),
            ),
        )

        handles = self._ble.gatts_register_services((hid_service,))[0]
        self._info_handle = handles[0]
        self._map_handle = handles[1]
        self._control_handle = handles[2]
        self._report_handle = handles[3]
        self._report_reference_handle = handles[4]
        self._output_handle = handles[5]
        self._output_reference_handle = handles[6]
        self._protocol_handle = handles[7]
        self._boot_input_handle = handles[8]
        self._boot_output_handle = handles[9]
        # Cardputer's UIFlow firmware restores its default name while the
        # services are registered, so set the GAP name afterwards.
        self._ble.config(gap_name=self._name)

        self._ble.gatts_write(self._info_handle, b"\x11\x01\x00\x02")
        self._ble.gatts_write(self._map_handle, KEYBOARD_REPORT_DESCRIPTOR)
        self._ble.gatts_write(self._report_handle, self._report)
        self._ble.gatts_write(self._report_reference_handle, b"\x01\x01")
        self._ble.gatts_write(self._output_handle, b"\x01\x00")
        self._ble.gatts_write(self._output_reference_handle, b"\x01\x02")
        self._ble.gatts_write(self._protocol_handle, b"\x01")
        self._ble.gatts_write(self._boot_input_handle, bytes(8))
        self._ble.gatts_write(self._boot_output_handle, b"\x00")
        self._advertise()

    def _advertise(self):
        self._ble.gap_advertise(
            100000,
            adv_data=_advertising_payload(self._name),
        )
        print("BLE HID advertising: {}".format(self._name))

    def _irq(self, event, data):
        if event == _IRQ_CENTRAL_CONNECT:
            self._conn_handle = data[0]
            self._encrypted = False
            self._bonded = False
            print("BLE HID connected")
            # Let macOS finish service discovery before starting pairing.
            # Requesting it from the IRQ can race with the first GATT reads.
            self._pair_at = time.ticks_add(time.ticks_ms(), 500)
        elif event == _IRQ_CENTRAL_DISCONNECT:
            self._conn_handle = None
            self._boot_protocol = False
            self._pair_at = None
            self._encrypted = False
            self._bonded = False
            self._secrets.flush()
            print("BLE HID disconnected")
            try:
                self._advertise()
            except OSError:
                # The BLE controller can already be restarting during a
                # MicroPython soft reset. Advertising will be started again
                # by the new instance immediately afterwards.
                pass
        elif event == _IRQ_GATTS_WRITE:
            _conn_handle, attr_handle = data
            if attr_handle == self._protocol_handle:
                self._boot_protocol = self._ble.gatts_read(attr_handle) == b"\x00"
                print("BLE HID protocol: {}".format("boot" if self._boot_protocol else "report"))
        elif event == _IRQ_ENCRYPTION_UPDATE:
            self._encrypted = bool(data[1])
            self._bonded = bool(data[3])
            if self._encrypted:
                self._pair_at = None
            print("BLE HID encryption: {}".format(data))
        elif event == _IRQ_GET_SECRET:
            sec_type, index, key = data
            print(
                "BLE HID get secret: {} {} {}".format(
                    sec_type, index, bytes(key) if key else None
                )
            )
            return self._secrets.get(sec_type, index, key)
        elif event == _IRQ_SET_SECRET:
            sec_type, key, value = data
            key = bytes(key)
            value = bytes(value) if value else None
            print("BLE HID set secret: {} {} {}".format(sec_type, key, value))
            self._secrets.set(sec_type, key, value)
            return True
        elif event == _IRQ_PASSKEY_ACTION:
            print("BLE HID passkey action: {}".format(data))

    def is_connected(self):
        return self._conn_handle is not None

    def poll(self):
        """Run delayed BLE work from the application loop."""
        self._secrets.flush()
        if self._pair_at is None or self._conn_handle is None:
            return
        if self._encrypted:
            self._pair_at = None
            return
        if time.ticks_diff(time.ticks_ms(), self._pair_at) < 0:
            return

        self._pair_at = None
        if not hasattr(self._ble, "gap_pair"):
            print("BLE HID pairing API unavailable")
            return
        try:
            self._ble.gap_pair(self._conn_handle)
            print("BLE HID pairing requested")
        except Exception as error:
            print("BLE HID pairing request failed: {}".format(error))

    def tap(self, usage):
        """Send one HID key press followed by a release report."""
        if not self.is_connected():
            print("BLE HID not connected; usage {} skipped".format(usage))
            return False

        if self._boot_protocol:
            handle = self._boot_input_handle
            pressed = bytes((0, 0, usage, 0, 0, 0, 0, 0))
            released = bytes(8)
        else:
            handle = self._report_handle
            pressed = bytes((0, 0, usage, 0, 0, 0, 0, 0))
            released = bytes(8)
        self._report = pressed
        self._ble.gatts_notify(self._conn_handle, handle, pressed)
        time.sleep_ms(25)
        self._report = released
        self._ble.gatts_notify(self._conn_handle, handle, released)
        return True
