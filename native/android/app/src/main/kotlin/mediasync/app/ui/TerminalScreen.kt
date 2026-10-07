package mediasync.app.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import mediasync.app.R
import mediasync.app.graph
import mediasync.app.session.SessionController
import mediasync.core.MediaTrack
import mediasync.core.PlaybackCorrector
import mediasync.core.SyncMode
import mediasync.core.TimelineMath
import mediasync.core.TrackKind

@Composable
fun TerminalScreen(onBack: () -> Unit, onHelp: () -> Unit, onOpenWeb: (String) -> Unit, onOpenXr: (() -> Unit)? = null) {
    val context = LocalContext.current
    val controller = context.graph.session
    val state by controller.state.collectAsStateWithLifecycle()
    val terminal = state.terminal ?: return
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    fun toggle(track: MediaTrack) {
        val starting = track.kind != TrackKind.TEXT && !state.isActive
        if (starting && Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        controller.toggle(track)
    }

    // The catalog scrolls; the player is docked below it by the activity (see PlayerDock).
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        Row(verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(horizontal = Tokens.spacing("containerPadding"))) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.native_terminal_back),
                    tint = MaterialTheme.colorScheme.onBackground)
            }
            Text(terminal.device.friendlyName ?: stringResource(R.string.native_discovery_unnamedTv), style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground, modifier = Modifier.weight(1f).semantics { heading() })
            IconButton(onClick = onHelp) {
                Icon(Icons.AutoMirrored.Filled.HelpOutline, contentDescription = stringResource(R.string.nav_help),
                    tint = MaterialTheme.colorScheme.onBackground)
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = Tokens.spacing("containerPadding"))
            .padding(bottom = Tokens.spacing("md"))) {
            val sessionText = Labels.session(state.snapshot)
            when {
                !terminal.supportsMediaSync -> Message(stringResource(R.string.native_discovery_noSyncSupport))
                state.noModes -> {
                    Message(stringResource(R.string.native_terminal_noModes))
                    OutlinedButton(onClick = controller::retry) { Text(stringResource(R.string.native_terminal_retry)) }
                }
                state.probing && state.availableModes.isEmpty() -> Message(stringResource(R.string.native_terminal_probing))
                sessionText != null -> Message(sessionText, live = true)
            }

            if (state.availableModes.isNotEmpty()) ModeSelector(state, controller)

            when (val content = state.content) {
                SessionController.Content.None, SessionController.Content.Loading ->
                    if (state.effectiveMode != null) Message(stringResource(R.string.discovery_waitingForContent))
                is SessionController.Content.Failed -> Message(stringResource(when (content.reason) {
                    SessionController.Unsupported.FORMAT -> R.string.native_terminal_unsupportedContent
                    SessionController.Unsupported.PROTECTED -> R.string.native_terminal_protectedContent
                    SessionController.Unsupported.MANIFEST -> R.string.native_terminal_manifestError
                }))
                is SessionController.Content.Web -> WebSection(state.webPages, onOpenWeb)
                is SessionController.Content.Media -> {
                    WebSection(state.webPages, onOpenWeb)
                    val tracks = content.manifest.tracks.filterNot { it.protected }
                    val audio = tracks.filter { it.kind == TrackKind.AUDIO }
                    val video = tracks.filter { it.kind == TrackKind.VIDEO }
                    val text = tracks.filter { it.kind == TrackKind.TEXT && content.kind != mediasync.core.ContentKind.HLS }
                    if (audio.isNotEmpty() || video.isNotEmpty() || text.isNotEmpty()) {
                        Message(stringResource(R.string.native_terminal_selectHint))
                    }
                    if (audio.isNotEmpty()) Section(stringResource(R.string.discovery_audioSection))
                    audio.forEach { ComponentRow(it, checked = state.audio == it, onToggle = ::toggle) }
                    if (video.isNotEmpty()) Section(stringResource(R.string.discovery_videoSection))
                    video.forEach { ComponentRow(it, checked = state.video == it, onToggle = ::toggle) }
                    if (text.isNotEmpty()) {
                        Section(stringResource(R.string.native_terminal_subtitles))
                        text.forEach { ComponentRow(it, checked = state.subtitle == it, onToggle = ::toggle) }
                        if (state.subtitle != null && onOpenXr != null) {
                            OutlinedButton(onClick = onOpenXr, modifier = Modifier.padding(top = Tokens.spacing("sm"))) {
                                Icon(Icons.Filled.ViewInAr, contentDescription = null)
                                Text(stringResource(R.string.native_terminal_subtitlesXr), modifier = Modifier.padding(start = Tokens.spacing("sm")))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Message(text: String, live: Boolean = false) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge,
        modifier = Modifier.fillMaxWidth().padding(vertical = Tokens.spacing("sm"))
            .then(if (live) Modifier.semantics { liveRegion = LiveRegionMode.Polite } else Modifier))
}

@Composable
private fun Section(title: String) {
    Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground,
        modifier = Modifier.padding(top = Tokens.spacing("lg"), bottom = Tokens.spacing("sm")).semantics { heading() })
}

@Composable
private fun ModeSelector(state: SessionController.UiState, controller: SessionController) {
    // Shows the mode actually in use (PRD-006-R08); the stored preference can differ when
    // the TV only offers the other stack.
    val shown = state.effectiveMode ?: state.preferredMode
    Section(stringResource(R.string.discovery_modeTitle))
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        SyncMode.entries.forEachIndexed { index, mode ->
            val label = stringResource(if (mode == SyncMode.NATIVE) R.string.discovery_modeNative else R.string.discovery_modeCompat)
            SegmentedButton(
                selected = shown == mode,
                enabled = mode in state.availableModes,
                onClick = { controller.setPreferredMode(mode) },
                shape = SegmentedButtonDefaults.itemShape(index, SyncMode.entries.size),
            ) { Text(label) }
        }
    }
    Text(stringResource(if (shown == SyncMode.NATIVE) R.string.discovery_modeNativeDescription else R.string.discovery_modeCompatDescription),
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = Tokens.spacing("xs")))
}

@Composable
private fun WebSection(pages: List<SessionController.WebPage>, onOpen: (String) -> Unit) {
    if (pages.isEmpty()) return
    Section(stringResource(R.string.discovery_webSection))
    pages.forEach { page -> WebCard(page) { onOpen(page.url) } }
}

@Composable
private fun WebCard(page: SessionController.WebPage, onOpen: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Tokens.surfaceContainer),
        modifier = Modifier.fillMaxWidth().padding(bottom = Tokens.spacing("sm"))) {
        Row(Modifier.padding(Tokens.spacing("md")), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Language, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface)
            Column(Modifier.weight(1f).padding(horizontal = Tokens.spacing("md"))) {
                val title = page.title ?: stringResource(R.string.discovery_webAvailableTitle)
                val language = page.language?.let { Labels.language(it, TrackKind.TEXT) }
                Text(if (language != null) "$title · $language" else title, style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface)
                Text(stringResource(R.string.discovery_webAvailableSubtitle), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Button(onClick = onOpen) { Text(stringResource(R.string.discovery_webOpen)) }
        }
    }
}

/** One component of the content; at most one audio, one video and one subtitle track are checked. */
@Composable
private fun ComponentRow(track: MediaTrack, checked: Boolean, onToggle: (MediaTrack) -> Unit) {
    val role = when (track.kind) {
        TrackKind.AUDIO -> Labels.audioRole(track)
        TrackKind.VIDEO -> stringResource(R.string.discovery_videoLabel)
        TrackKind.TEXT -> null
    }
    Card(
        colors = CardDefaults.cardColors(containerColor = if (checked) Tokens.surfaceContainerHigh else Tokens.surfaceContainer),
        shape = RoundedCornerShape(Tokens.radius("lg")),
        modifier = Modifier.fillMaxWidth().padding(bottom = Tokens.spacing("sm")),
    ) {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp)
            .toggleable(value = checked, role = Role.Checkbox, onValueChange = { onToggle(track) })
            .padding(horizontal = Tokens.spacing("sm"), vertical = Tokens.spacing("xs")),
            verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = checked, onCheckedChange = null, modifier = Modifier.padding(Tokens.spacing("sm")))
            Column(Modifier.weight(1f).padding(start = Tokens.spacing("sm"))) {
                role?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary) }
                Text(Labels.trackTitle(track), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

/** True when [PlayerDock] has something to show: checked audio/video or subtitles of the current content. */
val SessionController.UiState.hasDock: Boolean
    get() = content is SessionController.Content.Media && (isActive || subtitle != null)

/**
 * Player docked at the bottom of the app while components are checked: picture, subtitles,
 * sync status and volume. It stays below the TV list too, since playback outlives the TV screen.
 */
@Composable
fun PlayerDock(onFullscreen: () -> Unit, fullscreen: Boolean, modifier: Modifier = Modifier) {
    val controller = LocalContext.current.graph.session
    val state by controller.state.collectAsStateWithLifecycle()
    val live = (state.content as? SessionController.Content.Media)?.manifest?.isLive == true
    Surface(color = Tokens.surfaceContainerHigh, shape = RoundedCornerShape(topStart = Tokens.radius("lg"), topEnd = Tokens.radius("lg")),
        shadowElevation = 8.dp, modifier = modifier.fillMaxWidth()) {
        Column(Modifier.navigationBarsPadding().padding(horizontal = Tokens.spacing("containerPadding"), vertical = Tokens.spacing("sm"))) {
            if (state.video != null) {
                Box(Modifier.align(Alignment.CenterHorizontally).heightIn(max = 280.dp).aspectRatio(16f / 9f).background(Color.Black)) {
                    if (!fullscreen) PlayerSurface(Modifier.fillMaxSize())
                    SubtitleOverlay(state.subtitleText, Modifier.align(Alignment.BottomCenter))
                    IconButton(onClick = onFullscreen, modifier = Modifier.align(Alignment.TopEnd)) {
                        Icon(Icons.Filled.Fullscreen, contentDescription = stringResource(R.string.native_terminal_fullscreen), tint = Color.White)
                    }
                }
            } else {
                // Audio only or subtitles only: the text takes the place of the picture.
                Box(Modifier.fillMaxWidth().heightIn(min = 48.dp), contentAlignment = Alignment.Center) {
                    state.subtitleText?.let { Text(it, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodyLarge,
                        textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
                }
            }
            if (state.subtitleFailed) Message(stringResource(R.string.native_terminal_manifestError))
            if (state.isActive) PlaybackControls(state, live, controller)
        }
    }
}

@Composable
private fun PlaybackControls(state: SessionController.UiState, live: Boolean, controller: SessionController) {
    val status = Labels.syncStatus(state.status, state.rate)
    val statusDescription = stringResource(R.string.native_a11y_syncStatus, status)
    Row(Modifier.fillMaxWidth().padding(top = Tokens.spacing("xs")), verticalAlignment = Alignment.CenterVertically) {
        Text(status, style = MaterialTheme.typography.labelLarge,
            color = if (state.status == PlaybackCorrector.Status.LOCKED) Tokens.success else MaterialTheme.colorScheme.tertiary,
            modifier = Modifier.weight(1f).semantics { contentDescription = statusDescription; liveRegion = LiveRegionMode.Polite })
        Text(if (live) stringResource(R.string.discovery_live) else TimelineMath.formatClock(state.positionS),
            style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = controller::stopAll, modifier = Modifier.padding(start = Tokens.spacing("sm")).heightIn(min = 48.dp)) {
            Text(stringResource(R.string.discovery_stopSync))
        }
    }
    when {
        state.suspendedBySystem -> Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.native_player_pausedBySystem), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            Button(onClick = controller::resumeAfterSystemPause) { Text(stringResource(R.string.native_player_resume)) }
        }
        state.playerRetrying -> Message(stringResource(R.string.native_player_retrying), live = true)
        state.playerFailed -> Message(stringResource(R.string.native_player_failed), live = true)
        state.video == null -> Text(stringResource(R.string.discovery_backgroundHint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    // Without a checked audio track nothing is audible, so there is no volume to set.
    if (state.audio != null) {
        val volumeLabel = stringResource(R.string.native_player_volume)
        Slider(value = state.volume, onValueChange = controller::setVolume,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = volumeLabel })
    }
}

@Composable
fun SubtitleOverlay(text: String?, modifier: Modifier = Modifier) {
    text ?: return
    Text(text, color = Color.White, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center,
        modifier = modifier.padding(Tokens.spacing("sm")).background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(4.dp))
            .padding(horizontal = Tokens.spacing("sm"), vertical = Tokens.spacing("xs")))
}

/** Video surface bound to the single app player; audio-only playback never creates one. */
@OptIn(UnstableApi::class)
@Composable
fun PlayerSurface(modifier: Modifier = Modifier) {
    val player = LocalContext.current.graph.session.player
    AndroidView(modifier = modifier, factory = { context ->
        PlayerView(context).apply {
            useController = false
            subtitleView?.visibility = android.view.View.GONE
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setKeepContentOnPlayerReset(true)
            this.player = player
        }
    }, update = { it.player = player }, onRelease = { it.player = null })
}

@Composable
fun FullscreenVideo(onExit: () -> Unit) {
    val state by LocalContext.current.graph.session.state.collectAsStateWithLifecycle()
    androidx.activity.compose.BackHandler(onBack = onExit)
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        PlayerSurface(Modifier.fillMaxSize())
        SubtitleOverlay(state.subtitleText, Modifier.align(Alignment.BottomCenter).safeDrawingPadding())
        IconButton(onClick = onExit, modifier = Modifier.align(Alignment.TopEnd).safeDrawingPadding()) {
            Icon(Icons.Filled.Fullscreen, contentDescription = stringResource(R.string.native_terminal_exitFullscreen), tint = Color.White)
        }
    }
}
