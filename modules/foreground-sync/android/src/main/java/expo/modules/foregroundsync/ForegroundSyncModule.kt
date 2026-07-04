package expo.modules.foregroundsync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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

    // Receiver for the notification's stop action. Forwards the request to JS so
    // the React layer can tear down the player and the DVB-CSS sync.
    private var stopReceiver: BroadcastReceiver? = null
    private var stopReceiverRegistered = false

    private fun registerStopReceiver() {
        if (stopReceiverRegistered) return
        val context = appContext.reactContext ?: return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action != SyncForegroundService.ACTION_STOP_REQUESTED) return
                try {
                    sendEvent("onStopRequested", emptyMap<String, Any>())
                } catch (e: Exception) {
                    Log.e(TAG, "onStopRequested sendEvent error: ${e.message}")
                }
            }
        }
        val filter = IntentFilter(SyncForegroundService.ACTION_STOP_REQUESTED)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                context.registerReceiver(receiver, filter)
            }
            stopReceiver = receiver
            stopReceiverRegistered = true
        } catch (e: Exception) {
            Log.e(TAG, "registerStopReceiver error: ${e.message}")
        }
    }

    private fun unregisterStopReceiver() {
        if (!stopReceiverRegistered) return
        val context = appContext.reactContext
        val receiver = stopReceiver
        if (context != null && receiver != null) {
            try {
                context.unregisterReceiver(receiver)
            } catch (e: Exception) {
                Log.e(TAG, "unregisterStopReceiver error: ${e.message}")
            }
        }
        stopReceiver = null
        stopReceiverRegistered = false
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

        Events("onHeartbeat", "onStopRequested")

        Function("start") { title: String?, text: String?, stopLabel: String? ->
            val context = appContext.reactContext ?: return@Function false
            val intent = Intent(context, SyncForegroundService::class.java).apply {
                action = SyncForegroundService.ACTION_START
                putExtra(SyncForegroundService.EXTRA_TITLE, title ?: "Universal MediaSync")
                putExtra(SyncForegroundService.EXTRA_TEXT, text ?: "Sincronizando con la TV")
                putExtra(SyncForegroundService.EXTRA_STOP_LABEL, stopLabel ?: "Detener")
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
                registerStopReceiver()
                startHeartbeat()
                true
            } catch (e: Exception) {
                Log.e(TAG, "Could not start foreground service: ${e.message}")
                false
            }
        }

        Function("stop") {
            stopHeartbeat()
            unregisterStopReceiver()
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
            unregisterStopReceiver()
        }
    }
}
