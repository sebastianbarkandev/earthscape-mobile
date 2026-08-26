import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { theme } from '@/common/theme';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { cancelClipIn, clipIn, resetZoom, setActiveClipmark, setTimelineTool, toggleClipmarksVisible, toggleSensor } from '../../playerSlice';
import { createClipmark } from '../../clipmarkThunks';
import { selectCurrentUserId, selectSensorSegments, selectSortedClipmarks } from '../../timeline/selectors';
import { nextClipmark, prevClipmark } from '../../timeline/clipmarkUtils';
import { TIMELINE_HEIGHT } from '../../timeline/constants';
import { useSeek } from '../../hooks/useSeek';
import { TimelineToolbar } from './TimelineToolbar';
import { TimelineCanvas } from './TimelineCanvas';
import { ReadoutList } from './ReadoutList';
import { MetadataWell } from './MetadataWell';
import { ClipmarkSheet } from './ClipmarkSheet';

/** REGION 3 — web .pl-timeline-card (toolbar + canvas well + metadata well). */
export function TimelineCard({ videoId }: { videoId: number }) {
  const dispatch = useAppDispatch();
  const seek = useSeek(videoId);
  const tl = useAppSelector((s) => s.player.timeline);
  const currentUtc = useAppSelector((s) => s.player.time.currentUtc);
  const currentVideo = useAppSelector((s) => s.player.time.currentVideo);
  const duration = useAppSelector((s) => s.player.time.duration);
  const sorted = useAppSelector(selectSortedClipmarks);
  const sensors = useAppSelector(selectSensorSegments);
  const canClip = useAppSelector(selectCurrentUserId) != null;
  const busy = useAppSelector((s) => s.player.clipmarkOp.op === 'create');
  const [skimmer, setSkimmer] = useState<number | null>(null);
  const [wellOpen, setWellOpen] = useState(false);
  const [sheetId, setSheetId] = useState<number | null>(null);

  const clipInActive = tl.clipping.mode === 'clipIn';

  const onMark = useCallback(() => {
    if (currentUtc != null) dispatch(createClipmark({ time_start: currentUtc, time_end: null, type: 'timepoint', text: 'New Timepoint' }));
  }, [dispatch, currentUtc]);
  const onClipIn = useCallback(() => {
    if (currentUtc != null) dispatch(clipIn(currentUtc));
  }, [dispatch, currentUtc]);
  const onClipOut = useCallback(() => {
    if (tl.clipping.mode !== 'clipIn' || currentUtc == null) return;
    const start = tl.clipping.time_start; // read BEFORE clearing (web clipOut trap)
    dispatch(cancelClipIn());
    if (currentUtc - start < 0.05) return;
    dispatch(createClipmark({ time_start: Math.min(start, currentUtc), time_end: Math.max(start, currentUtc), type: 'clip', text: 'New Clip' }));
  }, [dispatch, tl.clipping, currentUtc]);

  // Web ButtonBar: reaching the end of the video while clipping auto clips out.
  useEffect(() => {
    if (clipInActive && duration != null && currentVideo != null && currentVideo >= duration - 0.25) onClipOut();
  }, [clipInActive, duration, currentVideo, onClipOut]);

  const jump = (dir: 'prev' | 'next') => {
    if (currentUtc == null) return;
    const t = dir === 'prev' ? prevClipmark(sorted, currentUtc) : nextClipmark(sorted, currentUtc);
    if (t?.time_start != null) {
      dispatch(setActiveClipmark(t.id));
      seek.toUtc(t.time_start);
    }
  };

  return (
    <View style={styles.card}>
      <TimelineToolbar
        canClip={canClip}
        tool={tl.tool}
        onToolChange={(t) => dispatch(setTimelineTool(t))}
        clipInActive={clipInActive}
        onMark={onMark}
        onClipIn={onClipIn}
        onClipOut={onClipOut}
        onCancelClipIn={() => dispatch(cancelClipIn())}
        hasEvents={sorted.length > 0}
        onPrev={() => jump('prev')}
        onNext={() => jump('next')}
        zoomed={tl.window != null}
        onResetZoom={() => dispatch(resetZoom())}
        clipmarksVisible={tl.clipmarksVisible}
        onToggleClipmarks={() => dispatch(toggleClipmarksVisible())}
        sensorsAvailable={sensors.length > 0}
        sensorVisibility={tl.sensorVisibility}
        onToggleSensor={(v) => dispatch(toggleSensor(v))}
        busy={busy}
      />
      <TimelineCanvas
        videoId={videoId}
        height={TIMELINE_HEIGHT}
        onSelectClipmark={(id) => {
          dispatch(setActiveClipmark(id));
          setSheetId(id);
        }}
        onSkimmerChange={setSkimmer}
      />
      <ReadoutList atUtc={skimmer ?? currentUtc} />
      <MetadataWell expanded={wellOpen} onToggle={() => setWellOpen((v) => !v)} />
      {sheetId != null && <ClipmarkSheet clipmarkId={sheetId} videoId={videoId} onClose={() => setSheetId(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border },
});
