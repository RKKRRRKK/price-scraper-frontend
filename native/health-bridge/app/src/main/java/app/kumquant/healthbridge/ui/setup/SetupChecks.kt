package app.kumquant.healthbridge.ui.setup

import android.Manifest
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import app.kumquant.healthbridge.BuildConfig
import app.kumquant.healthbridge.HealthBridgeApp
import app.kumquant.healthbridge.service.NotificationForwarder
import app.kumquant.healthbridge.weather.WeatherProvider

/** What the setup checklist inspects and the intents its actions fire. Nothing here shows UI. */
object SetupChecks {

    val bluetoothPermissions: Array<String> =
        if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)

    val locationPermissions = arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)

    val phonePermissions = arrayOf(
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_CALL_LOG,
        Manifest.permission.ANSWER_PHONE_CALLS,
        Manifest.permission.READ_CONTACTS,
    )

    fun granted(context: Context, permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun bluetooth(context: Context) = bluetoothPermissions.all { granted(context, it) }

    fun postNotifications(context: Context) =
        Build.VERSION.SDK_INT < 33 || granted(context, Manifest.permission.POST_NOTIFICATIONS)

    fun notificationAccess(context: Context) = NotificationForwarder.hasAccess(context)

    fun batteryExempt(context: Context) =
        context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)

    fun location(context: Context) = WeatherProvider.hasLocationPermission(context)

    fun dndAccess(context: Context) = context.getSystemService(NotificationManager::class.java).isNotificationPolicyAccessGranted

    fun phone(context: Context) = phonePermissions.all { granted(context, it) }

    fun paired() = HealthBridgeApp.prefs.watchAddress != null

    fun authKey() = BuildConfig.WATCH_AUTH_KEY.isNotBlank()

    /** Permissions to ask for in one go, for the actions that are plain runtime permissions. */
    fun missing(context: Context, permissions: Array<String>) = permissions.filterNot { granted(context, it) }.toTypedArray()

    // ---- intents ---------------------------------------------------------------------------

    fun notificationAccessIntent(context: Context): Intent =
        if (Build.VERSION.SDK_INT >= 30) {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(
                Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                ComponentName(context, NotificationForwarder::class.java).flattenToString(),
            )
        } else {
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        }

    fun batteryIntent(context: Context): Intent =
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))

    fun dndIntent() = Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)

    fun appDetailsIntent(context: Context): Intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))

    /** OPPO / ColorOS / OPlus screens for auto-launch and background activity, newest layouts first. */
    private val colorOsComponents = listOf(
        "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
        "com.oplus.safecenter" to "com.oplus.safecenter.startupapp.StartupAppListActivity",
        "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
        "com.coloros.safecenter" to "com.coloros.safecenter.startupapp.StartupAppListActivity",
        "com.coloros.oppoguardelf" to "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity",
        "com.oplus.battery" to "com.oplus.powermanager.fuelgaue.PowerUsageModelActivity",
    )

    /** Opens the first ColorOS auto-launch / background screen that exists, else this app's settings page. */
    fun openColorOsSettings(context: Context) {
        for ((pkg, cls) in colorOsComponents) {
            val intent = Intent().setComponent(ComponentName(pkg, cls)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (runCatching { context.startActivity(intent) }.isSuccess) return
        }
        context.startActivity(appDetailsIntent(context).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** True when something is missing that the bridge cannot work without. */
    fun requiredMissing(context: Context): Boolean =
        !paired() || !authKey() || !bluetooth(context) || !postNotifications(context) ||
            !notificationAccess(context) || !batteryExempt(context)
}
