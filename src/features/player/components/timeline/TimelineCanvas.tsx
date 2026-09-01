import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View, type GestureResponderEvent, type PanResponderInstance } from 'react-native';
import Svg, { G, Rect } from 'react-native-svg';
import { theme } from '@/common/theme';
import { formatTime } from '@/common/lib/formatTime';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { Clipmark } from '../../api';
import { beginClipDrag, endClipDrag, setZoom } from '../../playerSlice';
import { createClipmark, updateClipmark } from '../../clipmarkThunks';
import { HANDLE_HIT_W, MARK_HIT_W } from '../../timeline/constants';
import { shouldClaimMove, shouldReleaseResponder, touchDownX } from '../../timeline/gesture';
import { dragClip, finalizeDrag, startDrag, type ClipDrag } from '../../timeline/clippingMachine';
import { createGeometry, pinchWindow, transformFor, type Window } from '../../timeline/geometry';
import { selectActiveSeries, selectBounds, selectCurrentUserId, selectSensorSegments, selectTimeWindow } from '../../timeline/selectors';
import { canEditClipmark, timelineGlyph } from '../../timeline/clipmarkUtils';
import { useSeek } from '../../hooks/useSeek';
import { ClipHandles, ClipmarkLayer, DataLines, GhostBand, Playhead, SensorBands, Skimmer, TickMarkers } from './TimelineLayers';

interface Props {
  videoId: number;
  height: number;
  onSelectClipmark: (id: number) => void;
  /** Skimmer position while scrubbing (UTC) or null — drives the readout list. */
  onSkimmerChange: (utc: number | null) => void;
}

type Session =
  | { kind: 'scrub' }
  | { kind: 'clipCreate'; machine: ClipDrag }
  | { kind: 'handle'; machine: ClipDrag }
  | { kind: 'pinch'; startWindow: Window; c0: number; d0: number; live: Window };

type Hit = { clipmarkId: number | null; handle: { id: number; side: 'start' | 'end'; clip: Clipmark } | null };

/**
 * Port of the web TimelineMobile/Timeline SVG with touch gestures: tap = seek or
 * select a mark, drag = scrub (seek on release), clip tool drag = create,
 * handle drag on the active clip = resize, pinch/two-finger = zoom+pan.
 * Nothing is written to Redux during a gesture; one commit on release.
 * Responder policy (RESP-003, timeline/gesture.ts): the canvas sits inside the page
 * ScrollView, so it never claims a touch on start — taps go through a Pressable overlay
 * and a vertical swipe scrolls the page; only a horizontal-dominant move or a second
 * finger claims the gesture, and once committed it is never released mid-drag.
 */
export function TimelineCanvas({ videoId, height, onSelectClipmark, onSkimmerChange }: Props) {
  const dispatch = useAppDispatch();
  const seek = useSeek(videoId);
  const window = useAppSelector(selectTimeWindow);
  const bounds = useAppSelector(selectBounds);
  const clipmarks = useAppSelector((s) => s.player.clipmarks);
  const tl = useAppSelector((s) => s.player.timeline);
  const series = useAppSelector(selectActiveSeries);
  const sensors = useAppSelector(selectSensorSegments);
  const currentUserId = useAppSelector(selectCurrentUserId);
  const canUpdate = useAppSelector((s) => !!s.player.permissions?.videos.update);
  const canClip = currentUserId != null;

  const [width, setWidth] = useState(0);
  const [liveWindow, setLiveWindow] = useState<Window | null>(null);
  const [skimmer, setSkimmer] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ a: number; b: number } | null>(null);
  const session = useRef<Session | null>(null);
  const raf = useRef<number | null>(null);

  const win = liveWindow ?? window;
  const geo = useMemo(() => createGeometry(width, win.left, win.right), [width, win.left, win.right]);
  const baseGeo = useMemo(() => createGeometry(width, window.left, window.right), [width, window.left, window.right]);
  const transform = liveWindow ? transformFor(window, liveWindow, width) : null;

  const active = tl.activeClipmarkId != null ? clipmarks.find((c) => c.id === tl.activeClipmarkId) ?? null : null;
  const activeEditableClip =
    active && timelineGlyph(active) === 'band' && canEditClipmark(active, currentUserId, canUpdate) ? active : null;

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  const setSkimmerCoalesced = useCallback(
    (utc: number | null) => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        setSkimmer(utc);
        onSkimmerChange(utc);
      });
    },
    [onSkimmerChange],
  );

  // Refs so the PanResponder (created once) always sees fresh values.
  const live = useRef({ geo, window, bounds, clipmarks, tl, activeEditableClip, canClip, canUpdate, currentUserId, width });
  live.current = { geo, window, bounds, clipmarks, tl, activeEditableClip, canClip, canUpdate, currentUserId, width };

  const hitTest = (x: number): Hit => {
    const { geo: g, clipmarks: cms, tl: t, activeEditableClip: ae } = live.current;
    if (ae && ae.time_start != null && ae.time_end != null) {
      const x1 = g.xFromUtc(ae.time_start);
      const x2 = g.xFromUtc(ae.time_end);
      if (Math.abs(x - x1) <= HANDLE_HIT_W / 2) return { clipmarkId: ae.id, handle: { id: ae.id, side: 'start', clip: ae } };
      if (Math.abs(x - x2) <= HANDLE_HIT_W / 2) return { clipmarkId: ae.id, handle: { id: ae.id, side: 'end', clip: ae } };
    }
    if (!t.clipmarksVisible) return { clipmarkId: null, handle: null };
    let best: { id: number; d: number } | null = null;
    for (const c of cms) {
      const glyph = timelineGlyph(c);
      if (glyph === 'none' || c.time_start == null) continue;
      if (glyph === 'band') {
        const x1 = g.xFromUtc(c.time_start);
        const x2 = g.xFromUtc(c.time_end as number);
        if (x >= x1 - 4 && x <= x2 + 4) {
          const d = Math.min(Math.abs(x - x1), Math.abs(x - x2));
          if (!best || d < best.d) best = { id: c.id, d };
        }
      } else {
        const d = Math.abs(x - g.xFromUtc(c.time_start));
        if (d <= MARK_HIT_W / 2 && (!best || d < best.d)) best = { id: c.id, d };
      }
    }
    return { clipmarkId: best?.id ?? null, handle: null };
  };

  const touchesOf = (e: GestureResponderEvent) => e.nativeEvent.touches.map((t) => t.locationX);
  const pinchStats = (xs: number[]) => ({ c: (xs[0] + xs[1]) / 2, d: Math.max(1, Math.abs(xs[0] - xs[1])) });

  // Tap (no drag): select the mark under the finger or seek there. Pressable, not the
  // PanResponder, so the touch is never claimed on start (see gesture.ts).
  const onTap = (x: number) => {
    const hit = hitTest(x);
    if (hit.clipmarkId != null) onSelectClipmark(hit.clipmarkId);
    else seek.toUtc(live.current.geo.utcFromX(x));
  };

  // Where the finger went down, captured when the move is claimed (grant resets gestureState.dx).
  const downX = useRef(0);
  // Apply one move sample to a committed single-finger session.
  const applyMove = (cur: Session, x: number) => {
    const { geo: g, bounds: b } = live.current;
    if (cur.kind === 'scrub') {
      setSkimmerCoalesced(g.utcFromX(x));
    } else if (cur.kind === 'clipCreate' || cur.kind === 'handle') {
      cur.machine = dragClip(cur.machine, Math.min(b.end, Math.max(b.start, g.utcFromX(x))));
      setGhost({ a: g.xFromUtc(cur.machine.time_start), b: g.xFromUtc(cur.machine.time_end) });
    }
  };

  // Lazy init: `useRef(PanResponder.create(...))` would still evaluate create() on every 2 Hz render.
  const pan = useRef<PanResponderInstance | null>(null);
  pan.current ??= PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (e, g) => {
        const claim = shouldClaimMove(g.dx, g.dy, e.nativeEvent.touches.length);
        if (claim) downX.current = touchDownX(e.nativeEvent.locationX, g.dx);
        return claim;
      },
      onPanResponderTerminationRequest: () => shouldReleaseResponder(session.current?.kind),
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        const xs = touchesOf(e);
        const { geo: g, window: w, tl: t, canClip: cc } = live.current;
        if (xs.length >= 2) {
          const { c, d } = pinchStats(xs);
          session.current = { kind: 'pinch', startWindow: w, c0: c, d0: d, live: w };
          setSkimmerCoalesced(null);
          return;
        }
        const x0 = downX.current;
        const hit = hitTest(x0);
        let cur: Session;
        if (hit.handle) {
          const { clip, side } = hit.handle;
          const m = startDrag({ time_start: clip.time_start as number, time_end: clip.time_end as number }, side, clip.id);
          dispatch(beginClipDrag(clip.id));
          cur = { kind: 'handle', machine: m };
        } else if (t.tool === 'clip' && cc && t.clipping.mode === 'idle') {
          const t0 = g.utcFromX(x0);
          dispatch(beginClipDrag(null));
          cur = { kind: 'clipCreate', machine: startDrag({ time_start: t0, time_end: t0 }, 'end') };
        } else {
          cur = { kind: 'scrub' };
        }
        session.current = cur;
        applyMove(cur, xs[0] ?? e.nativeEvent.locationX); // the finger has already moved past the slop
      },
      onPanResponderMove: (e) => {
        const s = session.current;
        if (!s) return;
        const xs = touchesOf(e);
        const { window: w, bounds: b, width: W } = live.current;

        if (xs.length >= 2) {
          const { c, d } = pinchStats(xs);
          if (s.kind !== 'pinch') {
            session.current = { kind: 'pinch', startWindow: w, c0: c, d0: d, live: w };
            setGhost(null);
            setSkimmerCoalesced(null);
            return;
          }
          const next = pinchWindow(s.startWindow, { c0: s.c0, d0: s.d0, c, d }, W, b);
          s.live = next;
          setLiveWindow(next);
          return;
        }
        if (s.kind === 'pinch') return; // wait for release after a pinch

        applyMove(s, xs[0] ?? e.nativeEvent.locationX);
      },
      onPanResponderRelease: (e) => {
        const s = session.current;
        session.current = null;
        if (!s) return;
        const { geo: g } = live.current;
        if (s.kind === 'pinch') {
          dispatch(setZoom(s.live));
          setLiveWindow(null);
          return;
        }
        if (s.kind === 'scrub') {
          const x = e.nativeEvent.locationX;
          setSkimmerCoalesced(null);
          seek.toUtc(g.utcFromX(x));
          return;
        }
        setGhost(null);
        dispatch(endClipDrag());
        if (s.kind === 'clipCreate') {
          const f = finalizeDrag(s.machine);
          dispatch(createClipmark({ time_start: f.time_start, time_end: f.time_end, type: f.type }));
        } else if (s.kind === 'handle' && s.machine.clipmarkId != null) {
          if (s.machine.time_end - s.machine.time_start >= 0.5)
            dispatch(updateClipmark({ id: s.machine.clipmarkId, time_start: s.machine.time_start, time_end: s.machine.time_end }));
        }
      },
      onPanResponderTerminate: () => {
        const s = session.current;
        session.current = null;
        setGhost(null);
        setLiveWindow(null);
        setSkimmerCoalesced(null);
        if (s && (s.kind === 'clipCreate' || s.kind === 'handle')) dispatch(endClipDrag());
      },
    });
  const panHandlers = pan.current.panHandlers;

  const currentUtc = useAppSelector((s) => s.player.time.currentUtc);
  const currentVideo = useAppSelector((s) => s.player.time.currentVideo);
  const clipInGhost =
    tl.clipping.mode === 'clipIn' && currentUtc != null ? { a: geo.xFromUtc(tl.clipping.time_start), b: geo.xFromUtc(currentUtc) } : null;
  const skimLabel = skimmer != null && seek.mapper ? formatTime(seek.mapper.utcToVideo(skimmer) ?? 0, false) : '';

  return (
    <View style={[styles.wrap, { height }]} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} {...panHandlers}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(e) => onTap(e.nativeEvent.locationX)}
        accessibilityRole="adjustable"
        accessibilityLabel="Timeline"
        accessibilityHint="Tap to seek or select an event. Drag sideways to scrub, pinch to zoom."
      />
      {width > 0 && (
        <Svg width={width} height={height} pointerEvents="none">
          <Rect x={0} y={0} width={width} height={height} fill={theme.surface} />
          <G transform={transform ? `translate(${transform.tx},0) scale(${transform.sx},1)` : undefined}>
            <SensorBands segments={sensors} visibility={tl.sensorVisibility} geo={baseGeo} height={height} />
            <DataLines series={series} left={window.left} right={window.right} width={width} height={height} />
          </G>
          <TickMarkers start={bounds.start} end={bounds.end} left={win.left} right={win.right} width={width} height={height} />
          {tl.clipmarksVisible && <ClipmarkLayer clipmarks={clipmarks} activeId={tl.activeClipmarkId} geo={geo} height={height} />}
          {(ghost ?? clipInGhost) && <GhostBand x1={(ghost ?? clipInGhost)!.a} x2={(ghost ?? clipInGhost)!.b} height={height} />}
          {activeEditableClip && !ghost && (
            <ClipHandles x1={geo.xFromUtc(activeEditableClip.time_start as number)} x2={geo.xFromUtc(activeEditableClip.time_end as number)} height={height} width={width} />
          )}
          {skimmer != null && <Skimmer x={geo.xFromUtc(skimmer)} label={skimLabel} height={height} width={width} />}
          {currentUtc != null && <Playhead x={geo.xFromUtc(currentUtc)} label={formatTime(currentVideo ?? 0, false)} height={height} width={width} />}
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', backgroundColor: theme.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.border },
});
