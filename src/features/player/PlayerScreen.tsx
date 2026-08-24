import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
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
} from './playerSlice';
import { useFlightData } from './hooks/useFlightData';
import { useViewingHeartbeat } from './hooks/useViewingHeartbeat';
import { useTimeMapper } from './hooks/useTimeMapper';
import { PlayerVideo } from './components/PlayerVideo';
import { FlightMap } from './components/FlightMap';
import { ClipmarkRow } from './components/ClipmarkRow';
import type { Clipmark } from './api';

interface Props {
  eventId: string;
  videoIdHint?: number;
}

/**
 * THE screen — VOD and live are one page, exactly like the web where
 * LiveViewPage ultimately renders VideoPage. Layout: video top (16:9),
 * clipmark chip strip, synced map below.
 */
export function PlayerScreen({ eventId, videoIdHint }: Props) {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.player.status);
  const error = useAppSelector((s) => s.player.error);
  const video = useAppSelector(selectActiveVideo);
  const isLive = useAppSelector((s) => s.player.isLive);
  const mapData = useAppSelector((s) => s.player.mapData);
  const currentUtc = useAppSelector((s) => s.player.time.currentUtc);
  const clipmarks = useAppSelector((s) => s.player.clipmarks);
  const seek = useAppSelector((s) => s.player.seek);

  const mapper = useTimeMapper(video?.id ?? null);

  useEffect(() => {
    dispatch(loadEvent({ eventId, videoIdHint }));
    return () => {
      dispatch(resetPlayer());
    };
  }, [dispatch, eventId, videoIdHint]);

  useFlightData(video?.id ?? null);

  // liveStreamState flip (live ended / went live) -> reload the event so the
  // source URL swaps (live playlist <-> VOD HLS). Same signal the web uses.
  const onLiveStateChanged = useCallback(() => {
    dispatch(loadEvent({ eventId, videoIdHint }));
  }, [dispatch, eventId, videoIdHint]);
  useViewingHeartbeat(video?.id ?? null, video?.live_stream_state ?? null, onLiveStateChanged);

  const onTimeUpdate = useCallback(
    (videoTime: number) => {
      const utc = mapper ? mapper.videoToUtc(videoTime) : null;
      dispatch(setCurrentTime({ video: videoTime, utc }));
    },
    [dispatch, mapper],
  );

  const onClipmarkPress = useCallback(
    (c: Clipmark) => {
      if (!mapper || c.time_start == null) return;
      const videoTime = mapper.utcToVideo(c.time_start);
      if (videoTime != null) dispatch(requestSeek(videoTime));
    },
    [dispatch, mapper],
  );

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

  const sourceUri = resolveMediaUrl(video.hls_stream_url) ?? resolveMediaUrl(video.mp4_url);
  const hasMap = mapData.loc.length > 0;

  return (
    <View style={styles.screen}>
      {video.has_video && sourceUri ? (
        <PlayerVideo
          sourceUri={sourceUri}
          isLive={isLive}
          onTimeUpdate={onTimeUpdate}
          seek={seek}
        />
      ) : (
        <View style={styles.noVideo}>
          <Text style={styles.noVideoText}>
            {isLive ? 'Waiting for stream…' : 'No playable video source'}
          </Text>
        </View>
      )}

      {clipmarks.length > 0 && (
        <FlatList
          horizontal
          data={clipmarks}
          keyExtractor={(c) => String(c.id)}
          renderItem={({ item }) => <ClipmarkRow clipmark={item} onPress={onClipmarkPress} />}
          style={styles.chips}
          contentContainerStyle={styles.chipsContent}
          showsHorizontalScrollIndicator={false}
        />
      )}

      <View style={styles.map}>
        {hasMap ? (
          <FlightMap mapData={mapData} currentUtc={currentUtc} followLatest={isLive} />
        ) : (
          <EmptyState title="No flight data" detail="This video has no map telemetry." compact />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
  noVideo: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: theme.videoBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noVideoText: { color: theme.textTertiary, fontSize: 13 },
  chips: { flexGrow: 0, backgroundColor: theme.bgSubtle },
  chipsContent: { paddingHorizontal: 12, paddingVertical: 8 },
  map: { flex: 1, backgroundColor: theme.bgSubtle },
});
