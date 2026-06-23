/**
 * Native UDP Wall Clock Module Wrapper (Android only)
 * 
 * Provides a JavaScript API for the native Android UDP module
 * designed specifically for DVB-CSS Wall Clock protocol.
 * 
 * Uses Expo Modules API for native bridge.
 */

import { Platform } from 'react-native';
import { EventEmitter } from 'events';

// Import the Expo Module
let UDPWallClockModule = null;
try {
  UDPWallClockModule = require('../../modules/udp-wall-clock').default;
  console.log('✅ UDPWallClockModule loaded successfully:', UDPWallClockModule ? 'YES' : 'NO');
} catch (e) {
  console.warn('❌ UDPWallClockModule not available:', e.message);
}

// Check if module is available
const isAvailable = Platform.OS === 'android' && UDPWallClockModule != null;
console.log(`🔌 NativeUDPWallClock: Platform=${Platform.OS}, isAvailable=${isAvailable}`);

// Global socket registry (similar to Cordova pattern)
const sockets = {};

// Setup global event listener once
let globalSubscription = null;

function setupGlobalListener() {
  if (globalSubscription || !isAvailable) return;
  
  // Use Expo Modules event listener API
  globalSubscription = UDPWallClockModule.addListener('onMessage', (event) => {
    console.log(`📥 NativeUDP: Global event received for socket ${event.socketId}`);
    const socket = sockets[event.socketId];
    if (socket && socket._eventHandlers['message']) {
      socket._eventHandlers['message'](event.data, {
        address: event.address,
        port: event.port,
      });
    }
  });
  console.log('🔌 NativeUDP: Global event listener setup');
}

/**
 * Native UDP Wall Clock Socket for Android
 * Follows the Cordova plugin pattern
 */
class NativeUDPWallClockSocket extends EventEmitter {
  constructor() {
    super();
    this.socketId = null;
    this.isOpen = false;
    this.localPort = 0;
    this._eventHandlers = {};
    
    if (!isAvailable) {
      console.warn('UDPWallClockModule is not available on this platform');
      return;
    }
    
    // Setup global listener if not already done
    setupGlobalListener();
  }
  
  /**
   * Register event handler (Cordova-style)
   */
  on(event, callback) {
    this._eventHandlers[event] = callback;
    // Also call parent for EventEmitter compatibility
    super.on(event, callback);
    return this;
  }
  
  /**
   * Unregister event handler
   */
  off(event) {
    delete this._eventHandlers[event];
    super.removeAllListeners(event);
    return this;
  }
  
  /**
   * Create and bind the socket
   */
  async bind(port = 0, callback) {
    if (!isAvailable) {
      const err = new Error('UDPWallClockModule not available');
      if (callback) callback(err);
      else this.emit('error', err);
      return;
    }
    
    try {
      // Create socket
      this.socketId = await UDPWallClockModule.create();
      console.log(`🔌 NativeUDP: Socket created with id ${this.socketId}`);
      
      // Register in global registry
      sockets[this.socketId] = this;
      
      // Bind to port
      this.localPort = await UDPWallClockModule.bind(this.socketId, port);
      console.log(`🎧 NativeUDP: Socket ${this.socketId} bound to port ${this.localPort}`);
      
      this.isOpen = true;
      this.emit('listening');
      
      if (callback) callback(null);
    } catch (err) {
      console.error('❌ NativeUDP: Error creating socket:', err);
      if (callback) callback(err);
      else this.emit('error', err);
    }
  }
  
  /**
   * Send hex data to remote address
   * @param {string} hexData - Data as hex string (e.g., "00F6000000003200...")
   * @param {number} port - Remote port
   * @param {string} address - Remote IP address
   * @param {function} callback - Optional callback
   */
  async sendHex(hexData, port, address, callback) {
    if (!this.isOpen || !this.socketId) {
      const err = new Error('Socket not open');
      if (callback) callback(err);
      return;
    }
    
    try {
      await UDPWallClockModule.send(this.socketId, hexData, address, port);
      if (callback) callback(null);
    } catch (err) {
      console.error('❌ NativeUDP: Send error:', err);
      if (callback) callback(err);
    }
  }
  
  /**
   * Send Buffer data to remote address (converts to hex internally)
   * @param {Buffer} buffer - Data buffer
   * @param {number} offset - Buffer offset
   * @param {number} length - Data length
   * @param {number} port - Remote port
   * @param {string} address - Remote IP address
   * @param {function} callback - Optional callback
   */
  send(buffer, offset, length, port, address, callback) {
    // Convert buffer to hex string
    const data = buffer.slice(offset, offset + length);
    const hexData = data.toString('hex').toUpperCase();
    
    this.sendHex(hexData, port, address, callback);
  }
  
  /**
   * Get socket address info
   */
  address() {
    return {
      address: '0.0.0.0',
      port: this.localPort,
    };
  }
  
  /**
   * Close the socket
   */
  async close() {
    // Remove from global registry
    if (this.socketId != null) {
      delete sockets[this.socketId];
    }
    
    if (this.socketId != null && isAvailable) {
      try {
        await UDPWallClockModule.close(this.socketId);
        console.log(`🔌 NativeUDP: Socket ${this.socketId} closed`);
      } catch (err) {
        console.error('❌ NativeUDP: Close error:', err);
      }
    }
    
    // Call close handler if registered
    if (this._eventHandlers['close']) {
      this._eventHandlers['close']();
    }
    
    this.socketId = null;
    this.isOpen = false;
    this.emit('close');
  }
}

/**
 * Create a new UDP Wall Clock socket
 */
function createSocket() {
  return new NativeUDPWallClockSocket();
}

/**
 * Check if module is available
 */
function isModuleAvailable() {
  return isAvailable;
}

/**
 * Convert hex string to Buffer
 */
function hexToBuffer(hexString) {
  const { Buffer } = require('buffer');
  return Buffer.from(hexString, 'hex');
}

export default {
  createSocket,
  isModuleAvailable,
  hexToBuffer,
  NativeUDPWallClockSocket,
};

export { createSocket, isModuleAvailable, hexToBuffer, NativeUDPWallClockSocket };
