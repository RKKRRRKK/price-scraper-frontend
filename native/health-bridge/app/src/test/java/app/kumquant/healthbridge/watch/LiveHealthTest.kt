package app.kumquant.healthbridge.watch

import app.kumquant.healthbridge.proto.xiaomi.Health
import app.kumquant.healthbridge.proto.xiaomi.RealTimeStats
import app.kumquant.healthbridge.proto.xiaomi.WorkoutOpenWatch
import app.kumquant.healthbridge.proto.xiaomi.WorkoutStatsWatch
import app.kumquant.healthbridge.proto.xiaomi.WorkoutStatusWatch
import app.kumquant.healthbridge.proto.xiaomi.WorkoutStatusWatchV2
import app.kumquant.healthbridge.proto.xiaomi.WorkoutStatusWatchV2Sport
import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.watch.health.HealthService
import app.kumquant.healthbridge.watch.health.WorkoutLive
import app.kumquant.healthbridge.watch.services.MusicService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun health(subtype: Int, h: Health.Builder? = null): XiaomiProto.Command =
    XiaomiProto.Command.newBuilder().setType(8).setSubtype(subtype).apply { if (h != null) setHealth(h) }.build()

private fun realtime(bpm: Int, steps: Int = 100, kcal: Int = 5) =
    health(47, Health.newBuilder().setRealTimeStats(RealTimeStats.newBuilder().setHeartRate(bpm).setSteps(steps).setCalories(kcal)))

private fun status(status: Int, sport: Int) =
    health(26, Health.newBuilder().setWorkoutStatusWatch(WorkoutStatusWatch.newBuilder().setStatus(status).setSport(sport)))

private fun stats(hr: Int, kcal: Int, steps: Int, distance: Int) =
    health(50, Health.newBuilder().setWorkoutStatsWatch(WorkoutStatsWatch.newBuilder().setHeartRate(hr).setCalories(kcal).setSteps(steps).setDistance(distance)))

private fun open(sport: Int = 1) =
    health(30, Health.newBuilder().setWorkoutOpenWatch(WorkoutOpenWatch.newBuilder().setSport(sport).setSupportedVersions(2)))

private class FakeGps(var can: Boolean = true, var startOk: Boolean = true) : PhoneGps {
    var started = 0
    var stopped = 0
    var sink: ((LocationFix) -> Unit)? = null
    override fun canLocate() = can
    override fun start(onFix: (LocationFix) -> Unit): Boolean {
        if (!startOk) return false
        started++
        sink = onFix
        return true
    }
    override fun stop() { stopped++; sink = null }
}

private fun fix(t: Long = 1_730_851_200_000L) = LocationFix(t, 51.5, -0.12, 30.0, 2.5f, 90f)

/** The realtime stream and consumers, after Gadgetbridge's XiaomiRealtimeStatsTest, plus the live parsing. */
class RealtimeStatsTest {
    private val channel = FakeChannel()
    private val hr = MutableStateFlow<LiveHeartRate?>(null)
    private val service = HealthService(channel, CoroutineScope(Job()), liveHeartRate = hr, clock = { 1_000L })

    private fun count(subtype: Int) = channel.sent.count { it.type == 8 && it.subtype == subtype }

    @Test
    fun firstConsumerStartsTheStream() {
        service.enableRealtimeStats(true)
        assertEquals(1, count(45))
        assertEquals(0, count(46))
    }

    @Test
    fun repeatedEnableDoesNotRestart() {
        service.enableRealtimeStats(true)
        service.enableRealtimeStats(true)
        assertEquals(1, count(45))
    }

    @Test
    fun lastConsumerStopsTheStream() {
        service.enableRealtimeStats(true)
        service.enableRealtimeStats(false)
        assertEquals(1, count(45))
        assertEquals(1, count(46))
    }

    @Test
    fun closingTheLiveViewKeepsAHeartRateMeasurementRunning() {
        service.heartRateTest()
        service.enableRealtimeStats(true)
        service.enableRealtimeStats(false)
        assertEquals(1, count(45))
        assertEquals(0, count(46))
    }

    @Test
    fun readingsReachTheFlow() {
        service.enableRealtimeStats(true)
        service.handle(realtime(72, steps = 4200, kcal = 90))
        assertEquals(LiveHeartRate(72, 4200, 90, 1_000L), hr.value)
    }

    @Test
    fun aMeasuringSensorReadsAsZero() {
        service.enableRealtimeStats(true)
        service.handle(realtime(0))
        assertEquals(0, hr.value?.bpm)
        service.handle(realtime(255))
        assertEquals(0, hr.value?.bpm)
    }

    @Test
    fun stoppingClearsTheReading() {
        service.enableRealtimeStats(true)
        service.handle(realtime(80))
        service.enableRealtimeStats(false)
        assertNull(hr.value)
    }

    @Test
    fun eventsWithNoConsumerAskTheWatchToStop() {
        service.handle(realtime(80))
        assertNull(hr.value)
        assertEquals(1, count(46))
    }

    @Test
    fun theOneShotReleasesOnTheFirstValidReading() {
        service.heartRateTest()
        service.handle(realtime(5))
        assertEquals(0, count(46))
        service.handle(realtime(64))
        assertEquals(1, count(46))
        assertEquals(64, hr.value?.bpm)
    }
}

class WorkoutLiveTest {
    private var now = 1_000_000L
    private val live = WorkoutLive { now }

    @Test
    fun startThenStatsGiveALiveWorkout() {
        live.onStatus(WorkoutLive.STARTED, 1)
        now += 12_000
        val w = live.onStats(150, 12, 30, 40)!!
        assertEquals("Outdoor running", w.sport)
        assertEquals(12, w.elapsedS)
        assertEquals(150, w.hr)
        assertEquals(40, w.distanceM)
        assertEquals(12, w.kcal)
        assertEquals(30, w.steps)
        assertEquals(WorkoutPhase.RUNNING, w.phase)
    }

    @Test
    fun pausedTimeDoesNotCount() {
        live.onStatus(WorkoutLive.STARTED, 1)
        now += 10_000
        live.onStatus(WorkoutLive.PAUSED, 1)
        now += 30_000
        assertEquals(10, live.tick()!!.elapsedS)
        assertEquals(WorkoutPhase.PAUSED, live.tick()!!.phase)
        live.onStatus(WorkoutLive.RESUMED, 1)
        now += 5_000
        assertEquals(15, live.tick()!!.elapsedS)
    }

    @Test
    fun finishedClearsAndLateStatsAreIgnored() {
        live.onStatus(WorkoutLive.STARTED, 1)
        assertNull(live.onStatus(WorkoutLive.FINISHED, 1))
        now += 1_000
        assertNull(live.onStats(100, 1, 1, 1))
        now += 5_000
        assertNotNull(live.onStats(100, 1, 1, 1))
    }

    @Test
    fun aDuplicateStartDoesNotResetTheClock() {
        live.onStatus(WorkoutLive.STARTED, null)
        now += 2_000
        live.onStatus(WorkoutLive.STARTED, 6)
        assertEquals(2, live.tick()!!.elapsedS)
        assertEquals(6, live.tick()!!.sportCode)
    }

    @Test
    fun statsWithoutAStartJoinAWorkoutOfUnknownSport() {
        val w = live.onStats(120, 0, 0, 0)!!
        assertEquals("Workout", w.sport)
        assertNull(w.distanceM)
        assertEquals(120, w.hr)
    }

    @Test
    fun v2StatusNumbersPauseAndResumeTheOtherWayRound() {
        assertEquals(WorkoutLive.PAUSED, WorkoutLive.fromV2(2))
        assertEquals(WorkoutLive.RESUMED, WorkoutLive.fromV2(1))
        assertEquals(WorkoutLive.STARTED, WorkoutLive.fromV2(0))
        assertEquals(WorkoutLive.FINISHED, WorkoutLive.fromV2(3))
    }
}

class LiveWorkoutServiceTest {
    private val channel = FakeChannel()
    private val workout = MutableStateFlow<LiveWorkout?>(null)

    private fun service(gps: PhoneGps?) = HealthService(channel, CoroutineScope(Job()), gps, liveWorkout = workout)

    private fun replies() = channel.sent.filter { it.subtype == 30 }.map { it.health.workoutOpenReply }
    private fun locations() = channel.sent.filter { it.subtype == 48 }.map { it.health.workoutLocation }

    @Test
    fun statusAndStatsFlowIntoTheLiveWorkout() {
        val s = service(null)
        s.handle(status(0, 1))
        s.handle(stats(142, 30, 400, 1200))
        val w = workout.value!!
        assertEquals("Outdoor running", w.sport)
        assertEquals(142, w.hr)
        assertEquals(1200, w.distanceM)
        s.handle(status(3, 1))
        assertNull(workout.value)
    }

    @Test
    fun v2StatusStartsAWorkoutToo() {
        val s = service(null)
        s.handle(health(29, Health.newBuilder().setWorkoutStatusWatchV2(WorkoutStatusWatchV2.newBuilder().setStatus(0).setSport(WorkoutStatusWatchV2Sport.newBuilder().setType(6)))))
        assertEquals("Outdoor cycling", workout.value?.sport)
    }

    @Test
    fun withoutPhoneGpsTheOpenIsAnsweredNoPermission() {
        val s = service(null)
        s.handle(open())
        assertEquals(1, replies().size)
        assertEquals(3, replies().single().code)
        assertEquals(2, replies().single().selectedVersion)
    }

    @Test
    fun withoutLocationPermissionTheOpenIsAnsweredNoPermission() {
        val gps = FakeGps(can = false)
        service(gps).handle(open())
        assertEquals(3, replies().single().code)
        assertEquals(0, gps.started)
    }

    @Test
    fun aGpsThatCannotStartFallsBackToNoPermission() {
        val gps = FakeGps(startOk = false)
        service(gps).handle(open())
        assertEquals(3, replies().single().code)
    }

    @Test
    fun theFirstFixAnswersTheOpenAndLaterFixesStreamOnceTheWorkoutStarted() {
        val gps = FakeGps()
        val s = service(gps)
        s.handle(open())
        assertEquals(1, gps.started)
        assertTrue("no reply until a fix", replies().isEmpty())

        gps.sink!!(fix())
        assertEquals(0, replies().single().code)
        assertEquals(2, replies().single().gpsAccuracy)
        assertTrue("no locations before the workout starts", locations().isEmpty())

        gps.sink!!(fix(1_730_851_201_000L))
        assertEquals(1, replies().size)
        s.handle(status(0, 1))
        gps.sink!!(fix(1_730_851_202_000L))
        val loc = locations().single()
        assertEquals(1_730_851_202L, loc.timestamp.toLong())
        assertEquals(51.5, loc.latitude, 1e-9)
        assertEquals(-0.12, loc.longitude, 1e-9)
        assertEquals(30.0, loc.altitude, 1e-9)
        assertEquals(2.5f, loc.speed, 1e-6f)
        assertEquals(90f, loc.bearing, 1e-6f)
        assertEquals(2, loc.unknown1)
        assertTrue(workout.value!!.phoneGps)
    }

    @Test
    fun finishingTheWorkoutStopsTheGps() {
        val gps = FakeGps()
        val s = service(gps)
        s.handle(open())
        gps.sink!!(fix())
        s.handle(status(0, 1))
        s.handle(status(3, 1))
        assertEquals(1, gps.stopped)
    }

    @Test
    fun aDisconnectStopsTheGpsAndClearsTheWorkout() {
        val gps = FakeGps()
        val s = service(gps)
        s.handle(open())
        gps.sink!!(fix())
        s.handle(status(0, 1))
        s.onDisconnect()
        assertEquals(1, gps.stopped)
        assertNull(workout.value)
    }

    @Test
    fun theUnknownBytesOfTheLocationCommandAreOnTheWire() {
        val c = HealthService.locationCommand(fix())
        assertEquals(8, c.type)
        assertEquals(48, c.subtype)
        assertTrue(c.health.hasWorkoutLocation())
        assertFalse(c.health.workoutLocation.hasHorizontalAccuracy())
    }
}

class MusicKeyTest {
    @Test
    fun key2IsIgnored() {
        // The S5 sends key 2 unprompted; acting on it started music on its own.
        assertEquals(null, MusicService.commandFor(2, null, null))
    }

    @Test
    fun knownKeysAreUnchanged() {
        assertEquals(MusicCommand.PLAY, MusicService.commandFor(0, null, null))
        assertEquals(MusicCommand.PAUSE, MusicService.commandFor(1, null, null))
        assertEquals(MusicCommand.PREVIOUS, MusicService.commandFor(3, null, null))
        assertEquals(MusicCommand.NEXT, MusicService.commandFor(4, null, null))
        assertNull(MusicService.commandFor(9, null, null))
    }
}
