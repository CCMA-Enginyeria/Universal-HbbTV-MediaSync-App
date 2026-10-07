package mediasync.app

import android.app.Application
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import java.util.concurrent.TimeUnit
import mediasync.app.content.ContentLoader
import mediasync.app.data.Preferences
import mediasync.app.diagnostics.Diagnostics
import mediasync.app.discovery.DiscoveryController
import mediasync.app.net.AndroidTransport
import mediasync.app.net.NetworkMonitor
import mediasync.app.session.SessionController
import mediasync.app.web.CustomTabsCompanion
import mediasync.app.web.LoopbackCompanion
import mediasync.app.web.XrSubtitlesCompanion
import okhttp3.OkHttpClient

class MediaSyncApplication : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = graph.session.onAppForeground()
        })
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
    val network = NetworkMonitor(application)
    val transport = AndroidTransport(http, mainHandler, diagnostics) { network.state.value.network }
    val preferences = Preferences(application)
    val content = ContentLoader(http.newBuilder().followRedirects(true).followSslRedirects(true).build())
    val discovery = DiscoveryController(application, network, diagnostics, mainHandler)
    val session = SessionController(application, transport, network, content, preferences, diagnostics, mainHandler)
    val customTabs = CustomTabsCompanion(application, session, mainHandler)
    val loopback = LoopbackCompanion(application, session, mainHandler, diagnostics)
    val xrSubtitles = XrSubtitlesCompanion(application, session, mainHandler, diagnostics)
}

val Context.graph: AppGraph get() = (applicationContext as MediaSyncApplication).graph
