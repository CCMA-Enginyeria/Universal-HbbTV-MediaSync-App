package expo.modules.customtabsmessaging

import android.content.ComponentName
import android.net.Uri
import android.os.Bundle
import androidx.browser.customtabs.CustomTabsCallback
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.customtabs.CustomTabsService
import androidx.browser.customtabs.CustomTabsServiceConnection
import androidx.browser.customtabs.CustomTabsSession
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Owns the Android Custom Tabs session used to exchange verified postMessages
 * with a web origin while the React Native activity is in the background.
 */
class CustomTabsMessagingModule : Module() {
    private var client: CustomTabsClient? = null
    private var session: CustomTabsSession? = null
    private var connection: CustomTabsServiceConnection? = null
    private var channelReady = false
    private var requestedOrigin: Uri? = null
    private var requestedUrl: Uri? = null
    private var openPromise: Promise? = null

    private val callback = object : CustomTabsCallback() {
        override fun onRelationshipValidationResult(
            relation: Int,
            requestedOrigin: Uri,
            result: Boolean,
            extras: Bundle?
        ) {
            if (relation != CustomTabsService.RELATION_USE_AS_ORIGIN) return
            if (!result) {
                sendError("Digital Asset Links validation failed for $requestedOrigin")
            }
        }

        override fun onMessageChannelReady(extras: Bundle?) {
            channelReady = true
            sendEvent("onChannelReady")
        }

        override fun onPostMessage(message: String, extras: Bundle?) {
            sendEvent("onMessage", mapOf("message" to message))
        }

        override fun onNavigationEvent(navigationEvent: Int, extras: Bundle?) {
            if (navigationEvent == NAVIGATION_STARTED) {
                channelReady = false
            } else if (navigationEvent == NAVIGATION_FINISHED) {
                channelReady = false
                sendEvent("onPageLoaded")
                val origin = requestedOrigin
                val accepted = origin != null &&
                    (session?.requestPostMessageChannel(origin, origin, Bundle()) ?: false)
                if (!accepted) {
                    sendError("The browser rejected the postMessage channel after navigation")
                }
            } else if (navigationEvent == TAB_HIDDEN) {
                channelReady = false
                sendEvent("onTabHidden")
            }
        }
    }

    override fun definition() = ModuleDefinition {
        Name("CustomTabsMessaging")

        Events("onChannelReady", "onChannelError", "onMessage", "onPageLoaded", "onTabHidden")

        AsyncFunction("open") { url: String, origin: String, promise: Promise ->
            closeSession()
            val context = appContext.reactContext
            val activity = appContext.currentActivity
            if (context == null || activity == null) {
                promise.reject("NO_ACTIVITY", "The Android activity is not available", null)
                return@AsyncFunction
            }

            val pageUri = Uri.parse(url)
            val originUri = Uri.parse(origin)
            if (pageUri.scheme != "https" || originUri.scheme != "https" ||
                pageUri.host != originUri.host || pageUri.port != originUri.port) {
                promise.reject("INVALID_ORIGIN", "The page URL and HTTPS origin do not match", null)
                return@AsyncFunction
            }

            val packageName = CustomTabsClient.getPackageName(context, null)
            if (packageName == null) {
                promise.reject("NO_PROVIDER", "No Custom Tabs provider is installed", null)
                return@AsyncFunction
            }

            requestedUrl = pageUri
            requestedOrigin = originUri
            openPromise = promise
            val serviceConnection = object : CustomTabsServiceConnection() {
                override fun onCustomTabsServiceConnected(name: ComponentName, tabsClient: CustomTabsClient) {
                    client = tabsClient
                    tabsClient.warmup(0L)
                    val tabsSession = tabsClient.newSession(callback)
                    if (tabsSession == null) {
                        rejectOpen("SESSION_FAILED", "Could not create a Custom Tabs session")
                        return
                    }

                    session = tabsSession
                    val accepted = tabsSession.requestPostMessageChannel(
                        originUri,
                        originUri,
                        Bundle()
                    )
                    if (!accepted) {
                        rejectOpen("CHANNEL_REJECTED", "The browser rejected the postMessage channel request")
                        return
                    }

                    val intent = CustomTabsIntent.Builder(tabsSession).build()
                    intent.intent.setPackage(name.packageName)
                    intent.launchUrl(activity, pageUri)
                    openPromise?.resolve(true)
                    openPromise = null
                }

                override fun onServiceDisconnected(name: ComponentName) {
                    channelReady = false
                    client = null
                    session = null
                    sendError("The Custom Tabs service disconnected")
                }
            }
            connection = serviceConnection
            if (!CustomTabsClient.bindCustomTabsService(context, packageName, serviceConnection)) {
                rejectOpen("BIND_FAILED", "Could not connect to the Custom Tabs provider")
            }
        }

        Function("postMessage") { message: String ->
            if (!channelReady) return@Function CustomTabsService.RESULT_FAILURE_DISALLOWED
            session?.postMessage(message, Bundle())
                ?: CustomTabsService.RESULT_FAILURE_REMOTE_ERROR
        }

        Function("close") {
            closeSession()
        }

        OnDestroy {
            closeSession()
        }
    }

    private fun rejectOpen(code: String, message: String) {
        openPromise?.reject(code, message, null)
        openPromise = null
        closeSession()
    }

    private fun sendError(message: String) {
        sendEvent("onChannelError", mapOf("message" to message))
    }

    private fun closeSession() {
        val context = appContext.reactContext
        val serviceConnection = connection
        if (context != null && serviceConnection != null) {
            try {
                context.unbindService(serviceConnection)
            } catch (_: IllegalArgumentException) {
                // The bind may have failed before Android registered the connection.
            }
        }
        openPromise?.reject("SESSION_CLOSED", "The Custom Tabs session was closed", null)
        openPromise = null
        channelReady = false
        requestedOrigin = null
        requestedUrl = null
        connection = null
        session = null
        client = null
    }
}