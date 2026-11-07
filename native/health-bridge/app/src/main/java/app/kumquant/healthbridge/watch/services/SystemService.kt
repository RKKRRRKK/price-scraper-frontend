package app.kumquant.healthbridge.watch.services

import app.kumquant.healthbridge.proto.xiaomi.WearCommon
import app.kumquant.healthbridge.proto.xiaomi.XiaomiProto
import app.kumquant.healthbridge.proto.xiaomi.XiaomiSystem
import app.kumquant.healthbridge.watch.CommandChannel
import app.kumquant.healthbridge.watch.WatchInfo
import app.kumquant.healthbridge.watch.WatchListener
import app.kumquant.healthbridge.watch.WatchLog
import app.kumquant.healthbridge.watch.XiaomiService
import app.kumquant.healthbridge.watch.send
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Device info, battery, clock, find-my-phone and find-my-watch (command type 2). Ported from the
 * relevant parts of Gadgetbridge's XiaomiSystemService; display items, language, password,
 * widgets, camera remote, vibration patterns and firmware install are left out.
 */
internal class SystemService(
    private val channel: CommandChannel,
    private val info: MutableStateFlow<WatchInfo>,
    private val listener: WatchListener,
) : XiaomiService(COMMAND_TYPE) {

    override fun handle(cmd: XiaomiProto.Command) {
        when (cmd.subtype) {
            CMD_DEVICE_INFO -> {
                val d = cmd.system.deviceInfo
                WatchLog.d("device info: fw=${d.firmware} model=${d.model} sn=${d.serialNumber}")
                info.update { it.copy(model = d.model, firmware = d.firmware, serial = d.serialNumber) }
            }
            CMD_BATTERY -> handleBattery(cmd.system.power.battery)
            CMD_FIND_PHONE -> {
                if (cmd.hasSystem()) {
                    // 0 = the watch started "find my phone", anything else = it stopped
                    val start = cmd.system.findDevice == 0
                    WatchLog.i("find phone from watch: start=$start")
                    listener.onFindPhone(start)
                }
            }
            CMD_FIND_WATCH -> WatchLog.d("find watch reply: findDevice=${cmd.system.findDevice} (1 = found it)")
            CMD_SILENT_MODE_GET -> {
                WatchLog.d("watch asked for the phone's silent mode, answering off")
                channel.send(phoneSilentMode(false))
            }
            CMD_SILENT_MODE_SET_FROM_WATCH -> WatchLog.d("watch set phone silent mode: ${cmd.system.phoneSilentModeSet.phoneSilentMode.silent}")
            CMD_DEVICE_STATE_GET -> handleBasicDeviceState(cmd)
            CMD_DEVICE_STATE -> {
                // The charger state only arrives in these pushes; battery level and state come from the battery reply.
                WatchLog.d("device state push: ${cmd.system.deviceState}")
                channel.send(COMMAND_TYPE, CMD_BATTERY)
            }
            CMD_CLOCK -> WatchLog.d("set time acked, status=${if (cmd.hasStatus()) cmd.status else 0}")
            else -> WatchLog.w("unhandled system command ${cmd.subtype}: $cmd")
        }
    }

    private fun handleBattery(battery: XiaomiSystem.Battery) {
        val charging = if (battery.hasState()) {
            when (battery.state) {
                1 -> true
                2, 3 -> false
                else -> {
                    WatchLog.w("unknown battery state ${battery.state}")
                    null
                }
            }
        } else {
            null
        }
        WatchLog.d("battery ${battery.level}% charging=$charging")
        info.update { it.copy(batteryPct = battery.level, charging = charging ?: it.charging) }
    }

    private fun handleBasicDeviceState(cmd: XiaomiProto.Command) {
        if (!cmd.system.hasBasicDeviceState()) {
            channel.send(COMMAND_TYPE, CMD_BATTERY)
            return
        }
        val s = cmd.system.basicDeviceState
        WatchLog.d("basic device state: charging=${s.isCharging} battery=${if (s.hasBatteryLevel()) s.batteryLevel else -1} worn=${s.isWorn} asleep=${s.isUserAsleep}")
        info.update { it.copy(charging = s.isCharging, batteryPct = if (s.hasBatteryLevel()) s.batteryLevel else it.batteryPct) }
        if (!s.hasBatteryLevel()) channel.send(COMMAND_TYPE, CMD_BATTERY)
    }

    fun requestDeviceInfo() = channel.send(COMMAND_TYPE, CMD_DEVICE_INFO)

    fun requestBattery() {
        channel.send(COMMAND_TYPE, CMD_DEVICE_STATE_GET)
        channel.send(COMMAND_TYPE, CMD_BATTERY)
    }

    fun setTime(now: ZonedDateTime = ZonedDateTime.now(), is24Hour: Boolean = true) =
        channel.send(clockCommand(now, is24Hour))

    fun findWatch(start: Boolean) = channel.send(findDeviceCommand(CMD_FIND_WATCH, start))

    /** Tells the watch to stop its "find my phone" screen, after the phone side was dismissed. */
    fun stopFindPhoneOnWatch() = channel.send(findDeviceCommand(CMD_FIND_PHONE, start = false))

    companion object {
        const val COMMAND_TYPE = 2

        const val CMD_BATTERY = 1
        const val CMD_DEVICE_INFO = 2
        const val CMD_CLOCK = 3
        const val CMD_FIND_PHONE = 17
        const val CMD_FIND_WATCH = 18
        const val CMD_SILENT_MODE_GET = 43
        const val CMD_SILENT_MODE_SET_FROM_PHONE = 44
        const val CMD_SILENT_MODE_SET_FROM_WATCH = 45
        const val CMD_DEVICE_STATE_GET = 78
        const val CMD_DEVICE_STATE = 79

        /** Date, time and zone for the watch's clock. Zone and DST offsets are in 15-minute blocks. */
        fun clockCommand(now: ZonedDateTime, is24Hour: Boolean): XiaomiProto.Command {
            val zone: ZoneId = now.zone
            val instant = now.toInstant()
            val standardSeconds = zone.rules.getStandardOffset(instant).totalSeconds
            val dstSeconds = zone.rules.getDaylightSavings(instant).seconds.toInt()
            val clock = XiaomiSystem.Clock.newBuilder()
                .setTime(
                    WearCommon.Time.newBuilder()
                        .setHour(now.hour).setMinute(now.minute).setSecond(now.second)
                        .setMillisecond(now.nano / 1_000_000),
                )
                .setDate(WearCommon.Date.newBuilder().setYear(now.year).setMonth(now.monthValue).setDay(now.dayOfMonth))
                .setTimezone(
                    WearCommon.TimeZone.newBuilder()
                        .setZoneOffset(standardSeconds / 60 / 15)
                        .setDstOffset(dstSeconds / 60 / 15)
                        .setName(zone.id),
                )
                .setIsNot24Hour(!is24Hour)
                .build()
            return XiaomiProto.Command.newBuilder()
                .setType(COMMAND_TYPE)
                .setSubtype(CMD_CLOCK)
                .setSystem(XiaomiSystem.System.newBuilder().setClock(clock))
                .build()
        }

        /** `findDevice` is 0 to start and 1 to stop, on both the find-watch and find-phone commands. */
        fun findDeviceCommand(subtype: Int, start: Boolean): XiaomiProto.Command =
            XiaomiProto.Command.newBuilder()
                .setType(COMMAND_TYPE)
                .setSubtype(subtype)
                .setSystem(XiaomiSystem.System.newBuilder().setFindDevice(if (start) 0 else 1))
                .build()

        fun phoneSilentMode(silent: Boolean): XiaomiProto.Command =
            XiaomiProto.Command.newBuilder()
                .setType(COMMAND_TYPE)
                .setSubtype(CMD_SILENT_MODE_SET_FROM_PHONE)
                .setSystem(
                    XiaomiSystem.System.newBuilder().setPhoneSilentModeSet(
                        XiaomiSystem.PhoneSilentModeSet.newBuilder()
                            .setPhoneSilentMode(XiaomiSystem.PhoneSilentMode.newBuilder().setSilent(silent)),
                    ),
                )
                .build()
    }
}
