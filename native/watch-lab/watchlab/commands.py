"""Builders for the protobuf commands the lab sends. Ported from Gadgetbridge's services/Xiaomi*Service.java.

Command types: 1 auth, 2 system, 7 notification, 8 health, 10 weather, 18 music.
"""
from __future__ import annotations

import os
import time
from datetime import datetime
from typing import Optional

from .proto import xiaomi_pb2
from .proto.xiaomi import (wear_common_pb2, wear_fitness_pb2, wear_notification_pb2, wear_system_pb2)

Command = xiaomi_pb2.Command

# system (2)
SYS = 2
SYS_BATTERY = 1
SYS_DEVICE_INFO = 2
SYS_CLOCK = 3
SYS_FIND_PHONE = 17
SYS_FIND_WATCH = 18
SYS_DEVICE_STATE_GET = 78
SYS_DEVICE_STATE = 79

# notification (7)
NOTIF = 7
NOTIF_SEND = 0
NOTIF_DISMISS = 1
NOTIF_CALL_REJECT = 2
NOTIF_CALL_IGNORE = 5
NOTIF_OPEN_ON_PHONE = 8

# health (8)
HEALTH = 8
HEALTH_SET_USER_INFO = 0
HEALTH_FETCH_TODAY = 1
HEALTH_FETCH_PAST = 2
HEALTH_FETCH_REQUEST = 3
HEALTH_FETCH_ACK = 5
HEALTH_SPO2_GET = 8
HEALTH_HR_GET = 10
HEALTH_HR_SET = 11
HEALTH_STANDING_GET = 12
HEALTH_STRESS_GET = 14
HEALTH_GOAL_NOTIFICATION_GET = 21
HEALTH_VITALITY_GET = 35
HEALTH_GOALS_GET = 42

# weather (10)
WEATHER = 10
WEATHER_SET_CURRENT = 0
WEATHER_DAILY = 1
WEATHER_HOURLY = 2
WEATHER_REQUEST = 3
WEATHER_GET_LOCATIONS = 5
WEATHER_SET_LOCATIONS = 6
WEATHER_ADD_LOCATION = 7
WEATHER_REMOVE_LOCATIONS = 8
WEATHER_SET_PREFS = 10

# music (18)
MUSIC = 18
MUSIC_GET = 0
MUSIC_SEND = 1
MUSIC_BUTTON = 2

MUSIC_KEYS = {0: "play", 1: "pause", 3: "previous", 4: "next", 5: "volume"}


def simple(ctype: int, subtype: int) -> Command:
    return Command(type=ctype, subtype=subtype)


# ---- system ----------------------------------------------------------------------------------

def tz_name() -> str:
    name = os.environ.get("LAB_TZ")
    if name:
        return name
    try:
        import tzlocal  # optional
        return str(tzlocal.get_localzone())
    except Exception:
        pass
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\TimeZoneInformation") as k:
            return winreg.QueryValueEx(k, "TimeZoneKeyName")[0]
    except Exception:
        return time.tzname[0]


def build_set_time(now: Optional[datetime] = None, is_24h: bool = True, tz: Optional[str] = None) -> Command:
    """CMD_CLOCK with local date/time and the standard + DST offsets in 15-minute blocks."""
    now = now or datetime.now()
    lt = time.localtime(now.timestamp())
    std_offset = -time.timezone
    dst_offset = (-time.altzone - std_offset) if lt.tm_isdst > 0 else 0
    clock = wear_system_pb2.Clock(
        time=wear_common_pb2.Time(hour=now.hour, minute=now.minute, second=now.second,
                                  millisecond=now.microsecond // 1000),
        date=wear_common_pb2.Date(year=now.year, month=now.month, day=now.day),
        timezone=wear_common_pb2.TimeZone(zoneOffset=std_offset // 60 // 15, dstOffset=dst_offset // 60 // 15,
                                          name=tz or tz_name()),
        isNot24hour=not is_24h,
    )
    cmd = Command(type=SYS, subtype=SYS_CLOCK)
    cmd.system.clock.CopyFrom(clock)
    return cmd


def build_find_watch(start: bool) -> Command:
    cmd = Command(type=SYS, subtype=SYS_FIND_WATCH)
    cmd.system.findDevice = 0 if start else 1
    return cmd


def build_find_phone_stop() -> Command:
    cmd = Command(type=SYS, subtype=SYS_FIND_PHONE)
    cmd.system.findDevice = 1
    return cmd


def find_phone_event(cmd: Command) -> Optional[str]:
    """'start' / 'stop' for a watch -> phone find-phone command, else None."""
    if cmd.type == SYS and cmd.subtype == SYS_FIND_PHONE and cmd.HasField("system"):
        return "start" if cmd.system.findDevice == 0 else "stop"
    return None


# ---- notifications ---------------------------------------------------------------------------

def _timestamp(when: Optional[datetime] = None) -> str:
    return (when or datetime.now()).strftime("%Y%m%dT%H%M%S")


def build_notification(title: str, body: str, *, app_name: str = "watch-lab", package: str = "app.kumquant.watchlab",
                       notification_id: int = 1, when: Optional[datetime] = None) -> Command:
    """CMD_NOTIFICATION_SEND. The watch shows nothing without a body, so title and body are always set."""
    n3 = wear_notification_pb2.Notification3(
        id=notification_id, unknown4="", timestamp=_timestamp(when), package=package,
        title=title or "", body=body or "", appName=app_name or "UNKNOWN")
    cmd = Command(type=NOTIF, subtype=NOTIF_SEND)
    cmd.notification.notification2.notification3.CopyFrom(n3)
    return cmd


def build_incoming_call(name: Optional[str], number: Optional[str] = None, *, when: Optional[datetime] = None) -> Command:
    n3 = wear_notification_pb2.Notification3(
        id=0, unknown4="", isCall=True, repliesAllowed=False, timestamp=_timestamp(when),
        package="phone", appName="phone", title=name or "?", body=number or "?")
    cmd = Command(type=NOTIF, subtype=NOTIF_SEND)
    cmd.notification.notification2.notification3.CopyFrom(n3)
    return cmd


def build_call_end() -> Command:
    cmd = Command(type=NOTIF, subtype=NOTIF_DISMISS)
    nid = cmd.notification.notificationDismiss.notificationId.add()
    nid.id = 0
    nid.package = "phone"
    return cmd


def build_dismiss(notification_id: int, package: str) -> Command:
    cmd = Command(type=NOTIF, subtype=NOTIF_DISMISS)
    nid = cmd.notification.notificationDismiss.notificationId.add()
    nid.id = notification_id
    nid.package = package
    return cmd


# ---- health ----------------------------------------------------------------------------------

def build_fetch_today() -> Command:
    cmd = Command(type=HEALTH, subtype=HEALTH_FETCH_TODAY)
    cmd.health.activitySyncRequestToday.unknown1 = 0
    return cmd


def build_fetch_past() -> Command:
    return Command(type=HEALTH, subtype=HEALTH_FETCH_PAST)


def build_fetch_request(file_id_bytes: bytes) -> Command:
    cmd = Command(type=HEALTH, subtype=HEALTH_FETCH_REQUEST)
    cmd.health.activityRequestFileIds = file_id_bytes
    return cmd


def build_fetch_ack(file_id_bytes: bytes) -> Command:
    cmd = Command(type=HEALTH, subtype=HEALTH_FETCH_ACK)
    cmd.health.activitySyncAckFileIds = file_id_bytes
    return cmd


def build_hr_set(current: wear_fitness_pb2.HeartRate, *, interval_minutes: Optional[int] = None,
                 disabled: Optional[bool] = None) -> Command:
    """Read-modify-write of the watch's own HeartRate config so no other setting is disturbed.

    interval_minutes: 0 = smart, 1, 10, 30 ...; `disabled` switches continuous measurement off/on.
    """
    hr = wear_fitness_pb2.HeartRate()
    hr.CopyFrom(current)
    if interval_minutes is not None:
        hr.interval = interval_minutes
        if disabled is None:
            hr.disabled = False
    if disabled is not None:
        hr.disabled = disabled
    cmd = Command(type=HEALTH, subtype=HEALTH_HR_SET)
    cmd.health.heartRate.CopyFrom(hr)
    return cmd


SETTINGS_QUERIES = [
    ("heart rate", HEALTH, HEALTH_HR_GET),
    ("spo2", HEALTH, HEALTH_SPO2_GET),
    ("stress", HEALTH, HEALTH_STRESS_GET),
    ("standing reminder", HEALTH, HEALTH_STANDING_GET),
    ("goal notification", HEALTH, HEALTH_GOAL_NOTIFICATION_GET),
    ("goals", HEALTH, HEALTH_GOALS_GET),
    ("vitality score", HEALTH, HEALTH_VITALITY_GET),
]


# ---- music -----------------------------------------------------------------------------------

def describe_music(cmd: Command) -> str:
    if cmd.subtype == MUSIC_GET:
        return "watch asks for the current music state"
    if cmd.subtype == MUSIC_BUTTON:
        k = cmd.music.mediaKey
        name = MUSIC_KEYS.get(k.key, f"key{k.key}")
        return f"button: {name}" + (f" (volume {k.volume})" if k.key == 5 else "")
    return f"music subtype {cmd.subtype}"
