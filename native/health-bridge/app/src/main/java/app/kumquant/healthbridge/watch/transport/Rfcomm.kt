package app.kumquant.healthbridge.watch.transport

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import app.kumquant.healthbridge.watch.WatchLog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.IOException
import java.util.UUID

/**
 * Opens the RFCOMM socket to the watch. Strategies follow Gadgetbridge's BtBRQueue and are tried in
 * turn until one connects: the secure SPP service record, the insecure one, and finally a socket on
 * a fixed channel via reflection (some stacks fail the SDP lookup).
 */
internal object Rfcomm {
    val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb")

    private const val FALLBACK_CHANNEL = 1

    private class Strategy(val name: String, val create: (BluetoothDevice) -> BluetoothSocket)

    @SuppressLint("MissingPermission")
    private val strategies = listOf(
        Strategy("secure SPP") { it.createRfcommSocketToServiceRecord(SPP_UUID) },
        Strategy("insecure SPP") { it.createInsecureRfcommSocketToServiceRecord(SPP_UUID) },
        Strategy("channel $FALLBACK_CHANNEL (reflection)") {
            val method = BluetoothDevice::class.java.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
            method.invoke(it, FALLBACK_CHANNEL) as BluetoothSocket
        },
    )

    /**
     * Connects to [address]. Each strategy gets [perAttemptMs]; discovery is cancelled first because it
     * slows or breaks RFCOMM connects.
     * @throws IOException with every strategy's failure if none connects
     */
    @SuppressLint("MissingPermission")
    suspend fun open(adapter: BluetoothAdapter, address: String, perAttemptMs: Long = 15_000): BluetoothSocket =
        withContext(Dispatchers.IO) {
            try {
                adapter.cancelDiscovery()
            } catch (e: SecurityException) {
                WatchLog.w("cannot cancel discovery: ${e.message}")
            }
            val device = adapter.getRemoteDevice(address)
            val failures = mutableListOf<String>()
            for (strategy in strategies) {
                var socket: BluetoothSocket? = null
                try {
                    WatchLog.i("RFCOMM: trying ${strategy.name} to $address")
                    socket = strategy.create(device)
                    val s = socket
                    // connect() blocks and ignores cancellation, so run it aside and close the socket on timeout.
                    val attempt = async { runCatching { s.connect() } }
                    val result = withTimeoutOrNull(perAttemptMs) { attempt.await() }
                    if (result == null) {
                        s.closeQuietly()
                        attempt.cancel()
                        failures += "${strategy.name}: timed out"
                        continue
                    }
                    result.getOrThrow()
                    WatchLog.i("RFCOMM: connected via ${strategy.name}")
                    return@withContext s
                } catch (e: CancellationException) {
                    socket?.closeQuietly()
                    throw e
                } catch (e: SecurityException) {
                    socket?.closeQuietly()
                    throw IOException("Bluetooth permission missing: ${e.message}", e)
                } catch (e: Exception) {
                    failures += "${strategy.name}: ${e.message}"
                }
                socket?.closeQuietly()
            }
            throw IOException("RFCOMM connect to $address failed (${failures.joinToString("; ")})")
        }

    private fun BluetoothSocket.closeQuietly() {
        try {
            close()
        } catch (_: IOException) {
        }
    }
}
