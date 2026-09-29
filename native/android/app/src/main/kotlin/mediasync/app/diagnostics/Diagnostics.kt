package mediasync.app.diagnostics

import android.os.SystemClock
import android.util.Log
import mediasync.app.BuildConfig
import org.json.JSONObject

/**
 * In-memory structured log (PRD-013-R07). Records carry states, units and
 * ephemeral numeric ids only: never payloads, URLs or content identifiers.
 * Nothing leaves the device unless the user exports it explicitly.
 */
class Diagnostics(private val capacity: Int = 2_000) {
    private val records = ArrayDeque<String>()

    @Synchronized
    fun log(area: String, event: String, vararg fields: Pair<String, Any?>) {
        val json = JSONObject()
        json.put("t", SystemClock.elapsedRealtime())
        json.put("a", area)
        json.put("e", event)
        for ((key, value) in fields) json.put(key, value ?: JSONObject.NULL)
        val line = json.toString()
        records.addLast(line)
        while (records.size > capacity) records.removeFirst()
        if (BuildConfig.DEBUG || (BuildConfig.SYNC_TELEMETRY && area == "sync")) Log.d(TAG, line)
    }

    @Synchronized
    fun export(): String = buildString {
        append("MediaSync diagnostics ").append(BuildConfig.VERSION_NAME).append('\n')
        records.forEach { append(it).append('\n') }
    }

    companion object {
        const val TAG = "MediaSync"
    }
}
