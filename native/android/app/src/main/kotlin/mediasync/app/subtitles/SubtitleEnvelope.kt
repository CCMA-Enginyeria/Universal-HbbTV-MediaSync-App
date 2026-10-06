package mediasync.app.subtitles

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import mediasync.core.CompanionProtocol
import mediasync.core.Cue

/**
 * Envelope that mirrors the cue list of the selected subtitle track to a page that
 * renders subtitles itself (XR subtitles). The page picks the visible cue from the
 * `position` envelopes it also receives, so text timing does not depend on the tick
 * cadence. Same versioning as [CompanionProtocol]; regular companion pages never get it.
 */
object SubtitleEnvelope {
    const val TYPE = "subtitle-cues"

    fun cues(active: Boolean, cues: List<Cue>): String = buildJsonObject {
        put("version", CompanionProtocol.VERSION)
        put("type", TYPE)
        put("active", active)
        put("cues", buildJsonArray {
            for (cue in cues) {
                if (!cue.startS.isFinite() || !cue.endS.isFinite()) continue
                add(buildJsonObject {
                    put("start", JsonPrimitive(cue.startS))
                    put("end", JsonPrimitive(cue.endS))
                    put("text", cue.text)
                })
            }
        })
    }.toString()
}
