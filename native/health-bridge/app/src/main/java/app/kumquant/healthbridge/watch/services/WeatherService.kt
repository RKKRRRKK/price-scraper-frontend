package app.kumquant.healthbridge.watch.services

import app.kumquant.healthbridge.proto.xiaomi.ForecastEntries
import app.kumquant.healthbridge.proto.xiaomi.ForecastEntry
import app.kumquant.healthbridge.proto.xiaomi.Weather
import app.kumquant.healthbridge.proto.xiaomi.WeatherCurrent
import app.kumquant.healthbridge.proto.xiaomi.WeatherForecast
import app.kumquant.healthbridge.proto.xiaomi.WeatherLocation
import app.kumquant.healthbridge.proto.xiaomi.WeatherLocations
import app.kumquant.healthbridge.proto.xiaomi.WeatherMetadata
import app.kumquant.healthbridge.proto.xiaomi.WeatherPrefs
import app.kumquant.healthbridge.proto.xiaomi.WeatherRange
import app.kumquant.healthbridge.proto.xiaomi.WeatherSunriseSunset
import app.kumquant.healthbridge.proto.xiaomi.WeatherUnitValue
import app.kumquant.healthbridge.proto.xiaomi.WeatherWarnings
import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.watch.CommandChannel
import app.kumquant.healthbridge.watch.DayWeather
import app.kumquant.healthbridge.watch.HourWeather
import app.kumquant.healthbridge.watch.WatchException
import app.kumquant.healthbridge.watch.WatchListener
import app.kumquant.healthbridge.watch.WatchLog
import app.kumquant.healthbridge.watch.WeatherReport
import app.kumquant.healthbridge.watch.XiaomiService
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Current conditions, hourly and daily forecast on the watch's weather app and watch faces
 * (command type 10). Ported from Gadgetbridge's XiaomiWeatherService, fed from a [WeatherReport]
 * (Open-Meteo) instead of Gadgetbridge's WeatherSpec. The phone knows one location.
 */
internal class WeatherService(
    private val channel: CommandChannel,
    private val listener: WatchListener,
    private val zone: () -> ZoneId = { ZoneId.systemDefault() },
) : XiaomiService(COMMAND_TYPE) {

    /** Sets the temperature scale to Celsius; Gadgetbridge does this on every connect. */
    fun initialize() = channel.send(prefsCommand(celsius = true))

    suspend fun send(report: WeatherReport) {
        val zone = zone()
        val location = locationFor(report.locationName)
        ensureLocation(location)
        channel.send(currentCommand(report, zone))
        channel.send(dailyCommand(report, zone))
        channel.send(hourlyCommand(report, zone))
    }

    /** Makes [location] the only location on the watch, if it supports several; otherwise just adds it. */
    private suspend fun ensureLocation(location: WeatherLocation) {
        val reply = try {
            channel.request(XiaomiProto.Command.newBuilder().setType(COMMAND_TYPE).setSubtype(CMD_GET_LOCATIONS).build())
        } catch (e: WatchException) {
            WatchLog.w("weather: no reply to the location list, adding the location blindly")
            null
        }
        val status = if (reply != null && reply.hasStatus()) reply.status else 0
        if (reply == null || status == 1) {
            // single-location watch (or unknown): add sets the current location
            channel.send(locationCommand(CMD_ADD_LOCATION, location))
            return
        }
        val existing = reply.weather.locations.locationList
        WatchLog.d("weather: watch has ${existing.size} location(s)")
        if (location !in existing) channel.send(locationCommand(CMD_ADD_LOCATION, location))
        val stale = existing.filter { it != location }.distinct()
        if (stale.isNotEmpty()) {
            channel.send(
                commandOf(CMD_REMOVE_LOCATIONS, Weather.newBuilder().setLocations(WeatherLocations.newBuilder().addAllLocation(stale))),
            )
        }
        channel.send(commandOf(CMD_SET_LOCATIONS, Weather.newBuilder().setLocations(WeatherLocations.newBuilder().addLocation(location))))
    }

    override fun handle(cmd: XiaomiProto.Command) {
        if (cmd.hasStatus() && cmd.status != 0) WatchLog.w("weather command ${cmd.subtype} replied with status ${cmd.status}")
        when (cmd.subtype) {
            CMD_REQUEST_CONDITIONS_FOR_LOCATION -> {
                WatchLog.i("watch requested weather")
                listener.onWeatherRequested()
            }
            CMD_SET_CURRENT_WEATHER, CMD_UPDATE_DAILY_FORECAST, CMD_UPDATE_HOURLY_FORECAST, CMD_GET_LOCATIONS,
            CMD_SET_LOCATIONS, CMD_ADD_LOCATION, CMD_REMOVE_LOCATIONS, CMD_SET_WEATHER_PREFS ->
                WatchLog.d("weather reply ${cmd.subtype}, status=${if (cmd.hasStatus()) cmd.status else 0}")
            else -> WatchLog.w("unhandled weather command ${cmd.subtype}: $cmd")
        }
    }

    companion object {
        const val COMMAND_TYPE = 10

        const val CMD_SET_CURRENT_WEATHER = 0
        const val CMD_UPDATE_DAILY_FORECAST = 1
        const val CMD_UPDATE_HOURLY_FORECAST = 2
        const val CMD_REQUEST_CONDITIONS_FOR_LOCATION = 3
        const val CMD_GET_LOCATIONS = 5
        const val CMD_SET_LOCATIONS = 6
        const val CMD_ADD_LOCATION = 7
        const val CMD_REMOVE_LOCATIONS = 8
        const val CMD_SET_WEATHER_PREFS = 10

        private const val CELSIUS = "℃"
        private const val MAX_DAYS = 6
        private const val MAX_HOURS = 23
        private val ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssxxx", Locale.US)

        /** Accepts epoch milliseconds or seconds, so a unit slip upstream does not put the date in 1970. */
        private fun ms(t: Long) = if (t in 1 until 100_000_000_000L) t * 1000 else t

        fun isoWithColon(epoch: Long, zone: ZoneId): String = ISO.format(Instant.ofEpochMilli(ms(epoch)).atZone(zone))

        /** Same placeholder key scheme as Gadgetbridge: the watch only needs a stable code per location name. */
        fun locationKey(name: String) = "accu:%d".format(Locale.ROOT, abs(name.hashCode()) % 1_000_000)

        fun locationFor(name: String): WeatherLocation =
            WeatherLocation.newBuilder().setCode(locationKey(name)).setName(name).build()

        /** Wind speed in km/h to a Beaufort number (Gadgetbridge's thresholds). */
        fun beaufort(kph: Double): Int {
            val limits = doubleArrayOf(2.0, 6.0, 12.0, 20.0, 29.0, 39.0, 50.0, 62.0, 75.0, 89.0, 103.0, 118.0)
            var level = 0
            while (level < limits.size && limits[level] < kph) level++
            return level
        }

        private fun unit(value: Int, unit: String) = WeatherUnitValue.newBuilder().setUnit(unit).setValue(value).build()

        private fun range(from: Int, to: Int) = WeatherRange.newBuilder().setFrom(from).setTo(to)

        private fun metadata(report: WeatherReport, zone: ZoneId) = WeatherMetadata.newBuilder()
            .setPublicationTimestamp(isoWithColon(report.fetchedAt, zone))
            .setCityName("")
            .setLocationName(report.locationName)
            .setLocationKey(locationKey(report.locationName))
            .setIsCurrentLocation(true)

        private fun commandOf(subtype: Int, weather: Weather.Builder): XiaomiProto.Command =
            XiaomiProto.Command.newBuilder().setType(COMMAND_TYPE).setSubtype(subtype).setWeather(weather).build()

        fun locationCommand(subtype: Int, location: WeatherLocation) = commandOf(subtype, Weather.newBuilder().setLocation(location))

        fun prefsCommand(celsius: Boolean) =
            commandOf(CMD_SET_WEATHER_PREFS, Weather.newBuilder().setPrefs(WeatherPrefs.newBuilder().setTemperatureScale(if (celsius) 1 else 2)))

        fun currentCommand(report: WeatherReport, zone: ZoneId): XiaomiProto.Command {
            val c = report.current
            val current = WeatherCurrent.newBuilder()
                .setMetadata(metadata(report, zone))
                .setWeatherCondition(WeatherConditions.fromWmo(c.wmoCode))
                .setTemperature(unit(c.tempC.roundToInt(), CELSIUS))
                .setHumidity(unit(c.humidityPct ?: 0, "%"))
                .setWind(unit(beaufort(c.windKph ?: 0.0), (c.windDirDeg ?: 0).toString()))
                .setUv(unit((c.uvIndex ?: 0.0).roundToInt(), ""))
                .setAqi(unit(c.aqi?.takeIf { it >= 0 } ?: 0, "Unknown"))
                .setWarning(WeatherWarnings.newBuilder())
                .setPressure(((c.pressureHpa ?: 0.0) * 100.0).toFloat())
            return commandOf(CMD_SET_CURRENT_WEATHER, Weather.newBuilder().setCurrent(current))
        }

        /**
         * Entry 0 is today, built like Gadgetbridge does: today's range with the *current* condition
         * as both ends of the condition range. Up to six following days come next. If the report
         * does not start with today, today is synthesised from the current temperature.
         */
        fun dailyCommand(report: WeatherReport, zone: ZoneId): XiaomiProto.Command {
            val today = Instant.ofEpochMilli(ms(report.fetchedAt)).atZone(zone).toLocalDate()
            val first = report.daily.firstOrNull()
            val hasToday = first != null && first.date == today
            val following = if (hasToday) report.daily.drop(1) else report.daily
            val currentCondition = WeatherConditions.fromWmo(report.current.wmoCode)
            val aqi = unit(report.current.aqi?.takeIf { it >= 0 } ?: 0, "Unknown")

            val entries = ForecastEntries.newBuilder()
            val todayMax = (first?.takeIf { hasToday }?.maxC ?: report.current.tempC).roundToInt()
            val todayMin = (first?.takeIf { hasToday }?.minC ?: report.current.tempC).roundToInt()
            entries.addEntry(
                ForecastEntry.newBuilder()
                    .setAqi(aqi)
                    .setTemperatureRange(range(todayMax, todayMin))
                    .setConditionRange(range(currentCondition, currentCondition))
                    .setTemperatureSymbol(CELSIUS)
                    .setSunriseSunset(sunriseSunset(first?.takeIf { hasToday }, zone)),
            )
            for (d in following.take(MAX_DAYS)) {
                val cond = WeatherConditions.fromWmo(d.wmoCode)
                entries.addEntry(
                    ForecastEntry.newBuilder()
                        .setAqi(unit(0, "Unknown"))
                        .setConditionRange(range(cond, cond))
                        .setTemperatureRange(range(d.maxC.roundToInt(), d.minC.roundToInt()))
                        .setTemperatureSymbol(CELSIUS)
                        .setSunriseSunset(sunriseSunset(d, zone)),
                )
            }
            val forecast = WeatherForecast.newBuilder().setMetadata(metadata(report, zone)).setEntries(entries)
            return commandOf(CMD_UPDATE_DAILY_FORECAST, Weather.newBuilder().setForecast(forecast))
        }

        private fun sunriseSunset(d: DayWeather?, zone: ZoneId) = WeatherSunriseSunset.newBuilder()
            .setSunrise(d?.sunrise?.takeIf { it != 0L }?.let { isoWithColon(it, zone) } ?: "")
            .setSunset(d?.sunset?.takeIf { it != 0L }?.let { isoWithColon(it, zone) } ?: "")

        /** The next [MAX_HOURS] hours starting at the current one; `from` is required by the proto but unused by the watch. */
        fun hourlyCommand(report: WeatherReport, zone: ZoneId): XiaomiProto.Command {
            val hourStart = ms(report.fetchedAt) / 3_600_000L * 3_600_000L
            val upcoming = report.hourly.filter { ms(it.time) >= hourStart }.ifEmpty { report.hourly }
            val entries = ForecastEntries.newBuilder()
            for (h: HourWeather in upcoming.take(MAX_HOURS)) {
                entries.addEntry(
                    ForecastEntry.newBuilder()
                        .setAqi(unit(0, "Unknown"))
                        .setTemperatureRange(range(0, h.tempC.roundToInt()))
                        .setConditionRange(range(0, WeatherConditions.fromWmo(h.wmoCode)))
                        .setTemperatureSymbol(CELSIUS)
                        .setWind(unit(beaufort(h.windKph ?: 0.0), "0")),
                )
            }
            val forecast = WeatherForecast.newBuilder().setMetadata(metadata(report, zone)).setEntries(entries)
            return commandOf(CMD_UPDATE_HOURLY_FORECAST, Weather.newBuilder().setForecast(forecast))
        }
    }
}
