package mediasync.app

import android.content.pm.ActivityInfo
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import mediasync.app.ui.DiscoveryScreen
import mediasync.app.ui.FullscreenVideo
import mediasync.app.ui.HelpScreen
import mediasync.app.ui.MediaSyncTheme
import mediasync.app.ui.TerminalScreen
import mediasync.app.web.CompanionWebScreen
import mediasync.app.web.CustomTabsCompanion
import mediasync.app.web.LoopbackCompanion

/**
 * Single activity. Navigation state is saved by the NavController; session
 * state lives in the process-scoped [AppGraph], so rotation or recreation only
 * re-binds views. Phones stay portrait except fullscreen video and web pages.
 */
class MainActivity : ComponentActivity() {
    private val customTabs: CustomTabsCompanion get() = graph.customTabs
    private val loopback: LoopbackCompanion get() = graph.loopback

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MediaSyncTheme {
                val navigation = rememberNavController()
                var fullscreen by rememberSaveable { mutableStateOf(false) }
                val session by graph.session.state.collectAsStateWithLifecycle()
                val route = navigation.currentBackStackEntryFlow.collectAsStateWithLifecycle(null).value?.destination?.route
                LaunchedEffect(fullscreen, route) { applyOrientation(fullscreen || route == WEB) }
                LaunchedEffect(session.selected?.kind) { if (session.selected?.kind != mediasync.core.TrackKind.VIDEO) fullscreen = false }
                LaunchedEffect(session.terminal) {
                    if (session.terminal == null) loopback.close()
                    if (session.terminal == null && (route == TERMINAL || route == WEB)) navigation.popBackStack(DISCOVERY, false)
                }
                DisposableEffect(fullscreen) {
                    immersive(fullscreen)
                    onDispose { }
                }
                Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
                    NavHost(navigation, startDestination = DISCOVERY) {
                        composable(DISCOVERY) {
                            DiscoveryScreen(onOpenTerminal = { terminal ->
                                graph.session.select(terminal)
                                navigation.navigate(TERMINAL) { launchSingleTop = true }
                            }, onHelp = { navigation.navigate(HELP) })
                        }
                        composable(TERMINAL) {
                            TerminalScreen(
                                onBack = {
                                    graph.session.leaveDetail()
                                    navigation.popBackStack()
                                },
                                onHelp = { navigation.navigate(HELP) },
                                onOpenWeb = { url ->
                                    graph.session.openWeb(url)
                                    val inApp = {
                                        if (customTabs.canTry(url)) customTabs.open(this@MainActivity, url) { navigation.navigate(WEB) }
                                        else navigation.navigate(WEB)
                                    }
                                    // Horizon OS: only a regular Quest Browser tab offers WebXR.
                                    if (loopback.canTry(url)) loopback.open(this@MainActivity, url, inApp)
                                    else {
                                        loopback.close()
                                        inApp()
                                    }
                                },
                                onFullscreen = { fullscreen = true },
                                fullscreen = fullscreen,
                            )
                        }
                        composable(WEB) {
                            CompanionWebScreen(session.openWebPage?.url, graph.session) { navigation.popBackStack() }
                        }
                        composable(HELP) { HelpScreen(onBack = { navigation.popBackStack() }) }
                    }
                    if (fullscreen && session.selected?.kind == mediasync.core.TrackKind.VIDEO) FullscreenVideo(onExit = { fullscreen = false })
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        customTabs.onHostResumed()
    }

    override fun onDestroy() {
        if (isFinishing) {
            customTabs.close()
            loopback.close()
        }
        super.onDestroy()
    }

    private fun applyOrientation(free: Boolean) {
        val tablet = resources.configuration.smallestScreenWidthDp >= 600
        requestedOrientation = when {
            tablet -> ActivityInfo.SCREEN_ORIENTATION_FULL_USER
            free -> ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
            else -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
    }

    private fun immersive(enabled: Boolean) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (enabled) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private companion object {
        const val DISCOVERY = "discovery"
        const val TERMINAL = "terminal"
        const val WEB = "web"
        const val HELP = "help"
    }
}
