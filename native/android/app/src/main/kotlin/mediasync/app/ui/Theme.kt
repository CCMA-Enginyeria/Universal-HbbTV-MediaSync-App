package mediasync.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import mediasync.app.brand.BrandConfig

/** Brand palette exported from `src/theme.js` + brand overrides; no colors are hardcoded here. */
object Tokens {
    fun color(name: String): Color = Color(BrandConfig.COLORS[name] ?: 0xFFFF00FF)
    fun spacing(name: String) = (BrandConfig.SPACING[name] ?: 16).dp
    fun radius(name: String) = (BrandConfig.RADIUS[name] ?: 8).dp

    val success get() = color("success")
    val onSuccessContainer get() = color("onSuccessContainer")
    val successContainer get() = color("successContainer")
    val warningContainer get() = color("warningContainer")
    val onWarningContainer get() = color("onWarningContainer")
    val surfaceContainer get() = color("surfaceContainer")
    val surfaceContainerHigh get() = color("surfaceContainerHigh")
}

@Composable
fun MediaSyncTheme(content: @Composable () -> Unit) {
    val scheme = darkColorScheme(
        primary = Tokens.color("primary"),
        onPrimary = Tokens.color("onPrimary"),
        primaryContainer = Tokens.color("primaryContainer"),
        onPrimaryContainer = Tokens.color("onPrimaryContainer"),
        secondary = Tokens.color("secondary"),
        onSecondary = Tokens.color("onSecondary"),
        secondaryContainer = Tokens.color("secondaryContainer"),
        onSecondaryContainer = Tokens.color("onSecondaryContainer"),
        tertiary = Tokens.color("tertiary"),
        onTertiary = Tokens.color("onTertiary"),
        background = Tokens.color("background"),
        onBackground = Tokens.color("onBackground"),
        surface = Tokens.color("surface"),
        onSurface = Tokens.color("onSurface"),
        surfaceVariant = Tokens.color("surfaceVariant"),
        onSurfaceVariant = Tokens.color("onSurfaceVariant"),
        surfaceContainer = Tokens.color("surfaceContainer"),
        surfaceContainerHigh = Tokens.color("surfaceContainerHigh"),
        surfaceContainerHighest = Tokens.color("surfaceContainerHighest"),
        surfaceContainerLow = Tokens.color("surfaceContainerLow"),
        surfaceContainerLowest = Tokens.color("surfaceContainerLowest"),
        outline = Tokens.color("outline"),
        outlineVariant = Tokens.color("outlineVariant"),
        error = Tokens.color("error"),
        onError = Tokens.color("onError"),
        errorContainer = Tokens.color("errorContainer"),
        onErrorContainer = Tokens.color("onErrorContainer"),
        inverseSurface = Tokens.color("inverseSurface"),
        inverseOnSurface = Tokens.color("inverseOnSurface"),
        inversePrimary = Tokens.color("inversePrimary"),
    )
    MaterialTheme(colorScheme = scheme, content = content)
}
