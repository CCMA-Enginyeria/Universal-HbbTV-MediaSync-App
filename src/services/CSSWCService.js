/**
 * CSS-WC (Wall Clock) Service
 * 
 * Protocol DVB-CSS per sincronitzar rellotges entre dispositius.
 * Utilitza WebSocket JSON com a fallback per a React Native 
 * (el protocol estàndard és UDP binari).
 * 
 * El Wall Clock proporciona un temps comú entre TV i companion
 * per permetre la sincronització precisa de timelines.
 */

import { EventEmitter } from 'events';

// Precisió del rellotge en nanoseconds
const NANOS_PER_SECOND = 1000000000;
const NANOS_PER_MS = 1000000;

/**
 * Classe que representa un rellotge correlacionat
 * Mapeja temps local a wall clock temps
 */
export class CorrelatedClock {
  constructor() {
    // Correlació: (localTime, wallClockTime)
    this.correlation = {
      localTime: 0,
      wallClockTime: 0,
    };
    this.speed = 1.0;
    this.tickRate = NANOS_PER_SECOND; // Nanosegons per segon
    this.dispersion = Infinity; // Incertesa en nanosegons
    this.lastSyncTime = null;
  }

  /**
   * Estableix la correlació entre temps local i wall clock
   */
  setCorrelation(localTime, wallClockTime, dispersion = 0) {
    this.correlation.localTime = localTime;
    this.correlation.wallClockTime = wallClockTime;
    this.dispersion = dispersion;
    this.lastSyncTime = Date.now();
  }

  /**
   * Obté el temps wall clock actual en nanosegons
   */
  now() {
    const localNow = this.getLocalTimeNanos();
    const elapsed = localNow - this.correlation.localTime;
    return this.correlation.wallClockTime + (elapsed * this.speed);
  }

  /**
   * Obté el temps wall clock actual en segons
   */
  nowSeconds() {
    return this.now() / NANOS_PER_SECOND;
  }

  /**
   * Obté el temps wall clock actual en mil·lisegons
   */
  nowMillis() {
    return this.now() / NANOS_PER_MS;
  }

  /**
   * Obté el temps local en nanosegons
   */
  getLocalTimeNanos() {
    // Usar performance.now() si està disponible per més precisió
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now() * NANOS_PER_MS;
    }
    return Date.now() * NANOS_PER_MS;
  }

  /**
   * Obté la dispersió (incertesa) actual en mil·lisegons
   */
  getDispersionMillis() {
    return this.dispersion / NANOS_PER_MS;
  }

  /**
   * Comprova si el rellotge està sincronitzat (dispersion raonable)
   */
  isSynchronized(maxDispersionMs = 100) {
    return this.dispersion !== Infinity && 
           this.getDispersionMillis() <= maxDispersionMs;
  }

  /**
   * Obté informació del rellotge
   */
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
 * Servei CSS-WC per sincronització de wall clock
 */
export class CSSWCService extends EventEmitter {
  constructor(wcUrl) {
    super();
    this.wcUrl = wcUrl;
    this.ws = null;
    this.isConnected = false;
    this.wallClock = new CorrelatedClock();
    
    // Paràmetres de sincronització
    this.syncInterval = 1000; // ms entre requests
    this.syncTimer = null;
    this.pendingRequests = new Map(); // Map de requestId -> timestamp enviat
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
   * Connecta al servidor Wall Clock via WebSocket
   */
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.warn('⚠️  WC: Ja hi ha una connexió activa');
      return;
    }

    if (!this.wcUrl) {
      const error = new Error('WC: No hi ha URL Wall Clock disponible');
      this.emit('error', error);
      return;
    }

    console.log('🔌 WC: Connectant a', this.wcUrl);

    try {
      this.ws = new WebSocket(this.wcUrl);

      this.ws.onopen = () => {
        console.log('✅ WC: Connexió establerta');
        this.isConnected = true;
        this.emit('connected');
        
        // Iniciar sincronització periòdica
        this.startSync();
      };

      this.ws.onclose = (event) => {
        console.log('🔌 WC: Connexió tancada', event.code);
        this.isConnected = false;
        this.stopSync();
        this.emit('disconnected');
      };

      this.ws.onerror = (error) => {
        console.error('❌ WC: Error de WebSocket', error);
        this.emit('error', error);
      };

      this.ws.onmessage = (event) => {
        this.handleResponse(event.data);
      };

    } catch (error) {
      console.error('❌ WC: Error creant WebSocket', error);
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

    console.log('🕐 WC: Iniciant sincronització periòdica');
    
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
   * Envia una petició de sincronització
   * Format del missatge WC request (JSON):
   * {
   *   v: version (0),
   *   t: type (0 = request, 1 = response),
   *   p: precision (-50 = ~1ms),
   *   mfe: max freq error (50 ppm),
   *   id: request id,
   *   ot: originate timestamp (nanos)
   * }
   */
  sendRequest() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const requestId = ++this.requestCounter;
    const originateTime = this.wallClock.getLocalTimeNanos();

    const request = {
      v: 0,              // Version
      t: 0,              // Type: request
      p: -50,            // Precision (~1ms)
      mfe: 50,           // Max frequency error (50 ppm)
      id: requestId,
      ot: originateTime,
    };

    this.pendingRequests.set(requestId, {
      originateTime,
      sentAt: Date.now(),
    });

    this.ws.send(JSON.stringify(request));
    this.stats.requestsSent++;
  }

  /**
   * Processa una resposta del servidor
   * Format del missatge WC response (JSON):
   * {
   *   v: version,
   *   t: type (1 = response),
   *   p: precision,
   *   mfe: max freq error,
   *   id: request id,
   *   ot: originate timestamp (echo),
   *   rt: receive timestamp (server),
   *   tt: transmit timestamp (server)
   * }
   */
  handleResponse(data) {
    const receiveTime = this.wallClock.getLocalTimeNanos();
    
    try {
      const response = JSON.parse(data);
      
      // Verificar que és una resposta
      if (response.t !== 1) {
        console.warn('⚠️  WC: Missatge no és una resposta', response.t);
        return;
      }

      const pending = this.pendingRequests.get(response.id);
      if (!pending) {
        console.warn('⚠️  WC: Resposta per request desconegut', response.id);
        return;
      }

      this.pendingRequests.delete(response.id);
      this.stats.responsesReceived++;

      // Càlcul NTP-like
      const t1 = pending.originateTime;  // Temps local quan es va enviar
      const t2 = response.rt;             // Temps servidor quan va rebre
      const t3 = response.tt;             // Temps servidor quan va respondre
      const t4 = receiveTime;             // Temps local quan es va rebre

      // Round-trip time
      const roundTrip = (t4 - t1) - (t3 - t2);
      const roundTripMs = roundTrip / NANOS_PER_MS;

      // Offset del rellotge (diferència entre wall clock i local)
      const offset = ((t2 - t1) + (t3 - t4)) / 2;

      // Dispersió (incertesa) = round-trip / 2
      const dispersion = roundTrip / 2;

      // Actualitzar estadístiques
      this.updateStats(roundTripMs);

      // Actualitzar wall clock si la dispersió és acceptable
      // o si és millor que l'actual
      if (dispersion < this.wallClock.dispersion) {
        const wallClockTime = t4 + offset;
        this.wallClock.setCorrelation(t4, wallClockTime, dispersion);
        
        console.log(`🕐 WC: Sincronitzat - offset=${(offset/NANOS_PER_MS).toFixed(2)}ms, ` +
                    `RTT=${roundTripMs.toFixed(2)}ms, dispersion=${(dispersion/NANOS_PER_MS).toFixed(2)}ms`);
        
        this.emit('sync', {
          offset: offset / NANOS_PER_MS,
          roundTrip: roundTripMs,
          dispersion: dispersion / NANOS_PER_MS,
          wallClockTime: this.wallClock.nowMillis(),
        });
      }

    } catch (error) {
      console.error('❌ WC: Error processant resposta', error);
      this.emit('error', error);
    }
  }

  /**
   * Actualitza estadístiques
   */
  updateStats(roundTripMs) {
    this.stats.minRoundTrip = Math.min(this.stats.minRoundTrip, roundTripMs);
    this.stats.maxRoundTrip = Math.max(this.stats.maxRoundTrip, roundTripMs);
    
    // Mitjana mòbil
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
    console.log('🔌 WC: Tancant connexió...');
    this.stopSync();
    if (this.ws) {
      this.ws.close(1000, 'Client closing');
      this.ws = null;
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

export default CSSWCService;
