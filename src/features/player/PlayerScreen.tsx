import React, { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { theme } from '@/common/theme';
import { resolveMediaUrl } from '@/common/config';
import { edgePadding } from '@/common/layout';
import { EmptyState } from '@/common/components/EmptyState';
import {
  loadEvent,
  refreshEvent,
  resetPlayer,
  requestSeek,
  selectActiveVideo,
  selectAnyLive,
  selectPrimaryVideo,
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
import { useFocusEffect, useRouter } from 'expo-router';
import { EarthscapeLive } from '../../../modules/earthscape-live';
import { setActiveClipmark } from './playerSlice';
import { useState } from 'react';
import { effectiveLayout, videoCapabilities, type DashboardLayout } from './videoCapabilities';
import { canAddCameraTo } from '@/features/broadcast/liveGates';
import { toggleGraph } from './graphSlice';
import { existingProgramLabels, programTrackLabel } from './programs';
import { computeViewportSize } from './viewportLayout';
import { PinnedHeader, StickyEnabledContext } from './components/PinnedHeader';
import { useKeyboardHeight } from '@/common/hooks/useKeyboardHeight';

/** Constant on purpose — see PinnedHeader / RESP-018. */
const STICKY_INDICES = [0];

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
  const insets = useSafeAreaInsets();
  // RESP-027: the page has five in-page text fields (metadata well / transcript / events search,
  // the inline event edit, the Sharing tab's recipient field). In portrait the viewport is PINNED
  // at up to 55% of the visible height, so with the keyboard up (336pt on a 15/16, 260pt on an SE)
  // only ~20pt / ~11pt of the page was left between them and nothing could be scrolled into view.
  const keyboardHeight = useKeyboardHeight();
  const status = useAppSelector((s) => s.player.status);
  const error = useAppSelector((s) => s.player.error);
  const video = useAppSelector(selectActiveVideo);
  const permissions = useAppSelector((s) => s.player.permissions);
  const primaryPermissions = useAppSelector((s) => s.player.primaryPermissions);
  const features = useAppSelector((s) => s.auth.bootstrap?.features ?? null);
  const signedIn = useAppSelector((s) => !!s.auth.bootstrap?.current_user);
  const isLive = useAppSelector((s) => s.player.isLive);
  const mapData = useAppSelector((s) => s.player.mapData);
  // NOTE: the playback clock (time.currentUtc / currentVideo) is deliberately NOT selected here —
  // PlayerControls, FlightMap, ProgramStrip and TimelineCard subscribe to it themselves so the
  // 2 Hz timeUpdate never re-renders the whole page (RESP-002; guarded by PlayerScreen.rerender.test).
  const clipmarks = useAppSelector((s) => s.player.clipmarks);
  const seek = useAppSelector((s) => s.player.seek);
  const layoutChoice = useAppSelector((s) => s.player.layout);
  const playback = useAppSelector((s) => s.player.playback);
  const allVideos = useAppSelector((s) => s.player.videos);
  const primary = useAppSelector(selectPrimaryVideo);
  const anyLive = useAppSelector(selectAnyLive);
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

  // Every mid-view re-read goes through the NON-destructive refresh: the active video
  // (whatever the viewer swapped to), the running player, the map history, the graphs and
  // the timeline all survive; only the merged videos[] / live state / source URL change.
  const refresh = useCallback(() => {
    dispatch(refreshEvent({ eventId }));
  }, [dispatch, eventId]);
  // flight_data 403 mid-transition (LIVESTREAMS vs VIDEOS READ quirk) -> refresh, backed off in the hook.
  useFlightData(video?.id ?? null, refresh);

  // liveStreamState flip (live ended / went live) -> refresh the event so the
  // source URL swaps (live playlist <-> VOD HLS). Same signal the web uses.
  const pausedRef = useRef(false);
  pausedRef.current = playback.paused;
  const isPaused = useCallback(() => pausedRef.current, []);
  useViewingHeartbeat(video?.id ?? null, video?.live_stream_state ?? null, refresh, isPaused);

  // While ANY program is live, re-read the event every 20s so programs that join/end mid-stream
  // (phones via "Add my camera") appear/disappear for viewers already on the page.
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh, anyLive]);

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
  // LIVE-020: set only when "Add my camera" paused a PLAYING player, so the resume below never
  // starts playback the viewer had deliberately stopped.
  const pausedForMicRef = useRef(false);
  // LIVE-030: exactly one push per tap. react-navigation does not dedupe pushes and the modal only
  // blocks touches once its view covers the button, so a double tap stacked TWO /golive screens —
  // which share the one broadcast slice and the singleton native publisher, so dismissing the top
  // one ran leave() and ended the stream under the other. The second press also re-read
  // `playback.paused` (already true from the first) and reset pausedForMicRef to false, losing the
  // LIVE-020 resume. Cleared unconditionally by the focus effect below, i.e. on every return here.
  const navigatingToGoLiveRef = useRef(false);
  // Phone as a second program of THIS live event (web has no equivalent; see features/broadcast).
  const onAddCamera = useCallback(() => {
    if (!video || navigatingToGoLiveRef.current) return;
    navigatingToGoLiveRef.current = true;
    // LIVE-020: the publisher takes the mic with an AVAudioSession that routes to the speaker,
    // so anything still playing here would be captured and re-published as an echo of the primary
    // on the joined program. Hand over the audio route silent. Pausing is also what keeps the
    // handover stable: expo-video's VideoManager re-asserts a `.playback` audio session on every
    // playingChange (node_modules/expo-video/ios/VideoPlayer.swift:322), which would clobber the
    // publisher's `.playAndRecord` session if this player kept stalling/resuming in the background.
    pausedForMicRef.current = !playback.paused;
    videoRef.current?.pause();
    dispatch(setPaused(true));
    router.push({
      pathname: '/golive',
      params: { eventId: String(video.event_id), title: primary?.title ?? video.title, programs: JSON.stringify(existingProgramLabels(allVideos)) },
    } as never);
  }, [dispatch, router, video, primary, allVideos, playback.paused]);
  // LIVE-020 (the other half): coming back from the Go Live screen gives the audio route back —
  // the native module released the recording session in stopPreview() — so resume what we muted.
  // The player, not the store, is the source of truth: play() through the ref, and the resulting
  // playingChange mirrors itself into playback.paused.
  useFocusEffect(
    useCallback(() => {
      navigatingToGoLiveRef.current = false;
      if (!pausedForMicRef.current) return;
      pausedForMicRef.current = false;
      videoRef.current?.play();
    }, []),
  );
  // The backend joins a phone only while the PRIMARY is live (409 otherwise) — gate on it, not on the active program.
  // SEC-005/SEC-017: also require UPDATE on the PRIMARY (admin / uploader / ACL grant), not on whichever tile is
  // being watched — a read-only member must not see the action.
  const canAddCamera = !!video && canAddCameraTo(primary, primaryPermissions, liveEnabled && EarthscapeLive.isSupported);

  if (status === 'loading' || status === 'idle') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }
  if (status === 'error' || !video) {
    // UI-027: a transient 500 / dropped connection used to leave a dead card whose only exit
    // was the back button. Nothing is mounted yet, so the destructive full load is correct here.
    return (
      <EmptyState
        title="Couldn't load this video"
        detail={error ?? undefined}
        action={{ label: 'Try again', onPress: () => dispatch(loadEvent({ eventId, videoIdHint })) }}
      />
    );
  }

  const caps = videoCapabilities(video, permissions, features, signedIn);
  const layout = effectiveLayout(video, layoutChoice);
  const layoutLocked = video.has_map === false || !video.has_video;
  const sourceUri = resolveMediaUrl(video.hls_stream_url) ?? resolveMediaUrl(video.mp4_url);
  const hasMap = mapData.loc.length > 0;
  const showVideo = layout !== 'map';
  const showMap = layout !== 'video';

  // Viewport sizing from BOTH window axes (web: --pl-viewport-h card). Portrait pins the
  // viewport but caps it so the controls bar / action row / timeline stay reachable;
  // landscape fills the visible height and scrolls (see viewportLayout.ts + its tests).
  const { videoH, mapH, sideBySide, sticky, contentPaddingBottom } = computeViewportSize({
    width,
    height,
    insets,
    layout,
    isPad: Platform.OS === 'ios' && Platform.isPad,
  });

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
        isLive={caps.isLive}
      >
        <PlayerControls
          paused={playback.paused}
          rate={playback.rate}
          muted={playback.muted}
          hasAudio={caps.hasAudio}
          isLive={caps.isLive}
          canSeek={caps.canSeek}
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
        followLatest={isLive}
        drawnObjects={video.drawn_objects ?? []}
        platformType={video.platform?.type ?? 'helicopter'}
        trackLabel={programTrackLabel(allVideos, video.id)}
      />
    ) : (
      <EmptyState title="No flight data" detail="This video has no map telemetry." compact />
    )
  ) : null;

  return (
    // RESP-018: `stickyHeaderIndices` stays CONSTANT — toggling it swaps the element type at slot 0
    // (RN wraps a sticky child in ScrollViewStickyHeader) and remounts the viewport, i.e. a new
    // AVPlayer from t=0 and a fresh MapView on every rotation. Pinning is switched off through
    // PinnedHeader's context instead, which leaves the rendered tree identical.
    // RESP-027: unpin while the keyboard is up so the whole page can scroll past it. Switching
    // the CONTEXT (not `stickyHeaderIndices`) is what keeps the viewport mounted — see RESP-018.
    <StickyEnabledContext.Provider value={sticky && keyboardHeight === 0}>
    <ScrollView
      style={styles.screen}
      stickyHeaderIndices={STICKY_INDICES}
      StickyHeaderComponent={PinnedHeader}
      // RESP-027: iOS only adjusts the content inset for the keyboard when asked; without it a
      // focused field below the fold cannot be brought into view at all.
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: contentPaddingBottom }}
    >
      {/* REGION 1 — viewport (index 0 = the only sticky child; everything below scrolls) */}
      <View testID="player-viewport" style={[styles.viewport, sideBySide && { flexDirection: 'row', height: videoH }]}>
        {showVideo && <View style={sideBySide ? { flex: 1 } : { height: videoH }}>{videoPane}</View>}
        {showMap && <View style={[sideBySide ? { flex: 1 } : { height: mapH }, styles.mapPane]}>{mapPane}</View>}
      </View>
      {/* RESP-025: ONE horizontal gutter for everything below the viewport. In landscape iOS
          reports `insets.left/right ≈ 59` (Dynamic Island side + rounded corners) and none of
          these regions consumed it — worst of all TimelineCanvas, which is deliberately drawn
          edge-to-edge (`width: '100%'`, x = 0…width), so its scrub surface at t=start / t=end
          sat under the corner radius and the sensor housing. `min: 0` keeps portrait
          pixel-identical (each region keeps its own designed 12pt), the viewport above stays
          full-bleed, and the canvas re-measures through its own `onLayout`, so the time<->x
          mapping simply follows the narrower surface — no geometry change anywhere. */}
      <View testID="player-content" style={edgePadding(insets, 0)}>
      {/* Other programs of the event — outside the pinned block so it never eats the page. */}
      {showMultiprogram && allVideos.length > 1 && (
        <ProgramStrip videos={allVideos} activeId={video.id} activeIsLive={isLive} />
      )}

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
      </View>
    </ScrollView>
    </StickyEnabledContext.Provider>
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
