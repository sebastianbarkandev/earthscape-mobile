import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polygon, Polyline, type LatLng } from 'react-native-maps';
import { theme } from '@/common/theme';
// @ts-expect-error verbatim JS ports without types
import { getClosestPointValueOrNull, getLastValueOrNull } from '@/common/lib/timeSeries';
import type { FlightData } from '../api';

interface Props {
  mapData: Pick<FlightData, 'loc' | 'target' | 'footprint' | 'acft_hdg'>;
  /** Current playback position in UTC epoch seconds (via TimeMapper). */
  currentUtc: number | null;
  /** Live + following: pin to the latest point regardless of playback time. */
  followLatest: boolean;
}

const toLatLng = (pair: [number, number] | null | undefined): LatLng | null =>
  Array.isArray(pair) && pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])
    ? { latitude: pair[0], longitude: pair[1] }
    : null;

/**
 * Mobile counterpart of the web Map.jsx, reduced to the 10% that matters
 * (CLAUDE.md rule 4): flight path, target path, interpolated aircraft marker
 * rotated by acft_hdg, sensor footprint. No KML/TAK/heatmap/drawing layers.
 * Series values arrive [lat, lon] (backend ST_FlipCoordinates), matching Leaflet order.
 */
export function FlightMap({ mapData, currentUtc, followLatest }: Props) {
  const mapRef = useRef<MapView>(null);
  const fitted = useRef(false);

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

  const aircraft = followLatest
    ? getLastValueOrNull(mapData.loc)
    : currentUtc != null
      ? getClosestPointValueOrNull(mapData.loc, currentUtc)
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

  const aircraftCoord = toLatLng(aircraft as [number, number] | null);
  const footprintCoords = Array.isArray(footprintRing)
    ? ((footprintRing as Array<[number, number]>).map(toLatLng).filter(Boolean) as LatLng[])
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

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      mapType="hybrid"
      initialRegion={{
        latitude: pathCoords[0]?.latitude ?? 39.5,
        longitude: pathCoords[0]?.longitude ?? -104.9,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      }}
    >
      {pathCoords.length > 1 && (
        <Polyline coordinates={pathCoords} strokeColor={theme.flightPath} strokeWidth={3} />
      )}
      {targetCoords.length > 1 && (
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
  );
}

const styles = StyleSheet.create({
  aircraft: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aircraftGlyph: {
    fontSize: 22,
    color: theme.accent,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3,
  },
});
