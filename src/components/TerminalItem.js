import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from 'react-native';
import Slider from '@react-native-community/slider';
import Video from 'react-native-video';
import { useTranslation } from 'react-i18next';
import { MediaSyncService, SyncState } from '../services/MediaSyncService';
import MpdParserService from '../services/MpdParserService';
import config from '../utils/config';
import theme from '../theme';
import { MaterialIcons } from '@expo/vector-icons';

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
  const connectTimeoutRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const setupAndConnectRef = useRef(null);
  const isActiveRef = useRef(false);

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
    setAudios([]);
    setVideos([]);
    setSelectedAudio(null);
    setSelectedVideo(null);
    setAudioPlaying(false);
    setVideoPlaying(false);
    setPosition(null);
    setMpdUrl(null);
    setStreamInfo(null);
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
      setSyncState(newState);
    });

    service.on('cii-change', ({ state }) => {
      if (!isActiveRef.current) return;
      if (syncServiceRef.current !== service) return;
      if (state.contentId && state.contentId.includes('.mpd') && state.contentId !== lastContentIdRef.current) {
        hasReceivedContent = true;
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        lastContentIdRef.current = state.contentId;
        loadMpd(state.contentId);
      }
    });

    service.on('position-update', (pos) => {
      if (!isActiveRef.current) return;
      if (syncServiceRef.current !== service) return;
      setPosition(pos);
    });

    service.on('error', ({ service: svc, error: err }) => {
      if (!isActiveRef.current) return;
      if (syncServiceRef.current !== service) return;
      console.error(`Error en ${svc}:`, err);
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
      setSyncState(SyncState.DISCONNECTED);
      setIsLoading(false);
      setAudioPlaying(false);
      setVideoPlaying(false);
      setSelectedAudio(null);
      setSelectedVideo(null);
      setAudios([]);
      setVideos([]);
      setMpdUrl(null);
      setStreamInfo(null);
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
      setStreamInfo(null);
      setError(null);
      lastContentIdRef.current = null;
    };
  }, [expanded, hasMediaSync, terminal]);

  // Cargar MPD
  const loadMpd = useCallback(async (url) => {
    try {
      const data = await MpdParserService.parseMpd(url);
      if (!isActiveRef.current) return;
      setAudios(data.audios || []);
      setVideos(data.videos || []);
      setStreamInfo({
        isLive: data.isLive || false,
        mpdType: data.mpdType || 'static',
        availabilityStartTime: data.availabilityStartTime,
        timeShiftBufferDepthSeconds: data.timeShiftBufferDepthSeconds,
      });
      setMpdUrl(url);
    } catch (err) {
      console.error('❌ Error carregant MPD:', err);
    } finally {
      if (isActiveRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Sincronizar audio con posición TV
  useEffect(() => {
    if (!selectedAudio || !audioPlaying || !position) return;

    const now = Date.now();
    if (now - lastSyncTimeRef.current < 500) return;
    lastSyncTimeRef.current = now;

    if (position.positionSeconds == null || (streamInfo?.isLive && audioCurrentPlaybackTimeRef.current === 0)) return;

    const audioTime = streamInfo?.isLive ? audioCurrentPlaybackTimeRef.current : audioCurrentTimeRef.current;
    const isLive = !!streamInfo?.isLive;
    const tvTime = (isLive && position.exoPlayerPositionSeconds != null)
      ? position.exoPlayerPositionSeconds
      : position.positionSeconds;
    const drift = audioTime - tvTime;
    const absDrift = Math.abs(drift);

    const seekThreshold = isLive ? 5 : 2;
    const okThreshold = 0.02;
    const maxCorrection = 0.05;
    const maxRate = 0.93;
    const minRate = 1.07;

    if (absDrift > seekThreshold) {
      const seekTarget = isLive ? audioCurrentTimeRef.current - drift : tvTime;
      if (audioPlayerRef.current) audioPlayerRef.current.seek(seekTarget);
      setAudioRate(1.0);
    } else if (absDrift > okThreshold) {
      const correction = Math.min(absDrift * 0.1, maxCorrection);
      const newRate = drift > 0 ? 1.0 - correction : 1.0 + correction;
      const clampedRate = Math.max(maxRate, Math.min(minRate, newRate));
      setAudioRate(clampedRate);
    } else {
      if (audioRate !== 1.0) setAudioRate(1.0);
    }
  }, [position, selectedAudio, audioPlaying, streamInfo]);

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

  // Sincronizar vídeo con posición TV (mismo algoritmo que el áudio)
  useEffect(() => {
    if (!selectedVideo || !videoPlaying || !position) return;

    const now = Date.now();
    if (now - lastVideoSyncTimeRef.current < 500) return;
    lastVideoSyncTimeRef.current = now;

    if (position.positionSeconds == null || (streamInfo?.isLive && videoCurrentPlaybackTimeRef.current === 0)) return;

    const videoTime = streamInfo?.isLive ? videoCurrentPlaybackTimeRef.current : videoCurrentTimeRef.current;
    const isLive = !!streamInfo?.isLive;
    const tvTime = (isLive && position.exoPlayerPositionSeconds != null)
      ? position.exoPlayerPositionSeconds
      : position.positionSeconds;
    const drift = videoTime - tvTime;
    const absDrift = Math.abs(drift);

    const seekThreshold = isLive ? 5 : 2;
    const okThreshold = 0.02;
    const maxCorrection = 0.05;
    const maxRate = 0.93;
    const minRate = 1.07;

    if (absDrift > seekThreshold) {
      const seekTarget = isLive ? videoCurrentTimeRef.current - drift : tvTime;
      if (videoPlayerRef.current) videoPlayerRef.current.seek(seekTarget);
      setVideoRate(1.0);
    } else if (absDrift > okThreshold) {
      const correction = Math.min(absDrift * 0.1, maxCorrection);
      const newRate = drift > 0 ? 1.0 - correction : 1.0 + correction;
      const clampedRate = Math.max(maxRate, Math.min(minRate, newRate));
      setVideoRate(clampedRate);
    } else {
      if (videoRate !== 1.0) setVideoRate(1.0);
    }
  }, [position, selectedVideo, videoPlaying, streamInfo]);

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
      return;
    }
    // Reproducir áudio i vídeo són mútuament excloents.
    setSelectedVideo(null);
    setVideoPlaying(false);
    setSelectedAudio(audio);
    setAudioPlaying(true);
    lastSyncTimeRef.current = 0;
  }, [selectedAudio]);

  const handleStopAudio = useCallback(() => {
    setSelectedAudio(null);
    setAudioPlaying(false);
  }, []);

  const handleSelectVideo = useCallback((video) => {
    if (selectedVideo?.representationId === video.representationId && selectedVideo?.role === video.role) {
      setSelectedVideo(null);
      setVideoPlaying(false);
      return;
    }
    // Reproducir áudio i vídeo són mútuament excloents.
    setSelectedAudio(null);
    setAudioPlaying(false);
    setSelectedVideo(video);
    setVideoPlaying(true);
    lastVideoSyncTimeRef.current = 0;
  }, [selectedVideo]);

  const handleStopVideo = useCallback(() => {
    setSelectedVideo(null);
    setVideoPlaying(false);
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
          {isLoading && (
            <ActivityIndicator color={theme.colors.primary} style={{ marginVertical: 16 }} />
          )}

          {!isLoading && audios.length === 0 && videos.length === 0 && (
            <Text style={styles.emptyText}>{t('discovery.waitingForContent')}</Text>
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
                    <Video
                      ref={videoPlayerRef}
                      source={{ uri: mpdUrl, type: 'mpd' }}
                      paused={!videoPlaying || !position?.isPlaying}
                      rate={videoPlaying && position?.isPlaying ? videoRate : 1.0}
                      volume={volume}
                      resizeMode="contain"
                      selectedVideoTrack={
                        selectedVideo.videoTrackIndex != null
                          ? { type: 'index', value: selectedVideo.videoTrackIndex }
                          : { type: 'auto' }
                      }
                      onLoad={() => {
                        if (position?.positionSeconds && videoPlayerRef.current && !streamInfo?.isLive) {
                          videoPlayerRef.current.seek(position.positionSeconds);
                        }
                      }}
                      onProgress={({ currentTime, currentPlaybackTime }) => {
                        videoCurrentTimeRef.current = currentTime;
                        videoCurrentPlaybackTimeRef.current = currentPlaybackTime / 1000;
                      }}
                      onError={(err) => {
                        console.error('Error reproduint vídeo:', err);
                        setVideoPlaying(false);
                      }}
                      progressUpdateInterval={250}
                      style={styles.videoSurface}
                    />
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
          {error && (
            <View style={styles.errorBanner}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name="error" size={14} color={theme.colors.onErrorContainer} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
              <Text style={styles.retryText}>{t('discovery.retryingConnection')}</Text>
            </View>
          )}

          {/* Reproductor de audio oculto */}
          {selectedAudio && mpdUrl && (
            <Video
              ref={audioPlayerRef}
              source={{ uri: mpdUrl, type: 'mpd' }}
              audioOnly={true}
              paused={!audioPlaying || !position?.isPlaying}
              rate={audioPlaying && position?.isPlaying ? audioRate : 1.0}
              volume={volume}
              playInBackground={true}
              playWhenInactive={true}
              ignoreSilentSwitch="ignore"
              selectedAudioTrack={
                selectedAudio.audioTrackIndex != null
                  ? { type: 'index', value: selectedAudio.audioTrackIndex }
                  : { type: 'language', value: selectedAudio.iso }
              }
              onLoad={() => {
                if (position?.positionSeconds && audioPlayerRef.current && !streamInfo?.isLive) {
                  audioPlayerRef.current.seek(position.positionSeconds);
                }
              }}
              onProgress={({ currentTime, currentPlaybackTime }) => {
                audioCurrentTimeRef.current = currentTime;
                audioCurrentPlaybackTimeRef.current = currentPlaybackTime / 1000;
              }}
              onError={(err) => {
                console.error('❌ Error reproduint àudio:', err);
                setAudioPlaying(false);
              }}
              progressUpdateInterval={250}
              style={{ height: 0, width: 0 }}
            />
          )}
        </View>
      )}
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


  errorBanner: {
    backgroundColor: theme.colors.errorContainer,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm,
    marginTop: theme.spacing.sm,
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
