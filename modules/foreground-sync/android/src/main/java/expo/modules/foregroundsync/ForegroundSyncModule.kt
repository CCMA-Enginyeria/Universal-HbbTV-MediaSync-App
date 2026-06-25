package expo.modules.foregroundsync

import android.content.Intent
import android.os.Build
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
    }

    override fun definition() = ModuleDefinition {
        Name("ForegroundSync")

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
                true
            } catch (e: Exception) {
                Log.e(TAG, "Could not start foreground service: ${e.message}")
                false
            }
        }

        Function("stop") {
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
    }
}
