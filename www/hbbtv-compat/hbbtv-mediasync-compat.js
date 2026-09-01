/*******************************************************************************
 * HbbTV MediaSync — App2App Compatibility Mode
 * =============================================
 *
 * A drop-in, self-contained polyfill that exposes DVB-CSS inter-device media
 * synchronisation over the standard HbbTV **App2App** WebSocket transport,
 * INDEPENDENTLY of the terminal's native `MediaSynchroniser` / DVB-CSS stack.
 *
 * WHY: some real HbbTV devices ship a native DVB-CSS implementation (CSS-CII /
 * CSS-WC / CSS-TS) that is flaky or broken. The App2App channel, however, is a
 * reliable and widely-supported HbbTV feature. This module reuses the exact same
 * DVB-CSS JSON wire protocol as the FOKUS `hbbtv-manager-polyfill.js`, but serves
 * it over three App2App channels so a companion app can synchronise even when
 * the native DVB-CSS endpoints fail.
 *
 * A companion app connects to three App2App channels (defaults):
 *   - "<prefix>-cii"  Content Identification and Information (contentId, timelines)
 *   - "<prefix>-wc"   Wall Clock (request/response time correlation)
 *   - "<prefix>-ts"   Timeline Synchronisation (media control timestamps)
 *
 * The CII channel advertises the WC and TS channel URLs, so the companion only
 * needs to know the CII channel name to bootstrap the whole session.
 *
 * USAGE (in any HbbTV application):
 *   <script src="hbbtv-mediasync-compat.js"></script>
 *   ...
 *   var video = document.querySelector('video');
 *   window.HbbTVMediaSyncCompat.start(video, {
 *     contentId: 'https://example.com/stream.mpd', // DASH MPD or companion web URL
 *     timelineSelector: 'urn:dvb:css:timeline:pts',
 *   });
 *   // later, when playback ends / on teardown:
 *   window.HbbTVMediaSyncCompat.stop();
 *
 * This file is intentionally framework-agnostic ES5 (no build step) so it can be
 * dropped verbatim into any HbbTV application, including old device browsers.
 ******************************************************************************/
(function () {
  'use strict';

  // Default PTS tick rate (90 kHz) used for MPEG-DASH content timelines.
  var DEFAULT_TICK_RATE = 90000;
  // Default timeline selector (MPEG-DASH PTS).
  var DEFAULT_TIMELINE_SELECTOR = 'urn:dvb:css:timeline:pts';
  // Default App2App channel prefix. Kept distinct from the polyfill's own
  // "dvbcss-*" channels so this module can coexist with a running polyfill
  // MediaSynchroniser on devices without native DVB-CSS.
  var DEFAULT_CHANNEL_PREFIX = 'hbbtv-sync';
  // How often (ms) to push a fresh control timestamp to TS clients even when no
  // media event fired, so the companion can re-anchor and detect stalls.
  var TS_HEARTBEAT_MS = 10000;

  /**
   * Parses the launch hash parameters (port / hostname) exactly like the FOKUS
   * polyfill, so this module can resolve App2App URLs when no native CS manager
   * is available (e.g. emulators, manual launch).
   */
  function parseHashParameters() {
    var dict = {};
    var hash = location.hash.substr(location.hash.lastIndexOf('#') + 1);
    if (hash) {
      var params = hash.split('&');
      for (var i = 0; i < params.length; i++) {
        var index = params[i].indexOf('=');
        var key = index > -1 ? params[i].substr(0, index) : params[i];
        var value = index > -1 ? params[i].substr(index + 1) : '';
        if (typeof dict[key] === 'undefined') {
          dict[key] = value;
        }
      }
    }
    return dict;
  }

  /**
   * Resolves the App2App local (server) and remote (companion-facing) base URLs.
   * Both URLs end with a trailing slash.
   *
   * Strategy:
   *   1. Prefer the native CS manager (works even when native DVB-CSS is broken,
   *      since App2App is a separate, reliable subsystem).
   *   2. Fall back to the launch hash parameters (port + hostname).
   *
   * @returns {{ local: string, remote: string }|null}
   */
  function resolveApp2AppUrls(options) {
    // Explicit URLs are useful for browser-based TV emulators where no native
    // HbbTV CS manager exists, while keeping the production discovery paths
    // below unchanged.
    if (options && options.app2appLocalBaseUrl && options.app2appRemoteBaseUrl) {
      return {
        local: options.app2appLocalBaseUrl,
        remote: options.app2appRemoteBaseUrl,
      };
    }

    // 1) Native CS manager.
    try {
      if (window.oipfObjectFactory &&
          typeof window.oipfObjectFactory.createCSManager === 'function') {
        var csm = window.oipfObjectFactory.createCSManager();
        if (csm) {
          var local = typeof csm.getApp2AppLocalBaseURL === 'function'
            ? csm.getApp2AppLocalBaseURL() : null;
          var remote = typeof csm.getApp2AppRemoteBaseURL === 'function'
            ? csm.getApp2AppRemoteBaseURL() : null;
          if (local && remote) {
            return { local: local, remote: remote };
          }
        }
      }
    } catch (e) {
      console.warn('MediaSyncCompat: CS manager App2App lookup failed:', e && e.message);
    }

    // 2) Launch hash parameters.
    var params = parseHashParameters();
    var port = params.port;
    var hostname = params.hostname;
    if (port && hostname) {
      return {
        local: 'ws://127.0.0.1:' + port + '/local/',
        remote: 'ws://' + hostname + ':' + port + '/remote/',
      };
    }

    return null;
  }

  /**
   * Joins an App2App base URL (with or without trailing slash) and a channel
   * name into a single WebSocket URL. Fixes the missing-separator bug present in
   * the original polyfill.
   */
  function joinChannel(baseUrl, channel) {
    if (!baseUrl) return null;
    return baseUrl.replace(/\/+$/, '') + '/' + channel;
  }

  /**
   * MediaSync compatibility server. One instance is created per start() call.
   * @constructor
   */
  function MediaSyncCompatServer(video, options) {
    var self = this;
    options = options || {};

    this.video = video;
    this.tickRate = options.tickRate || DEFAULT_TICK_RATE;
    this.timelineSelector = options.timelineSelector || DEFAULT_TIMELINE_SELECTOR;
    this.channelPrefix = options.channelPrefix || DEFAULT_CHANNEL_PREFIX;
    this.app2appLocalBaseUrl = options.app2appLocalBaseUrl || null;
    this.app2appRemoteBaseUrl = options.app2appRemoteBaseUrl || null;

    this.channels = {
      cii: this.channelPrefix + '-cii',
      wc: this.channelPrefix + '-wc',
      ts: this.channelPrefix + '-ts',
    };

    this.urls = null;
    this.running = false;
    this.connectedClients = []; // [{ ws, type }]
    this.tsHeartbeatTimer = null;
    this.mediaListeners = null;

    // Current CII state broadcast to CII clients.
    this.ciiState = {
      protocolVersion: '1.1',
      contentId: options.contentId || null,
      contentIdStatus: 'stable',
      presentationStatus: 'okay',
      mrsUrl: null,
      wcUrl: null,
      tsUrl: null,
      teUrl: null,
      timelines: [{
        timelineSelector: this.timelineSelector,
        timelineProperties: {
          unitsPerTick: 1,
          unitsPerSecond: this.tickRate,
        },
      }],
      private: {},
    };

    // Bound helpers.
    this._onCiiMessage = function (ws) { ws.send(JSON.stringify(self.ciiState)); };
  }

  /** Wall clock in nanoseconds, aligned with the polyfill implementation. */
  MediaSyncCompatServer.prototype.getWallClockNanos = function () {
    return Math.floor((performance.now() + performance.timeOrigin) * 1000000);
  };

  /** Current media position in timeline ticks. */
  MediaSyncCompatServer.prototype.getMediaTimeTicks = function () {
    if (!this.video) return 0;
    return Math.floor(this.video.currentTime * this.tickRate);
  };

  /** Starts the three App2App servers. */
  MediaSyncCompatServer.prototype.start = function () {
    if (this.running) {
      console.warn('MediaSyncCompat: already running');
      return false;
    }

    this.urls = resolveApp2AppUrls({
      app2appLocalBaseUrl: this.app2appLocalBaseUrl,
      app2appRemoteBaseUrl: this.app2appRemoteBaseUrl,
    });
    if (!this.urls) {
      console.error('MediaSyncCompat: App2App URLs not available; cannot start. ' +
        'Provide a native CS manager or launch with port/hostname hash params.');
      return false;
    }

    // Advertise the WC and TS channel URLs to CII clients.
    this.ciiState.wcUrl = joinChannel(this.urls.remote, this.channels.wc);
    this.ciiState.tsUrl = joinChannel(this.urls.remote, this.channels.ts);

    console.log('MediaSyncCompat: starting App2App sync servers', {
      cii: this.channels.cii,
      wc: this.ciiState.wcUrl,
      ts: this.ciiState.tsUrl,
    });

    this.running = true;
    this.setupMediaListeners();
    this.startCIIServer();
    this.startWCServer();
    this.startTSServer();
    this.startTSHeartbeat();
    return true;
  };

  /** Stops the servers and releases all resources. */
  MediaSyncCompatServer.prototype.stop = function () {
    if (!this.running) return;
    console.log('MediaSyncCompat: stopping');
    this.running = false;

    this.stopTSHeartbeat();
    this.removeMediaListeners();

    for (var i = 0; i < this.connectedClients.length; i++) {
      var client = this.connectedClients[i];
      try {
        if (client.ws && client.ws.readyState === WebSocket.OPEN) {
          client.ws.close();
        }
      } catch (e) { /* ignore */ }
    }
    this.connectedClients = [];
  };

  /** Updates the announced contentId and re-broadcasts CII on change. */
  MediaSyncCompatServer.prototype.setContentId = function (contentId) {
    if (this.ciiState.contentId === contentId) return;
    this.ciiState.contentId = contentId;
    this.ciiState.contentIdStatus = 'stable';
    console.log('MediaSyncCompat: contentId ->', contentId);
    this.broadcastCII();
  };

  /** Replaces application-specific CII private state and re-broadcasts it. */
  MediaSyncCompatServer.prototype.setPrivateState = function (privateState) {
    this.ciiState.private = privateState || {};
    this.broadcastCII();
  };

  // ------------------------------------------------------------------ servers

  MediaSyncCompatServer.prototype.startCIIServer = function () {
    var self = this;
    this.createServerEndpoint(this.channels.cii, 'cii', function (ws) {
      // Send the current CII state to a freshly paired client.
      self._onCiiMessage(ws);
    });
  };

  MediaSyncCompatServer.prototype.startWCServer = function () {
    var self = this;
    this.createServerEndpoint(this.channels.wc, 'wc', function (ws, data) {
      if (!data) return;
      try {
        var request = JSON.parse(data);
        // Only respond to WC requests (type = 0).
        if (request.t === 0) {
          var now = self.getWallClockNanos();
          ws.send(JSON.stringify({
            v: 0,
            t: 1, // response
            p: request.p,
            mfe: request.mfe,
            id: request.id,
            ot: request.ot,
            rt: now,
            tt: now + 1000, // small transmit delta
          }));
        }
      } catch (e) {
        console.error('MediaSyncCompat WC: error processing request:', e && e.message);
      }
    });
  };

  MediaSyncCompatServer.prototype.startTSServer = function () {
    var self = this;
    this.createServerEndpoint(this.channels.ts, 'ts', function (ws, data) {
      if (data) {
        try {
          var setup = JSON.parse(data);
          if (setup && setup.timelineSelector) {
            ws.timelineSelector = setup.timelineSelector;
          }
        } catch (e) { /* not a setup message */ }
      }
      // Push a control timestamp (initial state and on each incoming message).
      self.sendControlTimestamp(ws);
    });
  };

  /**
   * Creates an App2App server endpoint that accepts multiple paired companion
   * clients. Mirrors the FOKUS polyfill pairing handshake.
   */
  MediaSyncCompatServer.prototype.createServerEndpoint = function (channel, type, messageHandler) {
    var self = this;
    var wsUrl = joinChannel(this.urls.local, channel);

    function createConnection() {
      if (!self.running) return;

      var ws;
      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        console.error('MediaSyncCompat ' + type + ': cannot open', wsUrl, e && e.message);
        return;
      }

      ws.onopen = function () {
        console.log('MediaSyncCompat ' + type + ': waiting for clients on', channel);
      };

      ws.onclose = function () {
        var idx = self.indexOfClient(ws);
        if (idx >= 0) {
          self.connectedClients.splice(idx, 1);
        }
        // Recreate the listener so more clients can pair.
        if (self.running) {
          setTimeout(createConnection, 100);
        }
      };

      ws.onerror = function (e) {
        console.error('MediaSyncCompat ' + type + ': socket error', e && e.message);
      };

      ws.onmessage = function (evt) {
        if (evt.data === 'pairingcompleted') {
          console.log('MediaSyncCompat ' + type + ': client paired');
          self.connectedClients.push({ ws: ws, type: type });

          // Switch to the per-client message handler once paired.
          ws.onmessage = function (evt2) {
            messageHandler(ws, evt2.data);
          };

          // Send the initial state to the newly paired client.
          messageHandler(ws, null);

          // Accept further clients on a new listener.
          if (self.running) {
            setTimeout(createConnection, 100);
          }
        } else {
          // Unexpected message before pairing; close and let it recreate.
          try { ws.close(); } catch (e) { /* ignore */ }
        }
      };
    }

    createConnection();
  };

  MediaSyncCompatServer.prototype.indexOfClient = function (ws) {
    for (var i = 0; i < this.connectedClients.length; i++) {
      if (this.connectedClients[i].ws === ws) return i;
    }
    return -1;
  };

  // ---------------------------------------------------------------- broadcast

  MediaSyncCompatServer.prototype.broadcastCII = function () {
    var message = JSON.stringify(this.ciiState);
    for (var i = 0; i < this.connectedClients.length; i++) {
      var client = this.connectedClients[i];
      if (client.type === 'cii' && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  };

  MediaSyncCompatServer.prototype.sendControlTimestamp = function (ws) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    var playing = this.video && !this.video.paused && !this.video.ended;
    var ct = {
      contentTime: this.getMediaTimeTicks(),
      wallClockTime: this.getWallClockNanos(),
      timelineSpeedMultiplier: playing ? (this.video.playbackRate || 1) : 0,
    };
    ws.send(JSON.stringify(ct));
  };

  MediaSyncCompatServer.prototype.broadcastControlTimestamp = function () {
    for (var i = 0; i < this.connectedClients.length; i++) {
      var client = this.connectedClients[i];
      if (client.type === 'ts') {
        this.sendControlTimestamp(client.ws);
      }
    }
  };

  MediaSyncCompatServer.prototype.updateCIIPresentationStatus = function (status) {
    if (this.ciiState.presentationStatus !== status) {
      this.ciiState.presentationStatus = status;
      this.broadcastCII();
    }
  };

  // --------------------------------------------------------------- heartbeat

  MediaSyncCompatServer.prototype.startTSHeartbeat = function () {
    var self = this;
    if (this.tsHeartbeatTimer) return;
    this.tsHeartbeatTimer = setInterval(function () {
      self.broadcastControlTimestamp();
    }, TS_HEARTBEAT_MS);
  };

  MediaSyncCompatServer.prototype.stopTSHeartbeat = function () {
    if (this.tsHeartbeatTimer) {
      clearInterval(this.tsHeartbeatTimer);
      this.tsHeartbeatTimer = null;
    }
  };

  // ----------------------------------------------------------- media events

  MediaSyncCompatServer.prototype.setupMediaListeners = function () {
    var self = this;
    if (!this.video) return;
    this.removeMediaListeners();

    var listeners = {
      play: function () {
        self.updateCIIPresentationStatus('okay');
        self.broadcastControlTimestamp();
      },
      pause: function () {
        self.broadcastControlTimestamp();
      },
      seeking: function () {
        self.updateCIIPresentationStatus('transitioning');
      },
      seeked: function () {
        self.updateCIIPresentationStatus('okay');
        self.broadcastControlTimestamp();
      },
      ratechange: function () {
        self.broadcastControlTimestamp();
      },
      ended: function () {
        self.updateCIIPresentationStatus('finished');
        self.broadcastControlTimestamp();
      },
      error: function () {
        self.updateCIIPresentationStatus('fault');
      },
    };

    this.video.addEventListener('play', listeners.play);
    this.video.addEventListener('pause', listeners.pause);
    this.video.addEventListener('seeking', listeners.seeking);
    this.video.addEventListener('seeked', listeners.seeked);
    this.video.addEventListener('ratechange', listeners.ratechange);
    this.video.addEventListener('ended', listeners.ended);
    this.video.addEventListener('error', listeners.error);
    this.mediaListeners = listeners;
  };

  MediaSyncCompatServer.prototype.removeMediaListeners = function () {
    if (!this.video || !this.mediaListeners) return;
    var l = this.mediaListeners;
    this.video.removeEventListener('play', l.play);
    this.video.removeEventListener('pause', l.pause);
    this.video.removeEventListener('seeking', l.seeking);
    this.video.removeEventListener('seeked', l.seeked);
    this.video.removeEventListener('ratechange', l.ratechange);
    this.video.removeEventListener('ended', l.ended);
    this.video.removeEventListener('error', l.error);
    this.mediaListeners = null;
  };

  // ------------------------------------------------------------ public API

  var currentServer = null;

  var HbbTVMediaSyncCompat = {
    /**
     * Starts the App2App compatibility sync servers for the given media element.
     * Any previously running instance is stopped first.
     *
     * @param {HTMLMediaElement} video The media element to synchronise from.
     * @param {Object} [options]
     * @param {string} [options.contentId] Content identifier (DASH MPD URL or
     *   companion web URL) announced over CSS-CII.
     * @param {string} [options.timelineSelector] Timeline selector (default PTS).
     * @param {number} [options.tickRate] Timeline tick rate (default 90000).
     * @param {string} [options.channelPrefix] App2App channel name prefix.
     * @returns {boolean} true if the servers started.
     */
    start: function (video, options) {
      if (!video) {
        console.error('MediaSyncCompat.start: a media element is required');
        return false;
      }
      if (currentServer) {
        currentServer.stop();
        currentServer = null;
      }
      var server = new MediaSyncCompatServer(video, options);
      var ok = server.start();
      if (ok) {
        currentServer = server;
      }
      return ok;
    },

    /** Updates the announced contentId (re-broadcasts CSS-CII). */
    setContentId: function (contentId) {
      if (currentServer) {
        currentServer.setContentId(contentId);
      }
    },

    /** Replaces application-specific CII private state and re-broadcasts it. */
    setPrivateState: function (privateState) {
      if (currentServer) {
        currentServer.setPrivateState(privateState);
      }
    },

    /** Stops the App2App compatibility sync servers. */
    stop: function () {
      if (currentServer) {
        currentServer.stop();
        currentServer = null;
      }
    },

    /** @returns {boolean} whether the compatibility servers are running. */
    isRunning: function () {
      return !!(currentServer && currentServer.running);
    },
  };

  window.HbbTVMediaSyncCompat = HbbTVMediaSyncCompat;
})();
