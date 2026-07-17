package expo.modules.wsbridge

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Expo module exposing a tiny loopback WebSocket server. It lets the mobile app
 * relay DVB-CSS synchronization to a companion page that runs OUTSIDE the in-app
 * WebView (e.g. in a Chrome Custom Tab, where WebXR works but there is no
 * `injectJavaScript` bridge).
 *
 * The app remains the sync authority (it does the UDP wall-clock and CSS-TS,
 * which a browser cannot) and simply forwards the computed positions over the
 * WebSocket. The server binds to 127.0.0.1 only, so it is unreachable from other
 * devices and an HTTPS page may connect via plain `ws://` without mixed-content
 * blocking.
 */
class WsBridgeModule : Module() {

  companion object {
    private const val TAG = "WsBridge"
    private const val START_TIMEOUT_SECONDS = 5L
  }

  private var server: BridgeServer? = null

  override fun definition() = ModuleDefinition {
    Name("WsBridge")

    AsyncFunction("start") { port: Int ->
      startServer(port)
    }

    Function("send") { message: String ->
      val srv = server ?: return@Function false
      srv.broadcastMessage(message)
    }

    Function("stop") {
      stopServer()
    }

    Function("isRunning") {
      server != null
    }

    OnDestroy {
      stopServer()
    }
  }

  private fun startServer(port: Int): Int {
    stopServer()
    val startLatch = CountDownLatch(1)
    val srv = BridgeServer(InetSocketAddress("127.0.0.1", port.coerceAtLeast(0)), startLatch)
    srv.isReuseAddr = true
    return try {
      srv.start()
      val started = startLatch.await(START_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      if (!started || !srv.didStartSuccessfully()) {
        Log.e(TAG, "WebSocket bridge did not start within ${START_TIMEOUT_SECONDS}s")
        try { srv.stop() } catch (_: Exception) {}
        return 0
      }
      server = srv
      val boundPort = srv.port
      Log.i(TAG, "WebSocket bridge listening on 127.0.0.1:$boundPort")
      boundPort
    } catch (e: Exception) {
      Log.e(TAG, "Could not start WebSocket bridge: ${e.message}")
      try { srv.stop() } catch (_: Exception) {}
      0
    }
  }

  private fun stopServer(): Boolean {
    val srv = server ?: return false
    server = null
    return try {
      // Non-blocking close of the server and all client connections.
      srv.stop(0)
      true
    } catch (e: Exception) {
      Log.e(TAG, "Could not stop WebSocket bridge: ${e.message}")
      false
    }
  }

  /**
   * Loopback WebSocket server that fans out the latest sync payload to every
   * connected client and re-sends it on new connections.
   */
  private class BridgeServer(
    address: InetSocketAddress,
    private val startLatch: CountDownLatch,
  ) : WebSocketServer(address) {

    @Volatile
    private var lastMessage: String? = null

    @Volatile
    private var startedSuccessfully = false

    override fun onStart() {
      startedSuccessfully = true
      startLatch.countDown()
    }

    override fun onOpen(conn: WebSocket?, handshake: ClientHandshake?) {
      // Give the freshly connected page the current sync state immediately.
      lastMessage?.let { snapshot ->
        try { conn?.send(snapshot) } catch (_: Exception) {}
      }
    }

    override fun onClose(conn: WebSocket?, code: Int, reason: String?, remote: Boolean) {}

    override fun onMessage(conn: WebSocket?, message: String?) {
      // The bridge is one-way (app -> page); inbound messages are ignored.
    }

    override fun onError(conn: WebSocket?, ex: Exception?) {
      Log.e(TAG, "WebSocket bridge error: ${ex?.message}")
      // A null connection means a server-level error; release the start latch so
      // a failed bind does not hang the caller for the full timeout.
      if (conn == null) startLatch.countDown()
    }

    fun didStartSuccessfully(): Boolean = startedSuccessfully

    fun broadcastMessage(message: String): Boolean {
      lastMessage = message
      return try {
        broadcast(message)
        true
      } catch (e: Exception) {
        Log.e(TAG, "broadcast error: ${e.message}")
        false
      }
    }
  }
}
