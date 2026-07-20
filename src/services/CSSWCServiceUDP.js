/**
 * CSS-WC (Wall Clock) Service - UDP Implementation
 * 
 * Protocol DVB-CSS per sincronitzar rellotges entre dispositius.
 * Implementació real amb UDP binari segons l'especificació DVB-CSS.
 * 
 * Format del paquet binari DVB-CSS WC (32 bytes):
 * - Byte 0: Version (uint8)
 * - Byte 1: Message Type (uint8) - 0=request, 1=response, 2=response+followup, 3=followup
 * - Byte 2: Precision (signed int8)
 * - Byte 3: Reserved
 * - Bytes 4-7: Max Frequency Error (uint32, big-endian)
 * - Bytes 8-11: Originate Timestamp Seconds (uint32, big-endian)
 * - Bytes 12-15: Originate Timestamp Nanoseconds (uint32, big-endian)
 * - Bytes 16-19: Receive Timestamp Seconds (uint32, big-endian)
 * - Bytes 20-23: Receive Timestamp Nanoseconds (uint32, big-endian)
 * - Bytes 24-27: Transmit Timestamp Seconds (uint32, big-endian)
 * - Bytes 28-31: Transmit Timestamp Nanoseconds (uint32, big-endian)
 * 
 * Android: Uses native UDPWallClockModule for reliable UDP communication
 * iOS: Uses native UDPWallClockModule (dedicated unicast UDP, no multicast entitlement);
 *      falls back to NativeUDPMulticast if the dedicated module is unavailable
 */

import { EventEmitter } from 'events';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import NativeUDPMulticast from '../utils/NativeUDPMulticast';
import NativeUDPWallClock from '../utils/NativeUDPWallClock';

// Constants de temps
const NANOS_PER_SECOND = 1000000000;
const NANOS_PER_MS = 1000000;

// Constants del protocol DVB-CSS WC
const WC_VERSION = 0;
const WC_MSG_REQUEST = 0;
const WC_MSG_RESPONSE = 1;
const WC_MSG_RESPONSE_FOLLOWUP = 2;
const WC_MSG_FOLLOWUP = 3;
const WC_PACKET_SIZE = 32;

/**
 * Converteix nanosegons a segons + nanosegons separats (format DVB-CSS)
 * @param {number} nanos - Temps en nanosegons
 * @returns {{seconds: number, nanos: number}} Objecte amb segons i nanosegons
 */
function nanosToSecsAndNanos(nanos) {
  const seconds = Math.trunc(nanos / NANOS_PER_SECOND);
  const nanosRemainder = Math.trunc(nanos % NANOS_PER_SECOND);
  return { seconds, nanos: nanosRemainder };
}

/**
 * Converteix segons + nanosegons a nanosegons totals
 * @param {number} secs - Segons
 * @param {number} nanos - Nanosegons
 * @returns {number} Temps total en nanosegons
 */
function secsAndNanosToNanos(secs, nanos) {
  return (Math.trunc(secs) * NANOS_PER_SECOND) + Math.trunc(nanos % NANOS_PER_SECOND);
}

/**
 * Classe que representa un rellotge correlacionat
 * Mapeja temps local a wall clock temps
 */
export class CorrelatedClock {
  constructor() {
    this.correlation = {
      localTime: 0,
      wallClockTime: 0,
    };
    this.speed = 1.0;
    this.tickRate = NANOS_PER_SECOND;
    this.dispersion = Infinity;
    this.lastSyncTime = null;
  }

  setCorrelation(localTime, wallClockTime, dispersion = 0) {
    this.correlation.localTime = localTime;
    this.correlation.wallClockTime = wallClockTime;
    this.dispersion = dispersion;
    this.lastSyncTime = Date.now();
  }

  now() {
    const localNow = this.getLocalTimeNanos();
    const elapsed = localNow - this.correlation.localTime;
    return this.correlation.wallClockTime + (elapsed * this.speed);
  }

  nowSeconds() {
    return this.now() / NANOS_PER_SECOND;
  }

  nowMillis() {
    return this.now() / NANOS_PER_MS;
  }

  getLocalTimeNanos() {
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now() * NANOS_PER_MS;
    }
    return Date.now() * NANOS_PER_MS;
  }

  getDispersionMillis() {
    return this.dispersion / NANOS_PER_MS;
  }

  isSynchronized(maxDispersionMs = 100) {
    return this.dispersion !== Infinity && 
           this.getDispersionMillis() <= maxDispersionMs;
  }

  getInfo() {
    return {
      wallClockNanos: this.now(),
      wallClockSeconds: this.nowSeconds(),
      dispersionMs: this.getDispersionMillis(),
      isSynchronized: this.isSynchronized(),
      lastSyncTime: this.lastSyncTime,
    };
  }
}

/**
 * Parser d'URL per Wall Clock
 * Suporta formats: udp://host:port, ws://host:port/path, host:port
 */
export function parseWCUrl(url) {
  if (!url) return null;
  
  let protocol = 'udp';
  let host = '';
  let port = 6677; // Port per defecte DVB-CSS WC
  
  try {
    // Detectar protocol
    if (url.startsWith('udp://')) {
      protocol = 'udp';
      url = url.substring(6);
    } else if (url.startsWith('ws://')) {
      protocol = 'ws';
      url = url.substring(5);
    } else if (url.startsWith('wss://')) {
      protocol = 'wss';
      url = url.substring(6);
    }
    
    // Eliminar path si existeix (per URLs WebSocket)
    const pathIndex = url.indexOf('/');
    if (pathIndex !== -1) {
      url = url.substring(0, pathIndex);
    }
    
    // Parsejar host:port
    const parts = url.split(':');
    host = parts[0];
    if (parts.length > 1) {
      port = parseInt(parts[1], 10);
    }
    
    return { protocol, host, port };
  } catch (e) {
    console.error('❌ WC: Error parsing URL:', e);
    return null;
  }
}

/**
 * Construeix un paquet WC Request binari (32 bytes) - Format DVB-CSS
 * 
 * @param {number} originateSecs - Segons del temps d'origen
 * @param {number} originateNanos - Nanosegons del temps d'origen
 * @param {number} precision - Precisió (per defecte 0)
 * @param {number} maxFreqError - Error màxim de freqüència (per defecte 0)
 * @returns {Buffer} Paquet binari de 32 bytes
 */
function buildWCRequest(originateSecs, originateNanos, precision = 0, maxFreqError = 0) {
  const buffer = Buffer.alloc(WC_PACKET_SIZE);
  
  // Byte 0: Version (uint8)
  buffer.writeUInt8(WC_VERSION, 0);
  
  // Byte 1: Message Type (uint8) - 0 = request
  buffer.writeUInt8(WC_MSG_REQUEST, 1);
  
  // Byte 2: Precision (signed int8)
  buffer.writeInt8(precision, 2);
  
  // Byte 3: Reserved
  buffer.writeUInt8(0, 3);
  
  // Bytes 4-7: Max Frequency Error (uint32 BE)
  buffer.writeUInt32BE(maxFreqError, 4);
  
  // Bytes 8-11: Originate Timestamp Seconds (uint32 BE)
  buffer.writeUInt32BE(originateSecs, 8);
  
  // Bytes 12-15: Originate Timestamp Nanoseconds (uint32 BE)
  buffer.writeUInt32BE(originateNanos, 12);
  
  // Bytes 16-19: Receive Timestamp Seconds (zero per request)
  buffer.writeUInt32BE(0, 16);
  
  // Bytes 20-23: Receive Timestamp Nanoseconds (zero per request)
  buffer.writeUInt32BE(0, 20);
  
  // Bytes 24-27: Transmit Timestamp Seconds (zero per request)
  buffer.writeUInt32BE(0, 24);
  
  // Bytes 28-31: Transmit Timestamp Nanoseconds (zero per request)
  buffer.writeUInt32BE(0, 28);
  
  return buffer;
}

/**
 * Parseja un paquet WC Response binari (32 bytes)
 * @param {Buffer} buffer - Buffer amb el paquet rebut
 * @returns {Object} Objecte amb els camps del missatge
 */
function parseWCResponse(buffer) {
  if (buffer.length < WC_PACKET_SIZE) {
    throw new Error(`Invalid WC packet size: ${buffer.length}`);
  }
  
  // Byte 0: Version
  const version = buffer.readUInt8(0);
  
  // Byte 1: Message Type
  const messageType = buffer.readUInt8(1);
  
  // Byte 2: Precision
  const precision = buffer.readInt8(2);
  
  // Bytes 4-7: Max Frequency Error
  const maxFreqError = buffer.readUInt32BE(4);
  
  // Bytes 8-11: Originate Seconds, Bytes 12-15: Originate Nanos
  const otSecs = buffer.readUInt32BE(8);
  const otNanos = buffer.readUInt32BE(12);
  
  // Bytes 16-19: Receive Seconds, Bytes 20-23: Receive Nanos
  const rtSecs = buffer.readUInt32BE(16);
  const rtNanos = buffer.readUInt32BE(20);
  
  // Bytes 24-27: Transmit Seconds, Bytes 28-31: Transmit Nanos
  const ttSecs = buffer.readUInt32BE(24);
  const ttNanos = buffer.readUInt32BE(28);
  
  return {
    version,
    messageType,
    precision,
    maxFreqError,
    // Convertir a nanosegons totals per càlculs
    originateTimestamp: secsAndNanosToNanos(otSecs, otNanos),
    receiveTimestamp: secsAndNanosToNanos(rtSecs, rtNanos),
    transmitTimestamp: secsAndNanosToNanos(ttSecs, ttNanos),
    // Guardar valors originals per debug
    raw: {
      ot: { secs: otSecs, nanos: otNanos },
      rt: { secs: rtSecs, nanos: rtNanos },
      tt: { secs: ttSecs, nanos: ttNanos },
    }
  };
}

/**
 * Servei CSS-WC amb UDP binari
 */
export class CSSWCServiceUDP extends EventEmitter {
  constructor(wcUrl) {
    super();
    this.wcUrl = wcUrl;
    this.parsedUrl = parseWCUrl(wcUrl);
    this.socket = null;
    this.isConnected = false;
    this.wallClock = new CorrelatedClock();
    
    // Paràmetres de sincronització
    this.syncInterval = 1000;
    this.syncTimer = null;
    this.pendingRequests = new Map();
    this.requestCounter = 0;
    
    // Estadístiques
    this.stats = {
      requestsSent: 0,
      responsesReceived: 0,
      avgRoundTrip: 0,
      minRoundTrip: Infinity,
      maxRoundTrip: 0,
    };
  }

  /**
   * Connecta al servidor Wall Clock via UDP
   */
  connect() {
    if (this.socket) {
      console.warn('⚠️  WC-UDP: Ja hi ha una connexió activa');
      return;
    }

    if (!this.parsedUrl) {
      const error = new Error('WC-UDP: URL no vàlida: ' + this.wcUrl);
      this.emit('error', error);
      return;
    }

    console.log(`🔌 WC-UDP: Connectant a ${this.parsedUrl.host}:${this.parsedUrl.port} (Platform: ${Platform.OS})`);

    try {
      // Crear socket segons plataforma
      if (Platform.OS === 'android' && NativeUDPWallClock.isModuleAvailable()) {
        // Android: Use native module for reliable UDP
        console.log('🔌 WC-UDP: Usant mòdul natiu Android (UDPWallClockModule)');
        this.socket = NativeUDPWallClock.createSocket();
        this.useNativeHex = true; // Flag to indicate hex-based communication
      } else if (Platform.OS === 'ios' && NativeUDPWallClock.isModuleAvailable()) {
        // iOS: Use dedicated native module (unicast UDP, no multicast entitlement needed)
        console.log('🔌 WC-UDP: Usant mòdul natiu iOS (UDPWallClockModule)');
        this.socket = NativeUDPWallClock.createSocket();
        this.useNativeHex = true; // Flag to indicate hex-based communication
      } else if (Platform.OS === 'ios') {
        // iOS fallback: reuse the multicast module's unicast socket
        this.socket = NativeUDPMulticast.createSocket('udp4');
        this.useNativeHex = false;
      } else {
        // Fallback to react-native-udp
        const dgram = require('react-native-udp');
        this.socket = dgram.createSocket({ type: 'udp4' });
        this.useNativeHex = false;
      }

      // Event handlers
      this.socket.on('message', (msg, rinfo) => {
        console.log(`📥 WC-UDP: RAW message event fired! Size: ${msg?.length || 'unknown'}`);
        this.handleResponse(msg, rinfo);
      });

      this.socket.on('error', (err) => {
        console.error('❌ WC-UDP: Error de socket:', err);
        this.emit('error', err);
      });
      
      this.socket.on('listening', () => {
        try {
          const addr = this.socket.address();
          console.log(`🎧 WC-UDP: Socket listening on ${addr.address}:${addr.port}`);
        } catch (e) {
          console.log('🎧 WC-UDP: Socket listening');
        }
      });

      // Bind a un port aleatori
      this.socket.bind(0, (err) => {
        if (err) {
          console.error('❌ WC-UDP: Error fent bind:', err);
          this.emit('error', err);
          return;
        }

        // Mostrar port assignat
        try {
          const addr = this.socket.address();
          console.log(`✅ WC-UDP: Socket obert a port ${addr.port}`);
        } catch (e) {
          console.log('✅ WC-UDP: Socket obert');
        }
        
        this.isConnected = true;
        this.emit('connected');
        
        // Iniciar sincronització periòdica
        this.startSync();
      });

    } catch (error) {
      console.error('❌ WC-UDP: Error creant socket:', error);
      this.emit('error', error);
    }
  }

  /**
   * Inicia la sincronització periòdica
   */
  startSync() {
    if (this.syncTimer) {
      return;
    }

    console.log('🕐 WC-UDP: Iniciant sincronització periòdica');
    
    // Primera sincronització immediata
    this.sendRequest();
    
    // Sincronització periòdica
    this.syncTimer = setInterval(() => {
      this.sendRequest();
    }, this.syncInterval);
  }

  /**
   * Atura la sincronització periòdica
   */
  stopSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Envia una petició de sincronització UDP binària (format DVB-CSS)
   */
  sendRequest() {
    if (!this.socket || !this.isConnected) {
      return;
    }

    const requestId = ++this.requestCounter;
    const originateTimeNanos = this.wallClock.getLocalTimeNanos(); // Temps local en nanosegons
    
    // Convertir a segons + nanosegons separats (format DVB-CSS)
    const { seconds: originateSecs, nanos: originateNanos } = nanosToSecsAndNanos(originateTimeNanos);

    // Construir paquet binari DVB-CSS
    const packet = buildWCRequest(originateSecs, originateNanos);

    this.pendingRequests.set(requestId, {
      originateTimeNanos,
      sentAt: Date.now(),
    });

    // Log del paquet en hex per debug
    const hexData = packet.toString('hex').toUpperCase();
    console.log(`📤 WC-UDP: Enviant request #${requestId} - ${hexData}`);

    // Enviar via UDP
    const { host, port } = this.parsedUrl;
    
    // Usar mètode apropiat segons el socket
    if (this.useNativeHex && this.socket.sendHex) {
      // Mòdul natiu Android: enviar directament en hex
      this.socket.sendHex(hexData, port, host, (err) => {
        if (err) {
          console.error('❌ WC-UDP: Error enviant request:', err);
          this.pendingRequests.delete(requestId);
        } else {
          this.stats.requestsSent++;
          console.log(`✅ WC-UDP: request #${requestId} enviat OK (natiu) -> ${host}:${port}`);
        }
      });
    } else {
      // Standard socket: enviar buffer
      this.socket.send(
        packet,
        0,
        packet.length,
        port,
        host,
        (err) => {
          if (err) {
            console.error('❌ WC-UDP: Error enviant request:', err);
            this.pendingRequests.delete(requestId);
          } else {
            this.stats.requestsSent++;
          }
        }
      );
    }
  }

  /**
   * Processa una resposta del servidor
   */
  handleResponse(data, rinfo) {
    const receiveTime = this.wallClock.getLocalTimeNanos();
    
    try {
      // Convertir a Buffer - el mòdul natiu retorna hex string
      let buffer;
      if (typeof data === 'string') {
        // Hex string from native module
        console.log(`📥 WC-UDP: Rebut HEX de ${rinfo.address}:${rinfo.port} - ${data}`);
        buffer = Buffer.from(data, 'hex');
      } else if (Buffer.isBuffer(data)) {
        buffer = data;
        console.log(`📥 WC-UDP: Rebut de ${rinfo.address}:${rinfo.port} - ${buffer.toString('hex').toUpperCase()}`);
      } else {
        buffer = Buffer.from(data);
        console.log(`📥 WC-UDP: Rebut de ${rinfo.address}:${rinfo.port} - ${buffer.toString('hex').toUpperCase()}`);
      }
      
      // Parsejar resposta binària
      const response = parseWCResponse(buffer);
      
      console.log(`📥 WC-UDP: Response parsed - type=${response.messageType}, ot=${response.originateTimestamp}, rt=${response.receiveTimestamp}, tt=${response.transmitTimestamp}`);
      
      this.stats.responsesReceived++;

      // Càlcul NTP-like
      const t1 = response.originateTimestamp;  // Temps local quan es va enviar
      const t2 = response.receiveTimestamp;    // Temps servidor quan va rebre
      const t3 = response.transmitTimestamp;   // Temps servidor quan va respondre
      const t4 = receiveTime;                  // Temps local quan es va rebre

      // Round-trip time
      const roundTrip = (t4 - t1) - (t3 - t2);
      const roundTripMs = roundTrip / NANOS_PER_MS;

      // Offset del rellotge
      const offset = ((t2 - t1) + (t3 - t4)) / 2;

      // Dispersió (incertesa)
      const dispersion = roundTrip / 2;

      // Actualitzar estadístiques
      this.updateStats(roundTripMs);

      // Actualitzar wall clock si la dispersió és acceptable
      if (dispersion < this.wallClock.dispersion) {
        const wallClockTime = t4 + offset;
        this.wallClock.setCorrelation(t4, wallClockTime, dispersion);
        
        console.log(`🕐 WC-UDP: Sync - RTT=${roundTripMs.toFixed(1)}ms, dispersion=${(dispersion/NANOS_PER_MS).toFixed(1)}ms`);
        
        this.emit('sync', {
          offset: offset / NANOS_PER_MS,
          roundTrip: roundTripMs,
          dispersion: dispersion / NANOS_PER_MS,
          wallClockTime: this.wallClock.nowMillis(),
        });
      }

    } catch (error) {
      console.error('❌ WC-UDP: Error processant resposta:', error);
      this.emit('error', error);
    }
  }

  /**
   * Actualitza estadístiques
   */
  updateStats(roundTripMs) {
    this.stats.minRoundTrip = Math.min(this.stats.minRoundTrip, roundTripMs);
    this.stats.maxRoundTrip = Math.max(this.stats.maxRoundTrip, roundTripMs);
    
    const alpha = 0.2;
    this.stats.avgRoundTrip = this.stats.avgRoundTrip === 0 
      ? roundTripMs 
      : (alpha * roundTripMs) + ((1 - alpha) * this.stats.avgRoundTrip);
  }

  /**
   * Obté el wall clock sincronitzat
   */
  getWallClock() {
    return this.wallClock;
  }

  /**
   * Obté el temps wall clock actual en mil·lisegons
   */
  getWallClockTime() {
    return this.wallClock.nowMillis();
  }

  /**
   * Comprova si està sincronitzat
   */
  isSynchronized(maxDispersionMs = 100) {
    return this.wallClock.isSynchronized(maxDispersionMs);
  }

  /**
   * Obté estadístiques de sincronització
   */
  getStats() {
    return {
      ...this.stats,
      currentDispersion: this.wallClock.getDispersionMillis(),
      isSynchronized: this.isSynchronized(),
    };
  }

  /**
   * Estableix l'interval de sincronització
   */
  setSyncInterval(intervalMs) {
    this.syncInterval = intervalMs;
    if (this.syncTimer) {
      this.stopSync();
      this.startSync();
    }
  }

  /**
   * Tanca la connexió
   */
  close() {
    console.log('🔌 WC-UDP: Tancant connexió...');
    this.stopSync();
    this.pendingRequests.clear();
    
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {
        // Ignorar errors al tancar
      }
      this.socket = null;
    }
    this.isConnected = false;
  }

  /**
   * Destrueix el servei
   */
  destroy() {
    this.close();
    this.removeAllListeners();
  }
}

export default CSSWCServiceUDP;
