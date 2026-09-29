package mediasync.core

class DiscoverySession(private val allowNonHbbtvDevices: Boolean = false) {
    class Request internal constructor(val location: String)

    private val pending = mutableMapOf<String, Request>()
    private val discovered = linkedMapOf<String, DialTerminal>()
    var isRunning = false
        private set
    val terminals: List<DialTerminal> get() = discovered.values.toList()

    fun start() {
        pending.clear()
        discovered.clear()
        isRunning = true
    }

    fun stop() {
        isRunning = false
        pending.clear()
        discovered.clear()
    }

    fun finish() {
        isRunning = false
        pending.clear()
    }

    fun accept(message: String): Request? {
        if (!isRunning) return null
        val location = DialProtocol.parseResponse(message) ?: return null
        if (location in pending || location in discovered) return null
        val request = Request(location)
        pending[location] = request
        return request
    }

    fun complete(request: Request, terminal: DialTerminal?): Boolean {
        if (!isRunning || pending[request.location] != request) return false
        pending.remove(request.location)
        if (terminal == null || terminal.device.location != request.location ||
            (!allowNonHbbtvDevices && !terminal.supportsHbbtv)
        ) return false
        discovered[request.location] = terminal
        return true
    }
}