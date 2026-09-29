package mediasync.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringArrayResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import mediasync.app.R
import mediasync.app.brand.BrandConfig
import mediasync.app.graph

@Composable
fun HelpScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(Tokens.spacing("containerPadding"))) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.native_terminal_back),
                    tint = MaterialTheme.colorScheme.onBackground)
            }
            Text(stringResource(R.string.help_mainTitle), style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground, modifier = Modifier.semantics { heading() })
        }
        Text(stringResource(R.string.help_mainSubtitle), color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = Tokens.spacing("md")))
        Card(colors = CardDefaults.cardColors(containerColor = Tokens.surfaceContainer), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(Tokens.spacing("lg")), verticalArrangement = Arrangement.spacedBy(Tokens.spacing("md"))) {
                Text(stringResource(R.string.help_troubleshootingTitle), style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.semantics { heading() })
                stringArrayResource(R.array.help_troubleshootingSteps).forEachIndexed { index, step ->
                    Text("${index + 1}. $step", color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
        Row(Modifier.padding(top = Tokens.spacing("lg")), horizontalArrangement = Arrangement.spacedBy(Tokens.spacing("sm"))) {
            BrandConfig.SUPPORT_URL?.let { url ->
                OutlinedButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }) {
                    Text(stringResource(R.string.native_help_support))
                }
            }
            OutlinedButton(onClick = {
                val share = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, context.graph.diagnostics.export())
                runCatching { context.startActivity(Intent.createChooser(share, null)) }
            }) { Text(stringResource(R.string.native_help_exportDiagnostics)) }
        }
        Text("${BrandConfig.APP_NAME} ${BrandConfig.VERSION}", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = Tokens.spacing("lg")))
    }
}
