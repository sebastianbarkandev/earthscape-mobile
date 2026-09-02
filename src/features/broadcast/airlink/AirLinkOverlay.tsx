import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon, Polyline, type LatLng } from 'react-native-maps';
import { theme } from '@/common/theme';
import { denseText } from '@/common/typography';
import { Icon } from '@/common/components/Icon';
import { compassLabel, formatDistance, type LatLon } from '@/common/geo';
import { touchSlop } from '@/common/touchTarget';
import { useAircraftTrack } from './useAircraftTrack';
import { usePhonePosition } from './usePhonePosition';
import { useGroundAir } from './useGroundAir';
import { useNearbyLiveEvents } from './useNearbyLiveEvents';
import { AIRCRAFT_STALE_S } from './groundAir';

interface Props {
  /** The live event this phone is joining (or has joined). Without it the overlay only suggests a nearby aircraft. */
  eventId?: number;
  /** This phone's own video id once the stream exists — hides it from the teammates. */
  ownVideoId: number | null;
  /** Telemetry on/off — a grant there is what lets the overlay start reading the phone position. */
  telemetryEnabled: boolean;
  /** Show at all (hidden on the ended / error cards). */
  visible: boolean;
  /** Absolute top (below the top bar and the join banner) and the safe-area side padding. */
  top: number;
  sideInsets: { paddingLeft: number; paddingRight: number };
  landscape: boolean;
  /** Nearby-aircraft suggestion accepted: join that event instead of creating a new one. */
  onJoinNearby?: (eventId: number, title: string) => void;
}

const MAP_H = { portrait: 170, landscape: 120 };
const FIT_PADDING = { top: 24, bottom: 24, left: 24, right: 24 };
const toLatLng = (p: LatLon): LatLng => ({ latitude: p[0], longitude: p[1] });

/**
 * Ground ↔ air. While the phone is (about to be) a program of a live aircraft event, this
 * card says whether the phone is inside the aircraft camera's footprint ("You're in frame"),
 * how far and which way the camera's target and the aircraft are relative to where the phone
 * points, and — expanded — a mini map with the footprint, target, aircraft, this phone and the
 * other phones on the event. With no event to join it watches `/live/list` and suggests the
 * nearest streaming aircraft instead.
 */
export function AirLinkOverlay({ eventId, ownVideoId, telemetryEnabled, visible, top, sideInsets, landscape, onJoinNearby }: Props) {
  const track = useAircraftTrack(eventId, ownVideoId, visible);
  const me = usePhonePosition(visible, telemetryEnabled);
  const ga = useGroundAir(me, track.aircraft, visible && !!eventId);
  const nearby = useNearbyLiveEvents(me?.loc ?? null, visible && !eventId);
  const [expanded, setExpanded] = useState(false);

  if (!visible) return null;

  if (!eventId) {
    const n = nearby.nearest;
    if (!n || !onJoinNearby) return null;
    return (
      <View testID="airlink-nearby" style={[styles.card, { top, left: sideInsets.paddingLeft, right: sideInsets.paddingRight }, landscape && styles.cardLandscape]}>
        <View style={styles.row}>
          <Icon name="helicopter" size={14} color={theme.overlayText} />
          <Text style={styles.title} numberOfLines={2}>
            {n.title || 'An aircraft'} is streaming {formatDistance(n.distanceM)} {compassLabel(n.bearingDeg)} of you
          </Text>
        </View>
        <Pressable
          testID="airlink-join"
          onPress={() => onJoinNearby(n.eventId, n.title)}
          hitSlop={touchSlop(32)}
          style={styles.joinBtn}
          accessibilityRole="button"
          accessibilityLabel={`Add my camera to ${n.title || 'that event'}`}
        >
          <Icon name="layer-group" size={12} color={theme.textOnAccent} />
          <Text style={styles.joinText} {...denseText}>Add my camera to it</Text>
        </Pressable>
      </View>
    );
  }

  const aircraft = track.aircraft;
  const frame = ga.inFrame === true ? 'in' : ga.inFrame === false ? 'out' : aircraft ? 'unknown' : 'none';
  const frameLabel =
    frame === 'in' ? "You're in frame" : frame === 'out' ? 'Out of frame' : frame === 'unknown' ? (me ? 'No camera footprint yet' : 'Turn on GPS to check the frame') : track.status === 'error' ? 'Aircraft track unavailable' : 'Waiting for the aircraft…';
  const frameBg = frame === 'in' ? theme.success : theme.overlayControl;
  const frameIcon = frame === 'in' ? 'eye' : frame === 'out' ? 'eye-slash' : 'satellite-dish';
  const staleText = ga.stale && ga.ageS != null ? `Aircraft position ${Math.round(ga.ageS)} s old` : null;
  const a11y = [
    frameLabel,
    ga.target ? `camera target ${formatDistance(ga.target.distanceM)} ${compassLabel(ga.target.bearingDeg)}` : null,
    ga.aircraft ? `aircraft ${formatDistance(ga.aircraft.distanceM)} ${compassLabel(ga.aircraft.bearingDeg)}` : null,
    track.teammates.length ? `${track.teammates.length} other camera${track.teammates.length === 1 ? '' : 's'} on the event` : null,
    staleText,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View testID="airlink" style={[styles.card, { top, left: sideInsets.paddingLeft, right: sideInsets.paddingRight }, landscape && styles.cardLandscape]}>
      <Pressable
        testID="airlink-summary"
        onPress={() => setExpanded((v) => !v)}
        style={styles.summary}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint={expanded ? 'Hides the map' : 'Shows the aircraft, its camera footprint and you on a map'}
      >
        <View testID="airlink-frame" style={[styles.frame, { backgroundColor: frameBg }]}>
          <Icon name={frameIcon} size={11} color={theme.overlayText} />
          <Text style={styles.frameText} {...denseText}>{frameLabel}</Text>
        </View>
        {ga.target ? <Vec testID="airlink-target" icon="crosshairs" label="Target" v={ga.target} /> : null}
        {ga.aircraft ? <Vec testID="airlink-aircraft" icon="helicopter" label="Aircraft" v={ga.aircraft} /> : null}
        {track.teammates.length ? (
          <View style={styles.vec}>
            <Icon name="users" size={11} color={theme.overlayTextMuted} />
            <Text style={styles.vecText} {...denseText}>{track.teammates.length}</Text>
          </View>
        ) : null}
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={11} color={theme.overlayTextMuted} />
      </Pressable>
      {staleText || ga.needsCalibration ? (
        <Text style={styles.hint} {...denseText}>
          {[staleText, ga.needsCalibration ? 'Compass needs calibration — move the phone in a figure 8' : null].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      {expanded ? <MiniMap aircraft={aircraft} me={me?.loc ?? null} teammates={track.teammates} height={landscape ? MAP_H.landscape : MAP_H.portrait} /> : null}
    </View>
  );
}

function Vec({ icon, label, v, testID }: { icon: string; label: string; v: { distanceM: number; bearingDeg: number; relativeDeg: number | null }; testID: string }) {
  // The arrow turns with the phone: straight up = the camera already points at it.
  const rotate = v.relativeDeg == null ? null : `${Math.round(v.relativeDeg)}deg`;
  return (
    <View testID={testID} style={styles.vec} accessibilityLabel={`${label} ${formatDistance(v.distanceM)} ${compassLabel(v.bearingDeg)}`}>
      <Icon name={icon} size={11} color={theme.overlayTextMuted} />
      {rotate ? (
        <View testID={`${testID}-arrow`} style={{ transform: [{ rotate }] }}>
          <Icon name="arrow-up" size={12} color={theme.accent} />
        </View>
      ) : (
        <Text style={styles.vecDim} {...denseText}>{compassLabel(v.bearingDeg)}</Text>
      )}
      <Text style={styles.vecText} {...denseText}>{formatDistance(v.distanceM)}</Text>
    </View>
  );
}

function MiniMap({ aircraft, me, teammates, height }: { aircraft: ReturnType<typeof useAircraftTrack>['aircraft']; me: LatLon | null; teammates: ReturnType<typeof useAircraftTrack>['teammates']; height: number }) {
  const mapRef = useRef<MapView>(null);
  const footprint = useMemo(() => (aircraft?.footprint ?? []).map(toLatLng), [aircraft?.footprint]);
  const points = useMemo(() => {
    const pts: LatLng[] = [];
    if (aircraft) pts.push(toLatLng(aircraft.loc));
    if (aircraft?.target) pts.push(toLatLng(aircraft.target));
    if (me) pts.push(toLatLng(me));
    for (const t of teammates) if (t.fix) pts.push(toLatLng(t.fix.loc));
    return pts.concat(footprint);
  }, [aircraft, me, teammates, footprint]);
  // Follow everything: the aircraft moves, so does the phone — refit on each new point set.
  const fitKey = points.map((p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`).join('|');
  useEffect(() => {
    if (points.length === 0) return;
    mapRef.current?.fitToCoordinates(points.length === 1 ? [points[0], points[0]] : points, { edgePadding: FIT_PADDING, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const center = points[0] ?? { latitude: 39.5, longitude: -104.9 };
  return (
    <View testID="airlink-map" style={[styles.map, { height }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapType="hybrid"
        pitchEnabled={false}
        rotateEnabled={false}
        showsCompass={false}
        initialRegion={{ latitude: center.latitude, longitude: center.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
      >
        {footprint.length > 2 ? <Polygon coordinates={footprint} strokeColor={theme.accent} strokeWidth={1} fillColor={theme.footprintFill} /> : null}
        {aircraft?.target && aircraft ? <Polyline coordinates={[toLatLng(aircraft.loc), toLatLng(aircraft.target)]} strokeColor={theme.targetPath} strokeWidth={1} /> : null}
        {aircraft?.target ? (
          <Marker coordinate={toLatLng(aircraft.target)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <Text style={styles.targetGlyph} allowFontScaling={false}>✕</Text>
          </Marker>
        ) : null}
        {aircraft ? (
          <Marker coordinate={toLatLng(aircraft.loc)} anchor={{ x: 0.5, y: 0.5 }} flat rotation={aircraft.heading ?? 0} tracksViewChanges={false}>
            <Text style={styles.aircraftGlyph} allowFontScaling={false}>▲</Text>
          </Marker>
        ) : null}
        {teammates.map((t) =>
          t.fix ? (
            <Marker key={t.videoId} coordinate={toLatLng(t.fix.loc)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} title={t.label}>
              <View style={styles.mate}><Text style={styles.mateText} allowFontScaling={false} numberOfLines={1}>{t.label}</Text></View>
            </Marker>
          ) : null,
        )}
        {me ? (
          <Marker coordinate={toLatLng(me)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.me} />
          </Marker>
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', backgroundColor: theme.overlayBg, borderRadius: theme.radiusSm, paddingHorizontal: 10, paddingVertical: 4, gap: 4 },
  cardLandscape: { right: undefined, maxWidth: 400 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 24 },
  // The whole summary row is the expand control; it wraps, so its 44pt is real height, not slop (UI-028).
  summary: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 44 },
  title: { color: theme.overlayText, fontSize: 12, fontWeight: '600', flex: 1 },
  frame: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, minHeight: 22, borderRadius: theme.radiusPill },
  frameText: { color: theme.overlayText, fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },
  vec: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  vecText: { color: theme.overlayText, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  vecDim: { color: theme.overlayTextMuted, fontSize: 10, fontWeight: '700' },
  hint: { color: theme.overlayTextMuted, fontSize: 10, lineHeight: 13 },
  joinBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 12, borderRadius: theme.radiusPill, backgroundColor: theme.accent },
  joinText: { color: theme.textOnAccent, fontSize: 12, fontWeight: '700' },
  map: { borderRadius: theme.radiusSm, overflow: 'hidden' },
  aircraftGlyph: { fontSize: 20, color: theme.accent, textShadowColor: theme.overlayShadow, textShadowRadius: 3 },
  targetGlyph: { fontSize: 16, fontWeight: '800', color: theme.targetPath, textShadowColor: theme.overlayShadow, textShadowRadius: 3 },
  me: { width: 14, height: 14, borderRadius: theme.radiusPill, backgroundColor: theme.overlayText, borderWidth: 3, borderColor: theme.targetPath },
  mate: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: theme.radiusXs, backgroundColor: theme.accent, maxWidth: 90 },
  mateText: { color: theme.textOnAccent, fontSize: 9, fontWeight: '700' },
});
