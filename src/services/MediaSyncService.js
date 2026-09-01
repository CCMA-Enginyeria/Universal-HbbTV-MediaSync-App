/**
 * Media Synchronization Service
 * 
 * Servei orquestrador que coordina els tres protocols DVB-CSS:
 * - CSS-CII: Informació del contingut i URLs dels altres serveis
 * - CSS-WC: Sincronització del wall clock
 * - CSS-TS: Sincronització del timeline del media
 * 
 * Proporciona una API simplificada per a la sincronització inter-dispositiu.
 */

import { EventEmitter } from 'events';
import CSSCIIService from './CSSCIIService';
import CSSWCService from './CSSWCService';
import CSSWCServiceUDP, { parseWCUrl } from './CSSWCServiceUDP';
import CSSTSService from './CSSTSService';
import App2AppChannelService, { buildAppChannelUrl } from './App2AppChannelService';
import mediaSyncConfig from '../utils/config';

// Estats de sincronització
export const SyncState = {
  DISCONNECTED: 'disconnected',
  CONNECTING_CII: 'connecting-cii',
  WAITING_WC: 'waiting-wc',
  CONNECTING_WC: 'connecting-wc',
  WAITING_TS: 'waiting-ts',
  CONNECTING_TS: 'connecting-ts',
  SYNCHRONIZED: 'synchronized',
  ERROR: 'error',
};

// Timeline selector per defecte (MPEG DASH PTS)
const DEFAULT_TIMELINE_SELECTOR = 'urn:dvb:css:timeline:pts';
// Tick rate per defecte (90kHz per PTS)
const DEFAULT_TICK_RATE = 90000;

/**
 * Servei principal de sincronització de media
 */
export class MediaSyncService extends EventEmitter {
  constructor() {
    super();
    
    // Serveis DVB-CSS
    this.ciiService = null;
    this.wcService = null;
    this.tsService = null;

    // Generic App2App application channel (independent of DVB-CSS).
    this.appChannelService = null;
    this.app2appUrl = null;
    
    // Configuració
    this.interDevSyncUrl = null;
    this.timelineSelector = DEFAULT_TIMELINE_SELECTOR;
    this.tickRate = DEFAULT_TICK_RATE;
    this.realIP = null; // IP real per substituir 0.0.0.0
    
    // Estat
    this.state = SyncState.DISCONNECTED;
    this.streamInfo = null; // Informació de l'stream (live vs VOD)
    this.syncQuality = {
      wcDispersion: Infinity,
      tsAvailable: false,
      lastUpdate: null,
    };
    
    // Timer per actualitzacions periòdiques
    this.updateTimer = null;
    this.updateInterval = mediaSyncConfig?.MEDIA_SYNC?.POSITION_UPDATE_INTERVAL_MS ?? 250; // ms

    // Selecció de transport (mode compatibilitat App2App vs DVB-CSS natiu).
    // `candidates` és una llista ordenada d'URLs d'entrada CSS-CII a provar. El
    // primer que respongui amb un missatge CII vàlid dins del `probeTimeoutMs`
    // es queda seleccionat; si no respon, es prova el següent (fallback).
    this.candidates = [];
    this.candidateIndex = 0;
    this.probeTimer = null;
    this.probeTimeoutMs = 12000;
    this.probing = false; // cert fins que un candidat dóna un CII vàlid
    this.mode = null; // 'compat' | 'native' un cop seleccionat
    this.compatChannelPrefix = 'hbbtv-sync';
  }

  /**
   * Connecta a un terminal per sincronització de media
   * @param {string} interDevSyncUrl - URL del servei InterDevSync (CSS-CII)
   * @param {Object} options - Opcions de connexió
   */
  async connect(interDevSyncUrl, options = {}) {
    if (this.state !== SyncState.DISCONNECTED && this.state !== SyncState.ERROR) {
      console.warn('⚠️  MediaSync: Ja hi ha una connexió activa');
      return;
    }

    this.timelineSelector = options.timelineSelector || DEFAULT_TIMELINE_SELECTOR;
    this.tickRate = options.tickRate || DEFAULT_TICK_RATE;
    this.realIP = options.realIP || null; // IP real per substituir 0.0.0.0
    this.probeTimeoutMs = options.compatProbeTimeoutMs || 2000;
    this.compatChannelPrefix = options.compatChannelPrefix || 'hbbtv-sync';

    // Native DVB-CSS URL and compatibility App2App CSS-CII URL, both with any
    // invalid host placeholder replaced before selecting a transport.
    const nativeUrl = interDevSyncUrl ? this.fixInvalidIP(interDevSyncUrl) : null;
    const app2appUrl = options.app2appUrl ? this.fixInvalidIP(options.app2appUrl) : null;
    const compatUrl = this.buildCompatCiiUrl(app2appUrl);
    const requestedMode = options.mode;
    if (requestedMode && requestedMode !== 'native' && requestedMode !== 'compat') {
      throw new Error(`Invalid MediaSync mode: ${requestedMode}`);
    }

    // An explicit mode is strict: retries stay on that transport and never
    // fall back. Calls without a mode retain the legacy ordered fallback.
    const preferCompat = options.preferCompat !== false;
    const ordered = requestedMode === 'native'
      ? [nativeUrl]
      : requestedMode === 'compat'
      ? [compatUrl]
      : preferCompat
      ? [compatUrl, nativeUrl]
      : [nativeUrl, compatUrl];
    const seen = new Set();
    this.candidates = [];
    ordered.forEach((url) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      this.candidates.push({ url, mode: url === compatUrl ? 'compat' : 'native' });
    });

    if (this.candidates.length === 0) {
      const missingTransport = requestedMode ? ` for '${requestedMode}' mode` : '';
      console.error(`❌ MediaSync: no synchronization URL available${missingTransport}`);
      this.setState(SyncState.ERROR);
      this.emit('error', {
        service: 'cii',
        error: new Error(`No sync URL available${missingTransport}`),
      });
      return;
    }

    console.log('🎬 MediaSync: Iniciant connexió...');
    console.log(`   Timeline: ${this.timelineSelector}`);
    console.log(`   Candidats de transport: ${this.candidates.map((c) => `${c.mode}`).join(' → ')}`);

    // The application channel does not depend on the DVB-CSS transport, so it
    // is opened as soon as an App2App base URL is known.
    this.app2appUrl = app2appUrl;
    this.startAppChannel();

    this.candidateIndex = 0;
    this.mode = null;
    this.tryNextCandidate();
  }

  /**
   * Construeix l'URL del canal App2App CSS-CII del mode compatibilitat a partir
   * de la URL base App2App (X_HbbTV_App2AppURL) del terminal.
   * @param {string|null} app2appUrl - URL base App2App remota
   * @returns {string|null} URL del canal CSS-CII de compatibilitat
   */
  buildCompatCiiUrl(app2appUrl) {
    if (!app2appUrl) return null;
    const base = app2appUrl.replace(/\/+$/, '');
    return `${base}/${this.compatChannelPrefix}-cii`;
  }

  /**
   * Checks that a service URL belongs to the selected App2App compatibility
   * transport. Compatibility mode is all-or-nothing: CII, WC and TS must all
   * use the WebSocket channels exposed by the same compatibility profile.
   */
  isCompatServiceUrl(url, service) {
    if (typeof url !== 'string' || !/^wss?:\/\//i.test(url)) return false;
    const expectedSuffix = `/${this.compatChannelPrefix}-${service}`;
    return url.replace(/\/+$/, '').endsWith(expectedSuffix);
  }

  /**
   * Prova el següent candidat de transport de la llista. Si s'esgoten, emet error.
   */
  tryNextCandidate() {
    if (this.candidateIndex >= this.candidates.length) {
      console.error('❌ MediaSync: tots els transports han fallat');
      this.setState(SyncState.ERROR);
      this.emit('error', { service: 'cii', error: new Error('All sync transports failed') });
      return;
    }

    const candidate = this.candidates[this.candidateIndex];
    const hasNext = this.candidateIndex < this.candidates.length - 1;
    this.interDevSyncUrl = candidate.url;
    this.mode = candidate.mode;
    // Només fem "probe" (amb fallback) si hi ha un altre candidat de reserva.
    this.probing = hasNext;

    console.log(`🔀 MediaSync: provant transport '${candidate.mode}' → ${candidate.url}`);
    this.setState(SyncState.CONNECTING_CII);
    this.connectCII();

    if (hasNext) {
      this.startProbeTimer();
    }
  }

  /**
   * Inicia el temporitzador de probe: si el transport actual no dóna un CII
   * vàlid a temps, passa al següent candidat.
   */
  startProbeTimer() {
    this.clearProbeTimer();
    this.probeTimer = setTimeout(() => {
      if (this.probing) {
        console.warn(`⏱️  MediaSync: transport '${this.mode}' sense resposta CII; provant el següent`);
        this.advanceCandidate();
      }
    }, this.probeTimeoutMs);
  }

  clearProbeTimer() {
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }

  /**
   * Marca el transport actual com a vàlid (ha arribat un CII real) i cancel·la
   * qualsevol fallback pendent.
   */
  markProbeSuccess() {
    if (!this.probing) return;
    this.probing = false;
    this.clearProbeTimer();
    console.log(`✅ MediaSync: transport '${this.mode}' seleccionat`);
    this.emit('transport-selected', { mode: this.mode, url: this.interDevSyncUrl });
  }

  /**
   * Descarta el candidat actual i prova el següent, sense notificar
   * desconnexió als consumidors (encara estem seleccionant transport).
   */
  advanceCandidate() {
    this.clearProbeTimer();
    this.probing = false;
    this.cleanupServices();
    this.candidateIndex += 1;
    this.tryNextCandidate();
  }

  /**
   * Allibera els serveis CSS actius sense canviar l'estat públic. S'usa durant
   * la selecció de transport (fallback entre candidats).
   */
  cleanupServices() {
    this.stopUpdateTimer();
    if (this.tsService) {
      this.tsService.destroy();
      this.tsService = null;
    }
    if (this.wcService) {
      this.wcService.destroy();
      this.wcService = null;
    }
    if (this.ciiService) {
      this.ciiService.destroy();
      this.ciiService = null;
    }
    this.syncQuality = {
      wcDispersion: Infinity,
      tsAvailable: false,
      lastUpdate: null,
    };
  }

  /**
   * Retorna el mode de transport seleccionat ('compat' | 'native' | null).
   */
  getMode() {
    return this.mode;
  }

  /**
   * Substitueix la IP invàlida (0.0.0.0, localhost, 127.0.0.1 o buida) per la IP real
   * @param {string} url - URL a corregir
   * @returns {string} URL amb la IP correcta
   */
  fixInvalidIP(url) {
    if (!url || !this.realIP) return url;
    // Detectar IP buida (ws://:port/), 0.0.0.0, localhost, 127.0.0.1
    const hasInvalidIP = url.includes('0.0.0.0') || 
                         url.includes('localhost') || 
                         url.includes('127.0.0.1') ||
                         /:\/{2}:/.test(url); // Detecta ws://:port/
    if (hasInvalidIP) {
      return url
        .replace('0.0.0.0', this.realIP)
        .replace('localhost', this.realIP)
        .replace('127.0.0.1', this.realIP)
        .replace(/:(\/{2}):/g, `:$1${this.realIP}:`); // Substitueix IP buida
    }
    return url;
  }

  /**
   * Estableix la IP real per substituir les IPs invàlides
   * @param {string} ip - IP real del terminal
   */
  setRealIP(ip) {
    this.realIP = ip;
    console.log(`📡 MediaSync: IP real establerta a ${ip}`);
  }

  /**
   * Connecta al servei CSS-CII
   */
  async connectCII() {
    this.ciiService = new CSSCIIService(this.interDevSyncUrl);

    // A compatibility transport is selected only after CII has advertised
    // valid App2App endpoints for BOTH downstream protocols. This prevents a
    // mixed session such as compat CII + native WC or TS.
    this.ciiService.on('message', () => {
      if (this.mode === 'compat') {
        const wcUrl = this.fixInvalidIP(this.ciiService.getWallClockUrl());
        const tsUrl = this.fixInvalidIP(this.ciiService.getTimelineSyncUrl());
        if (!this.isCompatServiceUrl(wcUrl, 'wc') || !this.isCompatServiceUrl(tsUrl, 'ts')) {
          return;
        }
      }
      this.markProbeSuccess();
    });

    // Escoltar events CII
    this.ciiService.on('connected', () => {
      console.log('✅ MediaSync: CII connectat');
      this.setState(SyncState.WAITING_WC);
      this.emit('cii-connected');
    });

    this.ciiService.on('disconnected', () => {
      if (this.probing) {
        console.warn('🔀 MediaSync: CII caigut durant la selecció de transport; provant el següent');
        this.advanceCandidate();
        return;
      }
      console.log('🔌 MediaSync: CII desconnectat');
      this.handleDisconnection('cii');
    });

    this.ciiService.on('error', (error) => {
      if (this.probing) {
        console.warn('🔀 MediaSync: error CII durant la selecció de transport; provant el següent', error?.message);
        this.advanceCandidate();
        return;
      }
      console.error('❌ MediaSync: Error CII', error);
      this.emit('error', { service: 'cii', error });
    });

    this.ciiService.on('wc-url', (wcUrl) => {
      console.log('📡 MediaSync: Wall Clock URL rebuda', wcUrl);
      // Substituir 0.0.0.0 per la IP real si cal
      const fixedWcUrl = this.fixInvalidIP(wcUrl);
      if (fixedWcUrl !== wcUrl) {
        console.log('📡 MediaSync: WC URL corregida', fixedWcUrl);
      }
      if (this.mode === 'compat' && !this.isCompatServiceUrl(fixedWcUrl, 'wc')) {
        console.warn('🔀 MediaSync: compat CII advertised a non-compat WC endpoint; rejecting the whole transport');
        if (this.probing) this.advanceCandidate();
        else this.emit('error', { service: 'wc', error: new Error('Invalid compatibility WC URL') });
        return;
      }
      this.connectWC(fixedWcUrl);
    });

    this.ciiService.on('ts-url', (tsUrl) => {
      console.log('📡 MediaSync: Timeline Sync URL rebuda', tsUrl);
      // Substituir 0.0.0.0 per la IP real si cal
      const fixedTsUrl = this.fixInvalidIP(tsUrl);
      if (fixedTsUrl !== tsUrl) {
        console.log('📡 MediaSync: TS URL corregida', fixedTsUrl);
      }
      if (this.mode === 'compat' && !this.isCompatServiceUrl(fixedTsUrl, 'ts')) {
        console.warn('🔀 MediaSync: compat CII advertised a non-compat TS endpoint; rejecting the whole transport');
        if (this.probing) this.advanceCandidate();
        else this.emit('error', { service: 'ts', error: new Error('Invalid compatibility TS URL') });
        return;
      }
      // Esperarem que WC estigui sincronitzat abans de connectar TS
      if (this.wcService && this.wcService.isSynchronized(this.getWcToleranceMs())) {
        this.connectTS(fixedTsUrl);
      }
    });

    this.ciiService.on('cii-change', (data) => {
      this.emit('cii-change', data);
    });

    this.ciiService.on('timelines', (timelines) => {
      console.log('📋 MediaSync: Timelines disponibles', timelines);
      this.emit('timelines', timelines);
    });

    this.ciiService.on('presentation-status', (status) => {
      this.emit('presentation-status', status);
    });

    // Connectar
    await this.ciiService.connect();
  }

  /**
   * Connecta al servei CSS-WC (Wall Clock)
   * Detecta automàticament si usar UDP (DVB-CSS real) o WebSocket (polyfill)
   */
  connectWC(wcUrl) {
    if (this.wcService) {
      this.wcService.destroy();
    }

    this.setState(SyncState.CONNECTING_WC);
    
    // Detectar protocol: UDP per DVB-CSS real, WebSocket per polyfill
    const parsedUrl = parseWCUrl(wcUrl);
    const useUDP = parsedUrl && parsedUrl.protocol === 'udp';
    
    if (useUDP) {
      console.log('📡 MediaSync: Usant WC amb UDP (DVB-CSS real)');
      this.wcService = new CSSWCServiceUDP(wcUrl);
    } else {
      console.log('📡 MediaSync: Usant WC amb WebSocket (polyfill mode)');
      this.wcService = new CSSWCService(wcUrl);
    }

    this.wcService.on('connected', () => {
      console.log('✅ MediaSync: WC connectat');
      this.emit('wc-connected');
    });

    this.wcService.on('disconnected', () => {
      console.log('🔌 MediaSync: WC desconnectat');
      this.handleDisconnection('wc');
    });

    this.wcService.on('error', (error) => {
      console.error('❌ MediaSync: Error WC', error);
      this.emit('error', { service: 'wc', error });
    });

    this.wcService.on('sync', (syncInfo) => {
      this.syncQuality.wcDispersion = syncInfo.dispersion;
      this.syncQuality.lastUpdate = Date.now();
      this.emit('wc-sync', syncInfo);

      // Quan WC està sincronitzat, connectar TS si tenim la URL
      if (this.wcService.isSynchronized(this.getWcToleranceMs()) && this.ciiService) {
        const tsUrl = this.ciiService.getTimelineSyncUrl();
        if (tsUrl && !this.tsService) {
          this.setState(SyncState.WAITING_TS);
          // Substituir 0.0.0.0 per la IP real si cal
          const fixedTsUrl = this.fixInvalidIP(tsUrl);
          this.connectTS(fixedTsUrl);
        }
      }
    });

    this.wcService.connect();
  }

  /**
   * Connecta al servei CSS-TS (Timeline Sync)
   */
  connectTS(tsUrl) {
    if (this.tsService) {
      this.tsService.destroy();
    }

    this.setState(SyncState.CONNECTING_TS);

    console.log('📡 MediaSync: TS URL', tsUrl);
    console.log('📡 MediaSync: Timeline selector', this.timelineSelector);
    
    this.tsService = new CSSTSService(tsUrl, this.timelineSelector);
    
    // Passar el wall clock al servei TS
    if (this.wcService) {
      this.tsService.setWallClock(this.wcService.getWallClock());
    }
    this.tsService.setTickRate(this.tickRate);

    // Propagar informació de stream live si ja la tenim
    if (this.streamInfo) {
      this.tsService.setStreamInfo(this.streamInfo);
    }

    this.tsService.on('connected', () => {
      console.log('✅ MediaSync: TS connectat');
      this.emit('ts-connected');
    });

    this.tsService.on('disconnected', () => {
      console.log('🔌 MediaSync: TS desconnectat');
      this.handleDisconnection('ts');
    });

    this.tsService.on('error', (error) => {
      console.error('❌ MediaSync: Error TS', error);
      this.emit('error', { service: 'ts', error });
    });

    this.tsService.on('sync', (timelineInfo) => {
      this.syncQuality.tsAvailable = timelineInfo.isAvailable;
      this.syncQuality.lastUpdate = Date.now();
      
      // Actualitzar estat a sincronitzat si tot està OK
      if (this.isSynchronized()) {
        this.setState(SyncState.SYNCHRONIZED);
      }
      
      this.emit('ts-sync', timelineInfo);
      this.emit('sync', this.getSyncInfo());
    });

    this.tsService.on('unavailable', () => {
      this.syncQuality.tsAvailable = false;
      this.emit('timeline-unavailable');
    });

    this.tsService.on('control-timestamp', (ct) => {
      this.emit('control-timestamp', ct);

      // IMPORTANT (background sync): els missatges TS arriben per WebSocket
      // entrant, que desperta el callback JS encara que l'app estigui en segon
      // pla. En canvi, el `setInterval` de `startUpdateTimer()` (i el del WC-UDP)
      // queda congelat per Android en background. Per això emetem `position-update`
      // directament aquí, de forma orientada a events, perquè el reposicionament
      // del player funcioni també amb l'app minimitzada.
      //
      // No depenem d'`isSynchronized()` (que requereix WC fresc, congelat en
      // background): n'hi ha prou que el timeline TS estigui disponible per
      // calcular una posició. El wall clock local continua avançant, i cada
      // control timestamp porta el seu propi contentTime/wallClockTime.
      if (this.tsService?.isTimelineAvailable()) {
        this.syncQuality.lastUpdate = Date.now();
        const position = this.getCurrentPosition();
        if (position) {
          this.emit('position-update', position);
        }
      }
    });

    this.tsService.connect();

    // Iniciar actualitzacions periòdiques
    this.startUpdateTimer();
  }

  /**
   * Gestiona desconnexions
   */
  handleDisconnection(service) {
    console.log(`🔌 MediaSync: Desconnexió de ${service}`);
    
    if (service === 'cii') {
      // Si CII es desconnecta, tot es desconnecta
      this.disconnect();
    } else if (service === 'wc') {
      this.syncQuality.wcDispersion = Infinity;
      if (this.state === SyncState.SYNCHRONIZED) {
        this.setState(SyncState.WAITING_WC);
      }
    } else if (service === 'ts') {
      this.syncQuality.tsAvailable = false;
      if (this.state === SyncState.SYNCHRONIZED) {
        this.setState(SyncState.WAITING_TS);
      }
    }

    this.emit('disconnection', { service });
  }

  /**
   * Força l'enviament d'una petició Wall Clock (UDP) immediata.
   *
   * El servei WC envia peticions periòdiques amb `setInterval`, però React
   * Native congela els timers JS quan l'app està en segon pla. Aquest mètode
   * permet que el heartbeat natiu del foreground service dispari peticions WC
   * en background (I/O), de manera que el Wall Clock pugui sincronitzar-se i
   * mantenir-se sincronitzat sense dependre del timer congelat.
   */
  pokeWallClock() {
    if (this.wcService && typeof this.wcService.sendRequest === 'function') {
      console.log('🫀 MediaSync: pokeWallClock -> wcService.sendRequest()');
      this.wcService.sendRequest();
    } else {
      console.log(`🫀 MediaSync: pokeWallClock SKIP (wcService=${!!this.wcService})`);
    }
  }

  /**
   * Inicia el timer d'actualitzacions periòdiques
   */
  startUpdateTimer() {
    if (this.updateTimer) return;

    this.updateTimer = setInterval(() => {
      if (this.isSynchronized()) {
        this.emit('position-update', this.getCurrentPosition());
      }
    }, this.updateInterval);
  }

  /**
   * Atura el timer d'actualitzacions
   */
  stopUpdateTimer() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * Canvia l'estat i emet event
   */
  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    console.log(`📊 MediaSync: Estat ${oldState} → ${newState}`);
    this.emit('state-change', { oldState, newState });
  }

  /**
   * Obté la dispersió màxima de Wall Clock acceptada pel transport actual.
   * App2App passa per un bridge WebSocket i, per tant, és menys precís que el
   * DVB-CSS natiu; el mode compatibilitat usa un marge més ampli.
   */
  getWcToleranceMs() {
    if (this.mode === 'compat') {
      return mediaSyncConfig.MEDIA_SYNC?.COMPAT_TOLERANCE_MS ?? 500;
    }
    return mediaSyncConfig.MEDIA_SYNC?.TOLERANCE_MS ?? 100;
  }

  /**
   * Comprova si està completament sincronitzat
   */
  isSynchronized() {
    const wcSynced = this.wcService?.isSynchronized(this.getWcToleranceMs());
    const tsAvailable = this.tsService?.isTimelineAvailable();
    return wcSynced && tsAvailable;
  }

  /**
   * Obté la posició actual del media en segons
   */
  getCurrentPosition() {
    if (!this.tsService) return null;
    
    const positionSeconds = this.tsService.getCurrentPosition();
    const positionMillis = this.tsService.getCurrentPositionMillis();
    const isPlaying = this.tsService.isPlaying();
    const speed = this.tsService.getTimeline().getSpeed();
    const timeline = this.tsService.getTimeline();
    const isLive = timeline.isLiveStream();
    const relativePositionSeconds = timeline.getRelativePositionSeconds();
    const exoPlayerPositionSeconds = timeline.getExoPlayerPositionSeconds();

    return {
      positionSeconds,
      positionMillis,
      isPlaying,
      speed,
      isLive,
      relativePositionSeconds,
      exoPlayerPositionSeconds,
      // Device wall-clock time (ms) at which this position is valid. Lets
      // latency-sensitive consumers (e.g. the web player, reached over a
      // WebView/WebSocket transport) compensate for how stale the sample is by
      // the time they anchor it. Same device clock on both ends.
      generatedAt: Date.now(),
      formattedTime: isLive
        ? this.formatLiveOffset(exoPlayerPositionSeconds)
        : this.formatTime(positionSeconds),
    };
  }

  /**
   * Estableix informació de l'stream (live vs VOD)
   * Propaga al servei CSS-TS per calcular posicions relatives
   * @param {Object} info - { isLive, availabilityStartTime, mpdType, ... }
   */
  setStreamInfo(info) {
    this.streamInfo = info;
    if (this.tsService) {
      this.tsService.setStreamInfo(info);
    }
    if (info?.isLive) {
      console.log(`📡 MediaSync: Stream live configurat (AST=${info.availabilityStartTime})`);
    }
  }

  /**
   * Formata temps en HH:MM:SS
   */
  formatTime(seconds) {
    if (seconds === null || seconds === undefined) return '--:--:--';
    
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
  }

  /**
   * Formata l'offset respecte el live edge.
   * Si està al edge (±5s) mostra "DIRECTE", sinó mostra "-MM:SS"
   */
  formatLiveOffset(exoPos) {
    if (exoPos == null) return '--:--';
    const offsetFromEdge = Date.now() / 1000 - exoPos; // segons darrere del live edge
    if (offsetFromEdge < 5) return 'DIRECTE';
    const m = Math.floor(offsetFromEdge / 60);
    const s = Math.floor(offsetFromEdge % 60);
    return `-${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * Obté informació completa de sincronització
   */
  getSyncInfo() {
    const position = this.getCurrentPosition();
    const ciiState = this.ciiService?.getState();
    const wcStats = this.wcService?.getStats();
    const tsInfo = this.tsService?.getInfo();

    return {
      state: this.state,
      isSynchronized: this.isSynchronized(),
      position,
      cii: ciiState ? {
        contentId: ciiState.contentId,
        presentationStatus: ciiState.presentationStatus,
        timelines: ciiState.timelines,
      } : null,
      wc: wcStats ? {
        isSynchronized: wcStats.isSynchronized,
        dispersionMs: wcStats.currentDispersion,
        avgRoundTrip: wcStats.avgRoundTrip,
      } : null,
      ts: tsInfo ? {
        isAvailable: tsInfo.timeline.isAvailable,
        speed: tsInfo.timeline.speed,
      } : null,
      quality: this.syncQuality,
    };
  }

  /**
   * Obté l'estat actual
   */
  getState() {
    return this.state;
  }

  /**
   * Obté la informació CII actual
   */
  getCIIState() {
    return this.ciiService?.getState();
  }

  /**
   * Obté el content ID actual
   */
  getContentId() {
    return this.ciiService?.getContentId();
  }

  // ----------------------------------------- App2App application channel

  /**
   * Obre el canal d'aplicació App2App si el terminal n'exposa la URL base.
   * És independent del transport DVB-CSS escollit.
   */
  startAppChannel() {
    if (this.appChannelService) return;

    const channelUrl = buildAppChannelUrl(this.app2appUrl, this.compatChannelPrefix);
    if (!channelUrl) {
      console.log('ℹ️  MediaSync: no App2App base URL, application channel disabled');
      return;
    }

    this.appChannelService = new App2AppChannelService(channelUrl);
    this.appChannelService.on('paired', () => this.emit('app-channel-ready'));
    this.appChannelService.on('message', (message) => this.emit('app-message', message));
    this.appChannelService.on('error', (error) => {
      // Non-fatal: media synchronisation works without the application channel.
      console.warn('⚠️  MediaSync: application channel error', error?.message || error);
    });
    this.appChannelService.connect();
  }

  /**
   * Envia un missatge d'aplicació a l'app HbbTV. Si el canal encara no està
   * aparellat, el missatge es posa a la cua i s'envia en aparellar-se.
   * @param {string} type - Tipus de missatge definit per l'aplicació
   * @param {*} [payload] - Contingut serialitzable a JSON
   * @param {string} [id] - Id de correlació, en respondre una petició de la TV
   * @returns {boolean}
   */
  sendAppMessage(type, payload, id) {
    if (!this.appChannelService) return false;
    return this.appChannelService.send(type, payload, id);
  }

  /**
   * Envia una petició i espera la resposta correlacionada de l'app HbbTV.
   * @param {string} type
   * @param {*} [payload]
   * @returns {Promise<Object>}
   */
  requestApp(type, payload) {
    if (!this.appChannelService) {
      return Promise.reject(new Error('MediaSync: application channel unavailable'));
    }
    return this.appChannelService.request(type, payload);
  }

  /**
   * Últim estat retingut rebut pel canal d'aplicació per a un tipus.
   * @param {string} type
   * @returns {*}
   */
  getAppState(type) {
    return this.appChannelService?.getRetainedState(type) ?? null;
  }

  /** @returns {boolean} si el canal d'aplicació està aparellat i operatiu */
  isAppChannelReady() {
    return this.appChannelService?.isReady() ?? false;
  }

  /**
   * Desconnecta tots els serveis
   */
  disconnect() {
    console.log('🔌 MediaSync: Desconnectant...');

    this.clearProbeTimer();
    this.probing = false;

    this.stopUpdateTimer();

    if (this.tsService) {
      this.tsService.destroy();
      this.tsService = null;
    }

    if (this.wcService) {
      this.wcService.destroy();
      this.wcService = null;
    }

    if (this.ciiService) {
      this.ciiService.destroy();
      this.ciiService = null;
    }

    if (this.appChannelService) {
      this.appChannelService.destroy();
      this.appChannelService = null;
    }
    this.app2appUrl = null;

    this.setState(SyncState.DISCONNECTED);
    this.syncQuality = {
      wcDispersion: Infinity,
      tsAvailable: false,
      lastUpdate: null,
    };

    this.emit('disconnected');
  }

  /**
   * Destrueix el servei completament
   */
  destroy() {
    this.removeAllListeners();
    this.disconnect();
  }
}

// Singleton instance
let instance = null;

/**
 * Obté la instància singleton del servei
 */
export const getMediaSyncService = () => {
  if (!instance) {
    instance = new MediaSyncService();
  }
  return instance;
};

/**
 * Reseteja la instància singleton (per testing)
 */
export const resetMediaSyncService = () => {
  if (instance) {
    instance.destroy();
    instance = null;
  }
};

export default MediaSyncService;
