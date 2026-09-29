package mediasync.app.web

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import mediasync.app.R
import mediasync.app.brand.BrandConfig
import mediasync.app.session.CompanionSink
import mediasync.app.session.SessionController
import mediasync.core.CompanionBridgeGate
import mediasync.core.CompanionProtocol

private const val BRIDGE = "__mediasyncBridge"

/**
 * Full-screen companion page. A new URL recreates the WebView (and its bridge),
 * so a web -> web change reloads coherently; a null URL means the TV no longer
 * announces web content and the user is offered to close.
 */
@Composable
fun CompanionWebScreen(url: String?, controller: SessionController, onClose: () -> Unit) {
    BackHandler(onBack = onClose)
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding()) {
        if (url != null && CompanionProtocol.origin(url) != null) {
            key(url) { CompanionWebView(url, controller, onClose) }
        } else {
            Notice(stringResource(R.string.discovery_webNoContent), stringResource(R.string.discovery_webClose), onClose)
        }
        IconButton(onClick = onClose, modifier = Modifier.align(Alignment.TopEnd)) {
            Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.discovery_webClose), tint = MaterialTheme.colorScheme.onBackground)
        }
    }
}

@Composable
private fun Notice(message: String, action: String, onAction: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(message, color = MaterialTheme.colorScheme.onBackground, style = MaterialTheme.typography.bodyLarge)
        Button(onClick = onAction, modifier = Modifier.padding(top = 16.dp)) { Text(action) }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun CompanionWebView(url: String, controller: SessionController, onClose: () -> Unit) {
    val context = LocalContext.current
    val gate = remember { CompanionBridgeGate(url) }
    var loading by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }
    var cameraNotice by remember { mutableStateOf(false) }
    var pendingPermission by remember { mutableStateOf<PermissionRequest?>(null) }
    val holder = remember { arrayOfNulls<WebView>(1) }
    val ready = remember { booleanArrayOf(false) }
    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val request = pendingPermission
        pendingPermission = null
        if (granted) request?.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else {
            request?.deny()
            cameraNotice = true
        }
    }
    val sink = remember {
        object : CompanionSink {
            override fun deliver(envelope: String) {
                if (ready[0]) holder[0]?.evaluateJavascript(CompanionProtocol.webViewInjection(envelope), null)
            }
        }
    }
    DisposableEffect(Unit) {
        controller.attachCompanion(sink)
        onDispose {
            controller.detachCompanion(sink)
            pendingPermission?.deny()
            holder[0]?.apply { stopLoading(); destroy() }
            holder[0] = null
        }
    }

    AndroidView(modifier = Modifier.fillMaxSize(), factory = { viewContext ->
        WebView(viewContext).apply {
            holder[0] = this
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setGeolocationEnabled(false)
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            val origins = setOf(requireNotNull(gate.allowedOrigin))
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                WebViewCompat.addWebMessageListener(this, BRIDGE, origins) { _, message, sourceOrigin, isMainFrame, _ ->
                    if (isMainFrame) gate.accept(sourceOrigin.toString(), gate.pageGeneration, message.data ?: "")?.let(controller::onCompanionMessage)
                }
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(this, CompanionProtocol.reactNativeShim("window.$BRIDGE"), origins)
            }
            webViewClient = object : WebViewClientCompat() {
                override fun onPageStarted(view: WebView, pageUrl: String?, favicon: Bitmap?) {
                    gate.onNavigation()
                    ready[0] = false
                    loading = true
                }

                override fun onPageFinished(view: WebView, pageUrl: String?) {
                    loading = false
                    if (CompanionProtocol.origin(pageUrl) == gate.allowedOrigin) {
                        ready[0] = true
                        controller.seedCompanion(sink)
                    }
                }

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (CompanionProtocol.origin(request.url.toString()) == gate.allowedOrigin) return false
                    if (request.url.scheme == "http" || request.url.scheme == "https") {
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    }
                    return true
                }

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceErrorCompat) {
                    if (request.isForMainFrame) failed = true
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    val camera = PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources
                    val sameOrigin = CompanionProtocol.origin(request.origin.toString()) == gate.allowedOrigin
                    if (!camera || !sameOrigin || !BrandConfig.CAMERA_ENABLED) {
                        request.deny()
                        if (camera && !BrandConfig.CAMERA_ENABLED) cameraNotice = true
                        return
                    }
                    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    } else {
                        pendingPermission?.deny()
                        pendingPermission = request
                        cameraLauncher.launch(Manifest.permission.CAMERA)
                    }
                }
            }
            loadUrl(url)
        }
    })
    if (loading && !failed) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    if (failed) {
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(24.dp),
            verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(R.string.native_web_loadError), color = MaterialTheme.colorScheme.onBackground)
            Button(onClick = { failed = false; holder[0]?.reload() }, modifier = Modifier.padding(top = 16.dp)) {
                Text(stringResource(R.string.native_terminal_retry))
            }
            Button(onClick = onClose, modifier = Modifier.padding(top = 8.dp)) { Text(stringResource(R.string.discovery_webClose)) }
        }
    }
    if (cameraNotice) {
        Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.BottomCenter) {
            Button(onClick = { cameraNotice = false }) {
                Text(stringResource(if (BrandConfig.CAMERA_ENABLED) R.string.permissions_camera_deniedMessage else R.string.native_web_cameraDisabled))
            }
        }
    }
}
