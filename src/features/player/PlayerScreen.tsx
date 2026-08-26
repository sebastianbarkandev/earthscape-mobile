import React, { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { theme } from '@/common/theme';
import { resolveMediaUrl } from '@/common/config';
import { EmptyState } from '@/common/components/EmptyState';
import {
  loadEvent,
  resetPlayer,
  requestSeek,
  selectActiveVideo,
  setCurrentTime,
  setMuted,
  setLayout,
  setPaused,
  setPlaybackRate,
} from './playerSlice';
import { useFlightData } from './hooks/useFlightData';
import { useViewingHeartbeat } from './hooks/useViewingHeartbeat';
import { useTimeMapper } from './hooks/useTimeMapper';
import { PlayerVideo, type PlayerVideoHandle } from './components/PlayerVideo';
import { PlayerControls } from './components/PlayerControls';
import { ActionRow } from './components/ActionRow';
import { FlightMap } from './components/FlightMap';
import { TimelineCard } from './components/timeline/TimelineCard';
import { SidePanel } from './components/panel/SidePanel';
import { InfoCard } from './components/info/InfoCard';
import { ClipmarkSheet } from './components/timeline/ClipmarkSheet';
import { ShareModal } from './components/share/ShareModal';
import { ProgramStrip } from './components/ProgramStrip';
import { useRouter } from 'expo-router';
import { EarthscapeLive } from '../../../modules/earthscape-live';
import { setActiveClipmark } from './playerSlice';
import { useState } from 'react';
import { effectiveLayout, videoCapabilities, type DashboardLayout } from './videoCapabilities';
import { toggleGraph } from './graphSlice';

interface Props {
  eventId: string;
  videoIdHint?: number;
  /** Deep-link preselection of the dashboard layout. */
  initialLayout?: DashboardLayout;
  /** DEV-only deep-link pre-activation of graph series ('Category/Name'). */
  initialGraphs?: string[];
}

/**
 * THE screen — VOD and live are one page, exactly like the web where
 * LiveViewPage ultimately renders VideoPage. Regions mirror the web shell:
 * viewport (video / split / map) → action row → [timeline card, Phase B] →
 * [side panel + info card, Phase C].
 */
export function PlayerScreen({ eventId, videoIdHint, initialLayout, initialGraphs }: Props) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const status = useAppSelector((s) => s.player.status);
  const error = useAppSelector((s) => s.player.error);
  const video = useAppSelector(selectActiveVideo);
  const permissions = useAppSelector((s) => s.player.permissions);
  const features = useAppSelector((s) => s.auth.bootstrap?.features ?? null);
  const signedIn = useAppSelector((s) => !!s.auth.bootstrap?.current_user);
  const isLive = useAppSelector((s) => s.player.isLive);
  const mapData = useAppSelector((s) => s.player.mapData);
  const currentUtc = useAppSelector((s) => s.player.time.currentUtc);
  const currentVideo = useAppSelector((s) => s.player.time.currentVideo);
  const clipmarks = useAppSelector((s) => s.player.clipmarks);
  const seek = useAppSelector((s) => s.player.seek);
  const layoutChoice = useAppSelector((s) => s.player.layout);
  const playback = useAppSelector((s) => s.player.playback);
  const allVideos = useAppSelector((s) => s.player.videos);
  const showMultiprogram = useAppSelector((s) => s.auth.bootstrap?.features?.show_multiprogram ?? true);
  const liveEnabled = useAppSelector((s) => s.auth.bootstrap?.features?.live_enabled ?? true);
  const videoRef = useRef<PlayerVideoHandle>(null);
  const [panelSheetId, setPanelSheetId] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const mapper = useTimeMapper(video?.id ?? null);

  useEffect(() => {
    dispatch(loadEvent({ eventId, videoIdHint }));
    if (initialLayout) dispatch(setLayout(initialLayout));
    initialGraphs?.forEach((g) => {
      const [category, ...rest] = g.split('/');
      if (category && rest.length) dispatch(toggleGraph({ category, name: rest.join('/') }));
    });
    return () => {
      dispatch(resetPlayer());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, eventId, videoIdHint]);

  const reloadEvent = useCallback(() => dispatch(loadEvent({ eventId, videoIdHint })), [dispatch, eventId, videoIdHint]);
  useFlightData(video?.id ?? null, reloadEvent);

  // liveStreamState flip (live ended / went live) -> reload the event so the
  // source URL swaps (live playlist <-> VOD HLS). Same signal the web uses.
  const onLiveStateChanged = useCallback(() => {
    dispatch(loadEvent({ eventId, videoIdHint }));
  }, [dispatch, eventId, videoIdHint]);
  const pausedRef = useRef(false);
  pausedRef.current = playback.paused;
  const isPaused = useCallback(() => pausedRef.current, []);
  useViewingHeartbeat(video?.id ?? null, video?.live_stream_state ?? null, onLiveStateChanged, isPaused);

  // While live, re-read the event every 20s so programs that join mid-stream (e.g. a phone via
  // "Add my camera") appear for viewers already on the page; the heartbeat only reloads on state flips.
  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => dispatch(loadEvent({ eventId, videoIdHint: video?.id ?? videoIdHint })), 20000);
    return () => clearInterval(t);
  }, [dispatch, eventId, isLive, video?.id, videoIdHint]);

  const onTimeUpdate = useCallback(
    (videoTime: number) => {
      const utc = mapper ? mapper.videoToUtc(videoTime) : null;
      dispatch(setCurrentTime({ video: videoTime, utc }));
    },
    [dispatch, mapper],
  );
  // Store mirrors of the native player (never the other way round — see PlayerVideo).
  const onPlayingChange = useCallback((isPlaying: boolean) => dispatch(setPaused(!isPlaying)), [dispatch]);
  const onRateChange = useCallback((r: number) => dispatch(setPlaybackRate(r)), [dispatch]);
  const onMutedChange = useCallback((m: boolean) => dispatch(setMuted(m)), [dispatch]);

  const onShare = useCallback(() => setShareOpen(true), []);
  // Phone as a second program of THIS live event (web has no equivalent; see features/broadcast).
  const onAddCamera = useCallback(() => {
    if (!video) return;
    router.push({ pathname: '/golive', params: { eventId: String(video.event_id), title: video.title } } as never);
  }, [router, video]);
  const canAddCamera = !!video && video.live_stream_state === 'live' && liveEnabled && EarthscapeLive.isSupported;

  if (status === 'loading' || status === 'idle') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }
  if (status === 'error' || !video) {
    return <EmptyState title="Couldn't load this video" detail={error ?? undefined} />;
  }

  const caps = videoCapabilities(video, permissions, features, signedIn);
  const layout = effectiveLayout(video, layoutChoice);
  const layoutLocked = video.has_map === false || !video.has_video;
  const sourceUri = resolveMediaUrl(video.hls_stream_url) ?? resolveMediaUrl(video.mp4_url);
  const hasMap = mapData.loc.length > 0;
  const showVideo = layout !== 'map';
  const showMap = layout !== 'video';

  // Viewport sizing (web: --pl-viewport-h card; phone: video 16:9 then map below).
  const videoH = Math.round(width * 9 / 16);
  const mapH = landscape ? videoH : Math.round(width * 0.75);
  const sideBySide = landscape && showVideo && showMap;

  const videoPane = showVideo ? (
    video.has_video && sourceUri ? (
      <PlayerVideo
        ref={videoRef}
        sourceUri={sourceUri}
        onTimeUpdate={onTimeUpdate}
        onPlayingChange={onPlayingChange}
        onRateChange={onRateChange}
        onMutedChange={onMutedChange}
        seek={seek}
      >
        <PlayerControls
          paused={playback.paused}
          rate={playback.rate}
          muted={playback.muted}
          hasAudio={caps.hasAudio}
          isLive={caps.isLive}
          canSeek={caps.canSeek}
          currentTime={currentVideo ?? 0}
          duration={video.duration}
          onTogglePaused={() => videoRef.current?.togglePlay()}
          onSeekTo={(t) => dispatch(requestSeek(t))}
          onSeekBy={(s) => videoRef.current?.seekBy(s)}
          onRate={(r) => videoRef.current?.setRate(r)}
          onToggleMuted={() => videoRef.current?.setMuted(!playback.muted)}
          onFullscreen={() => videoRef.current?.enterFullscreen()}
          onGoLive={() => videoRef.current?.goLive()}
        />
      </PlayerVideo>
    ) : (
      <View style={[styles.noVideo, { flex: 1 }]}>
        <Text style={styles.noVideoText}>{isLive ? 'Waiting for stream…' : 'No playable video source'}</Text>
      </View>
    )
  ) : null;

  const mapPane = showMap ? (
    hasMap ? (
      <FlightMap
        mapData={mapData}
        currentUtc={currentUtc}
        followLatest={isLive}
        drawnObjects={video.drawn_objects ?? []}
        platformType={video.platform?.type ?? 'helicopter'}
      />
    ) : (
      <EmptyState title="No flight data" detail="This video has no map telemetry." compact />
    )
  ) : null;

  return (
    <ScrollView style={styles.screen} stickyHeaderIndices={[0]} contentContainerStyle={{ paddingBottom: 24 }}>
      {/* REGION 1 — viewport */}
      <View style={[styles.viewport, sideBySide && { flexDirection: 'row', height: videoH }]}>
        {showVideo && (
          <View style={sideBySide ? { flex: 1 } : undefined}>
            <View style={{ height: videoH }}>{videoPane}</View>
            {showMultiprogram && allVideos.length > 1 && (
              <ProgramStrip videos={allVideos} activeId={video.id} currentUtc={currentUtc} paused={playback.paused} seekNonce={seek?.nonce ?? null} />
            )}
          </View>
        )}
        {showMap && <View style={[sideBySide ? { flex: 1 } : { height: mapH }, styles.mapPane]}>{mapPane}</View>}
      </View>

      {/* Side rail (web ≤1100px: stacked under the viewport) — Events / TAK Chat / Drawings / Transcript */}
      <SidePanel
        video={video}
        onOpenClipmark={(id) => {
          dispatch(setActiveClipmark(id));
          setPanelSheetId(id);
        }}
      />

      {/* REGION 2 — lede + actions */}
      <ActionRow
        video={video}
        caps={caps}
        layout={layout}
        layoutLocked={layoutLocked}
        clipmarkCount={clipmarks.filter((c) => c.type !== 'tak_chat').length}
        onShare={onShare}
        onAddCamera={canAddCamera ? onAddCamera : undefined}
      />

      {/* REGION 3 — timeline card (clipmarks, clip in/out, zoom, metadata graphs) */}
      <TimelineCard videoId={video.id} />

      {/* REGION 4 — info card (details / sharing) */}
      <InfoCard video={video} caps={caps} />

      {panelSheetId != null && <ClipmarkSheet clipmarkId={panelSheetId} videoId={video.id} onClose={() => setPanelSheetId(null)} />}
      {shareOpen && <ShareModal video={video} onClose={() => setShareOpen(false)} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
  viewport: { backgroundColor: theme.videoBg },
  mapPane: { backgroundColor: theme.bgSubtle },
  noVideo: { backgroundColor: theme.videoBg, alignItems: 'center', justifyContent: 'center' },
  noVideoText: { color: theme.textTertiary, fontSize: 13 },
});
