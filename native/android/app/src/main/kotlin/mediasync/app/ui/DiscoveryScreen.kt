package mediasync.app.ui

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import mediasync.app.R
import mediasync.app.discovery.DiscoveryController
import mediasync.app.graph
import mediasync.core.DialTerminal

@Composable
fun DiscoveryScreen(onOpenTerminal: (DialTerminal) -> Unit, onHelp: () -> Unit) {
    val context = LocalContext.current
    val graph = context.graph
    val state by graph.discovery.state.collectAsStateWithLifecycle()
    val network by graph.network.state.collectAsStateWithLifecycle()
    val session by graph.session.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { if (state.phase == DiscoveryController.Phase.IDLE) graph.discovery.start() }
    LaunchedEffect(network.available) {
        if (network.available && state.problem == DiscoveryController.Problem.NO_NETWORK) graph.discovery.start()
    }

    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = Tokens.spacing("containerPadding"))) {
        Row(Modifier.fillMaxWidth().padding(vertical = Tokens.spacing("sm")), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.discovery_title), style = MaterialTheme.typography.headlineSmall,
                    color = MaterialTheme.colorScheme.onBackground, modifier = Modifier.semantics { heading() })
                Text(stringResource(R.string.discovery_subtitle), style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onHelp) {
                Icon(Icons.AutoMirrored.Filled.HelpOutline, contentDescription = stringResource(R.string.nav_help),
                    tint = MaterialTheme.colorScheme.onBackground)
            }
        }

        session.terminal?.takeIf { session.isActive }?.let { active ->
            Card(onClick = { onOpenTerminal(active) }, modifier = Modifier.fillMaxWidth().padding(bottom = Tokens.spacing("sm")),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
                Text("${stringResource(R.string.native_discovery_activeSession)} · ${active.device.friendlyName ?: stringResource(R.string.native_discovery_unnamedTv)}",
                    modifier = Modifier.padding(Tokens.spacing("md")), color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
        }

        val statusText = when (state.problem) {
            DiscoveryController.Problem.NO_NETWORK -> stringResource(R.string.native_discovery_noNetwork)
            DiscoveryController.Problem.PERMISSION -> stringResource(R.string.native_discovery_permissionMessage)
            DiscoveryController.Problem.SEND_FAILED -> stringResource(R.string.native_discovery_sendFailed)
            null -> when {
                state.phase == DiscoveryController.Phase.SEARCHING -> stringResource(R.string.discovery_scanning)
                state.syncCapable.isEmpty() && state.phase == DiscoveryController.Phase.FINISHED ->
                    stringResource(R.string.discovery_noMediaSyncDevices)
                else -> null
            }
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).semantics { liveRegion = LiveRegionMode.Polite },
            verticalAlignment = Alignment.CenterVertically) {
            if (state.phase == DiscoveryController.Phase.SEARCHING) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(Tokens.spacing("sm")))
            }
            statusText?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Tokens.spacing("sm"))) {
            if (state.phase == DiscoveryController.Phase.SEARCHING) {
                OutlinedButton(onClick = graph.discovery::cancel) { Text(stringResource(R.string.native_discovery_cancel)) }
            } else {
                Button(onClick = graph.discovery::start) { Text(stringResource(R.string.native_discovery_rescan)) }
            }
            when (state.problem) {
                DiscoveryController.Problem.NO_NETWORK -> OutlinedButton(onClick = {
                    runCatching { context.startActivity(Intent(Settings.ACTION_WIFI_SETTINGS)) }
                }) { Text(stringResource(R.string.native_discovery_openSettings)) }
                DiscoveryController.Problem.PERMISSION -> OutlinedButton(onClick = {
                    runCatching { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.fromParts("package", context.packageName, null))) }
                }) { Text(stringResource(R.string.native_discovery_openSettings)) }
                else -> Unit
            }
        }

        LazyColumn(Modifier.fillMaxSize().padding(top = Tokens.spacing("md")), verticalArrangement = Arrangement.spacedBy(Tokens.spacing("sm"))) {
            items(state.syncCapable, key = { it.device.id }) { terminal ->
                TerminalRow(terminal, enabled = true) { onOpenTerminal(terminal) }
            }
            if (state.others.isNotEmpty()) {
                item {
                    Text(stringResource(R.string.discovery_otherDevices), style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = Tokens.spacing("md")).semantics { heading() })
                }
                items(state.others, key = { "other:" + it.device.id }) { terminal -> TerminalRow(terminal, enabled = false) {} }
            }
            if (state.phase == DiscoveryController.Phase.FINISHED && state.problem == null && state.syncCapable.isEmpty()) {
                item { Text(stringResource(R.string.discovery_errorHint), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }
    }
}

@Composable
private fun TerminalRow(terminal: DialTerminal, enabled: Boolean, onClick: () -> Unit) {
    val name = terminal.device.friendlyName ?: stringResource(R.string.native_discovery_unnamedTv)
    val detail = listOfNotNull(terminal.device.manufacturer, terminal.device.modelName).joinToString(" · ")
    Card(
        modifier = Modifier.fillMaxWidth().then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier),
        shape = RoundedCornerShape(Tokens.radius("lg")),
        colors = CardDefaults.cardColors(containerColor = Tokens.surfaceContainer),
    ) {
        Row(Modifier.padding(Tokens.spacing("md")).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Tv, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.width(Tokens.spacing("md")))
            Column(Modifier.weight(1f)) {
                Text(name, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
                if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (!enabled) Text(stringResource(R.string.native_discovery_nonHbbtvNotice), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
