import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { theme } from '@/common/theme';
import type { CoverageTrack } from '../api';
import { coverageBounds, RECENCY_LEGEND, recencyColor, trackCoordinates, trackRecency } from '../dashboardModel';
import { SectionHeader } from './SectionHeader';

interface Props {
  tracks: CoverageTrack[];
  /** Did the server compute this widget at all (it is part of the user's saved layout)? */
  inLayout: boolean;
  onPressTrack: (videoId: number) => void;
}

const FIT_PADDING = { top: 24, right: 24, bottom: 24, left: 24 };

/**
 * Web dashboard/components/MapCard.jsx: every flight of the last 14 days as a simplified
 * polyline, coloured by how recently it was flown; tapping a track opens its video.
 * Apple Maps hybrid, like FlightMap. No KML/TAK/heatmap here either (CLAUDE.md rule 4).
 */
export function CoverageMap({ tracks, inLayout, onPressTrack }: Props) {
  const mapRef = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const points = useMemo(() => coverageBounds(tracks), [tracks]);

  const fit = useCallback(() => {
    if (!mapRef.current || points.length < 2) return;
    mapRef.current.fitToCoordinates(points, { edgePadding: FIT_PADDING, animated: false });
  }, [points]);

  // Refit whenever the set of tracks changes (a pull-to-refresh can add today's flight).
  useEffect(() => {
    if (ready) fit();
  }, [ready, fit]);

  const first = points[0];
  return (
    <View style={styles.section}>
      <SectionHeader icon="map-location-dot" title="Flight coverage · last 14 days" />
      <View style={styles.card}>
        {points.length ? (
          <MapView
            ref={mapRef}
            style={styles.map}
            mapType="hybrid"
            pitchEnabled={false}
            rotateEnabled={false}
            showsPointsOfInterest={false}
            onMapReady={() => setReady(true)}
            initialRegion={{ latitude: first.latitude, longitude: first.longitude, latitudeDelta: 0.2, longitudeDelta: 0.2 }}
          >
            {tracks.map((t) => {
              const cs = trackCoordinates(t);
              if (cs.length < 2) return null;
              return (
                <Polyline
                  key={t.id}
                  coordinates={cs}
                  strokeColor={recencyColor(trackRecency(t.last_flown))}
                  strokeWidth={3}
                  tappable
                  onPress={() => onPressTrack(t.id)}
                />
              );
            })}
          </MapView>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{inLayout ? 'No flights in the last 14 days' : 'Flight coverage is not in your dashboard layout yet'}</Text>
            <Text style={styles.emptyDetail}>
              {inLayout
                ? 'Tracks appear here as soon as a video with GPS data is uploaded or streamed.'
                : 'Add the "Coverage map" widget on the web dashboard (Edit layout) — the same layout drives this screen.'}
            </Text>
          </View>
        )}
        <View style={styles.legend}>
          {RECENCY_LEGEND.map((r) => (
            <View key={r.key} style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: r.color }]} />
              <Text style={styles.legendText}>{r.label}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  card: { backgroundColor: theme.surface, borderRadius: theme.radiusMd, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  map: { width: '100%', height: 240 },
  // minHeight, not height: the copy must grow with Dynamic Type (RESP-020).
  empty: { minHeight: 240, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 6, backgroundColor: theme.bgSubtle },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: theme.textPrimary, textAlign: 'center' },
  emptyDetail: { fontSize: 12, color: theme.textSecondary, textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: theme.radiusXs },
  legendText: { fontSize: 12, color: theme.textSecondary },
});
