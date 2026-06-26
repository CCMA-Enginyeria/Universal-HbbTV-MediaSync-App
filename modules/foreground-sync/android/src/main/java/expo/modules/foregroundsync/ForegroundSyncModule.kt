package expo.modules.foregroundsync

import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module that starts/stops a plain (controls-less) foreground service so
 * the DVB-CSS synchronization keeps running while the app is backgrounded.
 */
class ForegroundSyncModule : Module() {

    companion object {
        private const val TAG = "ForegroundSync"
        // Intervalo del heartbeat nativo. Sirve para despertar el hilo JS en
        // segundo plano (donde React Native pausa los setTimeout), de modo que
        // la lógica de reconexión pueda ejecutarse aunque no haya sockets
        // abiertos ni audio reproduciéndose.
        private const val HEARTBEAT_INTERVAL_MS = 2000L
    }

    private val handler = Handler(Looper.getMainLooper())
    private var heartbeatRunning = false
    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            if (!heartbeatRunning) return
            try {
                sendEvent("onHeartbeat", mapOf("timestamp" to System.currentTimeMillis()))
            } catch (e: Exception) {
                Log.e(TAG, "heartbeat sendEvent error: ${e.message}")
            }
            handler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
        }
    }

    private fun startHeartbeat() {
        if (heartbeatRunning) return
        heartbeatRunning = true
        handler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS)
    }

    private fun stopHeartbeat() {
        heartbeatRunning = false
        handler.removeCallbacks(heartbeatRunnable)
    }

    override fun definition() = ModuleDefinition {
        Name("ForegroundSync")

        Events("onHeartbeat")

        Function("start") { title: String?, text: String? ->
            val context = appContext.reactContext ?: return@Function false
            val intent = Intent(context, SyncForegroundService::class.java).apply {
                action = SyncForegroundService.ACTION_START
                putExtra(SyncForegroundService.EXTRA_TITLE, title ?: "HbbTV MediaSync")
                putExtra(SyncForegroundService.EXTRA_TEXT, text ?: "Sincronizando con la TV")
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
                startHeartbeat()
                true
            } catch (e: Exception) {
                Log.e(TAG, "Could not start foreground service: ${e.message}")
                false
            }
        }

        Function("stop") {
            stopHeartbeat()
            val context = appContext.reactContext ?: return@Function false
            val intent = Intent(context, SyncForegroundService::class.java).apply {
                action = SyncForegroundService.ACTION_STOP
            }
            try {
                context.startService(intent)
                true
            } catch (e: Exception) {
                Log.e(TAG, "Could not stop foreground service: ${e.message}")
                false
            }
        }

        OnDestroy {
            stopHeartbeat()
        }
    }
}
