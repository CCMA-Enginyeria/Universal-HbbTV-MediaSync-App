/**
 * CSS-CII (Content Identification and Information) Service
 * 
 * Protocol DVB-CSS per rebre informació del contingut i estat de presentació
 * del terminal HbbTV. Connecta a X_HbbTV_InterDevSyncURL.
 * 
 * Missatges rebuts:
 * - contentId: Identificador del contingut actual
 * - contentIdStatus: 'stable', 'partial', 'not-observed'
 * - presentationStatus: 'okay', 'transitioning', 'fault'
 * - timelines: Array amb timelines disponibles
 * - wcUrl: URL del servei Wall Clock
 * - tsUrl: URL del servei Timeline Sync
 */

import { EventEmitter } from 'events';

// Estats del contingut
export const ContentIdStatus = {
  STABLE: 'stable',
  PARTIAL: 'partial',
  NOT_OBSERVED: 'not-observed',
};

// Estats de presentació
export const PresentationStatus = {
  OKAY: 'okay',
  TRANSITIONING: 'transitioning',
  FAULT: 'fault',
};

export class CSSCIIService extends EventEmitter {
  constructor(interDevSyncUrl) {
    super();
    this.interDevSyncUrl = interDevSyncUrl;
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 2000;
    
    // Estat CII actual
    this.state = {
      contentId: null,
      contentIdStatus: ContentIdStatus.NOT_OBSERVED,
      presentationStatus: PresentationStatus.TRANSITIONING,
      mrsUrl: null,
      wcUrl: null,
      tsUrl: null,
      timelines: [],
      teUrl: null,
      private: null,
    };
  }

  /**
   * Connecta al servidor CSS-CII
   */
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.warn('⚠️  CII: Ja hi ha una connexió activa');
      return;
    }

    if (!this.interDevSyncUrl) {
      const error = new Error('CII: No hi ha URL InterDevSync disponible');
      this.emit('error', error);
      return;
    }

    console.log('🔌 CII: Connectant a', this.interDevSyncUrl);

    try {
      this.ws = new WebSocket(this.interDevSyncUrl);

      this.ws.onopen = () => {
        console.log('✅ CII: Connexió establerta');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.emit('connected');
      };

      this.ws.onclose = (event) => {
        console.log('🔌 CII: Connexió tancada', event.code, event.reason);
        this.isConnected = false;
        this.emit('disconnected', { code: event.code, reason: event.reason });

        // Reconnexió automàtica si no és un tancament intencionat
        if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('❌ CII: Error de WebSocket', error);
        this.emit('error', error);
      };

      this.ws.onmessage = (event) => {
        console.log('📩 CII: RAW message received:', typeof event.data, event.data);
        this.handleMessage(event.data);
      };

    } catch (error) {
      console.error('❌ CII: Error creant WebSocket', error);
      this.emit('error', error);
    }
  }

  /**
   * Programa una reconnexió
   */
  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    console.log(`🔄 CII: Reconnectant en ${delay}ms (intent ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      if (!this.isConnected) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Processa missatges CII rebuts
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      console.log('📨 CII: Missatge rebut', message);

      // Detectar canvis i actualitzar estat
      const changes = {};
      let hasChanges = false;

      // Processar cada camp del missatge CII
      if ('contentId' in message && message.contentId !== this.state.contentId) {
        changes.contentId = message.contentId;
        this.state.contentId = message.contentId;
        hasChanges = true;
      }

      if ('contentIdStatus' in message && message.contentIdStatus !== this.state.contentIdStatus) {
        changes.contentIdStatus = message.contentIdStatus;
        this.state.contentIdStatus = message.contentIdStatus;
        hasChanges = true;
      }

      if ('presentationStatus' in message && message.presentationStatus !== this.state.presentationStatus) {
        changes.presentationStatus = message.presentationStatus;
        this.state.presentationStatus = message.presentationStatus;
        hasChanges = true;
        this.emit('presentation-status', message.presentationStatus);
      }

      if ('mrsUrl' in message && message.mrsUrl !== this.state.mrsUrl) {
        changes.mrsUrl = message.mrsUrl;
        this.state.mrsUrl = message.mrsUrl;
        hasChanges = true;
      }

      if ('wcUrl' in message && message.wcUrl !== this.state.wcUrl) {
        changes.wcUrl = message.wcUrl;
        this.state.wcUrl = message.wcUrl;
        hasChanges = true;
        this.emit('wc-url', message.wcUrl);
      }

      if ('tsUrl' in message && message.tsUrl !== this.state.tsUrl) {
        changes.tsUrl = message.tsUrl;
        this.state.tsUrl = message.tsUrl;
        hasChanges = true;
        this.emit('ts-url', message.tsUrl);
      }

      if ('teUrl' in message && message.teUrl !== this.state.teUrl) {
        changes.teUrl = message.teUrl;
        this.state.teUrl = message.teUrl;
        hasChanges = true;
      }

      if ('timelines' in message) {
        // Comparar timelines (array)
        const timelinesChanged = JSON.stringify(message.timelines) !== JSON.stringify(this.state.timelines);
        if (timelinesChanged) {
          changes.timelines = message.timelines;
          this.state.timelines = message.timelines;
          hasChanges = true;
          this.emit('timelines', message.timelines);
        }
      }

      if ('private' in message) {
        changes.private = message.private;
        this.state.private = message.private;
        hasChanges = true;
      }

      // Emetre events
      if (hasChanges) {
        this.emit('cii-change', { changes, state: this.getState() });
      }

      // Event general per cada missatge
      this.emit('message', message);

    } catch (error) {
      console.error('❌ CII: Error processant missatge', error, data);
      this.emit('error', error);
    }
  }

  /**
   * Obté l'estat CII actual
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Obté el content ID actual
   */
  getContentId() {
    return this.state.contentId;
  }

  /**
   * Obté l'URL del servei Wall Clock
   */
  getWallClockUrl() {
    return this.state.wcUrl;
  }

  /**
   * Obté l'URL del servei Timeline Sync
   */
  getTimelineSyncUrl() {
    return this.state.tsUrl;
  }

  /**
   * Obté els timelines disponibles
   */
  getTimelines() {
    return [...this.state.timelines];
  }

  /**
   * Comprova si la presentació és estable
   */
  isPresentationOkay() {
    return this.state.presentationStatus === PresentationStatus.OKAY;
  }

  /**
   * Comprova si el content ID és estable
   */
  isContentIdStable() {
    return this.state.contentIdStatus === ContentIdStatus.STABLE;
  }

  /**
   * Tanca la connexió
   */
  close() {
    if (this.ws) {
      console.log('🔌 CII: Tancant connexió...');
      this.maxReconnectAttempts = 0; // Evitar reconnexió
      this.ws.close(1000, 'Client closing');
      this.ws = null;
      this.isConnected = false;
    }
  }

  /**
   * Destrueix el servei i neteja recursos
   */
  destroy() {
    this.close();
    this.removeAllListeners();
  }
}

export default CSSCIIService;
