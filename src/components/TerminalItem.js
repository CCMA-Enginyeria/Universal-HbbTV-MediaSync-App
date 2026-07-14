import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  AppState,
  Alert,
  Modal,
} from 'react-native';
import Slider from '@react-native-community/slider';
import Video from 'react-native-video';
import { WebView } from 'react-native-webview';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useTranslation } from 'react-i18next';
import { MediaSyncService, SyncState } from '../services/MediaSyncService';
import MpdParserService from '../services/MpdParserService';
import config from '../utils/config';
import SyncController from '../utils/SyncController';
import { fetchWebMetadata } from '../utils/webMetadata';
import theme from '../theme';
import { MaterialIcons } from '@expo/vector-icons';
import StatusSlot from './StatusSlot';
import { startForegroundSync, stopForegroundSync, addHeartbeatListener, addStopListener } from '../utils/ForegroundSync';
import brand from '../brand/brand.config';
import { requestCameraPermission } from '../utils/CameraPermissions';

// Minimum interval (ms) between two drift corrections for the same player. The
// predictive controller is fed from two paths — the player `onProgress`
// (primary, foreground) and the `position-update` event (background-safe, since
// control timestamps wake JS even when timers freeze). This throttle
// de-duplicates overlapping calls without dropping legitimate onProgress samples.
const MIN_CORRECTION_INTERVAL_MS = config.MEDIA_SYNC?.SYNC_MIN_CORRECTION_INTERVAL_MS ?? 80;

// When true, the drift control loop logs its inputs/decision to the console so
// the sync behaviour can be diagnosed on-device. Toggle via config.MEDIA_SYNC.DEBUG_SYNC.
const DEBUG_SYNC = config.MEDIA_SYNC?.DEBUG_SYNC ?? false;

// Tuning for the predictive sync controller, read from config so the
// precision/battery trade-off can be adjusted without touching the logic.
const SYNC_CONTROLLER_OPTIONS = {
  emaAlpha: config.MEDIA_SYNC?.SYNC_EMA_ALPHA ?? 0.4,
  enterBandS: config.MEDIA_SYNC?.SYNC_ENTER_BAND_S ?? 0.06,
  exitBandS: config.MEDIA_SYNC?.SYNC_EXIT_BAND_S ?? 0.02,
  horizonS: config.MEDIA_SYNC?.SYNC_HORIZON_S ?? 3.0,
  deadTimeS: config.MEDIA_SYNC?.SYNC_DEAD_TIME_S ?? 0.35,
  maxRateDelta: config.MEDIA_SYNC?.SYNC_MAX_RATE_DELTA ?? 0.05,
  rateEps: config.MEDIA_SYNC?.SYNC_RATE_EPS ?? 0.002,
};

// Cadència d'enviament de correccions de sincronització a la web companion. La
// web porta el seu propi rellotge i interpola entre missatges, de manera que no
// cal inundar-la amb post-messages: només li enviem una correcció periòdica (o
// immediata quan canvia l'estat de reproducció / la velocitat).
const WEB_FEED_INTERVAL_MS = 1000;

// El contentId (contentIdOverride) pot apuntar a un MPD DASH o, alternativament,
// a una web companion (.html) que s'ha de carregar a pantalla completa en un
// WebView i alimentar amb la sincronització via post-messages, en comptes de
// parsejar un MPD. Detectem el cas web per l'extensió de la URL.
const isWebContent = (url) =>
  typeof url === 'string' && /\.html?(\?|#|$)/i.test(url);

export default function TerminalItem({ terminal, onPress, expanded, onToggleExpand }) {
  const { t } = useTranslation();
  const [syncState, setSyncState] = useState(SyncState.DISCONNECTED);
  const [audios, setAudios] = useState([]);
  const [videos, setVideos] = useState([]);
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [audioRate, setAudioRate] = useState(1.0);
  const [videoRate, setVideoRate] = useState(1.0);
  const [volume, setVolume] = useState(1);
  const [position, setPosition] = useState(null);
  const [streamInfo, setStreamInfo] = useState(null);
  const [mpdUrl, setMpdUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  // Contingut web companion: quan la TV envia una URL .html com a contentId,
  // en comptes de parsejar un MPD mostrem una targeta i, en obrir-la, carreguem
  // la web a pantalla completa dins d'un WebView alimentat amb la sincronització.
  const [companionWebUrl, setCompanionWebUrl] = useState(null);
  const [webModalVisible, setWebModalVisible] = useState(false);
  // Metadata (title + favicon) of the companion web page, fetched from its HTML
  // so the user recognizes what the synchronized content is instead of seeing a
  // generic globe icon. Both null while loading or on failure (UI falls back).
  const [webPageTitle, setWebPageTitle] = useState(null);
  const [webFaviconUrl, setWebFaviconUrl] = useState(null);
  // Quan, amb la web oberta, arriba un nou contentId que NO és una web, avisem
  // l'usuari que ja no hi ha contingut web sincronitzat i el deixem tancar.
  const [webNoContent, setWebNoContent] = useState(false);
  // Intención de reproducción activa: recuerda el componente (audio/vídeo) que
  // el usuario está reproduciendo para poder reanudarlo automáticamente cuando
  // se carga un nuevo MPD (reconexión o cambio de contenido). Se identifica por
  // idioma (iso) + role, ya que el índice de pista puede variar entre MPDs.
  // También mantiene vivo el foreground service durante la ventana de
  // reconexión para que la reanudación funcione con la app en segundo plano.
  const [playbackIntent, setPlaybackIntent] = useState(null);

  const syncServiceRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const videoPlayerRef = useRef(null);
  const audioCurrentTimeRef = useRef(0);
  const audioCurrentPlaybackTimeRef = useRef(0);
  const videoCurrentTimeRef = useRef(0);
  const videoCurrentPlaybackTimeRef = useRef(0);
  const lastSyncTimeRef = useRef(0);
  const lastVideoSyncTimeRef = useRef(0);
  const lastContentIdRef = useRef(null);
  // Predictive drift controllers (one per companion player). Kept in refs so the
  // imperative correction loop can reach them without re-creating them on render.
  const audioSyncControllerRef = useRef(null);
  const videoSyncControllerRef = useRef(null);
  if (!audioSyncControllerRef.current) audioSyncControllerRef.current = new SyncController(SYNC_CONTROLLER_OPTIONS);
  if (!videoSyncControllerRef.current) videoSyncControllerRef.current = new SyncController(SYNC_CONTROLLER_OPTIONS);
  // Throttle for the diagnostic sync log (per player).
  const lastDebugLogRef = useRef({ audio: 0, video: 0 });
  // Latest sync status per player, written by the drift controller so the UI
  // badge reflects the controller's real decision (filtered drift + mode)
  // instead of recomputing a separate, noisier raw-drift heuristic.
  const lastSyncInfoRef = useRef({ audio: null, video: null });
  // Estado de pantalla completa y reentrada pendiente: cuando la TV cambia de
  // contenido mientras el vídeo está en fullscreen, el componente <Video> se
  // remonta (key={mpdUrl}) y el reproductor fullscreen nativo del componente
  // antiguo se queda congelado encima. Cerramos el fullscreen antes del remontaje
  // y lo volvemos a presentar al cargar el nuevo MPD.
  const isFullscreenRef = useRef(false);
  const pendingFullscreenRef = useRef(false);
  const mpdUrlRef = useRef(null);
  const connectTimeoutRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const setupAndConnectRef = useRef(null);
  const isActiveRef = useRef(false);
  // WebView de la web companion i miralls d'estat (per usar-los dins de handlers
  // sense closures obsoletos).
  const webViewRef = useRef(null);
  const companionWebUrlRef = useRef(null);
  const webModalVisibleRef = useRef(false);
  // Throttle de l'aliment a la web companion (veure WEB_FEED_INTERVAL_MS).
  const lastWebFeedRef = useRef(0);
  const lastWebFeedStateRef = useRef({ isPlaying: null, speed: null });
  // Momento del último intento de reconexión disparado por el heartbeat nativo
  // (para no reintentar más a menudo que RETRY_DELAY en segundo plano).
  const lastReconnectAttemptRef = useRef(0);

  // Live mirrors of state used inside the AppState listener (avoids stale closures).
  const positionRef = useRef(null);
  const streamInfoRef = useRef(null);
  const selectedAudioRef = useRef(null);
  const selectedVideoRef = useRef(null);
  positionRef.current = position;
  streamInfoRef.current = streamInfo;
  selectedAudioRef.current = selectedAudio;
  selectedVideoRef.current = selectedVideo;
  const syncStateRef = useRef(SyncState.DISCONNECTED);
  syncStateRef.current = syncState;
  // Espejo de la intención de reproducción para poder leerla desde `loadMpd`
  // (useCallback con deps vacías) sin closures obsoletos.
  const playbackIntentRef = useRef(null);
  playbackIntentRef.current = playbackIntent;

  // Espejos de props usados por `stopEverything` (invocado desde el listener de
  // la acción de la notificación) para colapsar el terminal sin closures obsoletos.
  const onToggleExpandRef = useRef(onToggleExpand);
  onToggleExpandRef.current = onToggleExpand;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  // Mirrors adicionales usados por el corrector imperativo (sincronización en
  // background): permiten aplicar la corrección al player desde el handler del
  // evento `position-update`, sin depender del ciclo setState/useEffect que en
  // segundo plano puede no ejecutarse con la cadencia esperada.
  const audioPlayingRef = useRef(false);
  const videoPlayingRef = useRef(false);
  const audioRateRef = useRef(1.0);
  const videoRateRef = useRef(1.0);
  audioPlayingRef.current = audioPlaying;
  videoPlayingRef.current = videoPlaying;
  audioRateRef.current = audioRate;
  videoRateRef.current = videoRate;
  companionWebUrlRef.current = companionWebUrl;
  webModalVisibleRef.current = webModalVisible;

  // Fetch the companion web page's title and favicon whenever its URL changes so
  // the card can show what the synchronized content is. The request is aborted
  // if the URL changes again or the component unmounts.
  useEffect(() => {
    if (!companionWebUrl) {
      setWebPageTitle(null);
      setWebFaviconUrl(null);
      return;
    }
    const controller = new AbortController();
    fetchWebMetadata(companionWebUrl, { signal: controller.signal }).then(({ title, faviconUrl }) => {
      if (controller.signal.aborted) return;
      setWebPageTitle(title);
      setWebFaviconUrl(faviconUrl);
    });
    return () => controller.abort();
  }, [companionWebUrl]);

  // Marca que el player fue pausado de forma imperativa (al cerrarse la
  // conexión). Sirve para reanudarlo también de forma imperativa cuando vuelve
  // a haber posición en reproducción, ya que en background el cambio
  // declarativo del prop `paused` puede no aplicarse de forma fiable.
  const audioPausedImperativelyRef = useRef(false);
  const videoPausedImperativelyRef = useRef(false);

  // Animation refs for wave bars
  const waveBarAnimsRef = useRef([...Array(4)].map(() => new Animated.Value(1)));
  const animationRef = useRef(null);

  const hasMediaSync = terminal.hasMediaSyncCapability && terminal.hasMediaSyncCapability();

  // Function to animate wave bars
  const animateWaveBars = useCallback(() => {
    if (!audioPlaying) return;

    const animations = waveBarAnimsRef.current.map(() => {
      const randomScale = 0.4 + Math.random() * 0.6; // Random value between 0.4 and 1.0
      return Animated.timing(
        new Animated.Value(1),
        {
          toValue: randomScale,
          duration: 300 + Math.random() * 200, // 300-500ms
          useNativeDriver: false,
        }
      );
    });

    // Apply animations to each bar
    waveBarAnimsRef.current.forEach((anim, index) => {
      const randomScale = 0.4 + Math.random() * 0.6;
      Animated.timing(anim, {
        toValue: randomScale,
        duration: 300 + Math.random() * 200,
        useNativeDriver: false,
      }).start();
    });
  }, [audioPlaying]);

  // Control wave animation based on audioPlaying state
  useEffect(() => {
    if (audioPlaying && selectedAudio) {
      // Start continuous animation loop
      const startAnimation = () => {
        animateWaveBars();
        animationRef.current = setTimeout(startAnimation, 400 + Math.random() * 100);
      };
      startAnimation();

      return () => {
        if (animationRef.current) {
          clearTimeout(animationRef.current);
        }
      };
    } else {
      // Reset bars to initial state when not playing
      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }
      waveBarAnimsRef.current.forEach((anim) => {
        anim.setValue(1);
      });
    }
  }, [audioPlaying, selectedAudio, animateWaveBars]);

  const RETRY_DELAY = 5000;

  const getErrorMessage = useCallback((err) => {
    if (err && typeof err.message === 'string' && err.message.trim()) {
      return err.message;
    }
    return t('discovery.connectionError');
  }, [t]);

  // Fine drift correction for one companion player, driven by the shared
  // predictive controller (see src/utils/SyncController.js). Reads the freshest
  // player time from the onProgress refs and re-extrapolates the TV timeline on
  // demand so measurement and target are sampled at the same instant. Called
  // from the player `onProgress` (primary, high cadence) and from the
  // `position-update` handler (background-safe fallback); a short min-interval
  // throttle de-duplicates overlapping calls.
  const runDriftCorrection = useCallback((kind) => {
    const service = syncServiceRef.current;
    if (!service) return;

    const isAudio = kind === 'audio';
    const playerRef = isAudio ? audioPlayerRef : videoPlayerRef;
    const controller = isAudio ? audioSyncControllerRef.current : videoSyncControllerRef.current;
    const playingRef = isAudio ? audioPlayingRef : videoPlayingRef;
    const rateRef = isAudio ? audioRateRef : videoRateRef;
    const setRate = isAudio ? setAudioRate : setVideoRate;
    const currentTimeRef = isAudio ? audioCurrentTimeRef : videoCurrentTimeRef;
    const playbackTimeRef = isAudio ? audioCurrentPlaybackTimeRef : videoCurrentPlaybackTimeRef;
    const lastRef = isAudio ? lastSyncTimeRef : lastVideoSyncTimeRef;

    if (!controller || !playerRef.current || !playingRef.current) return;

    const now = Date.now();
    if (now - lastRef.current < MIN_CORRECTION_INTERVAL_MS) return;

    const pos = service.getCurrentPosition?.();
    if (!pos || pos.positionSeconds == null || !pos.isPlaying) return;

    const isLive = !!streamInfoRef.current?.isLive;
    if (isLive && playbackTimeRef.current === 0) return;

    const tvTime = (isLive && pos.exoPlayerPositionSeconds != null)
      ? pos.exoPlayerPositionSeconds
      : pos.positionSeconds;
    const playerTime = isLive ? playbackTimeRef.current : currentTimeRef.current;

    lastRef.current = now;

    const result = controller.update({
      playerTime,
      tvTime,
      seekThresholdS: isLive ? 5 : 2,
    });

    // Publish the controller's real decision for the UI badge (filtered drift +
    // mode), so the on-screen status matches what the controller is actually
    // doing instead of flickering on raw measurement noise.
    lastSyncInfoRef.current[kind] = {
      status: result.action === 'seek'
        ? 'seeking'
        : (controller.mode === 'correcting' ? 'adjusting' : 'locked'),
      driftMs: Math.round(result.filteredDrift * 1000),
      rate: controller.currentRate,
      at: now,
    };

    if (DEBUG_SYNC) {
      const dbg = lastDebugLogRef.current;
      if (now - dbg[kind] >= 250) {
        dbg[kind] = now;
        const appliedRate = result.action === 'rate' ? result.rate : rateRef.current;
        const wcDisp = service.wcService?.getDispersionMillis?.();
        console.log(
          `🎯 sync[${kind}] drift=${(result.drift * 1000).toFixed(0)}ms ` +
          `filt=${(result.filteredDrift * 1000).toFixed(0)}ms ` +
          `tv=${tvTime.toFixed(3)}s player=${playerTime.toFixed(3)}s ` +
          `rate=${appliedRate.toFixed(3)} act=${result.action} ` +
          `spd=${pos.speed}` +
          (wcDisp != null && isFinite(wcDisp) ? ` wcDisp=${wcDisp.toFixed(0)}ms` : '')
        );
      }
    }

    if (result.action === 'seek') {
      const seekTarget = isLive ? currentTimeRef.current - result.drift : tvTime;
      try { playerRef.current.seek(seekTarget); } catch (e) { /* ignore */ }
      if (rateRef.current !== 1.0) setRate(1.0);
    } else if (result.action === 'rate') {
      if (result.rate !== rateRef.current) setRate(result.rate);
    }
  }, []);

  // Corrector imperativo de posición. Se invoca desde el handler del evento
  // `position-update` para que la sincronización funcione también con la app en
  // segundo plano: los control timestamps de CSS-TS siguen llegando (WebSocket
  // entrante) aunque Android congele los timers JS, pero el ciclo
  // setState -> useEffect no es fiable en background. Aquí reconciliamos el
  // estado play/pause y delegamos la corrección de drift al controlador
  // predictivo compartido (runDriftCorrection).
  const applyPositionToActivePlayer = useCallback((pos) => {
    if (!pos || pos.positionSeconds == null) return;

    // Audio activo (o montado pero pausado, pendiente de reanudar)
    if (selectedAudioRef.current && audioPlayerRef.current) {
      // Reanudar de forma imperativa cuando la TV reproduce pero nuestro player
      // está en pausa (por desconexión o porque `audioPlaying` quedó en false
      // tras reconectar). En background el cambio declarativo de `paused` no es
      // fiable, así que forzamos resume() y marcamos audioPlaying=true. Si la TV
      // está pausada, hacemos lo contrario.
      if (pos.isPlaying && (audioPausedImperativelyRef.current || !audioPlayingRef.current)) {
        console.log('▶️ applyPosition: resume() AUDIO imperativo');
        try { audioPlayerRef.current.resume?.(); } catch (e) { console.log('⚠️ resume audio error', e?.message); }
        audioPausedImperativelyRef.current = false;
        if (!audioPlayingRef.current) setAudioPlaying(true);
      } else if (!pos.isPlaying && audioPlayingRef.current) {
        console.log('⏸️ applyPosition: pause() AUDIO imperativo (TV pausada)');
        try { audioPlayerRef.current.pause?.(); } catch (e) { /* ignore */ }
        setAudioPlaying(false);
      }
      // Delegar la corrección de drift al controlador predictivo (background-safe).
      runDriftCorrection('audio');
      return;
    }

    // Vídeo activo (o montado pero pausado, pendiente de reanudar)
    if (selectedVideoRef.current && videoPlayerRef.current) {
      // Reanudar / pausar de forma imperativa según la TV (ver audio).
      if (pos.isPlaying && (videoPausedImperativelyRef.current || !videoPlayingRef.current)) {
        console.log('▶️ applyPosition: resume() VIDEO imperativo');
        try { videoPlayerRef.current.resume?.(); } catch (e) { console.log('⚠️ resume video error', e?.message); }
        videoPausedImperativelyRef.current = false;
        if (!videoPlayingRef.current) setVideoPlaying(true);
      } else if (!pos.isPlaying && videoPlayingRef.current) {
        console.log('⏸️ applyPosition: pause() VIDEO imperativo (TV pausada)');
        try { videoPlayerRef.current.pause?.(); } catch (e) { /* ignore */ }
        setVideoPlaying(false);
      }
      // Delegar la corrección de drift al controlador predictivo (background-safe).
      runDriftCorrection('video');
    }
  }, []);

  // Detiene de forma imperativa el player activo (audio o vídeo). Se usa cuando
  // se cierra la conexión: en segundo plano el ciclo setState -> render no es
  // fiable, así que `paused`/desmontaje declarativo puede no aplicarse y el
  // audio seguiría sonando. Llamando a `pause()` sobre el ref nativo paramos el
  // sonido inmediatamente aunque la app esté en background, mientras se espera
  // una nueva conexión.
  const stopActivePlayers = useCallback(() => {
    try {
      audioPlayerRef.current?.pause?.();
      audioPausedImperativelyRef.current = true;
    } catch (e) {
      // ignore
    }
    try {
      videoPlayerRef.current?.pause?.();
      videoPausedImperativelyRef.current = true;
    } catch (e) {
      // ignore
    }
  }, []);

  // Reenvia la informació de sincronització a la web companion carregada al
  // WebView, injectant una crida a `window.__hbbtvSync(payload)`. Només actua si
  // el modal amb la web està obert. És el pont TV -> web: cada `position-update`
  // (control timestamp de CSS-TS) es tradueix en un missatge amb el timecode i
  // l'estat de reproducció, però que la web pugui mostrar-los sincronitzats.
  const feedWebView = useCallback((pos) => {
    if (!webModalVisibleRef.current || !webViewRef.current || !pos) return;
    if (pos.positionSeconds == null) return;
    // La web interpola amb el seu propi rellotge; només l'enviem una correcció
    // cada WEB_FEED_INTERVAL_MS, o immediatament si canvia l'estat de
    // reproducció (play/pausa) o la velocitat, per corregir de seguida.
    const now = Date.now();
    const stateChanged =
      pos.isPlaying !== lastWebFeedStateRef.current.isPlaying ||
      pos.speed !== lastWebFeedStateRef.current.speed;
    if (!stateChanged && now - lastWebFeedRef.current < WEB_FEED_INTERVAL_MS) return;
    lastWebFeedRef.current = now;
    lastWebFeedStateRef.current = { isPlaying: pos.isPlaying, speed: pos.speed };
    const payload = {
      type: 'position',
      positionSeconds: pos.positionSeconds,
      positionMillis: pos.positionMillis,
      isPlaying: pos.isPlaying,
      speed: pos.speed,
      isLive: pos.isLive,
      formattedTime: pos.formattedTime,
    };
    try {
      webViewRef.current.injectJavaScript(
        `window.__hbbtvSync && window.__hbbtvSync(${JSON.stringify(payload)}); true;`
      );
    } catch (e) {
      // ignore
    }
  }, []);

  // Obre la web companion a pantalla completa i desbloqueja l'orientació perquè
  // l'usuari pugui girar el telèfon mentre la mira. Reinicia el throttle perquè
  // el primer aliment (a onLoadEnd) s'enviï immediatament.
  const openWebModal = useCallback(() => {
    lastWebFeedRef.current = 0;
    lastWebFeedStateRef.current = { isPlaying: null, speed: null };
    setWebNoContent(false);
    setWebModalVisible(true);
    ScreenOrientation.unlockAsync().catch(() => {});
  }, []);

  // Tanca la web companion i restaura l'orientació vertical de l'app.
  const closeWebModal = useCallback(() => {
    setWebModalVisible(false);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  // Android: resolve camera permission requests coming from the companion web
  // page. We only request the OS permission now (on-demand), and grant just the
  // camera resource. Microphone (and any other resource) is denied. If the
  // brand has not opted into camera access, deny everything.
  const handleWebViewPermissionRequest = useCallback(
    async (event) => {
      const request = event?.nativeEvent ?? event;
      const resources = request?.resources ?? [];
      const CAMERA_RESOURCE = 'android.webkit.resource.VIDEO_CAPTURE';

      if (!brand.permissions?.camera || !resources.includes(CAMERA_RESOURCE)) {
        request?.deny?.();
        return;
      }

      const granted = await requestCameraPermission();
      if (granted) {
        request?.grant?.([CAMERA_RESOURCE]);
      } else {
        request?.deny?.();
        Alert.alert(
          t('permissions.camera.deniedTitle'),
          t('permissions.camera.deniedMessage')
        );
      }
    },
    [t]
  );

  // Detiene por completo el reproductor y la sincronización. Se invoca desde la
  // acción "Detener" de la notificación del foreground service (para poder
  // parar todo con la app en segundo plano) y es idempotente. Hace el teardown
  // de forma imperativa (no depende del ciclo setState/cleanup, que en
  // background puede no ejecutarse de inmediato) y además colapsa el terminal
  // para reflejarlo en la UI cuando se vuelve a primer plano.
  const stopEverything = useCallback(() => {
    isActiveRef.current = false;
    stopActivePlayers();
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (syncServiceRef.current) {
      const oldService = syncServiceRef.current;
      syncServiceRef.current = null;
      oldService.destroy();
    }
    setPlaybackIntent(null);
    setAudioPlaying(false);
    setVideoPlaying(false);
    setSyncState(SyncState.DISCONNECTED);
    stopForegroundSync();
    if (expandedRef.current && onToggleExpandRef.current) {
      onToggleExpandRef.current();
    }
  }, [stopActivePlayers]);
  const stopEverythingRef = useRef(stopEverything);
  stopEverythingRef.current = stopEverything;


  // Funció de connexió amb timeout i reintents infinits
  setupAndConnectRef.current = () => {
    if (!isActiveRef.current) return;


    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }

    if (syncServiceRef.current) {
      const oldService = syncServiceRef.current;
      syncServiceRef.current = null;
      oldService.destroy();
    }

    setError(null);
    setIsLoading(true);
    // No destruimos el player al reconectar: lo dejamos montado pero en pausa
    // (audioPlaying/videoPlaying=false). Así el ExoPlayer/MediaSession sobrevive
    // y puede reanudar en background sin recrearse (recrearlo en segundo plano
    // no arranca la reproducción). loadMpd actualizará la fuente y volverá a
    // poner playing=true cuando llegue el nuevo MPD.
    setAudioPlaying(false);
    setVideoPlaying(false);
    setPosition(null);
    lastContentIdRef.current = null;

    const interDevSyncUrl = terminal.getInterDevSyncURL();
    if (!interDevSyncUrl) {
      setError(t('discovery.terminalNoSyncUrl'));
      setIsLoading(false);
      return;
    }

    const service = new MediaSyncService();
    syncServiceRef.current = service;

    let hasReceivedContent = false;

    service.on('state-change', ({ newState }) => {
      if (!isActiveRef.current) return;
      if (syncServiceRef.current !== service) return;
      // Actualizar también el ref de forma síncrona: en background el render
      // puede no ejecutarse, y el driver de reconexión (heartbeat) necesita el
      // estado actual sin depender del ciclo de render.
      syncStateRef.current = newState;
      setSyncState(newState);
    });

    service.on('cii-change', ({ state }) => {
      if (!isActiveRef.current) return;
      if (syncServiceRef.current !== service) return;
      const contentId = state.contentId;
      console.log(`📺 cii-change: contentId=${contentId} (last=${lastContentIdRef.current})`);
      if (!contentId || contentId === lastContentIdRef.current) return;

      if (isWebContent(contentId)) {
        // Contingut WEB companion: no parsegem MPD. Netegem qualsevol estat de
        // reproducció MPD anterior i mostrem la targeta / carreguem la web.
        console.log('📺 cii-change: contingut WEB companion');
        hasReceivedContent = true;
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        lastContentIdRef.current = contentId;
        stopActivePlayers();
        setSelectedAudio(null);
        setSelectedVideo(null);
        setAudioPlaying(false);
        setVideoPlaying(false);
        setAudios([]);
        setVideos([]);
        setMpdUrl(null);
        mpdUrlRef.current = null;
        setPlaybackIntent(null);
        setWebNoContent(false);
        setCompanionWebUrl(contentId); // si el modal ja és obert, el WebView recarrega
        setIsLoading(false);
      } else if (contentId.includes('.mpd')) {
        console.log('📺 cii-change: nuevo contenido -> loadMpd');
        hasReceivedContent = true;
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        lastContentIdRef.current = contentId;
        // Si veníem d'una web companion, ja no hi ha web: si el modal és obert,
        // avisem l'usuari (podrà tancar-lo).
        if (companionWebUrlRef.current) {
          setCompanionWebUrl(null);
          if (webModalVisibleRef.current) setWebNoContent(true);
        }
        loadMpd(contentId);
      } else {
        // contentId no reconegut (ni web ni MPD). Si hi havia una web oberta,
        // avisem que ja no hi ha contingut web sincronitzat.
        console.log('📺 cii-change: contentId no reconegut (ni web ni mpd)');
        lastContentIdRef.current = contentId;
        if (companionWebUrlRef.current) {
          setCompanionWebUrl(null);
          if (webModalVisibleRef.current) setWebNoContent(true);
        }
      }
    });

    service.on('position-update', (pos) => {
      if (!isActiveRef.current) return;
      if (syncServiceRef.current !== service) return;
      setPosition(pos);
      // Aplicar la corrección al player de forma imperativa además de actualizar
      // el estado: garantiza que el reposicionamiento llegue al player aunque la
      // app esté en segundo plano (donde el ciclo setState/useEffect puede no
      // ejecutarse con la cadencia esperada).
      applyPositionToActivePlayer(pos);
      // Alimentar la web companion (si el modal amb el WebView està obert).
      feedWebView(pos);
    });

    service.on('error', ({ service: svc, error: err }) => {
      if (!isActiveRef.current) return;
      if (syncServiceRef.current !== service) return;
      console.error(`Error en ${svc}:`, err);
      // Cortar el sonido al perder la conexión (robusto en background).
      stopActivePlayers();
      setError(getErrorMessage(err));
      setIsLoading(false);
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      retryTimeoutRef.current = setTimeout(() => {
        if (setupAndConnectRef.current && isActiveRef.current) {
          setupAndConnectRef.current();
        }
      }, RETRY_DELAY);
    });

    service.on('disconnected', () => {
      if (!isActiveRef.current) return;
      if (syncServiceRef.current !== service) return;
      // Detener el audio/vídeo inmediatamente (también en background, donde el
      // desmontaje declarativo del <Video> puede no aplicarse) y quedar a la
      // espera de una nueva conexión. NO desmontamos el player: lo dejamos
      // montado pero en pausa (audioPlaying/videoPlaying=false) para que el
      // ExoPlayer/MediaSession sobreviva y pueda reanudar en background sin
      // recrearse. Conservamos selección, MPD y playbackIntent.
      stopActivePlayers();
      syncStateRef.current = SyncState.DISCONNECTED;
      setSyncState(SyncState.DISCONNECTED);
      setIsLoading(false);
      setAudioPlaying(false);
      setVideoPlaying(false);
      lastContentIdRef.current = null;
      hasReceivedContent = false;
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      retryTimeoutRef.current = setTimeout(() => {
        if (setupAndConnectRef.current && isActiveRef.current) {
          setupAndConnectRef.current();
        }
      }, RETRY_DELAY);
    });

    try {
      service.connect(interDevSyncUrl, {
        timelineSelector: config.MEDIA_SYNC?.TIMELINE_SELECTOR || 'urn:dvb:css:timeline:pts',
        tickRate: config.MEDIA_SYNC?.TICK_RATE || 90000,
      });
    } catch (err) {
      console.error('Error iniciant connexió MediaSync:', err);
      if (!isActiveRef.current) return;
      setError(getErrorMessage(err));
      setIsLoading(false);
      retryTimeoutRef.current = setTimeout(() => {
        if (setupAndConnectRef.current && isActiveRef.current) {
          setupAndConnectRef.current();
        }
      }, RETRY_DELAY);
      return;
    }

    connectTimeoutRef.current = setTimeout(() => {
      if (!isActiveRef.current) return;
      if (!hasReceivedContent) {
        setIsLoading(false);
        setError(t('discovery.noContentSelected'));
        retryTimeoutRef.current = setTimeout(() => {
          if (setupAndConnectRef.current && isActiveRef.current) {
            setupAndConnectRef.current();
          }
        }, RETRY_DELAY);
      }
    }, 5000);
  };

  // Conectar MediaSync al expandir
  useEffect(() => {
    if (!expanded || !hasMediaSync) return;

    isActiveRef.current = true;
    setupAndConnectRef.current();

    return () => {
      isActiveRef.current = false;
      stopForegroundSync();
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      if (syncServiceRef.current) {
        const oldService = syncServiceRef.current;
        syncServiceRef.current = null;
        oldService.destroy();
      }
      setSyncState(SyncState.DISCONNECTED);
      setAudios([]);
      setVideos([]);
      setSelectedAudio(null);
      setSelectedVideo(null);
      setAudioPlaying(false);
      setVideoPlaying(false);
      setPosition(null);
      setMpdUrl(null);
      mpdUrlRef.current = null;
      setStreamInfo(null);
      setError(null);
      setPlaybackIntent(null);
      lastContentIdRef.current = null;
      setCompanionWebUrl(null);
      setWebModalVisible(false);
      setWebNoContent(false);
      companionWebUrlRef.current = null;
      webModalVisibleRef.current = false;
      // Restaurar l'orientació vertical si la web companion estava oberta.
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [expanded, hasMediaSync, terminal]);

  // Mantener la sincronización al volver de background. La reproducción y los
  // timers de sync siguen vivos gracias al foreground service / background audio,
  // pero al volver a primer plano forzamos un recálculo y reposicionamos el
  // player activo a la posición actual de la TV para corregir cualquier deriva.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !isActiveRef.current) return;
      // Si la sincronización se cayó mientras estábamos en background (p. ej. el
      // SO cerró los WebSockets/UDP), forzamos una reconexión limpia.
      if (syncStateRef.current !== SyncState.SYNCHRONIZED) {
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
        if (setupAndConnectRef.current) {
          setupAndConnectRef.current();
        }
        return;
      }
      // Si seguía sincronizado, solo corregimos la posición y la deriva.
      // Reseteamos el throttle para forzar una corrección inmediata y delegamos
      // en el mismo corrector imperativo que usa el evento `position-update`.
      lastSyncTimeRef.current = 0;
      lastVideoSyncTimeRef.current = 0;
      applyPositionToActivePlayer(positionRef.current);
    });
    return () => subscription.remove();
  }, [applyPositionToActivePlayer]);

  // Reconexión en segundo plano dirigida por el heartbeat nativo del foreground
  // service. React Native pausa los `setTimeout` cuando la app está en
  // background, por lo que el reintento basado en timers no se ejecuta una vez
  // que se cierran los sockets y se detiene el audio (no hay actividad nativa
  // que despierte el hilo JS). El heartbeat nativo sí despierta el JS de forma
  // periódica, así que lo usamos para reintentar la conexión mientras no
  // estemos sincronizados (con throttle de RETRY_DELAY).
  useEffect(() => {
    if (!expanded || !hasMediaSync) return;
    const sub = addHeartbeatListener(() => {
      console.log(`💓 Heartbeat: active=${isActiveRef.current}, state=${syncStateRef.current}`);
      if (!isActiveRef.current) return;
      const s = syncStateRef.current;
      if (s !== SyncState.DISCONNECTED && s !== SyncState.ERROR) {
        // Estamos conectados o conectando. Forzamos el envío de una petición WC
        // (UDP) desde el heartbeat nativo: en background RN congela el
        // `setInterval` que envía las peticiones WC periódicas, así que sin esto
        // el WC deja de medir (no llegan respuestas NativeUDP), su dispersión
        // crece y, en una reconexión, nunca llega a sincronizar y el TS no
        // arranca. La petición y su respuesta son I/O, que sí despiertan el hilo
        // JS en segundo plano. Lo hacemos también estando ya sincronizados para
        // mantener el Wall Clock fresco mientras la app está en background.
        console.log('💓 Heartbeat: poking WC');
        syncServiceRef.current?.pokeWallClock?.();
        return;
      }
      const now = Date.now();
      if (now - lastReconnectAttemptRef.current < RETRY_DELAY) return;
      lastReconnectAttemptRef.current = now;
      if (setupAndConnectRef.current) {
        setupAndConnectRef.current();
      }
    });
    return () => sub.remove();
  }, [expanded, hasMediaSync]);

  // Mantener vivo el proceso en background con un foreground service propio (sin
  // controles de media: todo el control se hace en la TV). Se arranca mientras
  // la app está en primer plano (al iniciar la reproducción) para cumplir la
  // restricción de Android, y se detiene al parar.
  //
  // Se mantiene vivo también mientras haya `playbackIntent` (un componente que
  // el usuario está reproduciendo), aunque la reproducción esté momentáneamente
  // pausada por una desconexión. Así el hilo JS sigue activo en segundo plano
  // para recibir el nuevo MPD y reanudar automáticamente sin volver a primer
  // plano. Como Android exige arrancar el servicio en foreground, se inició al
  // seleccionar el componente (estando en primer plano) y aquí solo evitamos
  // detenerlo durante la ventana de reconexión.
  useEffect(() => {
    if (audioPlaying || videoPlaying || playbackIntent) {
      startForegroundSync(
        terminal.getFriendlyName(),
        t('discovery.syncingWithTv', { defaultValue: 'Sincronizando con la TV' }),
        t('discovery.stopSync', { defaultValue: 'Detener' })
      );
    } else {
      stopForegroundSync();
    }
  }, [audioPlaying, videoPlaying, playbackIntent, terminal, t]);

  // Acción "Detener" de la notificación del foreground service: permite al
  // usuario parar el reproductor y la sincronización con la app en segundo
  // plano, sin tener que reabrirla. El módulo nativo emite `onStopRequested`
  // cuando se pulsa el botón; delegamos en `stopEverything` (vía ref para
  // evitar closures obsoletos).
  useEffect(() => {
    if (!expanded || !hasMediaSync) return;
    const sub = addStopListener(() => {
      console.log('🛑 Stop solicitado desde la notificación');
      stopEverythingRef.current?.();
    });
    return () => sub.remove();
  }, [expanded, hasMediaSync]);

  // Cargar MPD
  const loadMpd = useCallback(async (url) => {
    try {
      // Si vamos a cambiar de contenido (nuevo MPD) mientras el vídeo está en
      // pantalla completa, cerramos el reproductor fullscreen del componente
      // actual ANTES de remontar el <Video> (la ref aún apunta al componente
      // antiguo). Marcamos la reentrada para volver a fullscreen tras onLoad.
      if (isFullscreenRef.current && url !== mpdUrlRef.current) {
        pendingFullscreenRef.current = true;
        videoPlayerRef.current?.dismissFullscreenPlayer?.();
      }
      const data = await MpdParserService.parseMpd(url);
      if (!isActiveRef.current) return;
      const audiosData = data.audios || [];
      const videosData = data.videos || [];
      setAudios(audiosData);
      setVideos(videosData);
      setStreamInfo({
        isLive: data.isLive || false,
        mpdType: data.mpdType || 'static',
        availabilityStartTime: data.availabilityStartTime,
        timeShiftBufferDepthSeconds: data.timeShiftBufferDepthSeconds,
        durationSeconds: data.durationSeconds ?? null,
      });
      mpdUrlRef.current = url;
      setMpdUrl(url);

      // Reanudar automáticamente el componente que se estaba reproduciendo si el
      // nuevo MPD contiene el mismo (mismo idioma + role). Esto cubre tanto la
      // reconexión como un cambio de contenido en la TV, y funciona también con
      // la app en segundo plano (el foreground service la mantiene viva).
      const intent = playbackIntentRef.current;
      console.log(
        `📀 loadMpd: audios=${audiosData.length}, videos=${videosData.length}, intent=${intent ? JSON.stringify(intent) : 'null'}`
      );
      let resumed = false;
      if (intent) {
        const sameRole = (a, b) => (a || '') === (b || '');
        if (intent.kind === 'audio') {
          const match = audiosData.find(
            (a) => a.iso === intent.iso && sameRole(a.role, intent.role)
          );
          console.log(`📀 loadMpd: auto-resume AUDIO match=${match ? (match.iso + '/' + (match.role || '')) : 'NONE'} (intent iso=${intent.iso}, role=${intent.role}); disponibles=[${audiosData.map((a) => a.iso + '/' + (a.role || '')).join(', ')}]`);
          if (match) {
            setSelectedVideo(null);
            setVideoPlaying(false);
            setSelectedAudio(match);
            setAudioPlaying(true);
            lastSyncTimeRef.current = 0;
            resumed = true;
          }
        } else if (intent.kind === 'video') {
          const match = videosData.find(
            (v) => v.iso === intent.iso && sameRole(v.role, intent.role)
          );
          console.log(`📀 loadMpd: auto-resume VIDEO match=${match ? (match.iso + '/' + (match.role || '')) : 'NONE'} (intent iso=${intent.iso}, role=${intent.role}); disponibles=[${videosData.map((v) => v.iso + '/' + (v.role || '')).join(', ')}]`);
          if (match) {
            setSelectedAudio(null);
            setAudioPlaying(false);
            setSelectedVideo(match);
            setVideoPlaying(true);
            lastVideoSyncTimeRef.current = 0;
            resumed = true;
          }
        }
      }

      // Si el nuevo MPD no contiene el componente que estábamos reproduciendo
      // (o no hay intención de reproducir), detenemos y limpiamos la selección
      // anterior: así un cambio de contenido en la TV no se queda reproduciendo
      // el contenido previo. El usuario podrá seleccionar de nuevo en la lista.
      if (!resumed) {
        console.log('📀 loadMpd: sin coincidencia -> limpiando selección anterior');
        stopActivePlayers();
        setSelectedAudio(null);
        setSelectedVideo(null);
        setAudioPlaying(false);
        setVideoPlaying(false);
      }
    } catch (err) {
      console.error('❌ Error carregant MPD:', err);
    } finally {
      if (isActiveRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Play/pause reactivo según TV
  const prevIsPlayingRef = useRef(null);
  useEffect(() => {
    if (!selectedAudio || !audioPlayerRef.current || !position) return;
    const tvIsPlaying = position.isPlaying;
    if (prevIsPlayingRef.current !== null && prevIsPlayingRef.current !== tvIsPlaying) {
      setAudioPlaying(tvIsPlaying);
      if (tvIsPlaying && position.positionSeconds != null && !streamInfo?.isLive) {
        audioPlayerRef.current.seek(position.positionSeconds);
      }
    }
    prevIsPlayingRef.current = tvIsPlaying;
  }, [position?.isPlaying, selectedAudio]);

  // Play/pause reactivo del vídeo según TV
  const prevVideoIsPlayingRef = useRef(null);
  useEffect(() => {
    if (!selectedVideo || !videoPlayerRef.current || !position) return;
    const tvIsPlaying = position.isPlaying;
    if (prevVideoIsPlayingRef.current !== null && prevVideoIsPlayingRef.current !== tvIsPlaying) {
      setVideoPlaying(tvIsPlaying);
      if (tvIsPlaying && position.positionSeconds != null && !streamInfo?.isLive) {
        videoPlayerRef.current.seek(position.positionSeconds);
      }
    }
    prevVideoIsPlayingRef.current = tvIsPlaying;
  }, [position?.isPlaying, selectedVideo]);

  const handleSelectAudio = useCallback((audio) => {
    if (selectedAudio?.representationId === audio.representationId && selectedAudio?.role === audio.role) {
      setSelectedAudio(null);
      setAudioPlaying(false);
      setPlaybackIntent(null);
      return;
    }
    // Reproducir áudio i vídeo són mútuament excloents.
    setSelectedVideo(null);
    setVideoPlaying(false);
    setSelectedAudio(audio);
    setAudioPlaying(true);
    setPlaybackIntent({ kind: 'audio', iso: audio.iso, role: audio.role || '' });
    lastSyncTimeRef.current = 0;
  }, [selectedAudio]);

  const handleStopAudio = useCallback(() => {
    setSelectedAudio(null);
    setAudioPlaying(false);
    setPlaybackIntent(null);
  }, []);

  const handleSelectVideo = useCallback((video) => {
    if (selectedVideo?.representationId === video.representationId && selectedVideo?.role === video.role) {
      setSelectedVideo(null);
      setVideoPlaying(false);
      setPlaybackIntent(null);
      return;
    }
    // Reproducir áudio i vídeo són mútuament excloents.
    setSelectedAudio(null);
    setAudioPlaying(false);
    setSelectedVideo(video);
    setVideoPlaying(true);
    setPlaybackIntent({ kind: 'video', iso: video.iso, role: video.role || '' });
    lastVideoSyncTimeRef.current = 0;
  }, [selectedVideo]);

  const handleStopVideo = useCallback(() => {
    setSelectedVideo(null);
    setVideoPlaying(false);
    setPlaybackIntent(null);
  }, []);

  const toggleExpand = () => {
    if (!hasMediaSync) {
      return;
    }
    if (onToggleExpand) {
      onToggleExpand();
    }
  };

  const isConnected = syncState === SyncState.SYNCHRONIZED;

  const getAudioLabel = (audio) => {
    if (audio.role === 'main' || !audio.role) return t('discovery.audioMain');
    if (audio.role === 'description' || audio.text.toLowerCase().includes('ad')) return t('discovery.audioDescription');
    if (audio.text.toLowerCase().includes('original')) return t('discovery.audioOriginal');
    return t('discovery.audioAlternative');
  };

  const getAudioIcon = (audio) => {
    if (audio.role === 'description' || audio.text.toLowerCase().includes('ad')) return 'person';
    return 'language';
  };

  // Formata una durada en segons a HH:MM:SS (o MM:SS si és < 1h).
  const formatDuration = (seconds) => {
    if (seconds == null || !isFinite(seconds) || seconds < 0) return '--:--';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (v) => v.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  };

  // Barra de progrés informativa (només lectura): mostra el temps actual i, si
  // es coneix, la durada total. En streams en directe no hi ha durada fixa, així
  // que mostrem un indicador "EN DIRECTO" sense progrés. L'usuari no pot moure la
  // posició (no hi ha cap control interactiu).
  const renderSeekBar = () => {
    if (!position) return null;
    const isLive = !!streamInfo?.isLive;
    const duration = streamInfo?.durationSeconds ?? null;
    const current = position.positionSeconds ?? 0;
    const hasDuration = !isLive && duration != null && duration > 0;
    const fraction = hasDuration
      ? Math.max(0, Math.min(1, current / duration))
      : 0;

    return (
      <View style={styles.seekRow}>
        <Text style={styles.seekTimeText}>
          {isLive ? formatDuration(current) : (position.formattedTime || formatDuration(current))}
        </Text>
        <View style={styles.seekTrack}>
          {isLive ? (
            <View style={styles.seekLiveIndicator} />
          ) : (
            <View style={[styles.seekFill, { width: `${fraction * 100}%` }]} />
          )}
        </View>
        {isLive ? (
          <View style={styles.seekLiveBadge}>
            <View style={styles.seekLiveDot} />
            <Text style={styles.seekLiveText}>{t('discovery.live')}</Text>
          </View>
        ) : (
          <Text style={styles.seekTimeText}>
            {hasDuration ? formatDuration(duration) : '--:--'}
          </Text>
        )}
      </View>
    );
  };

  // Estat de sincronització del reproductor per al badge de la UI. Llegeix la
  // decisió real del controlador (drift filtrat + mode), publicada a
  // `lastSyncInfoRef` a cada correcció, en lloc de recalcular una heurística
  // pròpia amb el drift cru (que oscil·laria amb el soroll de mesura). Si no hi
  // ha dada recent (player pausat, sense senyal) mostrem "waiting".
  const getPlayerSyncStatus = () => {
    const isAudioActive = !!selectedAudio && audioPlaying;
    const isVideoActive = !!selectedVideo && videoPlaying;
    if (!isAudioActive && !isVideoActive) return null;

    // Encara sense timeline/WC o sense posició: esperant senyal.
    if (syncState !== SyncState.SYNCHRONIZED || !position || position.positionSeconds == null) {
      return { status: 'waiting', driftMs: null, rate: 1 };
    }

    const info = isAudioActive ? lastSyncInfoRef.current.audio : lastSyncInfoRef.current.video;
    const rate = isAudioActive ? audioRate : videoRate;
    // Sense correcció recent (< 1s): el player encara no reporta o està en
    // transició → esperant.
    if (!info || Date.now() - info.at > 1000) {
      return { status: 'waiting', driftMs: null, rate };
    }

    return { status: info.status, driftMs: info.driftMs, rate: info.rate };
  };

  // Mapatge d'estat -> icona i color (dins del badge de reproducció).
  const SYNC_VISUALS = {
    locked: { icon: 'check-circle', color: theme.colors.success },
    adjusting: { icon: 'speed', color: theme.colors.warning },
    seeking: { icon: 'fast-forward', color: theme.colors.tertiary },
    waiting: { icon: 'hourglass-empty', color: theme.colors.onSurfaceVariant },
  };

  // Fila d'estat de sincronització (multiidioma): icona + etiqueta d'estat +
  // deriva (ms). Es col·loca sobre la barra de seek. Reutilitza les claus i18n
  // `discovery.sync*`.
  const renderSyncStatus = (sync) => {
    if (!sync) return null;
    const visual = SYNC_VISUALS[sync.status] || SYNC_VISUALS.waiting;
    const label = sync.status === 'adjusting'
      ? t('discovery.syncAdjusting', { rate: sync.rate.toFixed(2) })
      : t(`discovery.sync${sync.status.charAt(0).toUpperCase()}${sync.status.slice(1)}`);
    const showDrift = sync.driftMs != null && sync.status !== 'waiting';
    const driftLabel = showDrift
      ? `${sync.driftMs >= 0 ? '+' : '−'}${Math.abs(sync.driftMs)} ms`
      : null;
    return (
      <View style={styles.syncStatusRow}>
        <MaterialIcons name={visual.icon} size={14} color={visual.color} />
        <Text style={[styles.syncStatusText, { color: visual.color }]}>{label}</Text>
        {driftLabel && <Text style={styles.syncDriftText}>{driftLabel}</Text>}
      </View>
    );
  };

  const playerSync = getPlayerSyncStatus();

  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={toggleExpand} activeOpacity={hasMediaSync ? 0.8 : 1} disabled={!hasMediaSync}>
        <View style={[styles.header, !hasMediaSync && styles.headerDisabled]}>
          <View style={styles.iconContainer}>
            <MaterialIcons name="tv" size={24} color={theme.colors.onSurface} />
          </View>
          <View style={styles.info}>
            <Text style={styles.name}>{terminal.getFriendlyName()}</Text>
            {hasMediaSync && (
              <Text style={[styles.status, isConnected && styles.statusConnected]}>
                {isConnected ? t('discovery.statusConnected') : t('discovery.statusStandby')}
              </Text>
            )}
          </View>
          {hasMediaSync && (
            expanded ? (
              <MaterialIcons name="keyboard-arrow-up" size={24} color={theme.colors.onSurfaceVariant} />
            ) : (
              <MaterialIcons name="keyboard-arrow-down" size={24} color={theme.colors.onSurfaceVariant} />
            )
          )}
        </View>
      </TouchableOpacity>

      {expanded && hasMediaSync && (
        <View style={styles.mediaSection}>
          {(isLoading || (!companionWebUrl && audios.length === 0 && videos.length === 0)) && (
            <View style={styles.statusRegion}>
                <Text style={styles.emptyText}>{t('discovery.waitingForContent')} <ActivityIndicator color={theme.colors.primary} /></Text>
            </View>
          )}

          {/* Contingut web companion: targeta per obrir la web sincronitzada */}
          {companionWebUrl && (
            <>
              <Text style={styles.sectionLabel}>{t('discovery.webSection')}</Text>
              <View style={styles.webCard}>
                <View style={styles.webIconWrap}>
                  {webFaviconUrl ? (
                    <Image
                      source={{ uri: webFaviconUrl }}
                      style={styles.webFavicon}
                      onError={() => setWebFaviconUrl(null)}
                    />
                  ) : (
                    <MaterialIcons name="public" size={20} color={theme.colors.primary} />
                  )}
                </View>
                <View style={styles.webInfo}>
                  <Text style={styles.webTitle} numberOfLines={1}>
                    {webPageTitle || t('discovery.webAvailableTitle')}
                  </Text>
                  <Text style={styles.webSubtitle}>{t('discovery.webAvailableSubtitle')}</Text>
                </View>
                <TouchableOpacity
                  style={styles.webOpenButton}
                  onPress={openWebModal}
                >
                  <MaterialIcons name="open-in-full" size={16} color={theme.colors.onPrimary} />
                  <Text style={styles.webOpenButtonText}>{t('discovery.webOpen')}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {audios.length > 0 && (
            <Text style={styles.sectionLabel}>{t('discovery.audioSection')}</Text>
          )}

          {audios.map((audio, idx) => {
            const isSelected = selectedAudio?.representationId === audio.representationId && selectedAudio?.role === audio.role;
            return (
              <View key={`${audio.representationId}-${idx}`}>
                <View style={[styles.audioRow, isSelected && styles.audioRowSelected]}>
                  <View style={styles.audioIconWrap}>
                    <MaterialIcons name={getAudioIcon(audio)} size={18} color={theme.colors.onSurfaceVariant} />
                  </View>
                  <View style={styles.audioInfo}>
                    <Text style={styles.audioName}>{audio.text}</Text>
                    <Text style={styles.audioLabel}>{getAudioLabel(audio)}</Text>
                  </View>
                  {isSelected && audioPlaying ? (
                    <View style={styles.playingBadgeContainer}>
                      <View style={styles.playingBadge}>
                        <View style={styles.waveContainerCompact}>
                          {waveBarAnimsRef.current.map((animValue, i) => {
                            const heightInterpolation = animValue.interpolate({
                              inputRange: [0.4, 1.0],
                              outputRange: [8, 14],
                            });
                            const opacityInterpolation = animValue.interpolate({
                              inputRange: [0.4, 1.0],
                              outputRange: [0.76, 1.0],
                            });
                            return (
                              <Animated.View
                                key={i}
                                style={[
                                  styles.waveBarCompact,
                                  {
                                    height: heightInterpolation,
                                    opacity: opacityInterpolation,
                                  },
                                ]}
                              />
                            );
                          })}
                        </View>
                        <Text style={styles.playingBadgeText}>{t('discovery.playing')}</Text>
                      </View>
                      <TouchableOpacity style={styles.closeButtonCompact} onPress={handleStopAudio}>
                        <MaterialIcons name="close" size={14} color={theme.colors.onSurfaceVariant} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.listenButton} onPress={() => handleSelectAudio(audio)}>
                      <Text style={styles.listenButtonText}>{t('discovery.listen')}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {isSelected && (
                  <View style={styles.playerSection}>
                    {/* Estat de sincronització sobre la barra de seek */}
                    {renderSyncStatus(playerSync)}
                    {/* Barra de progrés informativa (només lectura) */}
                    {renderSeekBar()}
                    {/* Slider de volumen */}
                    <View style={styles.volumeRow}>
                      <MaterialIcons name="volume-down" size={14} color={theme.colors.onSurfaceVariant} />
                      <Slider
                        style={styles.volumeSlider}
                        value={volume}
                        onValueChange={setVolume}
                        minimumValue={0}
                        maximumValue={1}
                        step={0.01}
                        minimumTrackTintColor={theme.colors.primary}
                        maximumTrackTintColor={theme.colors.surfaceContainerHighest}
                        thumbTintColor={theme.colors.primaryContainer}
                      />
                      <Text style={styles.volumeText}>{Math.round(volume * 100)}%</Text>
                      <MaterialIcons name="volume-up" size={14} color={theme.colors.onSurfaceVariant} />
                    </View>
                  </View>
                )}
              </View>
            );
          })}

          {videos.length > 0 && (
            <Text style={styles.sectionLabel}>{t('discovery.videoSection')}</Text>
          )}

          {videos.map((video, idx) => {
            const isSelected = selectedVideo?.representationId === video.representationId && selectedVideo?.role === video.role;
            return (
              <View key={`v-${video.representationId}-${idx}`}>
                <View style={[styles.audioRow, isSelected && styles.audioRowSelected]}>
                  <View style={styles.audioIconWrap}>
                    <MaterialIcons name="videocam" size={18} color={theme.colors.onSurfaceVariant} />
                  </View>
                  <View style={styles.audioInfo}>
                    <Text style={styles.audioName}>{video.text}</Text>
                    <Text style={styles.audioLabel}>{t('discovery.videoLabel')}</Text>
                  </View>
                  {isSelected && videoPlaying ? (
                    <View style={styles.playingBadgeContainer}>
                      <View style={styles.playingBadge}>
                        <MaterialIcons name="play-arrow" size={14} color={theme.colors.primary} />
                        <Text style={styles.playingBadgeText}>{t('discovery.playing')}</Text>
                      </View>
                      <TouchableOpacity style={styles.closeButtonCompact} onPress={handleStopVideo}>
                        <MaterialIcons name="close" size={14} color={theme.colors.onSurfaceVariant} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.listenButton} onPress={() => handleSelectVideo(video)}>
                      <Text style={styles.listenButtonText}>{t('discovery.watch')}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {isSelected && mpdUrl && (
                  <View style={styles.videoPlayerSection}>
                    <View style={styles.videoSurfaceWrapper}>
                      <Video
                        key={mpdUrl}
                        ref={videoPlayerRef}
                        source={{ uri: mpdUrl, type: 'mpd' }}
                        paused={!videoPlaying || (position != null && !position.isPlaying)}
                        rate={videoPlaying && position?.isPlaying ? videoRate : 1.0}
                        volume={volume}
                        resizeMode="contain"
                        controls={false}
                        playInBackground={true}
                        playWhenInactive={true}
                        showNotificationControls={false}
                        ignoreSilentSwitch="ignore"
                        fullscreenOrientation="landscape"
                        fullscreenAutorotate={true}
                        onFullscreenPlayerWillPresent={() => {
                          isFullscreenRef.current = true;
                          ScreenOrientation.lockAsync(
                            ScreenOrientation.OrientationLock.LANDSCAPE
                          ).catch(() => {});
                        }}
                        onFullscreenPlayerWillDismiss={() => {
                          isFullscreenRef.current = false;
                          // Si el cierre forma parte de una reentrada automática
                          // (cambio de contenido en fullscreen), no restauramos
                          // la orientación vertical para evitar el parpadeo.
                          if (!pendingFullscreenRef.current) {
                            ScreenOrientation.lockAsync(
                              ScreenOrientation.OrientationLock.PORTRAIT_UP
                            ).catch(() => {});
                          }
                        }}
                        selectedVideoTrack={
                          selectedVideo.videoTrackIndex != null
                            ? { type: 'index', value: selectedVideo.videoTrackIndex }
                            : { type: 'auto' }
                        }
                        onLoad={() => {
                          videoSyncControllerRef.current?.reset();
                          if (position?.positionSeconds && videoPlayerRef.current && !streamInfo?.isLive) {
                            videoPlayerRef.current.seek(position.positionSeconds);
                          }
                          // Si el contenido cambió mientras estábamos en fullscreen,
                          // volvemos a presentar el reproductor a pantalla completa
                          // con el nuevo vídeo ya cargado.
                          if (pendingFullscreenRef.current) {
                            pendingFullscreenRef.current = false;
                            videoPlayerRef.current?.presentFullscreenPlayer?.();
                          }
                        }}
                        onProgress={({ currentTime, currentPlaybackTime }) => {
                          videoCurrentTimeRef.current = currentTime;
                          videoCurrentPlaybackTimeRef.current = currentPlaybackTime / 1000;
                          runDriftCorrection('video');
                        }}
                        onError={(err) => {
                          console.error('Error reproduint vídeo:', err);
                          setVideoPlaying(false);
                        }}
                        progressUpdateInterval={config.MEDIA_SYNC?.PROGRESS_UPDATE_INTERVAL_MS ?? 250}
                        style={styles.videoSurface}
                      />
                      <TouchableOpacity
                        style={styles.fullscreenButton}
                        onPress={() => videoPlayerRef.current?.presentFullscreenPlayer()}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <MaterialIcons name="fullscreen" size={22} color="#fff" />
                      </TouchableOpacity>
                    </View>
                    {/* Estat de sincronització sobre la barra de seek */}
                    {renderSyncStatus(playerSync)}
                    {/* Barra de progrés informativa (només lectura) */}
                    {renderSeekBar()}
                    <View style={styles.volumeRow}>
                      <MaterialIcons name="volume-down" size={14} color={theme.colors.onSurfaceVariant} />
                      <Slider
                        style={styles.volumeSlider}
                        value={volume}
                        onValueChange={setVolume}
                        minimumValue={0}
                        maximumValue={1}
                        step={0.01}
                        minimumTrackTintColor={theme.colors.primary}
                        maximumTrackTintColor={theme.colors.surfaceContainerHighest}
                        thumbTintColor={theme.colors.primaryContainer}
                      />
                      <Text style={styles.volumeText}>{Math.round(volume * 100)}%</Text>
                      <MaterialIcons name="volume-up" size={14} color={theme.colors.onSurfaceVariant} />
                    </View>
                  </View>
                )}
              </View>
            );
          })}

          {/* Error banner */}
          {/* <StatusSlot visible={!!error} minHeight={64}>
            <View style={styles.errorBanner}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name="error" size={14} color={theme.colors.onErrorContainer} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
              <Text style={styles.retryText}>{t('discovery.retryingConnection')}</Text>
            </View>
          </StatusSlot> */}

          {/* Reproductor de audio oculto */}
          {selectedAudio && mpdUrl && (
            <Video
              key={mpdUrl}
              ref={audioPlayerRef}
              source={{ uri: mpdUrl, type: 'mpd' }}
              audioOnly={true}
              paused={!audioPlaying || (position != null && !position.isPlaying)}
              rate={audioPlaying && position?.isPlaying ? audioRate : 1.0}
              volume={volume}
              playInBackground={true}
              playWhenInactive={true}
              showNotificationControls={false}
              ignoreSilentSwitch="ignore"
              selectedAudioTrack={
                selectedAudio.audioTrackIndex != null
                  ? { type: 'index', value: selectedAudio.audioTrackIndex }
                  : { type: 'language', value: selectedAudio.iso }
              }
              onLoad={() => {
                audioSyncControllerRef.current?.reset();
                if (position?.positionSeconds && audioPlayerRef.current && !streamInfo?.isLive) {
                  audioPlayerRef.current.seek(position.positionSeconds);
                }
              }}
              onProgress={({ currentTime, currentPlaybackTime }) => {
                audioCurrentTimeRef.current = currentTime;
                audioCurrentPlaybackTimeRef.current = currentPlaybackTime / 1000;
                runDriftCorrection('audio');
              }}
              onError={(err) => {
                console.error('❌ Error reproduint àudio:', err);
                setAudioPlaying(false);
              }}
              progressUpdateInterval={config.MEDIA_SYNC?.PROGRESS_UPDATE_INTERVAL_MS ?? 250}
              style={{ height: 0, width: 0 }}
            />
          )}
        </View>
      )}

      {/* Web companion a pantalla completa. Es carrega la URL rebuda per CII i
          s'alimenta amb la sincronitzaci\u00f3 via window.__hbbtvSync (feedWebView).
          Si arriba un contentId sense web mentre est\u00e0 obert, mostrem l'av\u00eds
          `webNoContent` i l'usuari pot tancar. */}
      <Modal
        visible={webModalVisible}
        animationType="slide"
        onRequestClose={closeWebModal}
        supportedOrientations={['portrait', 'landscape']}
      >
        <View style={styles.webModalContainer}>
          {companionWebUrl && !webNoContent ? (
            <WebView
              ref={webViewRef}
              source={{ uri: companionWebUrl }}
              style={styles.webModalWebView}
              originWhitelist={['*']}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              // iOS: let the loaded page use the camera when the brand opts in.
              // The OS still shows its own prompt (NSCameraUsageDescription) on
              // first use; if the brand disables it, deny outright.
              mediaCapturePermissionGrantType={
                brand.permissions?.camera ? 'grantIfSameHostElsePrompt' : 'deny'
              }
              // Android: the WebView asks us to resolve camera/mic requests. We
              // request the OS camera permission on-demand (only now, when the
              // page needs it) and grant just the camera resource.
              onPermissionRequest={handleWebViewPermissionRequest}
              onLoadEnd={() => {
                // Missatge inicial + darrera posici\u00f3 coneguda, per\u00f2 que la web
                // tingui context i mostri de seguida el timecode.
                const initPayload = { type: 'init', contentId: companionWebUrlRef.current };
                try {
                  webViewRef.current?.injectJavaScript(
                    `window.__hbbtvSync && window.__hbbtvSync(${JSON.stringify(initPayload)}); true;`
                  );
                } catch (e) {
                  // ignore
                }
                if (positionRef.current) feedWebView(positionRef.current);
              }}
            />
          ) : (
            <View style={styles.webNoContent}>
              <MaterialIcons name="link-off" size={48} color={theme.colors.onSurfaceVariant} />
              <Text style={styles.webNoContentText}>{t('discovery.webNoContent')}</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.webCloseButton}
            onPress={closeWebModal}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="close" size={22} color="#fff" />
            <Text style={styles.webCloseButtonText}>{t('discovery.webClose')}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surfaceContainer,
    borderRadius: theme.radius.lg,
    marginBottom: theme.spacing.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.md,
  },
  headerDisabled: {
    opacity: 0.45,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },

  info: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.onSurface,
    fontFamily: theme.typography.headlineSm.fontFamily,
  },
  status: {
    fontSize: 13,
    color: theme.colors.onSurfaceVariant,
    marginTop: 2,
    fontFamily: theme.typography.bodyMd.fontFamily,
  },
  statusConnected: {
    color: theme.colors.primary,
  },
  chevron: {
    fontSize: 24,
    color: theme.colors.onSurfaceVariant,
    fontWeight: '300',
  },
  mediaSection: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  emptyText: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 16,
    fontFamily: theme.typography.bodyMd.fontFamily,
  },
  sectionLabel: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.xs,
    fontFamily: theme.typography.labelCaps.fontFamily,
  },
  videoPlayerSection: {
    backgroundColor: theme.colors.surfaceContainerHigh,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  videoSurface: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    borderRadius: theme.radius.sm,
    marginBottom: theme.spacing.sm,
  },
  videoSurfaceWrapper: {
    position: 'relative',
    width: '100%',
  },
  fullscreenButton: {
    position: 'absolute',
    bottom: theme.spacing.sm + 8,
    right: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceContainerHigh,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  audioRowSelected: {
    marginBottom: 0
  },
  audioIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },

  audioInfo: {
    flex: 1,
  },
  audioName: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.onSurface,
    fontFamily: theme.typography.bodyLg.fontFamily,
  },
  audioLabel: {
    fontSize: 12,
    color: theme.colors.onSurfaceVariant,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: theme.typography.labelCaps.fontFamily,
  },
  listenButton: {
    borderWidth: 1,
    borderColor: theme.colors.outlineVariant,
    borderRadius: theme.radius.full,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  listenButtonText: {
    color: theme.colors.onSurface,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: theme.typography.bodyMd.fontFamily,
  },
  webCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceContainerHigh,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  webIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  webFavicon: {
    width: 24,
    height: 24,
    borderRadius: 4,
    resizeMode: 'contain',
  },
  webInfo: {
    flex: 1,
  },
  webTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.onSurface,
    fontFamily: theme.typography.bodyLg.fontFamily,
  },
  webSubtitle: {
    fontSize: 12,
    color: theme.colors.onSurfaceVariant,
    marginTop: 2,
    fontFamily: theme.typography.bodyMd.fontFamily,
  },
  webOpenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.full,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  webOpenButtonText: {
    color: theme.colors.onPrimary,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: theme.typography.bodyMd.fontFamily,
  },
  webModalContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  webModalWebView: {
    flex: 1,
    backgroundColor: '#000',
  },
  webNoContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
  },
  webNoContentText: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 16,
    textAlign: 'center',
    fontFamily: theme.typography.bodyLg.fontFamily,
  },
  webCloseButton: {
    position: 'absolute',
    top: 40,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: theme.radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  webCloseButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: theme.typography.bodyMd.fontFamily,
  },
  playingBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playingBadge: {
    backgroundColor: theme.colors.surfaceContainerHighest,
    borderRadius: theme.radius.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playingBadgeText: {
    color: theme.colors.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontFamily: theme.typography.labelCaps.fontFamily,
  },
  syncStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 6,
    marginBottom: theme.spacing.sm,
  },
  syncStatusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontFamily: theme.typography.labelCaps.fontFamily,
  },
  syncDriftText: {
    color: theme.colors.onSurfaceVariant,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
    fontFamily: theme.typography.bodyMd.fontFamily,
    fontVariant: ['tabular-nums'],
  },
  waveContainerCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 16,
    gap: 2,
  },
  waveBarCompact: {
    width: 2,
    backgroundColor: theme.colors.primary,
    borderRadius: 1,
  },
  closeButtonCompact: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playerSection: {
    backgroundColor: theme.colors.surfaceContainerHigh,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 8,
  },

  volumeSlider: {
    flex: 1,
    height: 40,
  },
  volumeText: {
    fontSize: 13,
    color: theme.colors.onSurfaceVariant,
    minWidth: 36,
    textAlign: 'center',
    fontFamily: theme.typography.bodyMd.fontFamily,
  },

  seekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 8,
    marginBottom: theme.spacing.sm,
  },
  seekTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surfaceContainerHighest,
    overflow: 'hidden',
  },
  seekFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: theme.colors.primary,
  },
  seekLiveIndicator: {
    height: '100%',
    width: '100%',
    backgroundColor: theme.colors.surfaceContainerHighest,
  },
  seekTimeText: {
    fontSize: 12,
    color: theme.colors.onSurfaceVariant,
    minWidth: 44,
    textAlign: 'center',
    fontFamily: theme.typography.bodyMd.fontFamily,
    fontVariant: ['tabular-nums'],
  },
  seekLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceContainerHighest,
  },
  seekLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.error,
  },
  seekLiveText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: theme.colors.onSurface,
    fontFamily: theme.typography.labelCaps.fontFamily,
  },


  errorBanner: {
    backgroundColor: theme.colors.errorContainer,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  statusRegion: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.md,
  },
  errorText: {
    color: theme.colors.onErrorContainer,
    fontSize: 13,
    fontFamily: theme.typography.bodyMd.fontFamily,
  },
  retryText: {
    color: theme.colors.onErrorContainer,
    fontSize: 12,
    fontFamily: theme.typography.bodyMd.fontFamily,
    marginTop: 4,
    opacity: 0.8,
  },
});
