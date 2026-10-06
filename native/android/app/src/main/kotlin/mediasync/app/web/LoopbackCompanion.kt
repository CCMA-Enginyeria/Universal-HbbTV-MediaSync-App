package mediasync.app.web

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import java.net.URLEncoder
import mediasync.app.diagnostics.Diagnostics
import mediasync.app.session.CompanionSink
import mediasync.app.session.SessionController
import mediasync.core.CompanionProtocol

/**
 * Companion transport for Meta Horizon OS. The Quest Browser exposes WebXR only in
 * regular tabs (its Custom Tabs and the Android WebView report no immersive sessions),
 * so the page opens in a regular tab and talks to the app over a [LoopbackServer].
 * The URL fragment carries the socket address with a per-launch secret and the server
 * also requires the page origin, so other sites and other apps cannot attach.
 * Process-scoped (see AppGraph); the bridge lives until the next page, the end of the
 * session or [close]. Called on the main thread.
 */
class LoopbackCompanion(
    private val context: Context,
    private val controller: SessionController,
    private val main: Handler,
    private val diagnostics: Diagnostics,
) {
    private var server: LoopbackServer? = null

    private val sink = object : CompanionSink {
        override fun deliver(envelope: String) {
            server?.send(envelope)
        }
    }

    /** True for HTTPS pages on devices with the Quest Browser, which needs a regular tab for WebXR. */
    fun canTry(url: String): Boolean = CompanionProtocol.httpsOrigin(url) != null && hasQuestBrowser(context)

    fun open(activity: Activity, url: String, onFallback: () -> Unit) {
        close()
        val origin = CompanionProtocol.httpsOrigin(url) ?: return onFallback()
        val listener = Listener()
        val started = runCatching { LoopbackServer(origin, listener) }.getOrElse {
            diagnostics.log("companion", "loopback-failed", "reason" to "listen")
            return onFallback()
        }
        val launched = runCatching {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(bridgeUrl(url, started.socketUrl)))
                .setPackage(QUEST_BROWSER)
                .addCategory(Intent.CATEGORY_BROWSABLE)
            activity.startActivity(intent)
        }.isSuccess
        if (!launched) {
            started.stop()
            diagnostics.log("companion", "loopback-failed", "reason" to "launch")
            return onFallback()
        }
        listener.owner = started
        server = started
        controller.attachCompanion(sink)
        diagnostics.log("companion", "loopback-open")
    }

    fun close() {
        val current = server ?: return
        server = null
        current.stop()
        controller.detachCompanion(sink)
        diagnostics.log("companion", "loopback-closed")
    }

    /**
     * Moves the events of one server to the main thread, dropping those of a replaced
     * server or page. [owner] is set by [open] before any posted event can run.
     */
    private inner class Listener : LoopbackServer.Listener {
        var owner: LoopbackServer? = null

        private fun onMain(connection: Long, action: () -> Unit) = main.post {
            val current = owner
            if (current != null && current === server && current.isCurrent(connection)) action()
        }

        override fun onConnected(connection: Long) {
            onMain(connection) { controller.seedCompanion(sink) }
        }

        override fun onText(connection: Long, text: String) {
            onMain(connection) { CompanionProtocol.parse(text)?.let(controller::onCompanionMessage) }
        }

        override fun onEvent(event: String) = diagnostics.log("companion", event)
    }

    companion object {
        const val QUEST_BROWSER = "com.oculus.browser"
        /** Fragment parameter read by the companion page client. */
        const val FRAGMENT_PARAMETER = "mediasync-ws"

        fun hasQuestBrowser(context: Context): Boolean {
            val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://")).setPackage(QUEST_BROWSER).addCategory(Intent.CATEGORY_BROWSABLE)
            return runCatching { context.packageManager.resolveActivity(probe, 0) != null }.getOrDefault(false)
        }

        /** Adds the bridge address to the URL fragment, keeping any fragment the page already has. */
        fun bridgeUrl(url: String, socketUrl: String): String {
            val parameter = FRAGMENT_PARAMETER + "=" + URLEncoder.encode(socketUrl, "UTF-8")
            val hash = url.indexOf('#')
            return when {
                hash == -1 -> "$url#$parameter"
                hash == url.length - 1 -> url + parameter
                else -> "$url&$parameter"
            }
        }
    }
}
