import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polygon, Polyline, type LatLng } from 'react-native-maps';
import { theme } from '@/common/theme';
import { Icon } from '@/common/components/Icon';
import { getClosestPointValueOrNull, getLastValueOrNull } from '@/common/lib/timeSeries';
import { calculateHeatMap } from '@/common/lib/calculateHeatMap';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { FlightData, DrawnObject } from '../api';
import { setMapFollow, type MapFollow } from '../playerSlice';
import { MapLayersSheet } from './MapLayersSheet';

interface Props {
  mapData: Pick<FlightData, 'loc' | 'target' | 'footprint' | 'acft_hdg'>;
  /** Current playback position in UTC epoch seconds (via TimeMapper). */
  currentUtc: number | null;
  /** Live + following: pin to the latest point regardless of playback time. */
  followLatest: boolean;
  drawnObjects?: DrawnObject[];
  /** Web platform.type (vehicle-type tag; default 'helicopter') — labels the follow control. */
  platformType?: string;
}

const toLatLng = (pair: [number, number] | null | undefined): LatLng | null =>
  Array.isArray(pair) && pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])
    ? { latitude: pair[0], longitude: pair[1] }
    : null;

/**
 * Mobile counterpart of the web Map.jsx (CLAUDE.md rule 4): flight path, target
 * path, interpolated aircraft marker rotated by acft_hdg, sensor footprint —
 * plus the web's follow ("center on") control, layer toggles, and drawn objects.
 * Series values arrive [lat, lon] (backend ST_FlipCoordinates).
 */
export function FlightMap({ mapData, currentUtc, followLatest, drawnObjects = [], platformType = 'helicopter' }: Props) {
  const dispatch = useAppDispatch();
  const mapRef = useRef<MapView>(null);
  const fitted = useRef(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(10);
  const toggles = useAppSelector((s) => s.player.toggles);
  const mapType = useAppSelector((s) => s.player.mapType);
  const follow = useAppSelector((s) => s.player.mapFollow);
  const focus = useAppSelector((s) => s.player.focusCoordinates);

  const pathCoords = useMemo(
    () => mapData.loc.map((p) => toLatLng(p?.[1])).filter(Boolean) as LatLng[],
    [mapData.loc],
  );
  const targetCoords = useMemo(
    () =>
      mapData.target
        .map((p) => toLatLng(p?.[1]))
        .filter((c): c is LatLng => !!c && (c.latitude !== 0 || c.longitude !== 0)),
    [mapData.target],
  );
  const hasTarget = targetCoords.length > 0;

  // Web calculateHeatMap -> [lat, lon, seconds]; react-native-maps' <Heatmap> is Google-only
  // on iOS, so intensity-bucketed circles approximate the leaflet.heat layer.
  const heat = useMemo(() => {
    if (!toggles.heatmap || mapData.target.length < 2) return [];
    const pts = calculateHeatMap(mapData.target.filter((p) => Array.isArray(p?.[1])));
    const max = pts.reduce((m, p) => Math.max(m, p[2]), 0) || 1;
    return pts
      .map((p) => ({ latitude: Number(p[0]), longitude: Number(p[1]), w: p[2] / max }))
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && p.w > 0.02);
  }, [toggles.heatmap, mapData.target]);

  const aircraft = followLatest
    ? getLastValueOrNull(mapData.loc)
    : currentUtc != null
      ? getClosestPointValueOrNull(mapData.loc, currentUtc)
      : null;
  const target = followLatest
    ? getLastValueOrNull(mapData.target)
    : currentUtc != null
      ? getClosestPointValueOrNull(mapData.target, currentUtc)
      : null;
  const heading = followLatest
    ? getLastValueOrNull(mapData.acft_hdg)
    : currentUtc != null
      ? getClosestPointValueOrNull(mapData.acft_hdg, currentUtc)
      : null;
  const footprintRing = followLatest
    ? getLastValueOrNull(mapData.footprint)
    : currentUtc != null
      ? getClosestPointValueOrNull(mapData.footprint, currentUtc)
      : null;

  const aircraftCoord = toLatLng(aircraft);
  const targetCoord = toLatLng(target);
  const footprintCoords = Array.isArray(footprintRing)
    ? (footprintRing.map(toLatLng).filter(Boolean) as LatLng[])
    : [];

  // Fit to path once, when the first flight points land (web: fitBounds on bounding_box).
  useEffect(() => {
    if (!fitted.current && pathCoords.length > 1 && mapRef.current) {
      fitted.current = true;
      mapRef.current.fitToCoordinates(pathCoords, {
        edgePadding: { top: 50, bottom: 50, left: 50, right: 50 },
        animated: false,
      });
    }
  }, [pathCoords]);

  // Follow mode (web Map.jsx:718-724): 'fov' pans to the target, anything else to the aircraft.
  const followTarget = follow === 'fov' ? targetCoord : follow === 'vehicle' ? aircraftCoord : null;
  useEffect(() => {
    if (followTarget && mapRef.current) {
      mapRef.current.animateCamera({ center: followTarget }, { duration: 300 });
    }
  }, [followTarget?.latitude, followTarget?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  // One-shot pan from an event card / drawn object (web setFocusCoordinates).
  useEffect(() => {
    if (focus && mapRef.current) {
      mapRef.current.animateCamera({ center: { latitude: focus.lat, longitude: focus.lon } }, { duration: 300 });
    }
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const cycleFollow = () => {
    // Web only ever *sets* the centre; mobile adds a way back to free pan.
    const order: MapFollow[] = hasTarget ? ['none', 'vehicle', 'fov'] : ['none', 'vehicle'];
    const next = order[(order.indexOf(follow) + 1) % order.length];
    dispatch(setMapFollow(next));
  };
  const followLabel = follow === 'fov' ? 'FOV' : follow === 'vehicle' ? platformType : 'Free';
  const heatRadius = zoomLevel <= 6 ? 400 : zoomLevel <= 10 ? 120 : 40; // metres, mirrors leaflet radius ladder

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapType={mapType}
        onRegionChangeComplete={(r) => setZoomLevel(Math.round(Math.log2(360 / Math.max(r.longitudeDelta, 1e-6))))}
        initialRegion={{
          latitude: pathCoords[0]?.latitude ?? 39.5,
          longitude: pathCoords[0]?.longitude ?? -104.9,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        }}
      >
        {heat.map((h, i) => (
          <Circle
            key={`h${i}`}
            center={h}
            radius={heatRadius}
            strokeWidth={0}
            fillColor={heatColor(h.w)}
          />
        ))}
        {toggles.vehiclePath && pathCoords.length > 1 && (
          <Polyline coordinates={pathCoords} strokeColor={theme.flightPath} strokeWidth={3} />
        )}
        {toggles.targetPath && targetCoords.length > 1 && (
          <Polyline coordinates={targetCoords} strokeColor={theme.targetPath} strokeWidth={2} />
        )}
        {footprintCoords.length > 2 && (
          <Polygon
            coordinates={footprintCoords}
            strokeColor={theme.accent}
            strokeWidth={1}
            fillColor={theme.footprintFill}
          />
        )}
        {toggles.mapDrawings && drawnObjects.map((d) => <DrawnObjectShape key={d.id} obj={d} />)}
        {aircraftCoord && (
          <Marker
            coordinate={aircraftCoord}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={Number.isFinite(heading as number) ? (heading as number) : 0}
            tracksViewChanges={false}
          >
            <View style={styles.aircraft}>
              <Text style={styles.aircraftGlyph}>▲</Text>
            </View>
          </Marker>
        )}
      </MapView>

      {toggles.overlays && (
        <View style={styles.controls} pointerEvents="box-none">
          <Pressable style={styles.ctl} onPress={() => setLayersOpen(true)} hitSlop={6}>
            <Icon name="layer-group" size={14} color={theme.textPrimary} />
          </Pressable>
          <Pressable style={[styles.ctl, follow !== 'none' && styles.ctlActive]} onPress={cycleFollow} hitSlop={6}>
            <Icon name="location-crosshairs" size={14} color={follow !== 'none' ? theme.textOnAccent : theme.textPrimary} />
            <Text style={[styles.ctlText, follow !== 'none' && { color: theme.textOnAccent }]}>{followLabel}</Text>
          </Pressable>
        </View>
      )}
      <MapLayersSheet visible={layersOpen} onClose={() => setLayersOpen(false)} hasTarget={hasTarget} hasDrawings={drawnObjects.length > 0} />
    </View>
  );
}

/** leaflet.heat gradient: blue -> lime -> yellow -> red, alpha by weight. */
function heatColor(w: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [0.4, [0, 0, 255]],
    [0.65, [0, 255, 0]],
    [0.85, [255, 255, 0]],
    [1.0, [255, 0, 0]],
  ];
  let c = stops[0][1];
  for (const [t, rgb] of stops) if (w >= t) c = rgb;
  return `rgba(${c[0]},${c[1]},${c[2]},${0.25 + 0.35 * w})`;
}

/** Existing drawn objects (read-only): Point / LineString / Polygon in the author's colour. */
function DrawnObjectShape({ obj }: { obj: DrawnObject }) {
  const g = obj.the_geom;
  const color = obj.color || theme.accent;
  if (!g) return null;
  const pt = (c: unknown): LatLng | null =>
    Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])
      ? { latitude: Number(c[1]), longitude: Number(c[0]) } // GeoJSON is [lon, lat]
      : null;
  if (g.type === 'Point') {
    const c = pt(g.coordinates);
    return c ? <Marker coordinate={c} pinColor={color} title={obj.text ?? undefined} /> : null;
  }
  if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
    const cs = (g.coordinates as unknown[]).map(pt).filter(Boolean) as LatLng[];
    return cs.length > 1 ? <Polyline coordinates={cs} strokeColor={color} strokeWidth={3} /> : null;
  }
  if (g.type === 'Polygon' && Array.isArray(g.coordinates) && Array.isArray((g.coordinates as unknown[])[0])) {
    const cs = ((g.coordinates as unknown[])[0] as unknown[]).map(pt).filter(Boolean) as LatLng[];
    return cs.length > 2 ? <Polygon coordinates={cs} strokeColor={color} strokeWidth={2} fillColor={`${color}33`} /> : null;
  }
  return null;
}

const styles = StyleSheet.create({
  aircraft: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  aircraftGlyph: { fontSize: 22, color: theme.accent, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3 },
  controls: { position: 'absolute', top: 8, right: 8, gap: 6, alignItems: 'flex-end' },
  ctl: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 34, height: 34, paddingHorizontal: 9, borderRadius: theme.radiusPill, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  ctlActive: { backgroundColor: theme.accent, borderColor: theme.accent },
  ctlText: { fontSize: 11, fontWeight: '700', color: theme.textPrimary, textTransform: 'capitalize' },
});
