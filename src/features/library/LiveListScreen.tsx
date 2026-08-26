import React, { useEffect } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/common/components/Icon';
import { EarthscapeLive } from '../../../modules/earthscape-live';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { theme } from '@/common/theme';
import { VideoCard } from '@/common/components/VideoCard';
import { EmptyState } from '@/common/components/EmptyState';
import { fetchLive } from './librarySlice';
import { useOpenVideo } from './useOpenVideo';

const REFRESH_MS = 20000;

export function LiveListScreen() {
  const dispatch = useAppDispatch();
  const { liveItems, liveStatus } = useAppSelector((s) => s.library);
  const liveEnabled = useAppSelector((s) => s.auth.bootstrap?.features?.live_enabled ?? true);
  const openStream = useOpenVideo();
  const router = useRouter();
  const canGoLive = liveEnabled && EarthscapeLive.isSupported;

  useEffect(() => {
    dispatch(fetchLive());
    const t = setInterval(() => dispatch(fetchLive()), REFRESH_MS);
    return () => clearInterval(t);
  }, [dispatch]);

  return (
    <View style={styles.screen}>
      {canGoLive && (
        <View style={styles.goLiveRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.goLiveTitle}>Stream from this phone</Text>
            <Text style={styles.goLiveSub}>Start a new live event with your camera; your GPS track shows on the map.</Text>
          </View>
          <Pressable onPress={() => router.push('/golive' as never)} style={styles.goLiveBtn} hitSlop={4}>
            <View style={styles.goLiveDot} />
            <Icon name="video" size={13} color="#FFF" />
            <Text style={styles.goLiveText}>Go live</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        data={liveItems}
        numColumns={2}
        keyExtractor={(v) => String(v.id)}
        renderItem={({ item }) => <VideoCard item={item} live onPress={openStream} />}
        contentContainerStyle={styles.list}
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
  goLiveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, margin: 12, marginBottom: 0, padding: 12, backgroundColor: theme.surface, borderRadius: theme.radiusMd, borderWidth: 1, borderColor: theme.border },
  goLiveTitle: { fontSize: 13, fontWeight: '700', color: theme.textPrimary },
  goLiveSub: { fontSize: 11, color: theme.textSecondary, marginTop: 2 },
  goLiveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: theme.radiusPill, backgroundColor: theme.liveRed },
  goLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF' },
  goLiveText: { color: '#FFF', fontSize: 12, fontWeight: '800' },
});
