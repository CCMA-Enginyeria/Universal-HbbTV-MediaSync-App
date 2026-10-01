package mediasync.app.playback

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import mediasync.app.MainActivity
import mediasync.app.R
import mediasync.app.graph

/**
 * Foreground service that keeps the process (sockets, wall clock and player)
 * alive in the background while a real session is active. It owns no state:
 * the session controller starts it, and stopping it never leaves a session
 * running without a notification. There are deliberately no seek or pause
 * controls, since the TV is the master timeline.
 */
class SyncService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val media = intent?.getBooleanExtra(EXTRA_MEDIA, true) ?: true
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: getString(R.string.app_name)
        val type = when {
            Build.VERSION.SDK_INT < Build.VERSION_CODES.Q -> 0
            media -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            else -> ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        }
        val entered = try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(title), type)
            true
        } catch (error: RuntimeException) {
            // Starting from the background is not allowed; the controller retries on the next app start.
            applicationContext.graph.session.onServiceStartFailed()
            false
        }
        pendingStarts = (pendingStarts - 1).coerceAtLeast(0)
        if (!entered || (stopRequested && pendingStarts == 0)) {
            stopRequested = false
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        applicationContext.graph.session.stop()
        stopSelf()
    }

    private fun notification(title: String): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, getString(R.string.native_notification_channel),
                NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false); setSound(null, null) })
        }
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        // Same intent as the launcher icon: brings the task to front without clearing an open Custom Tab.
        val launch = packageManager.getLaunchIntentForPackage(packageName) ?: Intent(this, MainActivity::class.java)
        val open = PendingIntent.getActivity(this, 0, launch
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED), flags)
        val stop = PendingIntent.getBroadcast(this, 1, Intent(this, StopReceiver::class.java), flags)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sync)
            .setContentTitle(title)
            .setContentText(getString(R.string.native_notification_text))
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(0, getString(R.string.discovery_stopSync), stop)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "mediasync.sync"
        private const val NOTIFICATION_ID = 47_231
        private const val ACTION_STOP = "mediasync.app.action.STOP_SERVICE"
        private const val EXTRA_MEDIA = "media"
        private const val EXTRA_TITLE = "title"

        /**
         * Starts not yet handled by [onStartCommand]. Stopping the service before it calls
         * startForeground crashes the app, so such a stop is deferred. Main thread only.
         */
        private var pendingStarts = 0
        private var stopRequested = false

        /** Returns false when the system refused the start (e.g. from the background on Android 12+). */
        fun start(context: Context, title: String, media: Boolean): Boolean {
            val intent = Intent(context, SyncService::class.java).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_MEDIA, media)
            val started = runCatching { ContextCompat.startForegroundService(context, intent) }.isSuccess
            if (started) {
                pendingStarts++
                stopRequested = false
            }
            return started
        }

        fun stop(context: Context) {
            if (pendingStarts > 0) stopRequested = true
            else context.stopService(Intent(context, SyncService::class.java))
        }
    }
}

/** Notification "Stop" action: tears the whole session down, also from the background. */
class StopReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        context.graph.session.stop()
    }
}
