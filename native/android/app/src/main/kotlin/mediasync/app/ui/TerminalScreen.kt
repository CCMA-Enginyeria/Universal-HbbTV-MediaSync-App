package mediasync.app.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.Language
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
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
fun TerminalScreen(onBack: () -> Unit, onHelp: () -> Unit, onOpenWeb: (String) -> Unit, onFullscreen: () -> Unit, fullscreen: Boolean = false) {
    val context = LocalContext.current
    val controller = context.graph.session
    val state by controller.state.collectAsStateWithLifecycle()
    val terminal = state.terminal ?: return
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    fun play(track: MediaTrack) {
        if (Build.VERSION.SDK_INT >= 33) notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        controller.play(track)
    }

    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(horizontal = Tokens.spacing("containerPadding"))) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
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
                if (audio.isNotEmpty()) Section(stringResource(R.string.discovery_audioSection))
                audio.forEach { TrackRow(it, state, content.manifest.isLive, ::play, onFullscreen, fullscreen) }
                if (video.isNotEmpty()) Section(stringResource(R.string.discovery_videoSection))
                video.forEach { TrackRow(it, state, content.manifest.isLive, ::play, onFullscreen, fullscreen) }
                if (text.isNotEmpty()) {
                    Section(stringResource(R.string.native_terminal_subtitles))
                    Row(horizontalArrangement = Arrangement.spacedBy(Tokens.spacing("sm"))) {
                        FilterChip(selected = state.subtitle == null, onClick = { controller.selectSubtitle(null) },
                            label = { Text(stringResource(R.string.native_terminal_subtitlesOff)) })
                        text.forEach { track ->
                            FilterChip(selected = state.subtitle == track, onClick = { controller.selectSubtitle(track) },
                                label = { Text(Labels.trackTitle(track)) })
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

@Composable
private fun TrackRow(track: MediaTrack, state: SessionController.UiState, live: Boolean, onPlay: (MediaTrack) -> Unit, onFullscreen: () -> Unit, fullscreen: Boolean) {
    val controller = LocalContext.current.graph.session
    val selected = state.selected == track
    val title = Labels.trackTitle(track)
    val role = if (track.kind == TrackKind.AUDIO) Labels.audioRole(track) else stringResource(R.string.discovery_videoLabel)
    val selectedText = stringResource(R.string.native_a11y_selected)
    Card(
        colors = CardDefaults.cardColors(containerColor = if (selected) Tokens.surfaceContainerHigh else Tokens.surfaceContainer),
        shape = RoundedCornerShape(Tokens.radius("lg")),
        modifier = Modifier.fillMaxWidth().padding(bottom = Tokens.spacing("sm")).semantics { this.selected = selected },
    ) {
        Column(Modifier.padding(Tokens.spacing("md"))) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(role, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                }
                val action = when {
                    selected -> stringResource(R.string.discovery_stopSync)
                    track.kind == TrackKind.AUDIO -> stringResource(R.string.discovery_listen)
                    else -> stringResource(R.string.discovery_watch)
                }
                Button(onClick = { onPlay(track) }, modifier = Modifier.heightIn(min = 48.dp)
                    .semantics { contentDescription = "$action, $title" + if (selected) ", $selectedText" else "" }) { Text(action) }
            }
            if (selected) PlayerPanel(track, state, live, controller, onFullscreen, fullscreen)
        }
    }
}

@Composable
private fun PlayerPanel(track: MediaTrack, state: SessionController.UiState, live: Boolean, controller: SessionController, onFullscreen: () -> Unit, fullscreen: Boolean) {
    if (track.kind == TrackKind.VIDEO) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).padding(top = Tokens.spacing("sm")).background(Color.Black)) {
            if (!fullscreen) PlayerSurface(Modifier.fillMaxSize())
            SubtitleOverlay(state.subtitleText, Modifier.align(Alignment.BottomCenter))
            IconButton(onClick = onFullscreen, modifier = Modifier.align(Alignment.TopEnd)) {
                Icon(Icons.Filled.Fullscreen, contentDescription = stringResource(R.string.native_terminal_fullscreen), tint = Color.White)
            }
        }
    } else {
        state.subtitleText?.let { Text(it, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = Tokens.spacing("sm"))) }
    }
    val status = Labels.syncStatus(state.status, state.rate)
    val statusDescription = stringResource(R.string.native_a11y_syncStatus, status)
    Row(Modifier.fillMaxWidth().padding(top = Tokens.spacing("sm")), verticalAlignment = Alignment.CenterVertically) {
        Text(status, style = MaterialTheme.typography.labelLarge,
            color = if (state.status == PlaybackCorrector.Status.LOCKED) Tokens.success else MaterialTheme.colorScheme.tertiary,
            modifier = Modifier.weight(1f).semantics { contentDescription = statusDescription; liveRegion = LiveRegionMode.Polite })
        Text(if (live) stringResource(R.string.discovery_live) else TimelineMath.formatClock(state.positionS),
            style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    when {
        state.suspendedBySystem -> Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.native_player_pausedBySystem), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            Button(onClick = controller::resumeAfterSystemPause) { Text(stringResource(R.string.native_player_resume)) }
        }
        state.playerRetrying -> Message(stringResource(R.string.native_player_retrying), live = true)
        state.playerFailed -> Message(stringResource(R.string.native_player_failed), live = true)
        track.kind == TrackKind.AUDIO -> Text(stringResource(R.string.discovery_backgroundHint), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (state.subtitleFailed) Message(stringResource(R.string.native_terminal_manifestError))
    val volumeLabel = stringResource(R.string.native_player_volume)
    Slider(value = state.volume, onValueChange = controller::setVolume,
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = volumeLabel })
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
