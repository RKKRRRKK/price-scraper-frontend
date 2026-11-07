"""Open-Meteo fetch and the Xiaomi weather commands.

Condition mapping follows Gadgetbridge's XiaomiWeatherConditions (OpenWeatherMap code -> Xiaomi icon
id); Open-Meteo's WMO codes are first translated to the nearest OpenWeatherMap code. Command layout
ported from XiaomiWeatherService.java (temperatures in whole degrees C, wind as Beaufort with the
direction in the unit field, pressure in Pa, first daily entry = today, 23 hourly entries).
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from .commands import (WEATHER, WEATHER_ADD_LOCATION, WEATHER_DAILY, WEATHER_HOURLY, WEATHER_SET_CURRENT,
                       WEATHER_SET_LOCATIONS, WEATHER_SET_PREFS, Command)
from .proto.xiaomi import wear_weather_pb2 as w

# Xiaomi condition ids (XiaomiWeatherConditions)
CLEAR_SKY, CLOUDY, OVERCAST, SHOWER, THUNDERSTORM, HAIL, SLEET, LIGHT_RAIN, MODERATE_RAIN = 0, 1, 2, 3, 4, 5, 6, 7, 8
HEAVY_RAINFALL, RAINSTORM, DOWNPOUR, HEAVY_RAINSTORM, SNOW_SHOWERS, LIGHT_SNOW, MODERATE_SNOW = 9, 10, 11, 12, 13, 14, 15
HEAVY_SNOW, BLIZZARD, MIST, FREEZING_RAIN, SANDSTORM, DUST, WINDY = 16, 17, 18, 19, 20, 29, 30

_OWM = {
    **{c: THUNDERSTORM for c in (200, 201, 202, 210, 211, 212, 221, 230, 231, 232)},
    # drizzle has no icon of its own: GB falls through to light rain
    **{c: LIGHT_RAIN for c in (300, 301, 302, 310, 311, 312, 313, 314, 321, 500)},
    501: MODERATE_RAIN, 502: RAINSTORM, 503: DOWNPOUR, 504: HEAVY_RAINSTORM, 511: FREEZING_RAIN,
    520: SHOWER, 521: SHOWER, 522: HEAVY_RAINFALL, 531: HEAVY_RAINFALL,
    600: LIGHT_SNOW, 601: MODERATE_SNOW, 602: HEAVY_SNOW, 611: SLEET, 612: SLEET,
    615: SNOW_SHOWERS, 616: SNOW_SHOWERS, 620: HEAVY_SNOW, 621: HEAVY_SNOW, 622: BLIZZARD,
    **{c: MIST for c in (701, 711, 721, 731, 741)},
    751: SANDSTORM, 761: DUST, 762: DUST, 771: DUST, 781: WINDY, 900: WINDY,
    800: CLEAR_SKY, 801: CLOUDY, 802: CLOUDY, 803: CLOUDY, 804: OVERCAST,
    901: WINDY, 902: WINDY, 903: CLEAR_SKY, 904: CLEAR_SKY, 905: WINDY, 906: HAIL,
    **{c: CLEAR_SKY for c in (951, 952, 953, 954, 955)},
    **{c: WINDY for c in (956, 957, 958, 959, 960, 961, 962)},
}


def owm_to_xiaomi(code: int) -> int:
    """XiaomiWeatherConditions.convertOwmConditionToXiaomi; unknown codes are CLEAR_SKY."""
    return _OWM.get(code, CLEAR_SKY)


_WMO_TO_OWM = {
    0: 800, 1: 801, 2: 802, 3: 804,
    45: 741, 48: 741,
    51: 300, 53: 301, 55: 302, 56: 511, 57: 511,
    61: 500, 63: 501, 65: 502, 66: 511, 67: 511,
    71: 600, 73: 601, 75: 602, 77: 600,
    80: 520, 81: 521, 82: 522,
    85: 620, 86: 622,
    95: 211, 96: 201, 99: 202,
}


def wmo_to_owm(code: int) -> int:
    return _WMO_TO_OWM.get(int(code), 800)


def wmo_to_xiaomi(code: int) -> int:
    return owm_to_xiaomi(wmo_to_owm(code))


_BEAUFORT = [2, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118]


def to_beaufort(speed_kmh: float) -> int:
    level = 0
    while level < len(_BEAUFORT) and _BEAUFORT[level] < speed_kmh:
        level += 1
    return level


def java_string_hash(s: str) -> int:
    h = 0
    for ch in s:
        h = (31 * h + ord(ch)) & 0xFFFFFFFF
    return h - (1 << 32) if h >= (1 << 31) else h


def location_key(name: str) -> str:
    """GB's placeholder key: accu:<abs(hashCode) % 1000000> (Math.abs(Integer.MIN_VALUE) stays negative in Java)."""
    h = java_string_hash(name or "")
    a = h if h == -(1 << 31) else abs(h)
    return f"accu:{a % 1000000 if a >= 0 else -((-a) % 1000000)}"


def iso_colon(ts: float, tz: Optional[timezone] = None) -> str:
    """unixTimestampToISOWithColons: yyyy-MM-ddTHH:mm:ss+HH:MM in the PC's local zone."""
    dt = datetime.fromtimestamp(ts, tz) if tz else datetime.fromtimestamp(ts).astimezone()
    s = dt.strftime("%Y-%m-%dT%H:%M:%S%z")
    return s[:-2] + ":" + s[-2:]


@dataclass
class Hour:
    time: int
    temp_c: float
    code: int
    wind_kmh: float = 0.0
    wind_dir: int = 0


@dataclass
class Day:
    max_c: float
    min_c: float
    code: int
    sunrise: int = 0
    sunset: int = 0


@dataclass
class WeatherReport:
    location: str
    time: int
    temp_c: float
    humidity: int
    code: int
    wind_kmh: float
    wind_dir: int
    pressure_hpa: float
    uv: float
    today_max_c: float
    today_min_c: float
    today_sunrise: int
    today_sunset: int
    hourly: list[Hour] = field(default_factory=list)
    daily: list[Day] = field(default_factory=list)  # days after today
    is_current_location: bool = True

    def summary(self) -> str:
        return (f"{self.location}: {self.temp_c:.1f}C, WMO {self.code} -> Xiaomi {wmo_to_xiaomi(self.code)}, "
                f"humidity {self.humidity}%, wind {self.wind_kmh:.0f} km/h (Bft {to_beaufort(self.wind_kmh)}), "
                f"{len(self.hourly)} hourly, {len(self.daily)} daily")


OPEN_METEO = "https://api.open-meteo.com/v1/forecast"


def fetch_open_meteo(lat: float, lon: float, name: Optional[str] = None, timeout: float = 15.0) -> WeatherReport:
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "timezone": "auto", "wind_speed_unit": "kmh",
        "forecast_days": 8, "timeformat": "unixtime",
        "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,uv_index",
        "hourly": "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset",
    })
    with urllib.request.urlopen(f"{OPEN_METEO}?{q}", timeout=timeout) as r:
        data = json.loads(r.read().decode("utf-8"))
    return parse_open_meteo(data, name or f"{lat:.2f},{lon:.2f}")


def parse_open_meteo(data: dict, name: str, now: Optional[int] = None) -> WeatherReport:
    cur = data["current"]
    now_ts = int(now if now is not None else cur.get("time", datetime.now().timestamp()))
    h, d = data["hourly"], data["daily"]
    hourly = []
    for i, t in enumerate(h["time"]):
        if t > now_ts:  # entries from the next full hour on
            hourly.append(Hour(t, h["temperature_2m"][i], h["weather_code"][i], h["wind_speed_10m"][i],
                               int(h["wind_direction_10m"][i] or 0)))
    days = [Day(d["temperature_2m_max"][i], d["temperature_2m_min"][i], d["weather_code"][i],
                d["sunrise"][i] or 0, d["sunset"][i] or 0) for i in range(len(d["time"]))]
    # the day containing "now" is today; the rest are the forecasts
    today_i = 0
    for i, t in enumerate(d["time"]):
        if t <= now_ts:
            today_i = i
    today = days[today_i]
    return WeatherReport(
        location=name, time=now_ts, temp_c=cur["temperature_2m"], humidity=int(round(cur["relative_humidity_2m"])),
        code=int(cur["weather_code"]), wind_kmh=cur["wind_speed_10m"], wind_dir=int(cur.get("wind_direction_10m") or 0),
        pressure_hpa=cur.get("surface_pressure") or 1013.0, uv=cur.get("uv_index") or 0.0,
        today_max_c=today.max_c, today_min_c=today.min_c, today_sunrise=today.sunrise, today_sunset=today.sunset,
        hourly=hourly, daily=days[today_i + 1:])


# ---- commands --------------------------------------------------------------------------------

def _uv(value: int, unit: str) -> w.WeatherUnitValue:
    return w.WeatherUnitValue(unit=unit, value=value)


def _meta(r: WeatherReport) -> w.WeatherMetadata:
    return w.WeatherMetadata(publicationTimestamp=iso_colon(r.time), cityName="", locationName=r.location,
                             locationKey=location_key(r.location), isCurrentLocation=r.is_current_location)


def build_current(r: WeatherReport) -> Command:
    cur = w.WeatherCurrent(
        metadata=_meta(r), weatherCondition=wmo_to_xiaomi(r.code),
        temperature=_uv(int(round(r.temp_c)), "℃"), humidity=_uv(r.humidity, "%"),
        wind=_uv(to_beaufort(r.wind_kmh), str(r.wind_dir)), uv=_uv(int(round(r.uv)), ""),
        aqi=_uv(0, "Unknown"), warning=w.WeatherWarnings(), pressure=r.pressure_hpa * 100.0)
    cmd = Command(type=WEATHER, subtype=WEATHER_SET_CURRENT)
    cmd.weather.current.CopyFrom(cur)
    return cmd


def _daily_entry(max_c, min_c, code, sunrise, sunset) -> w.ForecastEntry:
    cond = wmo_to_xiaomi(code)
    return w.ForecastEntry(
        aqi=_uv(0, "Unknown"), conditionRange=w.WeatherRange(**{"from": cond, "to": cond}),
        temperatureRange=w.WeatherRange(**{"from": int(round(max_c)), "to": int(round(min_c))}),
        temperatureSymbol="℃",
        sunriseSunset=w.WeatherSunriseSunset(sunrise=iso_colon(sunrise) if sunrise else "",
                                             sunset=iso_colon(sunset) if sunset else ""))


def build_daily(r: WeatherReport) -> Command:
    entries = w.ForecastEntries()
    entries.entry.append(_daily_entry(r.today_max_c, r.today_min_c, r.code, r.today_sunrise, r.today_sunset))
    for day in r.daily[:6]:
        entries.entry.append(_daily_entry(day.max_c, day.min_c, day.code, day.sunrise, day.sunset))
    cmd = Command(type=WEATHER, subtype=WEATHER_DAILY)
    cmd.weather.forecast.CopyFrom(w.WeatherForecast(metadata=_meta(r), entries=entries))
    return cmd


def build_hourly(r: WeatherReport) -> Command:
    entries = w.ForecastEntries()
    for hr in r.hourly[:23]:
        entries.entry.append(w.ForecastEntry(
            aqi=_uv(0, "Unknown"),
            temperatureRange=w.WeatherRange(**{"from": 0, "to": int(round(hr.temp_c))}),
            conditionRange=w.WeatherRange(**{"from": 0, "to": wmo_to_xiaomi(hr.code)}),
            temperatureSymbol="℃", wind=_uv(to_beaufort(hr.wind_kmh), str(hr.wind_dir))))
    cmd = Command(type=WEATHER, subtype=WEATHER_HOURLY)
    cmd.weather.forecast.CopyFrom(w.WeatherForecast(metadata=_meta(r), entries=entries))
    return cmd


def build_location(r: WeatherReport, subtype: int = WEATHER_ADD_LOCATION) -> Command:
    cmd = Command(type=WEATHER, subtype=subtype)
    cmd.weather.location.CopyFrom(w.WeatherLocation(code=location_key(r.location), name=r.location))
    return cmd


def build_locations_order(codes_names: list[tuple[str, str]]) -> Command:
    cmd = Command(type=WEATHER, subtype=WEATHER_SET_LOCATIONS)
    for code, name in codes_names:
        loc = cmd.weather.locations.location.add()
        loc.code = code
        loc.name = name
    return cmd


def build_celsius_pref() -> Command:
    cmd = Command(type=WEATHER, subtype=WEATHER_SET_PREFS)
    cmd.weather.prefs.temperatureScale = 1
    return cmd


def build_all(r: WeatherReport) -> list[Command]:
    return [build_current(r), build_daily(r), build_hourly(r)]


async def push_weather(client, r: WeatherReport, say=print) -> None:
    """GB's onSendWeather flow: celsius pref, probe multi-location support, add our location, send all three."""
    from . import commands as C
    await client._lenient(build_celsius_pref(), (C.WEATHER, WEATHER_SET_PREFS))
    reply = await client._lenient(C.simple(C.WEATHER, C.WEATHER_GET_LOCATIONS), (C.WEATHER, C.WEATHER_GET_LOCATIONS))
    multi = reply is not None and not (reply.HasField("status") and reply.status == 1)
    say(f"watch supports multiple weather locations: {multi}" if reply is not None
        else "watch did not answer the location query; assuming a single location")
    await client._lenient(build_location(r), (C.WEATHER, WEATHER_ADD_LOCATION))
    if multi:
        existing = [(l.code, l.name) for l in reply.weather.locations.location]
        mine = (location_key(r.location), r.location)
        order = [mine] + [e for e in existing if e[0] != mine[0]]
        await client._lenient(build_locations_order(order), (C.WEATHER, WEATHER_SET_LOCATIONS))
    for name, cmd, sub in (("current", build_current(r), WEATHER_SET_CURRENT), ("daily", build_daily(r), WEATHER_DAILY),
                           ("hourly", build_hourly(r), WEATHER_HOURLY)):
        ack = await client._lenient(cmd, (C.WEATHER, sub))
        status = ack.status if ack is not None and ack.HasField("status") else None
        say(f"weather {name}: {'sent' if ack is None else 'ack'}{'' if status is None else f' status={status}'}"
            f"{' (not supported by the watch)' if status == 1 else ''}")
