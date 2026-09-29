package mediasync.app.content

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import mediasync.core.ContentKind
import mediasync.core.HlsParser
import mediasync.core.MediaManifest
import mediasync.core.MpdParser
import mediasync.core.WebMetadata
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/**
 * Bounded, cancellable downloads of untrusted content: manifests, subtitles
 * and companion page metadata. Cancelling the coroutine cancels the HTTP call.
 */
class ContentLoader(private val http: OkHttpClient) {
    suspend fun manifest(url: String, kind: ContentKind): MediaManifest {
        val text = text(url, MpdParser.MAX_BYTES)
        return withContext(Dispatchers.Default) {
            if (kind == ContentKind.HLS) HlsParser.parse(text, url) else MpdParser.parse(text, url)
        }
    }

    suspend fun webMetadata(url: String): WebMetadata = runCatching {
        WebMetadata.parse(text(url, WebMetadata.MAX_HTML_CHARS, truncate = true), url)
    }.getOrDefault(WebMetadata(null, null))

    suspend fun text(url: String, maxBytes: Int, truncate: Boolean = false): String =
        String(bytes(url, maxBytes, truncate), Charsets.UTF_8)

    /** Returns null for 404 so live segment gaps are tolerated. */
    suspend fun bytesOrNull(url: String, maxBytes: Int): ByteArray? = try {
        bytes(url, maxBytes, false)
    } catch (error: HttpStatusException) {
        if (error.code == 404) null else throw error
    }

    class HttpStatusException(val code: Int) : IOException("HTTP $code")

    private suspend fun bytes(url: String, maxBytes: Int, truncate: Boolean): ByteArray {
        val scheme = url.substringBefore(':').lowercase()
        if (scheme != "http" && scheme != "https") throw IOException("Unsupported scheme")
        val call = http.newCall(Request.Builder().url(url).header("User-Agent", "MediaSyncNative/1.0").build())
        return call.awaitBytes(maxBytes, truncate)
    }

    private suspend fun Call.awaitBytes(maxBytes: Int, truncate: Boolean): ByteArray = suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { cancel() }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWith(Result.failure(e)) }
            override fun onResponse(call: Call, response: Response) {
                val result = runCatching {
                    response.use {
                        if (!it.isSuccessful) throw HttpStatusException(it.code)
                        val body = it.body ?: throw IOException("Empty body")
                        if (body.contentLength() > maxBytes && !truncate) throw IOException("Response exceeds size limit")
                        val source = body.source()
                        val buffer = okio.Buffer()
                        while (buffer.size < maxBytes) {
                            if (source.read(buffer, minOf(8_192L, maxBytes - buffer.size)) == -1L) break
                        }
                        if (!truncate && !source.exhausted()) throw IOException("Response exceeds size limit")
                        buffer.readByteArray()
                    }
                }
                if (continuation.isActive) continuation.resumeWith(result)
            }
        })
    }
}
