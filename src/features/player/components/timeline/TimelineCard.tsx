import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { theme } from '@/common/theme';
import { useAppDispatch, useAppSelector, useAppStore } from '@/store/hooks';
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

/**
 * RESP-024: the auto-clip-out watch is the ONLY thing in this card that needs the clock
 * continuously, so it subscribes on its own and renders nothing. Subscribing at card level
 * re-rendered the toolbar (~10 Pressables), the metadata well (up to ~60 field rows) and the
 * readout list twice a second for chrome that never changes.
 */
function ClipOutWatch({ active, onClipOut }: { active: boolean; onClipOut: () => void }) {
  const currentVideo = useAppSelector((s) => s.player.time.currentVideo);
  const duration = useAppSelector((s) => s.player.time.duration);
  useEffect(() => {
    // Web ButtonBar: reaching the end of the video while clipping auto clips out.
    if (active && duration != null && currentVideo != null && currentVideo >= duration - 0.25) onClipOut();
  }, [active, duration, currentVideo, onClipOut]);
  return null;
}

/** REGION 3 — web .pl-timeline-card (toolbar + canvas well + metadata well). */
export function TimelineCard({ videoId }: { videoId: number }) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const seek = useSeek(videoId);
  const tl = useAppSelector((s) => s.player.timeline);
  const sorted = useAppSelector(selectSortedClipmarks);
  const sensors = useAppSelector(selectSensorSegments);
  const canClip = useAppSelector(selectCurrentUserId) != null;
  const busy = useAppSelector((s) => s.player.clipmarkOp.op === 'create');
  const [skimmer, setSkimmer] = useState<number | null>(null);
  const [wellOpen, setWellOpen] = useState(false);
  const [sheetId, setSheetId] = useState<number | null>(null);

  const clipInActive = tl.clipping.mode === 'clipIn';

  // RESP-024: the playhead is READ at press time from the store instead of being subscribed
  // to — these callbacks then stay stable across the 2 Hz clock and so do their children.
  const utcNow = useCallback(() => store.getState().player.time.currentUtc, [store]);

  const onMark = useCallback(() => {
    const currentUtc = utcNow();
    if (currentUtc != null) dispatch(createClipmark({ time_start: currentUtc, time_end: null, type: 'timepoint', text: 'New Timepoint' }));
  }, [dispatch, utcNow]);
  const onClipIn = useCallback(() => {
    const currentUtc = utcNow();
    if (currentUtc != null) dispatch(clipIn(currentUtc));
  }, [dispatch, utcNow]);
  const onClipOut = useCallback(() => {
    const currentUtc = utcNow();
    if (tl.clipping.mode !== 'clipIn' || currentUtc == null) return;
    const start = tl.clipping.time_start; // read BEFORE clearing (web clipOut trap)
    dispatch(cancelClipIn());
    if (currentUtc - start < 0.05) return;
    dispatch(createClipmark({ time_start: Math.min(start, currentUtc), time_end: Math.max(start, currentUtc), type: 'clip', text: 'New Clip' }));
  }, [dispatch, tl.clipping, utcNow]);

  const jump = (dir: 'prev' | 'next') => {
    const currentUtc = utcNow();
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
      <ClipOutWatch active={clipInActive} onClipOut={onClipOut} />
      <ReadoutList skimUtc={skimmer} />
      <MetadataWell expanded={wellOpen} onToggle={() => setWellOpen((v) => !v)} />
      {sheetId != null && <ClipmarkSheet clipmarkId={sheetId} videoId={videoId} onClose={() => setSheetId(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border },
});
