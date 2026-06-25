/*******************************************************************************
 *
 * Copyright (c) 2015 Louay Bassbouss, Fraunhofer FOKUS, All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3.0 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library. If not, see <http://www.gnu.org/licenses/>.
 *
 * AUTHORS: Louay Bassbouss (louay.bassbouss@fokus.fraunhofer.de)
 *
 ******************************************************************************/
(function(){

    var parseParameters = function(query){
        var dict = {};
        query = query.substr(query.lastIndexOf("#")+1);
        if(query){
            var params = query.split("&");
            for (var i = 0; i < params.length; i++) {
                var index = params[i].indexOf("=");
                var key = index>-1?params[i].substr(0,index):params[i];
                var value = index>-1?params[i].substr(index+1):"";
                if(typeof dict[key] == "undefined"){
                    dict[key] = value;
                }
                else if(typeof dict[key] == "string"){
                    dict[key] = [dict[key],value];
                }
                else if(typeof dict[key] == "object"){
                    dict[key].push(value);
                }
            };
        }
        return dict;
    };

    var connect = function () {
        ws && ws.close();
        ws = new WebSocket(hbbtvCsManagerUrl);
        ws.onopen = function(evt) {
            //console.log("Connection to cs manager established");
        };
        ws.onclose = function(evt) {
            //console.log("Connection to cs manager closed");
            //window.close();
            if(ws = this){
                ws = null;
            }
        };
        ws.onerror = function (evt) {
            console.error("Error on connect to cs manager");
        };
        ws.onmessage = function(evt) {
            try{
                var rsp = JSON.parse(evt.data);
                handleRpcResponse(rsp);
            }
            catch(err){
                console.error("Error on parsing or handling rpc response",err);
            }
        };
    };

    var sendRpcRequest = function (req, callback) {
        if(!req.id){
            req.id = rpcCounter++;
        }
        if(callback && ws){
            pendingRpcRequests[req.id] = {
                req: req,
                callback: callback
            };
            ws.send(JSON.stringify(req));
            return true;
        }
        return false;
    };

    var handleRpcResponse = function (rsp) {
        var id = rsp.id;
        var pendingReq = pendingRpcRequests[id];
        if(pendingReq){
            if(pendingReq.callback){
                try{
                    var req = pendingReq.req || null;
                    pendingReq.callback.call(req,rsp);
                }
                catch (err){
                    //console.error("the ws response is not a valid rpc message",err);
                }

            }
        }
    };

    var hash = location.hash.substr(location.hash.lastIndexOf("#")+1);
    var hashParameters = parseParameters(hash);
    var port = hashParameters.port;
    var hostname = hashParameters.hostname;
    var app2AppLocalUrl = port && "ws://127.0.0.1:"+port+"/local/" || null;
    var app2AppRemoteUrl = port && hostname && "ws://"+hostname+":"+port+"/remote/" || null;
    var hbbtvCsManagerUrl = "ws://127.0.0.1:"+port+"/hbbtvmanager";
    var userAgent = navigator.userAgent;
    var appLaunchUrl = port && hostname && "http://"+hostname+":"+port+"/dial/apps/HbbTV" || null;
    var ws = null;
    var rpcCounter = 1;
    var pendingRpcRequests = {};
    var csLauncherCounter = 1;
    var discoveredLaunchers = {};
    var terminalCounter = 1;
    var discoveredTerminals = {};
    /**
     * Config is set after hbbtv is set
     */
    var config = null;
    /**
     * A DiscoveredTerminal object shall have the following properties:
     *  - readonly Number enum_id: A unique ID for a discovered HbbTV terminal
     *  - readonly String friendly_name: A discovered terminal may provide a friendly name, e.g. "Muttleys TV", for an HbbTV application to make use of.
     * 	- readonly String X_HbbTV_App2AppURL: The remote service endpoint on the discovered HbbTV terminal for application to application communication
     * 	- readonly String X_HbbTV_InterDevSyncURL: The remote service endpoint on the discovered HbbTV terminal for inter-device synchronisation
     * 	- readonly String X_HbbTV_UserAgent: The User Agent string of the discovered HbbTV terminal
     */
    var DiscoveredTerminal = function(enum_id, friendly_name, X_HbbTV_App2AppURL, X_HbbTV_InterDevSyncURL, X_HbbTV_UserAgent){
        Object.defineProperty(this, "enum_id", {
            get: function () {
                return enum_id;
            }
        });
        Object.defineProperty(this, "friendly_name", {
            get: function () {
                return friendly_name;
            }
        });
        Object.defineProperty(this, "X_HbbTV_App2AppURL", {
            get: function () {
                return X_HbbTV_App2AppURL;
            }
        });
        Object.defineProperty(this, "X_HbbTV_InterDevSyncURL", {
            get: function () {
                return X_HbbTV_InterDevSyncURL;
            }
        });
        Object.defineProperty(this, "X_HbbTV_UserAgent", {
            get: function () {
                return X_HbbTV_UserAgent;
            }
        });
    };
    /**
     * A DiscoveredCSLauncher object shall have the following properties:
     * 	- readonly Number enum_id: A unique ID for a CS Launcher Application
     * 	- readonly String friendly_name: A CS Launcher Application may provide a friendly name, e.g. "Muttleys Tablet", for an HbbTV application to make use of
     * 	- readonly String CS_OS_id: The CS OS identifier string, as described in clause 14.4.1 of the HbbTV 2.0 Spec
     */
    var DiscoveredCSLauncher = function(enum_id, friendly_name, CS_OS_id){
        Object.defineProperty(this, "enum_id", {
            get: function () {
                return enum_id;
            }
        });
        Object.defineProperty(this, "friendly_name", {
            get: function () {
                return friendly_name;
            }
        });
        Object.defineProperty(this, "CS_OS_id", {
            get: function () {
                return CS_OS_id;
            }
        });
    };


    /**
     * Boolean discoverCSLaunchers(function onCSDiscovery)
     * callback onCSDiscovery(Number enum_id, String friendly_name, String CS_OS_id )
     */
    var discoverCSLaunchers = function(onCSDiscovery){
        return sendRpcRequest({
            jsonrpc: "2.0",
            method: "discoverCSLaunchers",
            params: []
        }, function (rsp) {
            var csLaunchers = rsp.result;
            var res = [];
            for(var appUrl in csLaunchers){
                var oldLauncher = discoveredLaunchers[appUrl];
                var launcher = csLaunchers[appUrl];
                launcher.id = appUrl;
                var enumId = oldLauncher && oldLauncher.enum_id || csLauncherCounter++;
                var newCsLauncher = new DiscoveredCSLauncher(enumId, launcher.friendlyName, launcher.csOsId);
                discoveredLaunchers[appUrl] = newCsLauncher;
                discoveredLaunchers[enumId] = launcher;
                res.push(newCsLauncher);
            }
            onCSDiscovery && onCSDiscovery.call(null,res);
        });
    };

    /**
     * Boolean discoverTerminals(function onTerminalDiscovery)
     * callback onTerminalDiscovery (Number enum_id,String friendly_name,DiscoveredTerminalEndpoints endpoints )
     */
    var discoverTerminals = function(onTerminalDiscovery){
        return sendRpcRequest({
            jsonrpc: "2.0",
            method: "discoverTerminals",
            params: []
        }, function (rsp) {
            var terminals = rsp.result;
            var res = [];
            for(var appUrl in terminals){
                var oldTerminal = discoveredTerminals[appUrl];
                var terminal = terminals[appUrl];
                terminal.id = appUrl;
                var enumId = oldTerminal && oldTerminal.enumId || terminalCounter++;
                var newTerminal = new DiscoveredTerminal(enumId, terminal.friendlyName, terminal.app2AppURL, terminal.interDevSyncURL, terminal.userAgent);
                discoveredTerminals[appUrl] = newTerminal;
                discoveredTerminals[enumId] = terminal;
                res.push(newTerminal);
            }
            onTerminalDiscovery && onTerminalDiscovery.call(null,res);
        });
    };

    /**
     * Boolean launchCSApp(Integer enum_id, String payload, function onCSLaunch)
     * callback onCSLaunch(int enum_id, int error_code)
     * Error Codes Values:
     *	0: op_rejected
     *  2: op_not_guaranteed
     *  3: invalid_id
     *  4: general_error
     */
    var launchCSApp = function(enumId,payload,onCSLaunch){
        var csLauncher = discoveredLaunchers[enumId];
        var code = null;
        if(!csLauncher || typeof payload != "string"){
            code = 3;
            onCSLaunch && onCSLaunch.call(null,enumId,code);
            return false;
        }
        return sendRpcRequest({
            jsonrpc: "2.0",
            method: "launchCSApp",
            params: [csLauncher.id, payload]
        }, function (rsp) {
            var code = rsp.result;
            // TODO check code
            onCSLaunch && onCSLaunch.call(null,enumId,code);
        });
    };

    /**
     * Boolean launchHbbTVApp(Integer enum_id, Object options, function onCSLaunch)
     * callback onCSLaunch(int enum_id, int error_code)
     * Error Codes Values:
     *	0: op_rejected
     *  2: op_not_guaranteed
     *  3: invalid_id
     *  4: general_error
     */
    var launchHbbTVApp = function(enumId,options,onHbbTVLaunch){
        var terminal = discoveredTerminals[enumId];
        var code = null;
        if(!terminal){
            code = 3;
            onHbbTVLaunch && onHbbTVLaunch.call(null,enumId,code);
            return false;
        }
        return sendRpcRequest({
            jsonrpc: "2.0",
            method: "launchHbbTVApp",
            params: [terminal.id, options]
        }, function (rsp) {
            var code = rsp.result;
            // TODO
            onHbbTVLaunch && onHbbTVLaunch.call(null,enumId,code);
        });
    };

    /**
     * String getInterDevSyncURL()
     * Returns the URL of the CSS-CII service endpoint for the terminal that the calling HbbTV application is running on.
     */
    var getInterDevSyncURL =function(){
        // Construir URL del servei CSS-CII basat en app2AppRemoteUrl
        if (app2AppRemoteUrl) {
            // Convertir l'URL App2App en URL InterDevSync
            // Format: ws://hostname:port/remote/ -> ws://hostname:port/dvb-css/cii
            var baseUrl = app2AppRemoteUrl.replace(/\/remote\/?$/, '');
            var interDevSyncUrl = baseUrl + '/dvb-css/cii';
            console.log("HbbTVCSManager.getInterDevSyncURL:", interDevSyncUrl);
            return interDevSyncUrl;
        }
        console.warn("HbbTVCSManager.getInterDevSyncURL: app2AppRemoteUrl not available");
        return "";
    };

    /**
     * String getAppLaunchURL()
     * Returns the URL of the application launch service endpoint for the terminal that the calling HbbTV application is running on.
     */
    var getAppLaunchURL = function(){
        return appLaunchUrl;
    };

    /**
     * String getApp2AppLocalBaseURL()
     * Returns the base URL of the application to application communication service local endpoint.
     * The URL retrieved by this method shall end with a slash ('/') character.
     */
    var getApp2AppLocalBaseURL =function(){
        return app2AppLocalUrl;
    };

    /**
     * String getApp2AppRemoteBaseURL()
     * Returns the base URL of the application to application communication service remote endpoint.
     * The URL retrieved by this method shall end with a slash ('/') character
     */
    var getApp2AppRemoteBaseURL =function(){
        return app2AppRemoteUrl;
    };

    var HbbTVCSManager = function(){
        Object.defineProperty(this, "discoverCSLaunchers", {
            get: function () {
                return discoverCSLaunchers;
            }
        });

        Object.defineProperty(this, "discoverTerminals", {
            get: function () {
                return discoverTerminals;
            }
        });

        Object.defineProperty(this, "launchCSApp", {
            get: function () {
                return launchCSApp;
            }
        });

        Object.defineProperty(this, "launchHbbTVApp", {
            get: function () {
                return launchHbbTVApp;
            }
        });

        Object.defineProperty(this, "getInterDevSyncURL", {
            get: function () {
                return getInterDevSyncURL;
            }
        });

        Object.defineProperty(this, "getAppLaunchURL", {
            get: function () {
                return getAppLaunchURL;
            }
        });

        Object.defineProperty(this, "getApp2AppLocalBaseURL", {
            get: function () {
                return getApp2AppLocalBaseURL;
            }
        });

        Object.defineProperty(this, "getApp2AppRemoteBaseURL", {
            get: function () {
                return getApp2AppRemoteBaseURL;
            }
        });
    };

    var HbbTVTerminalManager = function(){
        Object.defineProperty(this, "discoverTerminals", {
            get: function () {
                return discoverTerminals;
            }
        });

        Object.defineProperty(this, "launchHbbTVApp", {
            get: function () {
                return launchHbbTVApp;
            }
        });
    };

    // ==================== MediaSynchroniser Implementation ====================
    // Implements the OIPF DAE MediaSynchroniser API for DVB-CSS inter-device sync
    // Based on HbbTV 2.0.4 specification sections 13.5 and 13.9
    
    var MediaSynchroniser = function() {
        var self = this;
        
        // Private state
        var _masterMedia = null;
        var _timelineSelector = null;
        var _contentId = null;
        var _initialized = false;
        var _interDevSyncEnabled = false;
        var _interDevSyncUrl = null;
        var _nrOfSlaves = 0;
        var _lastError = 0;
        var _lastErrorSource = null;
        var _slaves = [];
        
        // DVB-CSS server connections
        var _ciiServer = null;
        var _wcServer = null;
        var _tsServer = null;
        var _connectedClients = [];
        
        // Wall clock state
        var _wallClockOffset = 0;
        
        // Read-only properties
        // Flag to indicate this is the polyfill implementation, not native HbbTV
        Object.defineProperty(this, '_isPolyfill', {
            get: function() { return true; },
            enumerable: true
        });
        
        Object.defineProperty(this, 'nrOfSlaves', {
            get: function() { return _nrOfSlaves; }
        });
        
        Object.defineProperty(this, 'lastError', {
            get: function() { return _lastError; }
        });
        
        Object.defineProperty(this, 'lastErrorSource', {
            get: function() { return _lastErrorSource; }
        });
        
        Object.defineProperty(this, 'currentTime', {
            get: function() {
                if (_masterMedia && _masterMedia.currentTime !== undefined) {
                    return _masterMedia.currentTime;
                }
                return null;
            }
        });
        
        Object.defineProperty(this, 'interDevSyncEnabled', {
            get: function() { return _interDevSyncEnabled; }
        });
        
        // Event handlers (to be set by application)
        this.onSyncNowAchievable = null;
        this.onSyncNowUnachievable = null;
        this.onError = null;
        this.onInterDevSyncStatus = null;
        
        // CII state to broadcast
        var _ciiState = {
            protocolVersion: '1.1',
            contentId: null,
            contentIdStatus: 'stable',
            presentationStatus: 'okay',
            mrsUrl: null,
            wcUrl: null,
            tsUrl: null,
            teUrl: null,
            timelines: [],
            private: {}
        };
        
        // Initialize master media
        // void initMediaSynchroniser(MediaObject mediaObject, String timelineSelector)
        this.initMediaSynchroniser = function(mediaObject, timelineSelector) {
            console.log('MediaSynchroniser.initMediaSynchroniser:', timelineSelector);
            
            if (!mediaObject) {
                _lastError = 0; // Invalid media object
                _lastErrorSource = 'master';
                if (self.onError) self.onError(_lastError, _lastErrorSource);
                return;
            }
            
            _masterMedia = mediaObject;
            _timelineSelector = timelineSelector;
            _initialized = true;
            
            // Update CII state - contentId will come from the media source
            _ciiState.timelines = [{
                timelineSelector: timelineSelector,
                timelineProperties: {
                    unitsPerTick: 1,
                    unitsPerSecond: 90000 // PTS default
                }
            }];
            
            // Listen for media events
            setupMediaListeners();
            
            // Notify sync achievable
            if (self.onSyncNowAchievable) {
                self.onSyncNowAchievable(true);
            }
            
            console.log('MediaSynchroniser initialized with master media');
        };
        
        // Initialize with broadcast video (alternative method)
        this.initBroadcastMediaSynchroniser = function() {
            console.log('MediaSynchroniser.initBroadcastMediaSynchroniser');
            // For broadcast, we'd get the timeline from the broadcast signal
            // This is a simplified implementation
            _initialized = true;
            _timelineSelector = 'urn:dvb:css:timeline:temi:1:1';
        };
        
        // Add slave media (for multi-stream sync)
        this.addMediaObject = function(mediaObject, timelineSelector, correlationTimestamp, tolerance, multiDecoderMode) {
            console.log('MediaSynchroniser.addMediaObject');
            
            if (!_initialized) {
                _lastError = 4; // General error
                if (self.onError) self.onError(_lastError, 'slave');
                return false;
            }
            
            var slave = {
                media: mediaObject,
                timelineSelector: timelineSelector,
                correlation: correlationTimestamp,
                tolerance: tolerance || 50,
                multiDecoder: multiDecoderMode || 'seamless'
            };
            
            _slaves.push(slave);
            _nrOfSlaves = _slaves.length;
            
            return true;
        };
        
        // Remove slave media
        this.removeMediaObject = function(mediaObject) {
            // Check if it's the master media
            if (mediaObject === _masterMedia) {
                console.log('MediaSynchroniser.removeMediaObject: removing master media');
                removeMediaListeners();
                _masterMedia = null;
                _initialized = false;
                // Also clear all slaves
                _slaves = [];
                _nrOfSlaves = 0;
                return true;
            }
            // Otherwise check slaves
            var idx = _slaves.findIndex(function(s) { return s.media === mediaObject; });
            if (idx >= 0) {
                _slaves.splice(idx, 1);
                _nrOfSlaves = _slaves.length;
                return true;
            }
            return false;
        };
        
        // Enable inter-device synchronization (DVB-CSS server)
        // HbbTV API: void enableInterDeviceSync(function callback)
        // callback is called when endpoints are operable
        this.enableInterDeviceSync = function(callback) {
            console.log('MediaSynchroniser.enableInterDeviceSync');
            
            if (!_initialized) {
                console.error('MediaSynchroniser not initialized');
                return;
            }
            
            _interDevSyncEnabled = true;
            
            // Start DVB-CSS servers via App2App
            startDVBCSSServers();
            
            // Update status
            if (self.onInterDevSyncStatus) {
                self.onInterDevSyncStatus(1); // connecting
            }
            
            // Call callback when endpoints are ready (simulate small delay)
            if (callback && typeof callback === 'function') {
                setTimeout(function() {
                    if (self.onInterDevSyncStatus) {
                        self.onInterDevSyncStatus(2); // connected
                    }
                    callback();
                }, 100);
            }
        };
        
        // Disable inter-device synchronization
        this.disableInterDevSync = function() {
            console.log('MediaSynchroniser.disableInterDevSync');
            _interDevSyncEnabled = false;
            
            // Close all client connections
            _connectedClients.forEach(function(client) {
                if (client.ws && client.ws.readyState === WebSocket.OPEN) {
                    client.ws.close();
                }
            });
            _connectedClients = [];
            _nrOfSlaves = 0;
            
            if (self.onInterDevSyncStatus) {
                self.onInterDevSyncStatus(0); // disconnected
            }
        };
        
        // Update correlation timestamp
        this.updateCorrelationTimestamp = function(mediaObject, correlationTimestamp) {
            var slave = _slaves.find(function(s) { return s.media === mediaObject; });
            if (slave) {
                slave.correlation = correlationTimestamp;
                return true;
            }
            return false;
        };
        
        // Set content time and speed
        this.setContentTime = function(contentTime, speed) {
            if (_masterMedia) {
                _masterMedia.currentTime = contentTime;
                if (speed !== undefined) {
                    _masterMedia.playbackRate = speed;
                }
            }
            broadcastControlTimestamp();
        };
        
        // Get current content time in ticks
        this.getContentTime = function() {
            if (_masterMedia) {
                return Math.floor(_masterMedia.currentTime * 90000);
            }
            return 0;
        };
        
        // Named listener references for cleanup
        var _mediaListeners = {};

        // Private: Remove media event listeners
        function removeMediaListeners() {
            if (!_masterMedia || !_mediaListeners._attached) return;
            
            _masterMedia.removeEventListener('play', _mediaListeners.play);
            _masterMedia.removeEventListener('pause', _mediaListeners.pause);
            _masterMedia.removeEventListener('seeking', _mediaListeners.seeking);
            _masterMedia.removeEventListener('seeked', _mediaListeners.seeked);
            _masterMedia.removeEventListener('ended', _mediaListeners.ended);
            _masterMedia.removeEventListener('error', _mediaListeners.error);
            _mediaListeners._attached = false;
            
            console.log('MediaSynchroniser: media listeners removed');
        }

        // Private: Setup media event listeners
        function setupMediaListeners() {
            if (!_masterMedia) return;
            
            // Remove previous listeners if any
            removeMediaListeners();
            
            _mediaListeners.play = function() {
                updateCIIPresentationStatus('okay');
                broadcastControlTimestamp();
            };
            
            _mediaListeners.pause = function() {
                broadcastControlTimestamp();
            };
            
            _mediaListeners.seeking = function() {
                updateCIIPresentationStatus('transitioning');
            };
            
            _mediaListeners.seeked = function() {
                updateCIIPresentationStatus('okay');
                broadcastControlTimestamp();
            };
            
            _mediaListeners.ended = function() {
                updateCIIPresentationStatus('finished');
                broadcastControlTimestamp();
            };
            
            _mediaListeners.error = function() {
                updateCIIPresentationStatus('fault');
                if (self.onSyncNowUnachievable) {
                    self.onSyncNowUnachievable(true);
                }
            };
            
            _masterMedia.addEventListener('play', _mediaListeners.play);
            _masterMedia.addEventListener('pause', _mediaListeners.pause);
            _masterMedia.addEventListener('seeking', _mediaListeners.seeking);
            _masterMedia.addEventListener('seeked', _mediaListeners.seeked);
            _masterMedia.addEventListener('ended', _mediaListeners.ended);
            _masterMedia.addEventListener('error', _mediaListeners.error);
            _mediaListeners._attached = true;
        }
        
        // Private: Start DVB-CSS servers using App2App WebSocket
        function startDVBCSSServers() {
            if (!app2AppLocalUrl) {
                console.error('App2App local URL not available');
                return;
            }
            
            // Update CII with server URLs
            var baseRemoteUrl = app2AppRemoteUrl ? app2AppRemoteUrl.replace(/\/$/, '') : '';
            _ciiState.wcUrl = baseRemoteUrl + 'dvbcss-wc';
            _ciiState.tsUrl = baseRemoteUrl + 'dvbcss-ts';
            
            // Start CII server (Content Identification and Information)
            startCIIServer();
            
            // Start WC server (Wall Clock)
            startWCServer();
            
            // Start TS server (Timeline Synchronisation)
            startTSServer();
            
            console.log('DVB-CSS servers started');
            
            if (self.onInterDevSyncStatus) {
                self.onInterDevSyncStatus(2); // connected
            }
        }
        
        // CII Server
        function startCIIServer() {
            var channel = 'dvbcss-cii';
            createServerEndpoint(channel, 'cii', function(ws, data) {
                // Send current CII state to new client
                console.log('CII: Sending state to client');
                ws.send(JSON.stringify(_ciiState));
            });
        }
        
        // Wall Clock Server
        function startWCServer() {
            var channel = 'dvbcss-wc';
            createServerEndpoint(channel, 'wc', function(ws, data) {
                try {
                    var request = JSON.parse(data);
                    
                    // Only respond to WC requests (type = 0)
                    if (request.t === 0) {
                        var now = getWallClockNanos();
                        
                        var response = {
                            v: 0,
                            t: 1, // Response type
                            p: request.p,
                            mfe: request.mfe,
                            id: request.id,
                            ot: request.ot,
                            rt: now,
                            tt: now + 1000 // Small delta for transmit
                        };
                        
                        ws.send(JSON.stringify(response));
                    }
                } catch (e) {
                    console.error('WC: Error processing request:', e);
                }
            });
        }
        
        // Timeline Sync Server
        function startTSServer() {
            var channel = 'dvbcss-ts';
            createServerEndpoint(channel, 'ts', function(ws, data) {
                if (data) {
                    try {
                        var setup = JSON.parse(data);
                        console.log('TS: Setup received:', setup);
                        ws.timelineSelector = setup.timelineSelector;
                    } catch (e) {
                        // Not setup, might be acknowledgement
                    }
                }
                
                // Send control timestamp
                sendControlTimestamp(ws);
            });
        }
        
        // Create server endpoint using App2App
        function createServerEndpoint(channel, serverType, messageHandler) {
            var wsUrl = app2AppLocalUrl + channel;
            
            function createConnection() {
                var ws = new WebSocket(wsUrl);
                
                ws.onopen = function() {
                    console.log(serverType.toUpperCase() + ': Waiting for clients...');
                };
                
                ws.onclose = function() {
                    // Remove from connected clients
                    var idx = _connectedClients.findIndex(function(c) { return c.ws === ws; });
                    if (idx >= 0) {
                        _connectedClients.splice(idx, 1);
                        updateSlaveCount();
                    }
                    
                    // Recreate connection to accept more clients
                    if (_interDevSyncEnabled) {
                        setTimeout(createConnection, 100);
                    }
                };
                
                ws.onerror = function(e) {
                    console.error(serverType.toUpperCase() + ': Error:', e);
                };
                
                ws.onmessage = function(evt) {
                    if (evt.data === 'pairingcompleted') {
                        console.log(serverType.toUpperCase() + ': Client paired');
                        
                        _connectedClients.push({
                            ws: ws,
                            type: serverType,
                            timelineSelector: _timelineSelector
                        });
                        
                        updateSlaveCount();
                        
                        // Set up message handler for paired connection
                        ws.onmessage = function(evt2) {
                            messageHandler(ws, evt2.data);
                        };
                        
                        // Send initial state
                        messageHandler(ws, null);
                        
                        // Create another listener for more clients
                        if (_interDevSyncEnabled) {
                            setTimeout(createConnection, 100);
                        }
                    } else {
                        // Not pairing message, close
                        ws.close();
                    }
                };
            }
            
            createConnection();
        }
        
        // Update slave count based on TS clients
        function updateSlaveCount() {
            var tsClients = _connectedClients.filter(function(c) { return c.type === 'ts'; });
            _nrOfSlaves = tsClients.length;
            console.log('MediaSynchroniser: nrOfSlaves =', _nrOfSlaves);
        }
        
        // Get wall clock time in nanoseconds
        function getWallClockNanos() {
            return Math.floor((performance.now() + performance.timeOrigin) * 1000000);
        }
        
        // Get media time in PTS ticks
        function getMediaTimeTicks() {
            if (!_masterMedia) return 0;
            return Math.floor(_masterMedia.currentTime * 90000);
        }
        
        // Update CII presentation status
        function updateCIIPresentationStatus(status) {
            if (_ciiState.presentationStatus !== status) {
                _ciiState.presentationStatus = status;
                broadcastCII();
            }
        }
        
        // Broadcast CII to all CII clients
        function broadcastCII() {
            var ciiClients = _connectedClients.filter(function(c) { return c.type === 'cii'; });
            var message = JSON.stringify(_ciiState);
            
            ciiClients.forEach(function(client) {
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.send(message);
                }
            });
        }
        
        // Send control timestamp to a TS client
        function sendControlTimestamp(ws) {
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            
            var ct = {
                contentTime: getMediaTimeTicks(),
                wallClockTime: getWallClockNanos(),
                timelineSpeedMultiplier: (_masterMedia && !_masterMedia.paused) ? _masterMedia.playbackRate : 0
            };
            
            ws.send(JSON.stringify(ct));
        }
        
        // Broadcast control timestamp to all TS clients
        function broadcastControlTimestamp() {
            var tsClients = _connectedClients.filter(function(c) { return c.type === 'ts'; });
            
            tsClients.forEach(function(client) {
                sendControlTimestamp(client.ws);
            });
        }
    };

    // Helper function to safely add polyfill methods without overwriting native implementations
    function ensureOipfObjectFactory() {
        try {
            if (typeof window.oipfObjectFactory === 'undefined') {
                window.oipfObjectFactory = {};
                return true; // Created new polyfill factory
            }
            return false; // Native factory exists
        } catch (e) {
            console.warn('Cannot set oipfObjectFactory, using existing native implementation:', e.message);
            return false;
        }
    }
    
    function addPolyfillMethod(methodName, polyfillFn) {
        try {
            if (typeof window.oipfObjectFactory[methodName] !== 'function') {
                window.oipfObjectFactory[methodName] = polyfillFn;
                console.log('Polyfill: Added ' + methodName);
            } else {
                console.log('Polyfill: ' + methodName + ' already exists (native), skipping');
            }
        } catch (e) {
            console.warn('Cannot add polyfill method ' + methodName + ':', e.message);
        }
    }

    if(port && hostname){
        // Check if native oipfObjectFactory exists
        var isPolyfillFactory = ensureOipfObjectFactory();
        
        // Only add polyfill methods if they don't already exist (native takes priority)
        addPolyfillMethod('createCSManager', function(){
            return new HbbTVCSManager();
        });
        
        // Add MediaSynchroniser factory method
        addPolyfillMethod('createMediaSynchroniser', function(){
            return new MediaSynchroniser();
        });
        
        // Only override isObjectSupported if we created the factory or method doesn't exist
        try {
            var oldIsObjectSupported = window.oipfObjectFactory.isObjectSupported;
            window.oipfObjectFactory.isObjectSupported = function(mimeType){
                if(mimeType == "application/hbbtvCSManager"){
                    return true;
                }
                else if(mimeType == "application/hbbtvMediaSynchroniser"){
                    return true;
                }
                else {
                    return oldIsObjectSupported && oldIsObjectSupported.apply(this, arguments);
                }
            };
        } catch (e) {
            console.warn('Cannot override isObjectSupported:', e.message);
        }
        
        connect();
    }
    else if(port){
        window.hbbtv = window.hbbtv || {};
        window.hbbtv.createTerminalManager = function(){
            return new HbbTVTerminalManager();
        };
        
        // Also create MediaSynchroniser for CS apps
        ensureOipfObjectFactory();
        addPolyfillMethod('createMediaSynchroniser', function(){
            return new MediaSynchroniser();
        });
        
        connect();
    }
    else {
        console.warn("hash parameters 'port' and/or 'hostname' are not detected. " +
                     "hbbtv-manager-polyfill.js can be used in HbbTV Apps when the hash " +
                     "parameters 'port' and 'hostname' are specified and in CS Web Apps " +
                     "when only the 'port' hash parameter is specified. These parameters " +
                     "will be automatically set when the HbbTV App is launched through the " +
                     "HbbTVDialServer or the CS Web App is launched through the CsLauncherDialServer. " +
                     "The hash parameters needs to be set manually if the application is launched by the user.");
        
        // Still provide MediaSynchroniser for testing without hash params
        ensureOipfObjectFactory();
        addPolyfillMethod('createMediaSynchroniser', function(){
            return new MediaSynchroniser();
        });
        addPolyfillMethod('createCSManager', function(){
            return new HbbTVCSManager();
        });
    }
})();
