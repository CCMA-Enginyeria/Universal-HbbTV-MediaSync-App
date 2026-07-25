(function () {
  'use strict';

  var video = document.getElementById('tv-video');
  var programmePoster = document.getElementById('programme-poster');
  var emptyState = document.getElementById('video-empty');
  var catalogElement = document.getElementById('catalog');
  var contentIdElement = document.getElementById('content-id');
  var modeLabel = document.getElementById('mode-label');
  var connectionStatus = document.getElementById('connection-status');
  var player = null;
  var currentContentId = null;
  var currentContentIdOverride = null;
  var updateTimer = null;

  function request(url, options) {
    return fetch(url, options).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }

  function postState(patch) {
    return request('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  function setMode(mode) {
    document.querySelectorAll('[data-mode]').forEach(function (button) {
      button.classList.toggle('active', button.getAttribute('data-mode') === mode);
    });
    modeLabel.textContent = mode === 'compat' ? 'App2App compatibility' : 'Native DVB-CSS';
    postState({ mode: mode });
  }

  function updateCompanionContent(state) {
    currentContentIdOverride = state.contentIdOverride || null;
    contentIdElement.textContent = state.announcedContentId || state.contentId || 'No content selected';
    document.getElementById('companion-source-mode').textContent = currentContentIdOverride
      ? 'Using a custom companion URL'
      : 'Following TV content';
    document.getElementById('companion-reset').disabled = !currentContentIdOverride;
  }

  function loadContent(contentId, autoPlay, poster) {
    if (!contentId) return;
    currentContentId = contentId;
    updateCompanionContent({
      contentId: contentId,
      contentIdOverride: currentContentIdOverride,
      announcedContentId: currentContentIdOverride || contentId,
    });
    emptyState.classList.add('hidden');
    video.poster = poster || '';
    programmePoster.src = poster || '';
    programmePoster.classList.toggle('hidden', !poster);
    document.querySelectorAll('.programme').forEach(function (button) {
      button.classList.toggle('active', button.getAttribute('data-content-id') === contentId);
    });

    if (player) player.reset();
    player = dashjs.MediaPlayer().create();
    player.initialize(video, contentId, !!autoPlay);
    postState({ contentId: contentId, positionSeconds: 0, paused: !autoPlay, playbackRate: 1 })
      .then(updateCompanionContent)
      .catch(function () {});
  }

  function renderCatalog(items) {
    catalogElement.innerHTML = '';
    items.forEach(function (item) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'programme';
      button.setAttribute('data-content-id', item.contentId);
      button.innerHTML = '<strong></strong><span></span>';
      button.querySelector('strong').textContent = item.title;
      button.querySelector('span').textContent = item.description;
      button.addEventListener('click', function () { loadContent(item.contentId, true, item.poster); });
      catalogElement.appendChild(button);
    });
  }

  function updateStatus(state) {
    document.getElementById('cii-count').textContent = state.connections.cii;
    document.getElementById('wc-count').textContent = state.connections.wc;
    document.getElementById('ts-count').textContent = state.connections.ts;
    var connected = state.connections.cii > 0 || state.connections.wc > 0 || state.connections.ts > 0;
    connectionStatus.textContent = connected ? 'Companion connected' : 'Waiting for a companion';
    connectionStatus.classList.toggle('connected', connected);
  }

  function pushPlaybackState() {
    if (!currentContentId) return;
    postState({
      contentId: currentContentId,
      positionSeconds: video.currentTime || 0,
      paused: video.paused,
      playbackRate: video.playbackRate || 1,
    }).catch(function () {});
  }

  ['play', 'pause', 'seeked', 'ratechange', 'ended'].forEach(function (eventName) {
    video.addEventListener(eventName, pushPlaybackState);
  });
  ['loadeddata', 'playing'].forEach(function (eventName) {
    video.addEventListener(eventName, function () { programmePoster.classList.add('hidden'); });
  });
  video.addEventListener('error', function () {
    if (programmePoster.src) programmePoster.classList.remove('hidden');
  });

  document.querySelectorAll('[data-mode]').forEach(function (button) {
    button.addEventListener('click', function () { setMode(button.getAttribute('data-mode')); });
  });

  document.getElementById('custom-form').addEventListener('submit', function (event) {
    event.preventDefault();
    loadContent(document.getElementById('custom-url').value.trim(), true, '');
  });

  document.getElementById('companion-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var contentIdOverride = document.getElementById('companion-url').value.trim();
    postState({ contentIdOverride: contentIdOverride })
      .then(updateCompanionContent)
      .catch(function () {});
  });

  document.getElementById('companion-reset').addEventListener('click', function () {
    postState({ contentIdOverride: null })
      .then(function (state) {
        document.getElementById('companion-url').value = '';
        updateCompanionContent(state);
      })
      .catch(function () {});
  });

  setInterval(function () {
    document.getElementById('clock').textContent = new Date().toLocaleTimeString();
  }, 1000);

  request('/api/state').then(function (state) {
    renderCatalog(state.catalog);
    setMode(state.mode);
    updateStatus(state);
    updateCompanionContent(state);
    document.getElementById('companion-url').value = state.contentIdOverride || '';
    var selected = state.catalog.find(function (item) { return item.contentId === state.contentId; });
    loadContent(state.contentId, false, selected && selected.poster);
    updateTimer = setInterval(pushPlaybackState, 1000);
    setInterval(function () {
      request('/api/state').then(updateStatus).catch(function () {});
    }, 1500);
  }).catch(function (err) {
    emptyState.textContent = 'Could not load emulator state: ' + err.message;
  });

  window.addEventListener('beforeunload', function () {
    if (updateTimer) clearInterval(updateTimer);
    if (navigator.sendBeacon && currentContentId) {
      navigator.sendBeacon('/api/state', JSON.stringify({ paused: true, positionSeconds: video.currentTime || 0 }));
    }
  });
})();