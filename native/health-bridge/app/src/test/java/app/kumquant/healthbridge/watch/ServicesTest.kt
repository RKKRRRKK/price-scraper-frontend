package app.kumquant.healthbridge.watch

import app.kumquant.healthbridge.proto.xiaomi.Notification
import app.kumquant.healthbridge.proto.xiaomi.NotificationDismiss
import app.kumquant.healthbridge.proto.xiaomi.NotificationId
import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.watch.activity.ActivityFileId
import app.kumquant.healthbridge.watch.health.ActivityFileReceiver
import app.kumquant.healthbridge.watch.services.NotificationService
import app.kumquant.healthbridge.watch.services.SystemService
import app.kumquant.healthbridge.watch.services.WeatherConditions
import app.kumquant.healthbridge.watch.services.WeatherService
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.zip.CRC32

/** Records what a service sends and answers its requests from a script. */
internal class FakeChannel(private val replies: (XiaomiProto.Command) -> XiaomiProto.Command? = { null }) : CommandChannel {
    val sent = mutableListOf<XiaomiProto.Command>()

    override fun send(command: XiaomiProto.Command) {
        sent += command
    }

    override suspend fun request(command: XiaomiProto.Command, timeoutMs: Long): XiaomiProto.Command {
        sent += command
        return replies(command) ?: throw WatchTimeoutException("no reply")
    }

    override fun launch(block: suspend () -> Unit) = runBlocking { block() }
}

private class RecordingListener : WatchListener {
    val events = mutableListOf<String>()
    override fun onCallAction(reject: Boolean) { events += "call:$reject" }
    override fun onNotificationDismissed(key: String) { events += "dismissed:$key" }
    override fun onWeatherRequested() { events += "weather" }
}

/** Notification command building, after Gadgetbridge's XiaomiNotificationSendTest and XiaomiNotificationDismissTest. */
class NotificationServiceTest {
    private val listener = RecordingListener()
    private val channel = FakeChannel()
    private val service = NotificationService(channel, listener) { ZoneId.of("UTC") }
    private val key = "0|com.example.chat|42|null|1000"

    private fun note(k: String = key, title: String = "Alice", body: String = "Hello") =
        PhoneNotification(k, "com.example.chat", "Chat", title, body, postedAt = 1_730_851_200_000L)

    private fun n3(c: XiaomiProto.Command) = c.notification.notification2.notification3

    @Test
    fun sendsTitleBodyAndMetadata() {
        service.send(note())
        val cmd = channel.sent.single()
        assertEquals(7, cmd.type)
        assertEquals(0, cmd.subtype)
        val n = n3(cmd)
        assertEquals("Alice", n.title)
        assertEquals("Hello", n.body)
        assertEquals("com.example.chat", n.`package`)
        assertEquals("Chat", n.appName)
        assertEquals("20241106T000000", n.timestamp)
        assertEquals(key, n.key)
        assertTrue(n.openOnPhone)
    }

    /** The watch drops a notification without a body, so hidden content is still sent as empty strings. */
    @Test
    fun sendsEmptyTitleAndBodyWhenContentIsHidden() {
        service.send(note(title = "", body = ""))
        val n = n3(channel.sent.single())
        assertTrue(n.hasTitle())
        assertEquals("", n.title)
        assertTrue(n.hasBody())
        assertEquals("", n.body)
    }

    @Test
    fun dismissCarriesIdPackageAndKey() {
        service.send(note())
        val id = n3(channel.sent.single()).id
        channel.sent.clear()
        service.dismiss(key)
        val dismiss = channel.sent.single()
        assertEquals(1, dismiss.subtype)
        val nid = dismiss.notification.notificationDismiss.getNotificationId(0)
        assertEquals(id, nid.id)
        assertEquals("com.example.chat", nid.`package`)
        assertEquals(key, nid.key)
        channel.sent.clear()
        service.dismiss("never sent")
        assertTrue(channel.sent.isEmpty())
    }

    @Test
    fun callsAndWatchActions() {
        service.incomingCall("Bob", "+123")
        val call = n3(channel.sent.single())
        assertTrue(call.isCall)
        assertFalse(call.repliesAllowed)
        assertEquals("phone", call.`package`)
        assertEquals("Bob", call.title)

        service.send(note())
        val id = n3(channel.sent.last()).id
        val dismiss = Notification.newBuilder().setNotificationDismiss(
            NotificationDismiss.newBuilder().addNotificationId(NotificationId.newBuilder().setId(id)),
        )
        service.handle(XiaomiProto.Command.newBuilder().setType(7).setSubtype(1).setNotification(dismiss).build())
        service.handle(XiaomiProto.Command.newBuilder().setType(7).setSubtype(2).build())
        service.handle(XiaomiProto.Command.newBuilder().setType(7).setSubtype(5).build())
        assertEquals(listOf("dismissed:$key", "call:true", "call:false"), listener.events)
    }
}

class WeatherTest {
    private val zone = ZoneId.of("UTC")
    private val fetched = ZonedDateTime.of(2026, 11, 5, 10, 20, 0, 0, zone).toInstant().toEpochMilli()

    private fun day(offset: Long, wmo: Int, min: Double, max: Double) = DayWeather(
        date = LocalDate.of(2026, 11, 5).plusDays(offset), minC = min, maxC = max, wmoCode = wmo,
        sunrise = fetched - 3_600_000L, sunset = fetched + 3_600_000L, precipProbPct = 10, uvIndexMax = 3.0,
    )

    private val report = WeatherReport(
        locationName = "Berlin",
        fetchedAt = fetched,
        current = CurrentWeather(
            tempC = 7.6, feelsLikeC = 5.0, wmoCode = 61, humidityPct = 81, windKph = 22.0, windDirDeg = 250,
            pressureHpa = 1012.5, uvIndex = 1.4, aqi = 33, isDay = true,
        ),
        hourly = (0 until 40).map { HourWeather(fetched - 10 * 3_600_000L + it * 3_600_000L, 5.0 + it, if (it % 2 == 0) 3 else 63, 20, 12.0) },
        daily = (0 until 8).map { day(it.toLong(), if (it == 0) 3 else 71, 2.0 + it, 8.0 + it) },
    )

    @Test
    fun wmoCodesMapToXiaomiConditions() {
        val expected = mapOf(
            0 to 0, 1 to 0, 2 to 1, 3 to 2, 45 to 18, 48 to 18,
            51 to 7, 53 to 7, 55 to 7, 56 to 19, 57 to 19,
            61 to 7, 63 to 8, 65 to 10, 66 to 19, 67 to 19,
            71 to 14, 73 to 15, 75 to 16, 77 to 14,
            80 to 3, 81 to 3, 82 to 9, 85 to 13, 86 to 16,
            95 to 4, 96 to 4, 99 to 4,
            -1 to 0, 4 to 0, 100 to 0,
        )
        for ((wmo, xiaomi) in expected) assertEquals("wmo $wmo", xiaomi, WeatherConditions.fromWmo(wmo))
        // the Watch S1 Active crashes on ids above 33
        assertTrue((0..120).all { WeatherConditions.fromWmo(it) in 0..33 })
    }

    @Test
    fun beaufortThresholdsMatchGadgetbridge() {
        assertEquals(0, WeatherService.beaufort(2.0))
        assertEquals(1, WeatherService.beaufort(2.1))
        assertEquals(4, WeatherService.beaufort(22.0))
        assertEquals(12, WeatherService.beaufort(200.0))
    }

    @Test
    fun timestampsAndLocationKey() {
        assertEquals("2026-11-05T11:20:00+01:00", WeatherService.isoWithColon(fetched, ZoneId.of("Europe/Berlin")))
        assertEquals(WeatherService.isoWithColon(fetched, zone), WeatherService.isoWithColon(fetched / 1000, zone))
        assertEquals("accu:" + (kotlin.math.abs("Berlin".hashCode()) % 1_000_000), WeatherService.locationKey("Berlin"))
    }

    @Test
    fun currentConditions() {
        val w = WeatherService.currentCommand(report, zone).weather.current
        assertEquals(7, w.weatherCondition)
        assertEquals(8, w.temperature.value)
        assertEquals(81, w.humidity.value)
        assertEquals(4, w.wind.value)
        assertEquals("250", w.wind.unit)
        assertEquals(1, w.uv.value)
        assertEquals(33, w.aqi.value)
        assertEquals(101250f, w.pressure, 0.5f)
        assertEquals("Berlin", w.metadata.locationName)
        assertEquals("2026-11-05T10:20:00+00:00", w.metadata.publicationTimestamp)
    }

    @Test
    fun dailyForecastStartsWithTodayUsingTheCurrentCondition() {
        val entries = WeatherService.dailyCommand(report, zone).weather.forecast.entries.entryList
        assertEquals(7, entries.size)
        assertEquals(8, entries[0].temperatureRange.from)
        assertEquals(2, entries[0].temperatureRange.to)
        assertEquals(7, entries[0].conditionRange.from)
        assertEquals("2026-11-05T09:20:00+00:00", entries[0].sunriseSunset.sunrise)
        assertEquals(9, entries[1].temperatureRange.from)
        assertEquals(14, entries[1].conditionRange.from)
    }

    @Test
    fun hourlyForecastStartsAtTheCurrentHourAndIsCapped() {
        val entries = WeatherService.hourlyCommand(report, zone).weather.forecast.entries.entryList
        assertEquals(23, entries.size)
        assertEquals(15, entries[0].temperatureRange.to)
        assertEquals(2, entries[0].conditionRange.to)
    }

    @Test
    fun aWatchRequestAsksTheApp() {
        val listener = RecordingListener()
        WeatherService(FakeChannel(), listener).handle(XiaomiProto.Command.newBuilder().setType(10).setSubtype(3).build())
        assertEquals(listOf("weather"), listener.events)
    }
}

class SystemAndFetchTest {
    @Test
    fun clockCarriesDateTimeAndZoneInQuarterHours() {
        val now = ZonedDateTime.of(2026, 7, 1, 13, 45, 30, 250_000_000, ZoneId.of("Europe/Berlin"))
        val clock = SystemService.clockCommand(now, is24Hour = true).system.clock
        assertEquals(13, clock.time.hour)
        assertEquals(250, clock.time.millisecond)
        assertEquals(4, clock.timezone.zoneOffset)
        assertEquals(4, clock.timezone.dstOffset)
        assertFalse(clock.isNot24Hour)
    }

    /** The whole file, 7-byte id, padding byte, payload and CRC, is what ActivityParsers.parse receives. */
    @Test
    fun activityFileIsReassembledAndCrcChecked() {
        val id = ActivityFileId(timestamp = 1_730_851_200, timezone = 4, version = 2, type = 0, subtype = 0, detailType = 0)
        val noCrc = id.toBytes() + byteArrayOf(0) + ByteArray(30) { it.toByte() }
        val data = noCrc + ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(CRC32().apply { update(noCrc) }.value.toInt()).array()
        val parts = data.toList().chunked(15).mapIndexed { i, p ->
            ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putShort(3).putShort((i + 1).toShort()).array() + p.toByteArray()
        }
        val receiver = ActivityFileReceiver()
        assertEquals(ActivityFileReceiver.Result.Partial, receiver.addChunk(parts[0]))
        assertEquals(ActivityFileReceiver.Result.Partial, receiver.addChunk(parts[1]))
        val done = receiver.addChunk(parts[2]) as ActivityFileReceiver.Result.Complete
        assertEquals(id, done.id)
        assertArrayEquals(data, done.data)

        val corrupt = data.copyOf().also { it[12] = (it[12].toInt() xor 1).toByte() }
        val single = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putShort(1).putShort(1).array() + corrupt
        assertTrue(receiver.addChunk(single) is ActivityFileReceiver.Result.Rejected)
    }

    @Test
    fun fileIdsAreFetchedOldestFirstSummaryBeforeDetails() {
        val id = ActivityFileId(1_730_851_200, 4, 2, 1, 1, 0)
        val summary = id.copy(detailType = 1)
        val gps = id.copy(detailType = 2)
        val older = id.copy(timestamp = id.timestamp - 100)
        val sorted = listOf(gps, id, summary, older).sortedWith(app.kumquant.healthbridge.watch.health.HealthService.FETCH_ORDER)
        assertEquals(listOf(older, summary, id, gps), sorted)
    }
}
