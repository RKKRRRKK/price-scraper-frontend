package app.kumquant.healthbridge.weather

import app.kumquant.healthbridge.watch.CurrentWeather
import app.kumquant.healthbridge.watch.DayWeather
import app.kumquant.healthbridge.watch.HourWeather
import app.kumquant.healthbridge.watch.WeatherReport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.ZoneOffset
import kotlin.math.roundToInt

/** Open-Meteo forecast and air-quality calls (no key), mapped to a [WeatherReport]. */
object OpenMeteo {
    private const val FORECAST = "https://api.open-meteo.com/v1/forecast"
    private const val AIR = "https://air-quality-api.open-meteo.com/v1/air-quality"

    /** Current conditions, the next 24 hours and 7 days for a point; [place] is shown on the watch. */
    suspend fun report(lat: Double, lon: Double, place: String): WeatherReport = withContext(Dispatchers.IO) {
        val forecast = JSONObject(
            get(
                "$FORECAST?latitude=$lat&longitude=$lon&timezone=auto&timeformat=unixtime&wind_speed_unit=kmh" +
                    "&forecast_days=7&forecast_hours=24" +
                    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code," +
                    "surface_pressure,wind_speed_10m,wind_direction_10m" +
                    "&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m,uv_index" +
                    "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset," +
                    "precipitation_probability_max,uv_index_max"
            )
        )
        val aqi = runCatching {
            JSONObject(get("$AIR?latitude=$lat&longitude=$lon&current=european_aqi"))
                .getJSONObject("current").optDouble("european_aqi").takeIf { !it.isNaN() }?.roundToInt()
        }.getOrNull()
        parse(forecast, aqi, place)
    }

    internal fun parse(root: JSONObject, aqi: Int?, place: String): WeatherReport {
        val cur = root.getJSONObject("current")
        val hourly = root.getJSONObject("hourly")
        val daily = root.getJSONObject("daily")
        val offset = root.optInt("utc_offset_seconds", 0)

        val hourTimes = hourly.getJSONArray("time")
        val hours = (0 until hourTimes.length()).map { i ->
            HourWeather(
                time = hourTimes.getLong(i) * 1000,
                tempC = hourly.getJSONArray("temperature_2m").getDouble(i),
                wmoCode = hourly.getJSONArray("weather_code").optInt(i),
                precipProbPct = hourly.getJSONArray("precipitation_probability").optIntOrNull(i),
                windKph = hourly.getJSONArray("wind_speed_10m").optDoubleOrNull(i),
            )
        }
        val nowSec = cur.optLong("time", System.currentTimeMillis() / 1000)
        val uvNow = hourly.optJSONArray("uv_index")?.let { uv ->
            val idx = hourTimes.let { t -> (0 until t.length()).lastOrNull { t.getLong(it) <= nowSec } ?: 0 }
            uv.optDoubleOrNull(idx)
        }

        val dayTimes = daily.getJSONArray("time")
        val days = (0 until dayTimes.length()).map { i ->
            DayWeather(
                date = Instant.ofEpochSecond(dayTimes.getLong(i) + offset).atZone(ZoneOffset.UTC).toLocalDate(),
                minC = daily.getJSONArray("temperature_2m_min").getDouble(i),
                maxC = daily.getJSONArray("temperature_2m_max").getDouble(i),
                wmoCode = daily.getJSONArray("weather_code").optInt(i),
                sunrise = daily.getJSONArray("sunrise").optLongOrNull(i)?.times(1000),
                sunset = daily.getJSONArray("sunset").optLongOrNull(i)?.times(1000),
                precipProbPct = daily.getJSONArray("precipitation_probability_max").optIntOrNull(i),
                uvIndexMax = daily.getJSONArray("uv_index_max").optDoubleOrNull(i),
            )
        }

        return WeatherReport(
            locationName = place,
            fetchedAt = System.currentTimeMillis(),
            current = CurrentWeather(
                tempC = cur.getDouble("temperature_2m"),
                feelsLikeC = cur.optDouble("apparent_temperature").takeIf { !it.isNaN() },
                wmoCode = cur.optInt("weather_code"),
                humidityPct = cur.optInt("relative_humidity_2m", -1).takeIf { it >= 0 },
                windKph = cur.optDouble("wind_speed_10m").takeIf { !it.isNaN() },
                windDirDeg = cur.optInt("wind_direction_10m", -1).takeIf { it >= 0 },
                pressureHpa = cur.optDouble("surface_pressure").takeIf { !it.isNaN() },
                uvIndex = uvNow,
                aqi = aqi,
                isDay = cur.optInt("is_day", 1) == 1,
            ),
            hourly = hours,
            daily = days,
        )
    }

    private fun get(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw IOException("Weather HTTP $code: ${text.take(200)}")
            return text
        } finally {
            conn.disconnect()
        }
    }

    private fun JSONArray.optDoubleOrNull(i: Int) = if (isNull(i)) null else optDouble(i).takeIf { !it.isNaN() }
    private fun JSONArray.optIntOrNull(i: Int) = if (isNull(i)) null else optDouble(i).takeIf { !it.isNaN() }?.roundToInt()
    private fun JSONArray.optLongOrNull(i: Int) = if (isNull(i)) null else optLong(i)
}
