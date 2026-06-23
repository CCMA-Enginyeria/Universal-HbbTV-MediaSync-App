/**
 * CSS-TS (Timeline Synchronisation) Service
 * 
 * Protocol DVB-CSS per sincronitzar timelines de media entre dispositius.
 * Rep timestamps de control que mapegen el timeline del media al wall clock.
 * 
 * Control Timestamps:
 * - contentTime: Posició al timeline del contingut (ticks)
 * - wallClockTime: Temps wall clock corresponent (nanos)
 * - timelineSpeedMultiplier: Velocitat de reproducció (1.0 = normal)
 */

import { EventEmitter } from 'events';

// Nanos per segon per conversions
const NANOS_PER_SECOND = 1000000000;
const NANOS_PER_MS = 1000000;

/**
 * Classe que representa un timeline sincronitzat
 */
export class SynchronizedTimeline {
  constructor(timelineSelector, tickRate = 1000) {
    this.timelineSelector = timelineSelector;
    this.tickRate = tickRate; // Ticks per segon
    
    // Control timestamp actual
    this.controlTimestamp = null;
    this.isAvailable = false;
    
    // Referència al wall clock
    this.wallClock = null;

    // Informació de stream live
    this.streamInfo = null; // { isLive, availabilityStartTime, mpdType, ... }
    this.astEpochSeconds = null; // availabilityStartTime en segons Unix
  }

  /**
   * Estableix el wall clock de referència
   */
  setWallClock(wallClock) {
    this.wallClock = wallClock;
  }

  /**
   * Actualitza amb un nou control timestamp
   */
  updateControlTimestamp(ct) {
    // IMPORTANT: Parsejar com a números per evitar concatenació de strings
    const speed = Number(ct.timelineSpeedMultiplier);
    this.controlTimestamp = {
      contentTime: Number(ct.contentTime),
      wallClockTime: Number(ct.wallClockTime),
      // Usar isNaN per detectar valors invàlids, ja que 0 és un valor vàlid (pausa)
      timelineSpeedMultiplier: isNaN(speed) ? 1.0 : speed,
      receivedAt: Date.now(),
    };
    this.isAvailable = true;
  }

  /**
   * Marca el timeline com no disponible
   */
  setUnavailable() {
    this.isAvailable = false;
    this.controlTimestamp = null;
  }

  /**
   * Obté la posició actual al timeline en ticks
   */
  getCurrentPosition() {
    if (!this.isAvailable || !this.controlTimestamp || !this.wallClock) {
      return null;
    }

    const ct = this.controlTimestamp;
    
    // Si està pausat (speed = 0), retornar posició fixa
    if (ct.timelineSpeedMultiplier === 0) {
      return ct.contentTime;
    }

    // Calcular temps transcorregut des del control timestamp
    const wallClockNow = this.wallClock.now();
    const wallClockElapsed = wallClockNow - ct.wallClockTime;

    // Convertir elapsed wall clock a ticks del timeline
    // tickRate ticks per segon, wall clock en nanos
    const ticksElapsed = (wallClockElapsed / NANOS_PER_SECOND) * 
                         this.tickRate * 
                         ct.timelineSpeedMultiplier;

    return ct.contentTime + ticksElapsed;
  }

  /**
   * Obté la posició actual en segons
   */
  getCurrentPositionSeconds() {
    const ticks = this.getCurrentPosition();
    if (ticks === null) return null;
    return ticks / this.tickRate;
  }

  /**
   * Obté la posició actual en mil·lisegons
   */
  getCurrentPositionMillis() {
    const seconds = this.getCurrentPositionSeconds();
    if (seconds === null) return null;
    return seconds * 1000;
  }

  /**
   * Obté la velocitat actual de reproducció
   */
  getSpeed() {
    if (!this.controlTimestamp) return 0;
    return this.controlTimestamp.timelineSpeedMultiplier;
  }

  /**
   * Comprova si el media està reproduint-se
   */
  isPlaying() {
    return this.isAvailable && this.getSpeed() > 0;
  }

  /**
   * Comprova si el media està pausat
   */
  isPaused() {
    return this.isAvailable && this.getSpeed() === 0;
  }

  /**
   * Estableix informació de l'stream (live vs VOD)
   * @param {Object} info - { isLive, availabilityStartTime, mpdType, timeShiftBufferDepthSeconds, ... }
   */
  setStreamInfo(info) {
    this.streamInfo = info;
    if (info && info.isLive && info.availabilityStartTime) {
      this.astEpochSeconds = info.astEpochSeconds ?? new Date(info.availabilityStartTime).getTime() / 1000;
      this.timeShiftBufferDepthSeconds = info.timeShiftBufferDepthSeconds ?? 7200;
      console.log(`🎬 Timeline: Stream live configurat, AST=${info.availabilityStartTime} (${this.astEpochSeconds}s epoch), DVR=${this.timeShiftBufferDepthSeconds}s`);
    } else {
      this.astEpochSeconds = null;
      this.timeShiftBufferDepthSeconds = null;
    }
  }

  /**
   * Comprova si l'stream actual és live
   */
  isLiveStream() {
    return this.streamInfo?.isLive === true;
  }

  /**
   * Obté el temps transcorregut des de l'AST (live edge) usant Date.now() (Unix epoch).
   * Per VOD, retorna la mateixa posició absoluta.
   * Per live: Date.now()/1000 - astEpochSeconds = durada total del directe (live edge)
   */
  getRelativePositionSeconds() {
    const absoluteSeconds = this.getCurrentPositionSeconds();
    if (absoluteSeconds === null) return null;

    if (this.isLiveStream() && this.astEpochSeconds !== null) {
      const liveEdge = Date.now() / 1000 - this.astEpochSeconds;
      return Math.max(0, liveEdge);
    }

    return absoluteSeconds;
  }

  /**
   * Obté la posició convertida a la base de temps d'ExoPlayer per a streams live DVR.
   * ExoPlayer en live DASH reporta currentTime dins la finestra DVR [0, timeShiftBufferDepth].
   * Fórmula: exoTime = DVR - (liveEdge - tvPosition)
   *   on liveEdge = Date.now()/1000 - AST (durada total del directe)
   *       tvPosition = positionSeconds (on està la tele, des de l'AST)
   *       offsetFromLive = liveEdge - tvPosition (quants segons darrere del live edge)
   * Per VOD, retorna null.
   */
  getExoPlayerPositionSeconds() {
    if (!this.isLiveStream() || this.astEpochSeconds === null) {
      return null;
    }
    const tvPosition = this.getCurrentPositionSeconds();
    if (tvPosition === null) return null;
    const result = this.astEpochSeconds + tvPosition;
    return result;
  }

  /**
   * Obté informació del timeline
   */
  getInfo() {
    return {
      timelineSelector: this.timelineSelector,
      tickRate: this.tickRate,
      isAvailable: this.isAvailable,
      currentPositionTicks: this.getCurrentPosition(),
      currentPositionSeconds: this.getCurrentPositionSeconds(),
      relativePositionSeconds: this.getRelativePositionSeconds(),
      exoPlayerPositionSeconds: this.getExoPlayerPositionSeconds(),
      isLive: this.isLiveStream(),
      speed: this.getSpeed(),
      isPlaying: this.isPlaying(),
      controlTimestamp: this.controlTimestamp,
    };
  }
}

/**
 * Servei CSS-TS per sincronització de timelines
 */
export class CSSTSService extends EventEmitter {
  constructor(tsUrl, timelineSelector) {
    super();
    this.tsUrl = tsUrl;
    this.timelineSelector = timelineSelector;
    this.ws = null;
    this.isConnected = false;
    
    // Timeline sincronitzat
    this.timeline = new SynchronizedTimeline(timelineSelector);
    
    // Wall clock (s'ha d'establir externament)
    this.wallClock = null;
    
    // Estat de la connexió
    this.lastControlTimestamp = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
  }

  /**
   * Estableix el wall clock de referència
   */
  setWallClock(wallClock) {
    this.wallClock = wallClock;
    this.timeline.setWallClock(wallClock);
  }

  /**
   * Estableix el tick rate del timeline
   */
  setTickRate(tickRate) {
    this.timeline.tickRate = tickRate;
  }

  /**
   * Connecta al servidor Timeline Sync
   */
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.warn('⚠️  TS: Ja hi ha una connexió activa');
      return;
    }

    if (!this.tsUrl) {
      const error = new Error('TS: No hi ha URL Timeline Sync disponible');
      this.emit('error', error);
      return;
    }

    console.log('🔌 TS: Connectant a', this.tsUrl);

    try {
      this.ws = new WebSocket(this.tsUrl);

      this.ws.onopen = () => {
        console.log('✅ TS: Connexió establerta');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connected');
        
        // Enviar setup message amb el timeline selector
        this.sendSetup();
      };

      this.ws.onclose = (event) => {
        console.log('🔌 TS: Connexió tancada', event.code);
        this.isConnected = false;
        this.timeline.setUnavailable();
        this.emit('disconnected');

        // Reconnexió automàtica
        if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('❌ TS: Error de WebSocket', error);
        this.emit('error', error);
      };

      this.ws.onmessage = (event) => {
        console.log('📨 TS: Raw event data', event.data);
        this.handleMessage(event.data);
      };

    } catch (error) {
      console.error('❌ TS: Error creant WebSocket', error);
      this.emit('error', error);
    }
  }

  /**
   * Programa una reconnexió
   */
  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = 2000 * this.reconnectAttempts;
    console.log(`🔄 TS: Reconnectant en ${delay}ms`);
    
    setTimeout(() => {
      if (!this.isConnected) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Envia el missatge de setup
   * Format:
   * {
   *   contentIdStem: string (opcional),
   *   timelineSelector: string
   * }
   */
  sendSetup() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const setup = {
      timelineSelector: this.timelineSelector,
    };

    console.log('📤 TS: Enviant setup', setup);
    this.ws.send(JSON.stringify(setup));
  }

  /**
   * Processa missatges del servidor
   * Pot ser:
   * - Control Timestamp: { contentTime, wallClockTime, timelineSpeedMultiplier }
   * - Timeline Unavailable: { timelineSpeedMultiplier: null }
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      console.log('📨 TS: Missatge rebut', message);

      // Detectar si el timeline no està disponible
      if (message.timelineSpeedMultiplier === null || 
          message.contentTime === undefined ||
          message.wallClockTime === undefined) {
        console.log('⚠️  TS: Timeline no disponible');
        this.timeline.setUnavailable();
        this.emit('unavailable');
        return;
      }

      // Actualitzar control timestamp
      this.lastControlTimestamp = {
        contentTime: message.contentTime,
        wallClockTime: message.wallClockTime,
        timelineSpeedMultiplier: message.timelineSpeedMultiplier ?? 1.0,
        receivedAt: Date.now(),
      };

      this.timeline.updateControlTimestamp(this.lastControlTimestamp);

      // Logging
      const posSeconds = this.timeline.getCurrentPositionSeconds();
      const speed = this.timeline.getSpeed();
      console.log(`🎬 TS: Timeline actualitzat - pos=${posSeconds?.toFixed(2)}s, speed=${speed}`);

      // Emetre event
      this.emit('control-timestamp', {
        contentTime: message.contentTime,
        wallClockTime: message.wallClockTime,
        speed: message.timelineSpeedMultiplier,
        positionSeconds: posSeconds,
      });

      this.emit('sync', this.timeline.getInfo());

    } catch (error) {
      console.error('❌ TS: Error processant missatge', error);
      this.emit('error', error);
    }
  }

  /**
   * Obté el timeline sincronitzat
   */
  getTimeline() {
    return this.timeline;
  }

  /**
   * Estableix informació de l'stream (live vs VOD) al timeline
   */
  setStreamInfo(info) {
    this.timeline.setStreamInfo(info);
  }

  /**
   * Obté la posició actual en segons
   */
  getCurrentPosition() {
    return this.timeline.getCurrentPositionSeconds();
  }

  /**
   * Obté la posició actual en mil·lisegons
   */
  getCurrentPositionMillis() {
    return this.timeline.getCurrentPositionMillis();
  }

  /**
   * Comprova si el timeline està disponible
   */
  isTimelineAvailable() {
    return this.timeline.isAvailable;
  }

  /**
   * Comprova si el media està reproduint-se
   */
  isPlaying() {
    return this.timeline.isPlaying();
  }

  /**
   * Obté informació completa
   */
  getInfo() {
    return {
      isConnected: this.isConnected,
      timeline: this.timeline.getInfo(),
    };
  }

  /**
   * Tanca la connexió
   */
  close() {
    console.log('🔌 TS: Tancant connexió...');
    this.maxReconnectAttempts = 0;
    if (this.ws) {
      this.ws.close(1000, 'Client closing');
      this.ws = null;
    }
    this.isConnected = false;
    this.timeline.setUnavailable();
  }

  /**
   * Destrueix el servei
   */
  destroy() {
    this.close();
    this.removeAllListeners();
  }
}

export default CSSTSService;
