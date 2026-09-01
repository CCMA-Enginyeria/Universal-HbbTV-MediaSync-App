/**
 * App2App Application Channel Service
 *
 * Generic, bidirectional messaging channel between this companion app and the
 * HbbTV application, layered on top of the HbbTV App2App WebSocket bridge
 * (base URL advertised by DIAL as `X_HbbTV_App2AppURL`).
 *
 * It is deliberately independent of DVB-CSS: the channel is available whether
 * media synchronisation runs over native DVB-CSS or over the compatibility
 * mode, and it carries whatever the HbbTV application and its companion agree
 * on (commands, chat, application state). This service stays agnostic of the
 * payload schema and simply forwards it.
 *
 * Wire format (JSON):
 *   { version: 1, type: <string>, id: <string|null>, payload: <any>, retained?: true }
 *
 * - Companion -> TV: a message with an `id` is a request; the TV answers with
 *   the same `id`.
 * - TV -> companion: a message without `id` is a broadcast. Messages flagged
 *   `retained` carry application state replayed on pairing, so a companion
 *   joining mid-session immediately receives the current state.
 */

import { EventEmitter } from 'events';

/** Envelope version of the application channel protocol. */
export const APP_MESSAGE_VERSION = 1;

/** Default suffix appended to the channel prefix. */
const CHANNEL_SUFFIX = 'app';

/** Default timeout (ms) before a pending request is rejected. */
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

/**
 * Builds the App2App WebSocket URL of the application channel.
 *
 * @param {string} app2appUrl Base App2App URL from DIAL.
 * @param {string} channelPrefix Channel prefix shared with the HbbTV app.
 * @returns {string|null} The channel URL, or null if no base URL is available.
 */
export function buildAppChannelUrl(app2appUrl, channelPrefix) {
  if (!app2appUrl) return null;
  const base = String(app2appUrl).replace(/\/+$/, '');
  const prefix = String(channelPrefix || '').replace(/^\/+|\/+$/g, '');
  if (!prefix) return null;
  return `${base}/${prefix}-${CHANNEL_SUFFIX}`;
}

export class App2AppChannelService extends EventEmitter {
  /**
   * @param {string} channelUrl Full WebSocket URL of the application channel.
   * @param {Object} [options]
   * @param {number} [options.requestTimeoutMs] Timeout for `request()` calls.
   * @param {number} [options.maxReconnectAttempts]
   * @param {number} [options.reconnectDelay] Base delay (ms), grows linearly.
   */
  constructor(channelUrl, options = {}) {
    super();
    this.channelUrl = channelUrl;
    this.ws = null;
    this.isConnected = false;
    this.isPaired = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 3;
    this.reconnectDelay = options.reconnectDelay ?? 2000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    // Messages queued while the channel is not paired yet.
    this.outgoingQueue = [];
    // Pending requests awaiting a correlated response, keyed by id.
    this.pendingRequests = new Map();
    // Last retained state received from the TV, keyed by message type.
    this.retainedState = {};
    this.requestCounter = 0;
  }

  /**
   * Opens the channel. Resolves as soon as the socket is created; readiness is
   * reported through the `paired` event.
   */
  connect() {
    if (!this.channelUrl) {
      console.warn('⚠️  App2App channel: no channel URL available');
      return false;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.warn('⚠️  App2App channel: already connected');
      return true;
    }

    console.log('🔌 App2App channel: connecting to', this.channelUrl);

    try {
      this.ws = new WebSocket(this.channelUrl);
    } catch (error) {
      console.error('❌ App2App channel: cannot open socket', error);
      this.emit('error', error);
      return false;
    }

    this.ws.onopen = () => {
      console.log('✅ App2App channel: socket open, waiting for pairing');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.emit('connected');
    };

    this.ws.onclose = (event) => {
      console.log('🔌 App2App channel: closed — code:', event.code,
        '| wasClean:', event.wasClean);
      this.isConnected = false;
      this.isPaired = false;
      this.emit('disconnected', { code: event.code, reason: event.reason });

      if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('❌ App2App channel: socket error', error?.message || error);
      this.emit('error', error);
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    return true;
  }

  /** Schedules a reconnection with a linearly growing delay. */
  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    console.log(`🔄 App2App channel: reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    setTimeout(() => {
      if (!this.isConnected) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Handles an incoming frame: either the App2App pairing control frame or a
   * JSON application message.
   */
  handleMessage(data) {
    // The HbbTV App2App bridge sends this control frame to both peers when the
    // channel is paired. It is transport metadata, not an application message.
    if (data === 'pairingcompleted') {
      console.log('🔗 App2App channel: pairing completed');
      this.isPaired = true;
      this.emit('paired');
      this.flushQueue();
      return;
    }

    let message;
    try {
      message = JSON.parse(data);
    } catch (error) {
      console.warn('⚠️  App2App channel: ignoring non-JSON frame', data);
      return;
    }

    if (!message || typeof message.type !== 'string') {
      console.warn('⚠️  App2App channel: ignoring message without type', message);
      return;
    }

    if (message.retained) {
      this.retainedState[message.type] = message.payload ?? null;
    }

    // Resolve a pending request when the response carries its correlation id.
    if (message.id && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);
      clearTimeout(pending.timer);
      pending.resolve(message);
    }

    this.emit('message', message);
  }

  /**
   * Sends an application message to the HbbTV app. Messages sent before the
   * channel is paired are queued and flushed on pairing.
   *
   * @param {string} type Application-defined message type.
   * @param {*} [payload] JSON-serialisable payload.
   * @param {string} [id] Correlation id, when answering a TV request.
   * @returns {boolean} true if the message was sent or queued.
   */
  send(type, payload, id) {
    if (!type) return false;
    const message = {
      version: APP_MESSAGE_VERSION,
      type,
      id: id ?? null,
      payload: payload ?? null,
    };
    return this.sendRaw(message);
  }

  /** Sends a pre-built envelope, queueing it while the channel is not paired. */
  sendRaw(message) {
    if (!this.isPaired || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.outgoingQueue.push(message);
      return true;
    }
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('❌ App2App channel: send failed', error);
      this.emit('error', error);
      return false;
    }
  }

  /** Flushes messages queued while the channel was not paired yet. */
  flushQueue() {
    if (!this.outgoingQueue.length) return;
    const queued = this.outgoingQueue;
    this.outgoingQueue = [];
    console.log(`📤 App2App channel: flushing ${queued.length} queued message(s)`);
    queued.forEach((message) => this.sendRaw(message));
  }

  /**
   * Sends a request and waits for the TV response correlated by id.
   *
   * @param {string} type Application-defined message type.
   * @param {*} [payload] JSON-serialisable payload.
   * @returns {Promise<Object>} The response envelope.
   */
  request(type, payload) {
    return new Promise((resolve, reject) => {
      if (!type) {
        reject(new Error('App2App channel: a message type is required'));
        return;
      }
      this.requestCounter++;
      const id = `req-${Date.now()}-${this.requestCounter}`;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`App2App channel: request "${type}" timed out`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.sendRaw({
        version: APP_MESSAGE_VERSION,
        type,
        id,
        payload: payload ?? null,
      });
    });
  }

  /**
   * @param {string} type
   * @returns {*} Last retained payload received for that type, or null.
   */
  getRetainedState(type) {
    return this.retainedState[type] ?? null;
  }

  /** @returns {boolean} whether the channel is paired and usable. */
  isReady() {
    return this.isPaired && !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /** Closes the channel without reconnecting. */
  close() {
    this.maxReconnectAttempts = 0;
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(new Error('App2App channel: closed'));
    });
    this.pendingRequests.clear();
    this.outgoingQueue = [];

    if (this.ws) {
      console.log('🔌 App2App channel: closing');
      // Detach handlers before closing: a late `onerror`/`onclose` on an
      // already destroyed service would emit on a listener-less emitter.
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      try {
        this.ws.close(1000, 'Client closing');
      } catch (error) {
        // Socket already closing; nothing to do.
      }
      this.ws = null;
    }
    this.isConnected = false;
    this.isPaired = false;
  }

  /** Closes the channel and removes every listener. */
  destroy() {
    this.close();
    this.removeAllListeners();
  }
}

export default App2AppChannelService;
