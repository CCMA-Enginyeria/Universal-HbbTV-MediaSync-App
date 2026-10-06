package mediasync.app.web

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mediasync.app.R
import mediasync.app.diagnostics.Diagnostics
import mediasync.app.session.CompanionSink
import mediasync.app.session.SessionController

/**
 * XR subtitles for Meta Horizon OS: a bundled WebXR page that draws the selected
 * subtitle track in passthrough, following the view or anchored where the user
 * places it. The app serves the page itself over a [LoopbackServer] (loopback is a
 * secure context, so no hosting and no Local Network Access prompt) and feeds it
 * positions and cues. It opens in a regular Quest Browser tab, the only one with
 * WebXR (see [LoopbackCompanion]). Called on the main thread.
 */
class XrSubtitlesCompanion(
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

    fun canOpen(): Boolean = LoopbackCompanion.hasQuestBrowser(context)

    fun open(activity: Activity) {
        close()
        val page = runCatching { page() }.getOrElse {
            diagnostics.log("xr", "open-failed", "reason" to "page")
            return
        }
        val listener = Listener()
        val started = runCatching { LoopbackServer(null, listener, PREFERRED_PORT, page) }.getOrElse {
            diagnostics.log("xr", "open-failed", "reason" to "listen")
            return
        }
        val launched = runCatching {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(started.pageUrl))
                .setPackage(LoopbackCompanion.QUEST_BROWSER)
                .addCategory(Intent.CATEGORY_BROWSABLE))
        }.isSuccess
        if (!launched) {
            started.stop()
            diagnostics.log("xr", "open-failed", "reason" to "launch")
            return
        }
        listener.owner = started
        server = started
        controller.attachSubtitleSink(sink)
        diagnostics.log("xr", "open", "port" to (started.port == PREFERRED_PORT))
    }

    fun close() {
        val current = server ?: return
        server = null
        current.stop()
        controller.detachSubtitleSink(sink)
        diagnostics.log("xr", "closed")
    }

    /** The bundled page with its localized strings inlined, so it needs no other request. */
    private fun page(): ByteArray {
        val template = context.assets.open(ASSET).use { it.readBytes().toString(Charsets.UTF_8) }
        val strings = buildJsonObject {
            put("lang", context.resources.configuration.locales[0].language)
            STRINGS.forEach { (key, id) -> put(key, context.getString(id)) }
        }.toString().replace("<", "\\u003c")
        return template.replace(STRINGS_PLACEHOLDER, strings).toByteArray(Charsets.UTF_8)
    }

    /** Moves events of the current server to the main thread; see [LoopbackCompanion]. */
    private inner class Listener : LoopbackServer.Listener {
        var owner: LoopbackServer? = null

        override fun onConnected(connection: Long) {
            main.post {
                val current = owner
                if (current != null && current === server && current.isCurrent(connection)) controller.seedSubtitleSink(sink)
            }
        }

        // The page only listens; nothing it sends is forwarded to the TV.
        override fun onText(connection: Long, text: String) = Unit

        override fun onEvent(event: String) = diagnostics.log("xr", event)
    }

    private companion object {
        const val ASSET = "xr-subtitles.html"
        const val STRINGS_PLACEHOLDER = "\"__MEDIASYNC_STRINGS__\""
        /** Stable origin for the page's saved placement; any free port is used if taken. */
        const val PREFERRED_PORT = 47_913

        val STRINGS = listOf(
            "title" to R.string.native_xr_title,
            "intro" to R.string.native_xr_intro,
            "enter" to R.string.native_xr_enter,
            "unsupported" to R.string.native_xr_unsupported,
            "failed" to R.string.native_xr_failed,
            "connecting" to R.string.native_xr_connecting,
            "disconnected" to R.string.native_xr_disconnected,
            "noSubtitles" to R.string.native_xr_noSubtitles,
            "modeTitle" to R.string.native_xr_modeTitle,
            "modeHead" to R.string.native_xr_modeHead,
            "modeWorld" to R.string.native_xr_modeWorld,
            "size" to R.string.native_xr_size,
            "resetPlacement" to R.string.native_xr_resetPlacement,
            "placementReset" to R.string.native_xr_placementReset,
            "placeholder" to R.string.native_xr_placeholder,
            "hintHead" to R.string.native_xr_hintHead,
            "hintWorld" to R.string.native_xr_hintWorld,
        )
    }
}
