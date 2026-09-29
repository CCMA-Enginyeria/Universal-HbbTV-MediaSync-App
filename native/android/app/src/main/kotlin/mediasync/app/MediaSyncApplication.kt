package mediasync.app

import android.app.Application
import android.content.Context
import android.os.Handler
import android.os.Looper
import java.util.concurrent.TimeUnit
import mediasync.app.content.ContentLoader
import mediasync.app.data.Preferences
import mediasync.app.diagnostics.Diagnostics
import mediasync.app.discovery.DiscoveryController
import mediasync.app.net.AndroidTransport
import mediasync.app.net.NetworkMonitor
import mediasync.app.session.SessionController
import okhttp3.OkHttpClient

class MediaSyncApplication : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
    }
}

/**
 * Process-scoped owners. Everything that mutates session state runs on the
 * main looper; network and parsing run on worker threads and post back.
 * Screens only observe state, so recreation never duplicates workers.
 */
class AppGraph(val application: Application) {
    val mainHandler = Handler(Looper.getMainLooper())
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .pingInterval(15, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .build()
    val diagnostics = Diagnostics()
    val transport = AndroidTransport(http, mainHandler, diagnostics)
    val network = NetworkMonitor(application)
    val preferences = Preferences(application)
    val content = ContentLoader(http.newBuilder().followRedirects(true).followSslRedirects(true).build())
    val discovery = DiscoveryController(application, network, diagnostics, mainHandler)
    val session = SessionController(application, transport, content, preferences, diagnostics, mainHandler)
}

val Context.graph: AppGraph get() = (applicationContext as MediaSyncApplication).graph
