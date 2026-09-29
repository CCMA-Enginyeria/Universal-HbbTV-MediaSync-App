package mediasync.app.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import java.net.Inet4Address
import java.net.NetworkInterface
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Tracks the local-area network (Wi-Fi or Ethernet) used to reach TVs, even
 * when a VPN is the default route, so discovery can target the right interface.
 */
class NetworkMonitor(context: Context) {
    data class LocalNetwork(val available: Boolean, val interfaceName: String?, val vpnActive: Boolean) {
        fun networkInterface(): NetworkInterface? = interfaceName?.let { runCatching { NetworkInterface.getByName(it) }.getOrNull() }
            ?.takeIf { candidate -> candidate.isUp && candidate.supportsMulticast() && candidate.inetAddresses.toList().any { it is Inet4Address } }
    }

    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val links = LinkedHashMap<Network, String?>()
    private val _state = MutableStateFlow(LocalNetwork(false, null, false))
    val state: StateFlow<LocalNetwork> = _state

    init {
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
            .build()
        connectivity.registerNetworkCallback(request, object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = update { links[network] = connectivity.getLinkProperties(network)?.interfaceName }
            override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) = update { links[network] = properties.interfaceName }
            override fun onLost(network: Network) = update { links.remove(network) }
        })
    }

    @Synchronized
    private fun update(change: () -> Unit) {
        change()
        val vpn = connectivity.activeNetwork?.let { connectivity.getNetworkCapabilities(it) }
            ?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
        _state.value = LocalNetwork(links.isNotEmpty(), links.values.lastOrNull { it != null }, vpn)
    }
}
