package mediasync.app.subtitles

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import mediasync.app.content.ContentLoader
import mediasync.core.Cue
import mediasync.core.CueTrack
import mediasync.core.MediaManifest
import mediasync.core.MediaTrack
import mediasync.core.Subtitles
import mediasync.core.TextSegmentSchedule

/**
 * Downloads one text track (whole file or segmented TTML) and answers which
 * cue is visible at a TV position. Text is always derived from the TV
 * position, so seeks and pauses never leave stale cues on screen. A failure
 * only disables subtitles; audio/video keep playing (PRD-010-R07).
 */
class SubtitleController(private val loader: ContentLoader, private val scope: CoroutineScope) {
    var track: MediaTrack? = null
        private set
    var failed = false
        private set
    /** Changes whenever the loaded cue list does, so pages that mirror [cues] know when to refresh. */
    var revision = 0L
        private set
    private var job: Job? = null
    private var cues = CueTrack()
        set(value) {
            field = value
            revision++
        }
    @Volatile private var positionS: Double? = null

    fun select(manifest: MediaManifest?, track: MediaTrack?) {
        job?.cancel()
        job = null
        cues = CueTrack()
        failed = false
        this.track = track
        if (manifest == null || track == null) return
        val template = track.segmentTemplate
        job = if (template != null && track.baseUrl != null) {
            val schedule = TextSegmentSchedule(template, track.baseUrl!!, manifest.isLive, manifest.availabilityStartTimeMs,
                track.representationId, lookahead = LOOKAHEAD_SEGMENTS)
            scope.launch {
                while (isActive) {
                    for (number in schedule.pending(System.currentTimeMillis(), positionS)) {
                        val url = schedule.url(number) ?: continue
                        val bytes = runCatching { loader.bytesOrNull(url, SEGMENT_LIMIT) }.getOrNull()
                        if (!isActive) return@launch
                        if (bytes == null) break
                        val text = bytes.toString(Charsets.UTF_8).trimStart()
                        val parsed = if (track.textFormat == "vtt") Subtitles.parseVtt(text) else {
                            val document = if (text.startsWith("<")) text else Subtitles.extractTtmlFromMp4(bytes)
                            document?.let(Subtitles::parseTtml).orEmpty()
                        }
                        schedule.complete(number, parsed)
                    }
                    val loaded = schedule.cues()
                    if (loaded != cues.cues) cues = CueTrack(loaded)
                    // A segment that is not published yet is retried soon, before the position reaches it.
                    delay(if (manifest.isLive) (template.segmentSeconds * 1000 / 3).toLong().coerceIn(1_000, 2_000) else 1_000)
                }
            }
        } else {
            val url = track.textUrl ?: return
            scope.launch {
                val parsed: List<Cue>? = runCatching {
                    val text = loader.text(url, Subtitles.MAX_DOCUMENT_CHARS)
                    if (track.textFormat == "vtt") Subtitles.parseVtt(text) else Subtitles.parseTtml(text)
                }.getOrNull()
                if (!isActive) return@launch
                if (parsed == null) failed = true else cues = CueTrack(parsed)
            }
        }
    }

    /** Cues loaded for the selected track, sorted by start time. */
    val cueList: List<Cue> get() = cues.cues

    fun text(position: Double?): String? {
        positionS = position
        return cues.activeText(position)
    }

    private companion object {
        const val SEGMENT_LIMIT = 1_048_576
        const val LOOKAHEAD_SEGMENTS = 2
    }
}
