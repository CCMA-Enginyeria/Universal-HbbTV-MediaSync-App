package mediasync.app.playback

import android.content.Context
import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import mediasync.core.ContentKind
import mediasync.core.MediaManifest
import mediasync.core.MediaTrack
import mediasync.core.PlaybackCorrector

/**
 * The single ExoPlayer of the app, used on the main looper. Tracks are
 * selected by catalog identity (representation id, then language/role/label),
 * never by list index. The user picks the audio and the video independently:
 * audio-only playback disables video renderers and video-only playback mutes
 * the programme by disabling audio renderers.
 */
@OptIn(UnstableApi::class)
class PlayerOwner(context: Context, private val handler: Handler, private val listener: Listener) {
    interface Listener {
        fun onSeekCompleted()
        fun onPlaybackError(retrying: Boolean)
        fun onSystemPause()
        fun onStateChanged()
    }

    val player: ExoPlayer = ExoPlayer.Builder(context)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
        .setHandleAudioBecomingNoisy(true)
        .setWakeMode(C.WAKE_MODE_NETWORK)
        .setLooper(handler.looper)
        .build()

    var audioTrack: MediaTrack? = null
        private set
    var videoTrack: MediaTrack? = null
        private set
    private var manifestUrl: String? = null
    private var subtitleTrack: MediaTrack? = null
    var subtitleText: String? = null
        private set
    private var seekPending = false
    private var retries = 0
    private var retry: Runnable? = null
    private val retryDelaysMs = longArrayOf(2_000, 4_000, 8_000)
    /** True after the OS paused playback (headphones removed, focus lost); TV resume must not override it. */
    var suspendedBySystem = false
        private set

    init {
        player.addListener(object : Player.Listener {
            override fun onTracksChanged(tracks: Tracks) = applySelection(tracks)

            override fun onCues(cueGroup: CueGroup) {
                subtitleText = if (subtitleTrack == null) null else cueGroup.cues
                    .mapNotNull { it.text?.toString() }.takeLast(4).joinToString("\n").ifEmpty { null }
            }

            override fun onPositionDiscontinuity(old: Player.PositionInfo, new: Player.PositionInfo, reason: Int) {
                if (reason == Player.DISCONTINUITY_REASON_SEEK) seekPending = true
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) {
                    retries = 0
                    if (seekPending) {
                        seekPending = false
                        listener.onSeekCompleted()
                    }
                }
                listener.onStateChanged()
            }

            override fun onPlaybackSuppressionReasonChanged(reason: Int) = listener.onStateChanged()

            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (!playWhenReady && (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY ||
                        reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS)) {
                    suspendedBySystem = true
                    listener.onSystemPause()
                }
                listener.onStateChanged()
            }

            override fun onPlayerError(error: PlaybackException) {
                val url = manifestUrl
                if (!isActive || url == null || retries >= retryDelaysMs.size) {
                    listener.onPlaybackError(retrying = false)
                    return
                }
                val delay = retryDelaysMs[retries++]
                listener.onPlaybackError(retrying = true)
                val runnable = Runnable {
                    retry = null
                    if (isActive && manifestUrl == url) {
                        player.prepare()
                        player.playWhenReady = true
                    }
                }
                retry = runnable
                handler.postDelayed(runnable, delay)
            }
        })
    }

    val isActive: Boolean get() = audioTrack != null || videoTrack != null
    val isPlaying: Boolean get() = player.isPlaying
    /** Transient focus loss (calls, navigation prompts) keeps playWhenReady but freezes playback. */
    val isSuppressed: Boolean get() = player.playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE
    val isBuffering: Boolean get() = player.playbackState == Player.STATE_BUFFERING || seekPending
    val rate: Double get() = player.playbackParameters.speed.toDouble()
    val positionS: Double get() = player.currentPosition / 1000.0

    /** Epoch seconds of the current live position, when the stream exposes a wall-clock window. */
    val liveEpochS: Double?
        get() {
            val timeline = player.currentTimeline
            if (timeline.isEmpty) return null
            val window = timeline.getWindow(player.currentMediaItemIndex, Timeline.Window())
            if (window.windowStartTimeMs == C.TIME_UNSET) return null
            return (window.windowStartTimeMs + player.currentPosition) / 1000.0
        }

    /**
     * Plays [audio] and/or [video] of the manifest. A new combination of the content already
     * loaded only changes the track selection, so playback (and its sync) continues.
     */
    fun play(manifest: MediaManifest, kind: ContentKind, audio: MediaTrack?, video: MediaTrack?, startPositionS: Double?, volume: Float) {
        val reload = !isActive || manifestUrl != manifest.url
        audioTrack = audio
        videoTrack = video
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_AUDIO)
            .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
            .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, video == null)
            .setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, audio == null)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, subtitleTrack == null)
            .build()
        if (!reload) {
            applySelection(player.currentTracks)
            return
        }
        manifestUrl = manifest.url
        retries = 0
        suspendedBySystem = false
        val item = MediaItem.Builder()
            .setUri(manifest.url)
            .setMimeType(if (kind == ContentKind.HLS) MimeTypes.APPLICATION_M3U8 else MimeTypes.APPLICATION_MPD)
            .build()
        player.volume = volume
        player.setPlaybackSpeed(1f)
        if (startPositionS != null && !manifest.isLive) player.setMediaItem(item, (startPositionS * 1000).toLong())
        else player.setMediaItem(item)
        player.prepare()
        player.playWhenReady = true
    }

    fun apply(command: PlaybackCorrector.Command) {
        when (command) {
            PlaybackCorrector.Command.Play -> if (!suspendedBySystem) player.playWhenReady = true
            PlaybackCorrector.Command.Pause -> player.playWhenReady = false
            is PlaybackCorrector.Command.SetRate -> player.setPlaybackSpeed(command.rate.toFloat())
            is PlaybackCorrector.Command.Seek -> {
                seekPending = true
                player.seekTo((command.mediaTimeS * 1000).toLong().coerceAtLeast(0))
            }
        }
    }

    /** Explicit user resume after a system pause. */
    fun resumeAfterSystemPause() {
        suspendedBySystem = false
        player.playWhenReady = true
    }

    fun setVolume(volume: Float) { player.volume = volume.coerceIn(0f, 1f) }

    fun selectSubtitle(track: MediaTrack?) {
        subtitleTrack = track
        subtitleText = null
        applySubtitleSelection(player.currentTracks)
    }

    private fun applySubtitleSelection(tracks: Tracks) {
        val target = subtitleTrack
        val group = target?.let { selected ->
            tracks.groups.firstOrNull { candidate ->
                candidate.type == C.TRACK_TYPE_TEXT && (0 until candidate.length).any { index ->
                    val format = candidate.getTrackFormat(index)
                    candidate.isTrackSupported(index) &&
                        (selected.language == null || format.language == selected.language) &&
                        (selected.label == null || format.label == selected.label)
                }
            }
        }
        val parameters = player.trackSelectionParameters.buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, group == null)
        if (group != null) {
            val index = (0 until group.length).first { index ->
                val format = group.getTrackFormat(index)
                group.isTrackSupported(index) &&
                    (target.language == null || format.language == target.language) &&
                    (target.label == null || format.label == target.label)
            }
            parameters.setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, index))
        }
        val updated = parameters.build()
        if (updated != player.trackSelectionParameters) player.trackSelectionParameters = updated
    }

    fun stop() {
        selectSubtitle(null)
        audioTrack = null
        videoTrack = null
        manifestUrl = null
        seekPending = false
        suspendedBySystem = false
        retry?.let(handler::removeCallbacks)
        retry = null
        player.stop()
        player.clearMediaItems()
        player.setPlaybackSpeed(1f)
    }

    fun release() {
        stop()
        player.release()
    }

    private fun applySelection(tracks: Tracks) {
        applySubtitleSelection(tracks)
        audioTrack?.let { selectGroup(tracks, it, C.TRACK_TYPE_AUDIO) }
        videoTrack?.let { selectGroup(tracks, it, C.TRACK_TYPE_VIDEO) }
    }

    private fun selectGroup(tracks: Tracks, target: MediaTrack, type: Int) {
        val groups = tracks.groups.filter { it.type == type }
        fun formats(group: Tracks.Group) = (0 until group.length).map { group.getTrackFormat(it) }
        val match = groups.firstOrNull { group -> target.representationId != null && formats(group).any { it.id == target.representationId } }
            ?: groups.firstOrNull { group ->
                formats(group).any { format ->
                    val roleMatches = when {
                        target.audioDescription -> format.roleFlags and C.ROLE_FLAG_DESCRIBES_VIDEO != 0
                        target.signLanguage -> format.roleFlags and C.ROLE_FLAG_SIGN != 0
                        else -> format.roleFlags and (C.ROLE_FLAG_DESCRIBES_VIDEO or C.ROLE_FLAG_SIGN) == 0
                    }
                    (target.language == null || format.language?.startsWith(target.language!!) == true) && roleMatches &&
                        (target.label == null || format.label == null || format.label == target.label)
                }
            }
            ?: return
        if (player.trackSelectionParameters.overrides.containsKey(match.mediaTrackGroup)) return
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(match.mediaTrackGroup, (0 until match.length).toList()))
            .build()
    }
}
