import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { theme } from '@/common/theme';
import { VideoCard } from '@/common/components/VideoCard';
import { EmptyState } from '@/common/components/EmptyState';
import { fetchLive, type VideoListItem } from './librarySlice';

const REFRESH_MS = 20000;

export function LiveListScreen() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { liveItems, liveStatus } = useAppSelector((s) => s.library);

  useEffect(() => {
    dispatch(fetchLive());
    const t = setInterval(() => dispatch(fetchLive()), REFRESH_MS);
    return () => clearInterval(t);
  }, [dispatch]);

  const openStream = useCallback(
    (item: VideoListItem) => {
      if (!item.event_id) {
        Alert.alert(
          'Missing event_id',
          'The /live/list payload has no event_id — add it (and live_stream_id) to the live list serializer in the earthscape repo.',
        );
        return;
      }
      router.push({
        pathname: '/video/[eventId]',
        params: { eventId: String(item.event_id), videoId: String(item.id) },
      });
    },
    [router],
  );

  return (
    <View style={styles.screen}>
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
});
