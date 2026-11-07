package app.kumquant.healthbridge.watch.services

/**
 * Xiaomi weather condition ids, and the mapping from WMO weather codes (what Open-Meteo returns).
 *
 * Gadgetbridge maps OpenWeatherMap codes; this table goes from WMO straight to the same Xiaomi ids,
 * choosing what Gadgetbridge's OWM table would give for the equivalent condition. The Xiaomi Watch
 * S1 Active is known to crash on ids above 33, so never return anything outside 0..33.
 */
internal object WeatherConditions {
    const val CLEAR_SKY = 0
    const val CLOUDY = 1 // may show a moon on some models
    const val OVERCAST = 2
    const val SHOWER = 3
    const val THUNDERSTORM = 4
    const val HAIL = 5
    const val SLEET = 6
    const val LIGHT_RAIN = 7
    const val MODERATE_RAIN = 8
    const val HEAVY_RAINFALL = 9
    const val RAINSTORM = 10
    const val DOWNPOUR = 11
    const val HEAVY_RAINSTORM = 12
    const val SNOW_SHOWERS = 13
    const val LIGHT_SNOW = 14
    const val MODERATE_SNOW = 15
    const val HEAVY_SNOW = 16
    const val BLIZZARD = 17
    const val MIST = 18
    const val FREEZING_RAIN = 19
    const val SANDSTORM = 20
    const val DUST = 29
    const val WINDY = 30

    /** WMO code to Xiaomi condition id; unknown codes read as clear sky, as in Gadgetbridge. */
    fun fromWmo(code: Int): Int = when (code) {
        0, 1 -> CLEAR_SKY // clear, mainly clear
        2 -> CLOUDY // partly cloudy
        3 -> OVERCAST
        45, 48 -> MIST // fog, rime fog
        51, 53, 55 -> LIGHT_RAIN // drizzle (Gadgetbridge maps drizzle to light rain)
        56, 57 -> FREEZING_RAIN // freezing drizzle
        61 -> LIGHT_RAIN
        63 -> MODERATE_RAIN
        65 -> RAINSTORM // heavy rain, as OWM 502
        66, 67 -> FREEZING_RAIN
        71 -> LIGHT_SNOW
        73 -> MODERATE_SNOW
        75 -> HEAVY_SNOW
        77 -> LIGHT_SNOW // snow grains
        80, 81 -> SHOWER // slight and moderate rain showers
        82 -> HEAVY_RAINFALL // violent rain showers
        85 -> SNOW_SHOWERS
        86 -> HEAVY_SNOW
        95, 96, 99 -> THUNDERSTORM // thunderstorm, with slight or heavy hail
        else -> CLEAR_SKY
    }
}
