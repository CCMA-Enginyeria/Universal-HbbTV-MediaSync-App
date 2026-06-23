package expo.modules.udpwallclock

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap

/**
 * Native Android module for UDP Wall Clock communication (DVB-CSS)
 * Expo Modules implementation
 */
class UDPWallClockModule : Module() {

    companion object {
        private const val TAG = "UDPWallClock"
    }

    init {
        Log.i(TAG, "🟢 UDPWallClockModule LOADED - Native Kotlin module initialized successfully!")
    }

    private val sockets = ConcurrentHashMap<Int, DatagramSocket>()
    private val listeners = ConcurrentHashMap<Int, SocketListener>()
    private var socketCounter = 0

    /**
     * Socket listener thread that receives UDP packets
     */
    private inner class SocketListener(
        private val socketId: Int,
        private val socket: DatagramSocket
    ) : Thread() {
        
        @Volatile
        private var running = true

        override fun run() {
            val data = ByteArray(32) // DVB-CSS WC packets are 32 bytes
            val packet = DatagramPacket(data, data.size)
            
            Log.d(TAG, "SocketListener started for socket $socketId")
            
            while (running && !socket.isClosed) {
                try {
                    socket.receive(packet)
                    
                    // Convert received data to hex string
                    val hexData = byteArrayToHexString(data)
                    val address = packet.address.hostAddress ?: "unknown"
                    val port = packet.port
                    
                    Log.d(TAG, "Received UDP packet: $hexData from $address:$port")
                    
                    // Send event to JavaScript
                    sendEvent("onMessage", mapOf(
                        "socketId" to socketId,
                        "data" to hexData,
                        "address" to address,
                        "port" to port
                    ))
                    
                } catch (e: Exception) {
                    if (running) {
                        Log.e(TAG, "Receive exception: ${e.message}")
                    }
                    break
                }
            }
            
            Log.d(TAG, "SocketListener stopped for socket $socketId")
        }

        fun stopListening() {
            running = false
            interrupt()
        }
    }

    override fun definition() = ModuleDefinition {
        Name("UDPWallClock")

        // Define events that can be sent to JavaScript
        Events("onMessage")

        // Create a new UDP socket
        AsyncFunction("create") { promise: Promise ->
            try {
                val socketId = ++socketCounter
                val socket = DatagramSocket(null)
                socket.reuseAddress = true
                sockets[socketId] = socket
                
                Log.d(TAG, "Socket created with id: $socketId")
                promise.resolve(socketId)
            } catch (e: Exception) {
                Log.e(TAG, "Create exception: ${e.message}")
                promise.reject("CREATE_ERROR", e.message ?: "Unknown error", e)
            }
        }

        // Bind socket to a port (0 for random port)
        AsyncFunction("bind") { socketId: Int, port: Int, promise: Promise ->
            try {
                val socket = sockets[socketId]
                if (socket == null) {
                    promise.reject("SOCKET_NOT_FOUND", "Socket $socketId not found", null)
                    return@AsyncFunction
                }
                
                socket.bind(InetSocketAddress(port))
                val boundPort = socket.localPort
                
                // Start listener thread
                val listener = SocketListener(socketId, socket)
                listeners[socketId] = listener
                listener.start()
                
                Log.d(TAG, "Socket $socketId bound to port $boundPort")
                promise.resolve(boundPort)
            } catch (e: Exception) {
                Log.e(TAG, "Bind exception: ${e.message}")
                promise.reject("BIND_ERROR", e.message ?: "Unknown error", e)
            }
        }

        // Send data to remote address
        AsyncFunction("send") { socketId: Int, hexData: String, address: String, port: Int, promise: Promise ->
            try {
                val socket = sockets[socketId]
                if (socket == null) {
                    promise.reject("SOCKET_NOT_FOUND", "Socket $socketId not found", null)
                    return@AsyncFunction
                }
                
                Log.d(TAG, "Sending to $address:$port - $hexData")
                
                val data = hexStringToByteArray(hexData)
                val packet = DatagramPacket(
                    data, 
                    data.size, 
                    InetAddress.getByName(address), 
                    port
                )
                
                // Send in background thread to avoid blocking
                Thread {
                    try {
                        socket.send(packet)
                        Log.d(TAG, "Packet sent successfully")
                    } catch (e: Exception) {
                        Log.e(TAG, "Send exception: ${e.message}")
                    }
                }.start()
                
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "Send exception: ${e.message}")
                promise.reject("SEND_ERROR", e.message ?: "Unknown error", e)
            }
        }

        // Close socket
        AsyncFunction("close") { socketId: Int, promise: Promise ->
            try {
                // Stop listener
                listeners[socketId]?.let { listener ->
                    listener.stopListening()
                    listeners.remove(socketId)
                }
                
                // Close socket
                sockets[socketId]?.let { socket ->
                    socket.close()
                    sockets.remove(socketId)
                }
                
                Log.d(TAG, "Socket $socketId closed")
                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "Close exception: ${e.message}")
                promise.reject("CLOSE_ERROR", e.message ?: "Unknown error", e)
            }
        }

        // Get socket info
        AsyncFunction("getSocketInfo") { socketId: Int, promise: Promise ->
            try {
                val socket = sockets[socketId]
                if (socket == null) {
                    promise.reject("SOCKET_NOT_FOUND", "Socket $socketId not found", null)
                    return@AsyncFunction
                }
                
                val info = mapOf(
                    "localPort" to socket.localPort,
                    "localAddress" to (socket.localAddress?.hostAddress ?: "0.0.0.0"),
                    "isBound" to socket.isBound,
                    "isClosed" to socket.isClosed
                )
                
                promise.resolve(info)
            } catch (e: Exception) {
                promise.reject("INFO_ERROR", e.message ?: "Unknown error", e)
            }
        }

        // Cleanup when module is destroyed
        OnDestroy {
            // Close all sockets
            listeners.values.forEach { it.stopListening() }
            listeners.clear()
            sockets.values.forEach { it.close() }
            sockets.clear()
            Log.d(TAG, "Module destroyed, all sockets closed")
        }
    }

    /**
     * Convert hex string to byte array
     */
    private fun hexStringToByteArray(s: String): ByteArray {
        val len = s.length
        val data = ByteArray(len / 2)
        var i = 0
        while (i < len) {
            data[i / 2] = ((Character.digit(s[i], 16) shl 4) + 
                          Character.digit(s[i + 1], 16)).toByte()
            i += 2
        }
        return data
    }

    /**
     * Convert byte array to hex string
     */
    private fun byteArrayToHexString(data: ByteArray): String {
        val hexArray = "0123456789ABCDEF".toCharArray()
        val hexChars = CharArray(data.size * 2)
        for (j in data.indices) {
            val v = data[j].toInt() and 0xFF
            hexChars[j * 2] = hexArray[v ushr 4]
            hexChars[j * 2 + 1] = hexArray[v and 0x0F]
        }
        return String(hexChars)
    }
}
