/**
 * Native UDP Multicast Module Wrapper (iOS only)
 *
 * Provides a dgram-compatible API on top of the `udp-multicast` Expo local module
 * (native Swift / BSD sockets). Used for DIAL/SSDP multicast discovery and
 * DVB-CSS wall-clock unicast on iOS.
 *
 * The public API (createSocket/bind/send/addMembership/close/on/...) is kept
 * identical to the previous NativeModules-based implementation so the consuming
 * services do not need any changes.
 */

import { Platform } from 'react-native';
import { Buffer } from 'buffer';

// Import the Expo Module (iOS only).
let UDPMulticastModule = null;
try {
  UDPMulticastModule = require('../../modules/udp-multicast').default;
  console.log('✅ UDPMulticastModule loaded successfully:', UDPMulticastModule ? 'YES' : 'NO');
} catch (e) {
  console.warn('❌ UDPMulticastModule not available:', e.message);
}

const isAvailable = Platform.OS === 'ios' && UDPMulticastModule != null;
console.log(`🔌 NativeUDPMulticast: Platform=${Platform.OS}, isAvailable=${isAvailable}`);

// Global socket registry so native events can be routed to the right socket.
const sockets = {};

// Set up the global event listeners once.
let listenersInitialized = false;

function setupGlobalListeners() {
  if (listenersInitialized || !isAvailable) return;
  listenersInitialized = true;

  UDPMulticastModule.addListener('onMessage', (event) => {
    const socket = sockets[event.socketId];
    if (socket) {
      socket._emit('message', Buffer.from(event.data, 'base64'), {
        address: event.address,
        port: event.port,
        size: event.size,
      });
    }
  });

  UDPMulticastModule.addListener('onError', (event) => {
    const socket = sockets[event.socketId];
    if (socket) {
      socket._emit('error', new Error(event.error));
    }
  });

  UDPMulticastModule.addListener('onBound', (event) => {
    const socket = sockets[event.socketId];
    if (socket) {
      socket._port = event.port;
      socket._address = event.address;
      console.log(`[NativeUDP] Socket ${socket.socketId} bound to ${socket._address}:${socket._port}`);
    }
  });
}

class UDPSocket {
  constructor(type) {
    if (type !== 'udp4') {
      throw new Error('Only udp4 is supported');
    }

    this.socketId = `socket-${Date.now()}-${Math.random()}`;
    this.type = type;
    this.listeners = {};
    this._port = null;
    this._address = null;

    if (isAvailable) {
      sockets[this.socketId] = this;
      setupGlobalListeners();
    }
  }
  
  /**
   * Bind socket to port
   * Suporta: bind(callback), bind(port, callback), bind(port, address, callback)
   */
  bind(port, address, callback) {
    // Detectar la forma de crida
    if (typeof port === 'function') {
      // bind(callback)
      callback = port;
      port = 0;
      address = '0.0.0.0';
    } else if (typeof address === 'function') {
      // bind(port, callback)
      callback = address;
      address = '0.0.0.0';
    }
    
    // Valors per defecte
    port = port || 0;
    address = address || '0.0.0.0';
    
    if (!isAvailable) {
      const err = new Error('Native UDP module not available');
      if (callback) callback(err);
      else this._emit('error', err);
      return;
    }
    
    console.log(`[NativeUDP] Binding socket ${this.socketId} to ${address}:${port}`);
    
    UDPMulticastModule.createSocket(this.socketId, port, address)
      .then(() => {
        console.log(`[NativeUDP] Socket ${this.socketId} created successfully`);
        if (callback) callback();
      })
      .catch((err) => {
        console.error(`[NativeUDP] Failed to bind socket ${this.socketId}:`, err);
        if (callback) callback(err);
        else this._emit('error', err);
      });
  }
  
  /**
   * Send message
   */
  send(buffer, offset, length, port, address, callback) {
    if (!isAvailable) {
      const err = new Error('Native UDP module not available');
      if (callback) callback(err);
      return;
    }
    
    // Convertir el tram rellevant del buffer a base64
    const data = buffer.slice(offset, offset + length).toString('base64');
    
    console.log(`[NativeUDP] Sending ${length} bytes to ${address}:${port}`);
    
    UDPMulticastModule.send(this.socketId, data, port, address)
      .then(() => {
        if (callback) callback(null);
      })
      .catch((err) => {
        console.error(`[NativeUDP] Failed to send:`, err);
        console.error(`[NativeUDP] socketId: ${this.socketId}, address: ${address}, port: ${port}, length: ${length}`);
        if (callback) callback(err);
      });
  }
  
  /**
   * Add multicast membership
   */
  addMembership(multicastAddress) {
    if (!isAvailable) {
      console.warn('[NativeUDP] addMembership not available');
      return;
    }
    
    console.log(`[NativeUDP] Adding membership to ${multicastAddress}`);
    
    UDPMulticastModule.addMembership(this.socketId, multicastAddress)
      .then(() => {
        console.log(`[NativeUDP] Joined multicast group ${multicastAddress}`);
      })
      .catch((err) => {
        console.error(`[NativeUDP] Failed to join multicast group:`, err);
      });
  }
  
  /**
   * Set broadcast (handled natively by the multicast configuration)
   */
  setBroadcast(flag) {
    console.log(`[NativeUDP] setBroadcast(${flag}) - handled natively`);
  }
  
  /**
   * Set multicast TTL (configured natively on bind)
   */
  setMulticastTTL(ttl) {
    console.log(`[NativeUDP] setMulticastTTL(${ttl}) - configured natively`);
  }
  
  /**
   * Set multicast loopback (configured natively on bind)
   */
  setMulticastLoopback(flag) {
    console.log(`[NativeUDP] setMulticastLoopback(${flag}) - configured natively`);
  }
  
  /**
   * Get socket address info
   */
  address() {
    return {
      address: this._address || '0.0.0.0',
      port: this._port || 0
    };
  }
  
  /**
   * Close socket
   */
  close() {
    console.log(`[NativeUDP] Closing socket ${this.socketId}`);
    
    // Remove from the global registry
    delete sockets[this.socketId];
    
    // Close native socket
    if (isAvailable) {
      UDPMulticastModule.close(this.socketId)
        .then(() => {
          console.log(`[NativeUDP] Socket ${this.socketId} closed`);
        })
        .catch((err) => {
          console.error(`[NativeUDP] Failed to close socket:`, err);
        });
    }
    
    this.listeners = {};
  }
  
  /**
   * Event listener management
   */
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }
  
  once(event, callback) {
    const wrapper = (...args) => {
      callback(...args);
      this.removeListener(event, wrapper);
    };
    this.on(event, wrapper);
  }
  
  removeListener(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }
  
  removeAllListeners(event) {
    if (event) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
  }
  
  /**
   * Internal emit
   */
  _emit(event, ...args) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => {
        try {
          callback(...args);
        } catch (err) {
          console.error(`[NativeUDP] Error in ${event} listener:`, err);
        }
      });
    }
  }
}

/**
 * Factory function compatible amb dgram
 */
export function createSocket(type, callback) {
  const socket = new UDPSocket(type);
  if (callback) {
    socket.once('message', callback);
  }
  return socket;
}

export default {
  createSocket
};
