package mediasync.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import mediasync.app.R
import mediasync.core.MediaSyncSession
import mediasync.core.MediaTrack
import mediasync.core.PlaybackCorrector
import mediasync.core.TrackKind

/** Localized labels derived from core models; the core never returns display text. */
object Labels {
    private val languages = mapOf(
        "ca" to R.string.discovery_media_languages_ca, "es" to R.string.discovery_media_languages_es,
        "eu" to R.string.discovery_media_languages_eu, "en" to R.string.discovery_media_languages_en,
        "fr" to R.string.discovery_media_languages_fr, "de" to R.string.discovery_media_languages_de,
        "it" to R.string.discovery_media_languages_it, "pt" to R.string.discovery_media_languages_pt,
    )

    @Composable
    fun language(code: String?, kind: TrackKind): String {
        if (code.isNullOrBlank()) return stringResource(when (kind) {
            TrackKind.AUDIO -> R.string.discovery_media_audioGeneric
            TrackKind.VIDEO -> R.string.discovery_media_videoGeneric
            TrackKind.TEXT -> R.string.discovery_media_subtitleGeneric
        })
        val normalized = code.lowercase().substringBefore('-')
        return when {
            Regex("^q[a-t][a-z]$").matches(normalized) || normalized == "mis" -> stringResource(R.string.discovery_media_otherLang)
            normalized == "und" -> stringResource(R.string.discovery_media_undefinedLang)
            else -> languages[normalized]?.let { stringResource(it) } ?: code.uppercase()
        }
    }

    @Composable
    fun audioRole(track: MediaTrack): String = stringResource(when {
        track.audioDescription || track.role == "description" -> R.string.discovery_audioDescription
        track.role == null || track.role == "main" -> R.string.discovery_audioMain
        track.label?.contains("original", ignoreCase = true) == true || track.role == "dub" -> R.string.discovery_audioOriginal
        else -> R.string.discovery_audioAlternative
    })

    fun codec(track: MediaTrack): String? {
        val codecs = track.codecs?.lowercase() ?: return null
        return when {
            "ec-3" in codecs -> "Dolby"
            "ac-3" in codecs -> "AC3"
            "mp4a" in codecs -> "AAC"
            else -> null
        }
    }

    @Composable
    fun trackTitle(track: MediaTrack): String {
        val base = track.label ?: when {
            track.kind == TrackKind.VIDEO && track.signLanguage -> stringResource(R.string.discovery_media_signLanguage)
            track.kind == TrackKind.AUDIO && track.audioDescription -> stringResource(R.string.discovery_media_audioDescription)
            track.kind == TrackKind.VIDEO && track.role != null && track.role != "main" ->
                "${stringResource(R.string.discovery_media_videoGeneric)} (${track.role})"
            else -> language(track.language, track.kind)
        }
        val extras = listOfNotNull(
            codec(track)?.takeIf { track.kind == TrackKind.AUDIO && !base.contains(it) },
            if (track.kind == TrackKind.VIDEO && track.width != null && track.height != null) "${track.width}x${track.height}" else null,
        )
        return if (extras.isEmpty()) base else "$base (${extras.joinToString(", ")})"
    }

    @Composable
    fun syncStatus(status: PlaybackCorrector.Status, rate: Double): String = when (status) {
        PlaybackCorrector.Status.LOCKED -> stringResource(R.string.discovery_syncLocked)
        PlaybackCorrector.Status.ADJUSTING -> stringResource(R.string.discovery_syncAdjusting, String.format(java.util.Locale.ROOT, "%.3f", rate))
        PlaybackCorrector.Status.SEEKING -> stringResource(R.string.discovery_syncSeeking)
        PlaybackCorrector.Status.PAUSED -> stringResource(R.string.native_player_pausedOnTv)
        PlaybackCorrector.Status.WAITING -> stringResource(R.string.discovery_syncWaiting)
    }

    @Composable
    fun session(snapshot: MediaSyncSession.Snapshot?): String? {
        snapshot ?: return null
        val issue = when (snapshot.issue) {
            MediaSyncSession.Issue.NONE -> null
            MediaSyncSession.Issue.NO_ENDPOINT -> R.string.discovery_terminalNoSyncUrl
            MediaSyncSession.Issue.CII_UNREACHABLE -> R.string.discovery_connectionError
            MediaSyncSession.Issue.CONNECTION_LOST -> R.string.discovery_retryingConnection
            MediaSyncSession.Issue.INVALID_ENDPOINTS -> R.string.native_terminal_invalidEndpoints
            MediaSyncSession.Issue.NO_CONTENT -> R.string.discovery_noContentSelected
            MediaSyncSession.Issue.PRESENTATION_FAULT -> R.string.native_terminal_presentationFault
            MediaSyncSession.Issue.UNSUPPORTED_TIMELINE -> R.string.native_terminal_unsupportedTimeline
            MediaSyncSession.Issue.TIMELINE_UNAVAILABLE -> R.string.native_terminal_timelineUnavailable
            MediaSyncSession.Issue.WALL_CLOCK_UNSYNCHRONISED -> R.string.native_terminal_wallClock
        }
        if (issue != null) return stringResource(issue)
        return when (snapshot.state) {
            MediaSyncSession.State.DISCONNECTED -> null
            MediaSyncSession.State.CONNECTING -> stringResource(R.string.native_terminal_connecting)
            MediaSyncSession.State.WAITING_CONTENT -> stringResource(R.string.discovery_waitingForContent)
            MediaSyncSession.State.SYNCHRONISING -> stringResource(R.string.native_terminal_synchronising)
            MediaSyncSession.State.SYNCHRONISED -> stringResource(
                if (snapshot.mode == mediasync.core.SyncMode.COMPAT) R.string.discovery_statusConnectedCompat else R.string.discovery_statusConnected)
            MediaSyncSession.State.RECOVERING -> stringResource(R.string.discovery_retryingConnection)
            MediaSyncSession.State.ERROR -> stringResource(R.string.discovery_connectionError)
        }
    }
}
