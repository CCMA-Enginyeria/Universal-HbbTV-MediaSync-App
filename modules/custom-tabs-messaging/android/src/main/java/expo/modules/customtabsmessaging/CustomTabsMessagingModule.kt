package expo.modules.customtabsmessaging

import android.app.Activity
import android.content.ComponentName
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
 *
 * The tab is only launched once the browser confirms the Digital Asset Links
 * relationship for the origin; otherwise `open` resolves with `opened = false`
 * so the caller can fall back to the in-app WebView.
 */
class CustomTabsMessagingModule : Module() {
    private var client: CustomTabsClient? = null
    private var session: CustomTabsSession? = null
    private var connection: CustomTabsServiceConnection? = null
    private var channelReady = false
    private var requestedOrigin: Uri? = null
    private var requestedUrl: Uri? = null
    private var openPromise: Promise? = null
    private var pendingActivity: Activity? = null
    private var providerPackage: String? = null
    private var awaitingValidation = false

    private val mainHandler = Handler(Looper.getMainLooper())
    private val validationTimeout = Runnable {
        if (!awaitingValidation) return@Runnable
        awaitingValidation = false
        settleOpen(false, "DAL_TIMEOUT")
        closeSession()
    }

    private val callback = object : CustomTabsCallback() {
        override fun onRelationshipValidationResult(
            relation: Int,
            requestedOrigin: Uri,
            result: Boolean,
            extras: Bundle?
        ) {
            if (relation != CustomTabsService.RELATION_USE_AS_ORIGIN) return
            if (!awaitingValidation) return
            awaitingValidation = false
            mainHandler.removeCallbacks(validationTimeout)
            if (result) {
                launchVerifiedTab()
            } else {
                settleOpen(false, "DAL_FAILED")
                closeSession()
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
                resolveNotOpened(promise, "INVALID_ORIGIN")
                return@AsyncFunction
            }

            val tabsPackage = CustomTabsClient.getPackageName(context, null)
            if (tabsPackage == null) {
                resolveNotOpened(promise, "NO_PROVIDER")
                return@AsyncFunction
            }

            requestedUrl = pageUri
            requestedOrigin = originUri
            pendingActivity = activity
            openPromise = promise
            val serviceConnection = object : CustomTabsServiceConnection() {
                override fun onCustomTabsServiceConnected(name: ComponentName, tabsClient: CustomTabsClient) {
                    client = tabsClient
                    providerPackage = name.packageName
                    tabsClient.warmup(0L)
                    val tabsSession = tabsClient.newSession(callback)
                    if (tabsSession == null) {
                        settleOpen(false, "SESSION_FAILED")
                        closeSession()
                        return
                    }

                    session = tabsSession
                    // The tab is launched from onRelationshipValidationResult, never here.
                    val requested = tabsSession.validateRelationship(
                        CustomTabsService.RELATION_USE_AS_ORIGIN,
                        originUri,
                        null
                    )
                    if (!requested) {
                        settleOpen(false, "DAL_REQUEST_REJECTED")
                        closeSession()
                        return
                    }

                    awaitingValidation = true
                    mainHandler.postDelayed(validationTimeout, VALIDATION_TIMEOUT_MS)
                }

                override fun onServiceDisconnected(name: ComponentName) {
                    channelReady = false
                    client = null
                    session = null
                    if (openPromise != null) {
                        settleOpen(false, "SERVICE_DISCONNECTED")
                    } else {
                        sendError("The Custom Tabs service disconnected")
                    }
                }
            }
            connection = serviceConnection
            if (!CustomTabsClient.bindCustomTabsService(context, tabsPackage, serviceConnection)) {
                settleOpen(false, "BIND_FAILED")
                closeSession()
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

    private fun launchVerifiedTab() {
        val tabsSession = session
        val activity = pendingActivity
        val pageUri = requestedUrl
        val originUri = requestedOrigin
        if (tabsSession == null || activity == null || pageUri == null || originUri == null) {
            settleOpen(false, "SESSION_LOST")
            closeSession()
            return
        }

        if (!tabsSession.requestPostMessageChannel(originUri, originUri, Bundle())) {
            settleOpen(false, "CHANNEL_REJECTED")
            closeSession()
            return
        }

        val intent = CustomTabsIntent.Builder(tabsSession).build()
        providerPackage?.let { intent.intent.setPackage(it) }
        intent.launchUrl(activity, pageUri)
        settleOpen(true, null)
    }

    private fun resolveNotOpened(promise: Promise, reason: String) {
        promise.resolve(mapOf("opened" to false, "reason" to reason))
    }

    private fun settleOpen(opened: Boolean, reason: String?) {
        val promise = openPromise ?: return
        openPromise = null
        val payload = mutableMapOf<String, Any>("opened" to opened)
        reason?.let { payload["reason"] = it }
        promise.resolve(payload)
    }

    private fun sendError(message: String) {
        sendEvent("onChannelError", mapOf("message" to message))
    }

    private fun closeSession() {
        mainHandler.removeCallbacks(validationTimeout)
        awaitingValidation = false
        val context = appContext.reactContext
        val serviceConnection = connection
        if (context != null && serviceConnection != null) {
            try {
                context.unbindService(serviceConnection)
            } catch (_: IllegalArgumentException) {
                // The bind may have failed before Android registered the connection.
            }
        }
        settleOpen(false, "SESSION_CLOSED")
        channelReady = false
        requestedOrigin = null
        requestedUrl = null
        pendingActivity = null
        providerPackage = null
        connection = null
        session = null
        client = null
    }

    companion object {
        /** How long to wait for the browser to resolve the Digital Asset Links statement. */
        private const val VALIDATION_TIMEOUT_MS = 2500L
    }
}