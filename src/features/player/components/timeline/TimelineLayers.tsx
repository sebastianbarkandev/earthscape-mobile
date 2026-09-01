import React, { useMemo } from 'react';
import { G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { theme } from '@/common/theme';
import { formatTime } from '@/common/lib/formatTime';
import type { Clipmark } from '../../api';
import { BAND_HEIGHT_RATIO, BAND_MAX_H, BAND_MIN_H, BAND_TOP_RATIO, EDGE_WIDTH } from '../../timeline/constants';
import { buildDataLinePath } from '../../timeline/dataLinePath';
import { clampToCanvas, createGeometry, labelPlacement, type Geometry } from '../../timeline/geometry';
import type { ActiveSeries } from '../../timeline/selectors';
import { sensorColor, type SensorSegment } from '../../timeline/sensorBands';
import { computeTicks } from '../../timeline/tickMarkers';
import { isSystemGenerated, timelineGlyph } from '../../timeline/clipmarkUtils';

/** Memoized SVG layers. Props are plain values so React.memo actually short-circuits. */

/** Axis tick label size, and the 'LP' plate's — `labelPlacement` needs the real value. */
export const TICK_FONT_SIZE = 10;
const PLATE_FONT_SIZE = 9;

export function bandGeometry(height: number) {
  const h = Math.min(BAND_MAX_H, Math.max(BAND_MIN_H, height * BAND_HEIGHT_RATIO));
  return { y: height * BAND_TOP_RATIO, h };
}

// ── Data lines (web DataTimeline/DataLine) ──────────────────────────────────
const DataLinePath = React.memo(function DataLinePath({
  s, left, right, width, height,
}: { s: ActiveSeries; left: number; right: number; width: number; height: number }) {
  const d = useMemo(() => buildDataLinePath(s.series, { left, right, width, height, meta: s.meta }), [s.series, s.meta, left, right, width, height]);
  if (!d) return null;
  return <Path d={d} fill={s.meta.color} fillOpacity={0.3} stroke={s.meta.color} strokeWidth={1} />;
});

export const DataLines = React.memo(function DataLines({ series, left, right, width, height }: { series: ActiveSeries[]; left: number; right: number; width: number; height: number }) {
  return (
    <G>
      {series.map((s) => (
        <DataLinePath key={s.key} s={s} left={left} right={right} width={width} height={height} />
      ))}
    </G>
  );
});

// ── Sensor bands (web Timeline.jsx sensor background) ──────────────────────
export const SensorBands = React.memo(function SensorBands({
  segments, visibility, geo, height,
}: { segments: SensorSegment[]; visibility: Record<number, boolean>; geo: Geometry; height: number }) {
  return (
    <G>
      {segments.map((seg, i) => {
        if (!visibility[seg.value]) return null;
        const color = sensorColor(seg.value);
        if (!color) return null;
        const x1 = geo.xFromUtc(seg.startTime);
        const x2 = seg.endTime == null ? geo.width : geo.xFromUtc(seg.endTime);
        if (x2 <= x1) return null;
        return <Rect key={i} x={x1} y={0} width={x2 - x1} height={height} fill={color} />;
      })}
    </G>
  );
});

// ── Tick markers (web Markers/Marker) ───────────────────────────────────────
export const TickMarkers = React.memo(function TickMarkers({
  start, end, left, right, width, height,
}: { start: number; end: number; left: number; right: number; width: number; height: number }) {
  const ticks = useMemo(() => computeTicks({ start, end, left, right, width }), [start, end, left, right, width]);
  return (
    <G>
      {ticks.map((t) => {
        // UI-025: the same clipping UI-016 fixed for the playhead/skimmer. `computeTicks`
        // admits any tick with x <= width, and `text-anchor: start` then drew the last
        // label past the SVG viewport (61s fixture, 375pt canvas: x=368.8, label 24pt wide),
        // so the right-most time simply vanished.
        const p = labelPlacement(t.x, width, t.label, TICK_FONT_SIZE);
        return (
          <G key={t.seconds}>
            <Line x1={t.x} y1={0} x2={t.x} y2={height} stroke={theme.border} strokeWidth={1} />
            <SvgText x={p.x} textAnchor={p.anchor} y={12} fontSize={TICK_FONT_SIZE} fill={theme.textTertiary}>
              {t.label}
            </SvgText>
          </G>
        );
      })}
    </G>
  );
});

// ── Clipmarks (web TimelineClipmarkLayer / TimelineClipmark / Instantaneous) ──
export const ClipmarkLayer = React.memo(function ClipmarkLayer({
  clipmarks, activeId, geo, height,
}: { clipmarks: Clipmark[]; activeId: number | null; geo: Geometry; height: number }) {
  const band = bandGeometry(height);
  return (
    <G>
      {clipmarks.map((c) => {
        const glyph = timelineGlyph(c);
        if (glyph === 'none' || c.time_start == null) return null;
        const system = isSystemGenerated(c);
        const active = c.id === activeId;
        if (glyph === 'band') {
          const x1 = geo.xFromUtc(c.time_start);
          const x2 = geo.xFromUtc(c.time_end as number);
          if (x2 <= 0 || x1 >= geo.width) return null;
          const fill = system ? (active ? theme.tlClipFillSystemActive : theme.tlClipFillSystem) : active ? theme.tlClipFillActive : theme.tlClipFill;
          const edge = system ? theme.tlClipEdgeSystem : theme.tlClipEdge;
          return (
            <G key={c.id}>
              <Rect x={x1} y={band.y} width={Math.max(1, x2 - x1)} height={band.h} fill={fill} />
              <Rect x={x1} y={band.y} width={EDGE_WIDTH} height={band.h} fill={edge} />
              <Rect x={Math.max(x1, x2 - EDGE_WIDTH)} y={band.y} width={EDGE_WIDTH} height={band.h} fill={edge} />
            </G>
          );
        }
        const x = geo.xFromUtc(c.time_start);
        if (x < 0 || x > geo.width) return null;
        if (glyph === 'markerOpen' || glyph === 'markerClose') {
          const dir = glyph === 'markerOpen' ? 1 : -1;
          return (
            <G key={c.id}>
              <Line x1={x} y1={0} x2={x} y2={height} stroke={theme.tlMarkEvent} strokeWidth={active ? 3 : 2} />
              <Polygon points={`${x},${band.y} ${x + dir * 7},${band.y + 5} ${x},${band.y + 10}`} fill={theme.tlMarkEvent} />
            </G>
          );
        }
        return (
          <G key={c.id}>
            <Line x1={x} y1={0} x2={x} y2={height} stroke={theme.tlMarkPoint} strokeWidth={active ? 3 : 2} />
            <Polygon points={`${x},${band.y - 6} ${x + 5},${band.y - 1} ${x},${band.y + 4} ${x - 5},${band.y - 1}`} fill={theme.tlMarkPoint} />
            {glyph === 'plate' && (() => {
              // UI-025: an 'LP' plate on a clipmark at the right edge was clipped too.
              const p = labelPlacement(x, geo.width, 'LP', PLATE_FONT_SIZE);
              return (
                <SvgText x={p.x} textAnchor={p.anchor} y={band.y + 4} fontSize={PLATE_FONT_SIZE} fontWeight="700" fill={theme.tlMarkPoint}>
                  LP
                </SvgText>
              );
            })()}
          </G>
        );
      })}
    </G>
  );
});

/** Drag/clip-in preview band. */
export function GhostBand({ x1, x2, height }: { x1: number; x2: number; height: number }) {
  const band = bandGeometry(height);
  const l = Math.min(x1, x2);
  const w = Math.max(2, Math.abs(x2 - x1));
  return (
    <G>
      <Rect x={l} y={band.y} width={w} height={band.h} fill={theme.tlGhost} />
      <Rect x={l} y={band.y} width={EDGE_WIDTH} height={band.h} fill={theme.tlClipEdge} />
      <Rect x={l + w - EDGE_WIDTH} y={band.y} width={EDGE_WIDTH} height={band.h} fill={theme.tlClipEdge} />
    </G>
  );
}

/**
 * Resize grips on the active editable clip (web TimelineClipmarkHandle; hit-testing is done
 * in JS). UI-016: a clip that starts before / ends after the zoom window puts its grip on the
 * canvas edge, where half of it was drawn outside the SVG — clamp it fully inside.
 */
export function ClipHandles({ x1, x2, height, width }: { x1: number; x2: number; height: number; width: number }) {
  const band = bandGeometry(height);
  const grip = (x: number) => {
    const cx = clampToCanvas(x, width, 2 + 0.5); // half the 4pt grip + half its 1pt stroke
    return <Rect x={cx - 2} y={band.y - 4} width={4} height={band.h + 8} rx={theme.radiusXs} fill={theme.tlClipEdge} stroke={theme.surface} strokeWidth={1} />;
  };
  return (
    <G>
      {grip(x1)}
      {grip(x2)}
    </G>
  );
}

/** Label font size of the playhead / skimmer readouts (also used to place them). */
export const MARKER_LABEL_SIZE = 10;

export function Skimmer({ x, label, height, width }: { x: number; label: string; height: number; width: number }) {
  const p = labelPlacement(x, width, label, MARKER_LABEL_SIZE);
  return (
    <G>
      <Line x1={x} y1={0} x2={x} y2={height} stroke={theme.tlSkimmer} strokeWidth={1} />
      <SvgText x={p.x} y={28} textAnchor={p.anchor} fontSize={MARKER_LABEL_SIZE} fill={theme.tlSkimmer}>
        {label}
      </SvgText>
    </G>
  );
}

export function Playhead({ x, label, height, width }: { x: number; label: string; height: number; width: number }) {
  // UI-016: on a live stream the playhead sits AT the right edge, where a start-anchored
  // label was clipped away; flip it to the left of the line there.
  const p = labelPlacement(x, width, label, MARKER_LABEL_SIZE);
  return (
    <G>
      <Line x1={x} y1={0} x2={x} y2={height} stroke={theme.tlPlayhead} strokeWidth={2} />
      <SvgText x={p.x} y={height - 6} textAnchor={p.anchor} fontSize={MARKER_LABEL_SIZE} fontWeight="700" fill={theme.tlPlayhead}>
        {label}
      </SvgText>
    </G>
  );
}

export { createGeometry, formatTime };
