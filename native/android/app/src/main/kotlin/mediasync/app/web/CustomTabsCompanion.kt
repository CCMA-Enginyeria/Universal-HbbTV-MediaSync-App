package mediasync.app.web

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.util.Log
import androidx.browser.customtabs.CustomTabsCallback
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.customtabs.CustomTabsService
import androidx.browser.customtabs.CustomTabsServiceConnection
import androidx.browser.customtabs.CustomTabsSession
import mediasync.app.session.CompanionSink
import mediasync.app.BuildConfig
import mediasync.app.session.SessionController
import mediasync.core.CompanionProtocol

/**
 * Custom Tab with a Digital Asset Links verified postMessage channel. The tab
 * is launched only after the browser validates the origin; any failure calls
 * [open]'s fallback exactly once, so retries never stack browser instances.
 */
class CustomTabsCompanion(private val context: Context, private val controller: SessionController, private val main: Handler) {
    private var connection: CustomTabsServiceConnection? = null
    private var session: CustomTabsSession? = null
    private var origin: Uri? = null
    private var channelReady = false
    private var fallback: (() -> Unit)? = null
    private val timeout = Runnable {
        trace("Validation timed out")
        fail()
    }

    private val sink = object : CompanionSink {
        override fun deliver(envelope: String) {
            if (channelReady) session?.postMessage(envelope, null)
        }
    }

    fun canTry(url: String): Boolean {
        val candidate = CompanionProtocol.httpsOrigin(url) ?: return false
        val provider = CustomTabsClient.getPackageName(context, null)
        trace("Eligibility: provider=$provider, origin=$candidate")
        return provider != null
    }

    fun open(activity: Activity, url: String, onFallback: () -> Unit) {
        close()
        val originText = CompanionProtocol.httpsOrigin(url)
        val provider = CustomTabsClient.getPackageName(context, null)
        if (originText == null || provider == null) {
            onFallback()
            return
        }
        val originUri = Uri.parse(originText)
        origin = originUri
        fallback = onFallback
        val callback = object : CustomTabsCallback() {
            override fun onRelationshipValidationResult(relation: Int, requestedOrigin: Uri, result: Boolean, extras: Bundle?) {
                main.post {
                    trace("Relationship validation: relation=$relation, origin=$requestedOrigin, result=$result")
                    if (relation != CustomTabsService.RELATION_USE_AS_ORIGIN || fallback == null) return@post
                    main.removeCallbacks(timeout)
                    if (!result) return@post fail()
                    val tabs = session
                    val requested = tabs?.requestPostMessageChannel(originUri, originUri, Bundle()) == true
                    trace("Initial channel request: accepted=$requested")
                    if (!requested) return@post fail()
                    fallback = null
                    controller.attachCompanion(sink)
                    CustomTabsIntent.Builder(tabs).build().apply { intent.setPackage(provider) }.launchUrl(activity, Uri.parse(url))
                }
            }

            override fun onMessageChannelReady(extras: Bundle?) {
                main.post {
                    trace("Message channel ready")
                    channelReady = true
                    controller.seedCompanion(sink)
                }
            }

            override fun onPostMessage(message: String, extras: Bundle?) {
                main.post { CompanionProtocol.parse(message)?.let(controller::onCompanionMessage) }
            }

            override fun onNavigationEvent(navigationEvent: Int, extras: Bundle?) {
                main.post {
                    trace("Navigation event: $navigationEvent")
                    when (navigationEvent) {
                        NAVIGATION_STARTED -> channelReady = false
                        NAVIGATION_FINISHED -> {
                            channelReady = false
                            val current = origin
                            if (current == null || session?.requestPostMessageChannel(current, current, Bundle()) != true) close()
                        }
                        TAB_HIDDEN -> close()
                    }
                }
            }
        }
        val serviceConnection = object : CustomTabsServiceConnection() {
            override fun onCustomTabsServiceConnected(name: ComponentName, client: CustomTabsClient) {
                main.post {
                    trace("Service connected: ${name.packageName}")
                    client.warmup(0)
                    val tabs = client.newSession(callback)
                    session = tabs
                    if (tabs == null || !tabs.validateRelationship(CustomTabsService.RELATION_USE_AS_ORIGIN, originUri, null)) {
                        fail()
                        return@post
                    }
                    main.postDelayed(timeout, VALIDATION_TIMEOUT_MS)
                }
            }

            override fun onServiceDisconnected(name: ComponentName) {
                main.post { if (fallback != null) fail() else close() }
            }
        }
        connection = serviceConnection
        if (!CustomTabsClient.bindCustomTabsService(context, provider, serviceConnection)) fail()
    }

    fun close() {
        main.removeCallbacks(timeout)
        controller.detachCompanion(sink)
        connection?.let { runCatching { context.unbindService(it) } }
        connection = null
        session = null
        origin = null
        channelReady = false
        fallback = null
    }

    private fun fail() {
        trace("Falling back to WebView; validation can be retried on the next open")
        val onFallback = fallback
        close()
        onFallback?.invoke()
    }

    private fun trace(message: String) {
        if (BuildConfig.DEBUG) Log.d("MediaSyncCustomTabs", message)
    }

    private companion object {
        const val VALIDATION_TIMEOUT_MS = 10_000L
    }
}
