package mediasync.app.content

import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.Source
import okio.Timeout
import okio.buffer
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ContentLoaderTest {
    @Test
    fun readsBodyAtExactSizeLimit() = withResponse("test") { loader ->
        assertEquals("test", loader.text("http://localhost/content", 4))
    }

    @Test
    fun rejectsOversizedBody() = withResponse("oversized") { loader ->
        assertFailsWith<IOException> { loader.text("http://localhost/content", 4) }
    }

    @Test
    fun truncatesMetadataBodyAtLimit() = withResponse("metadata") { loader ->
        assertEquals("meta", loader.text("http://localhost/content", 4, truncate = true))
    }

    @Test
    fun toleratesMissingSubtitleSegment() = withResponse("missing", 404) { loader ->
        assertNull(loader.bytesOrNull("http://localhost/subtitle", 1024))
    }

    @Test
    fun rejectsOtherHttpErrors() = withResponse("unavailable", 503) { loader ->
        val error = assertFailsWith<ContentLoader.HttpStatusException> {
            loader.bytesOrNull("http://localhost/subtitle", 1024)
        }
        assertEquals(503, error.code)
    }

    private fun withResponse(text: String, status: Int = 200, check: suspend (ContentLoader) -> Unit) = runBlocking {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(status).message("Test response").body(text.toResponseBody()).build()
        }.build()
        try {
            check(ContentLoader(client))
        } finally {
            client.dispatcher.executorService.shutdownNow()
            client.connectionPool.evictAll()
        }
    }

    @Test
    fun cancellationWhileReadingBodyCancelsHttpCall() = runBlocking {
        val reading = CountDownLatch(1)
        val release = CountDownLatch(1)
        val closed = CountDownLatch(1)
        val activeCall = AtomicReference<Call>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            activeCall.set(chain.call())
            val source = object : Source {
                override fun read(sink: Buffer, byteCount: Long): Long {
                    reading.countDown()
                    check(release.await(5, TimeUnit.SECONDS))
                    return -1
                }
                override fun timeout() = Timeout.NONE
                override fun close() { closed.countDown() }
            }.buffer()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK").body(object : ResponseBody() {
                    override fun contentType() = null
                    override fun contentLength() = -1L
                    override fun source(): BufferedSource = source
                }).build()
        }.build()
        val download = launch(Dispatchers.Default) {
            ContentLoader(client).text("http://localhost/manifest.mpd", 1024)
        }
        try {
            assertTrue(reading.await(5, TimeUnit.SECONDS), "Download must reach body reading")
            download.cancel()
            assertTrue(activeCall.get().isCanceled(), "Cancellation must abort the active HTTP call")
        } finally {
            release.countDown()
            download.cancel()
            download.join()
            client.dispatcher.executorService.shutdownNow()
            client.connectionPool.evictAll()
        }
        assertTrue(closed.await(1, TimeUnit.SECONDS), "Response body must be closed")
    }
}