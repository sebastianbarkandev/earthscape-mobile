import React, { useEffect } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { edgePadding, gridColumns } from '@/common/layout';
import { Icon } from '@/common/components/Icon';
import { EarthscapeLive } from '../../../modules/earthscape-live';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { theme } from '@/common/theme';
import { denseText } from '@/common/typography';
import { VideoCard } from '@/common/components/VideoCard';
import { EmptyState } from '@/common/components/EmptyState';
import { fetchLive } from './librarySlice';
import { useOpenVideo } from './useOpenVideo';
import { canCreateLiveStream } from '@/features/broadcast/liveGates';
import { verticalTouchSlop } from '@/common/touchTarget';

const REFRESH_MS = 20000;

export function LiveListScreen() {
  const dispatch = useAppDispatch();
  const { liveItems, liveStatus, liveError } = useAppSelector((s) => s.library);
  const liveEnabled = useAppSelector((s) => s.auth.bootstrap?.features?.live_enabled ?? true);
  const mayPublish = useAppSelector((s) => canCreateLiveStream(s.auth.bootstrap));
  const openStream = useOpenVideo();
  const router = useRouter();
  const cols = gridColumns(useWindowDimensions().width); // 2 on phones, 3–4 on iPad (RESP-011)
  const insets = useSafeAreaInsets(); // RESP-019: landscape grid must clear the cut-out strip
  const canGoLive = liveEnabled && mayPublish && EarthscapeLive.isSupported;

  useEffect(() => {
    dispatch(fetchLive());
    const t = setInterval(() => dispatch(fetchLive({ silent: true })), REFRESH_MS);
    return () => clearInterval(t);
  }, [dispatch]);

  return (
    <View style={styles.screen}>
      {canGoLive && (
        <View style={[styles.goLiveRow, edgePadding(insets, 12)]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.goLiveTitle}>Stream from this phone</Text>
            <Text style={styles.goLiveSub}>Start a new live event with your camera; your GPS track shows on the map.</Text>
          </View>
          <Pressable onPress={() => router.push('/golive' as never)} style={styles.goLiveBtn} hitSlop={verticalTouchSlop(36)}>
            <View style={styles.goLiveDot} />
            <Icon name="video" size={13} color={theme.textOnAccent} />
            <Text {...denseText} style={styles.goLiveText}>Go live</Text>
          </Pressable>
        </View>
      )}
      {/* UI-005: a poll that fails while streams are on screen keeps the list and says so;
          an empty list becomes a retryable error instead of a silent "No live streams". */}
      {liveError && liveItems.length > 0 && (
        <View style={[styles.staleRow, edgePadding(insets, 10)]} accessibilityRole="alert">
          <Icon name="triangle-exclamation" size={12} color={theme.danger} />
          <Text style={styles.staleText} numberOfLines={2}>Showing the last known streams — refresh failed ({liveError})</Text>
          <Pressable onPress={() => dispatch(fetchLive())} style={styles.staleRetryBtn} hitSlop={verticalTouchSlop(30)} accessibilityRole="button" accessibilityLabel="Retry loading live streams">
            <Text style={styles.staleRetry}>Retry</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        data={liveItems}
        numColumns={cols}
        key={cols}
        keyExtractor={(v) => String(v.id)}
        renderItem={({ item }) => <VideoCard item={item} live columns={cols} onPress={openStream} />}
        contentContainerStyle={[styles.list, edgePadding(insets, 6)]}
        refreshControl={
          <RefreshControl
            refreshing={liveStatus === 'loading' && liveItems.length > 0}
            onRefresh={() => dispatch(fetchLive())}
            tintColor={theme.accent}
          />
        }
        ListEmptyComponent={
          liveStatus === 'loading' ? (
            <ActivityIndicator style={styles.spinner} color={theme.accent} size="large" />
          ) : liveStatus === 'error' ? (
            <EmptyState
              title="Couldn't load live streams"
              detail={liveError ?? undefined}
              action={{ label: 'Try again', onPress: () => dispatch(fetchLive()) }}
            />
          ) : (
            <EmptyState
              title="No live streams"
              detail="When an aircraft goes live, its stream appears here."
            />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  list: { paddingHorizontal: 6, paddingTop: 10, paddingBottom: 24, flexGrow: 1 },
  spinner: { marginTop: 80 },
  // RESP-019: the horizontal gutter is PADDING (not margin) so `edgePadding` can raise it in
  // landscape — the "Go live" pill is right-aligned and sat under the sensor housing.
  goLiveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, margin: 12, marginBottom: 0, padding: 12, backgroundColor: theme.surface, borderRadius: theme.radiusMd, borderWidth: 1, borderColor: theme.border },
  goLiveTitle: { fontSize: 13, fontWeight: '700', color: theme.textPrimary },
  goLiveSub: { fontSize: 11, color: theme.textSecondary, marginTop: 2 },
  goLiveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: theme.radiusPill, backgroundColor: theme.liveRed },
  staleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginTop: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radiusSm, backgroundColor: theme.bgSubtle, borderWidth: 1, borderColor: theme.border },
  staleText: { flex: 1, fontSize: 11, color: theme.textSecondary },
  // UI-022: the Retry had no box at all — a 12pt label, so a ~16pt strike. 30 + vertical
  // slop is 44, and the slop stays inside the banner's own 8pt padding.
  staleRetryBtn: { minHeight: 30, paddingHorizontal: 6, justifyContent: 'center' },
  staleRetry: { fontSize: 12, fontWeight: '700', color: theme.accentActive },
  goLiveDot: { width: 8, height: 8, borderRadius: theme.radiusPill, backgroundColor: theme.textOnAccent },
  goLiveText: { color: theme.textOnAccent, fontSize: 12, fontWeight: '800' },
});
