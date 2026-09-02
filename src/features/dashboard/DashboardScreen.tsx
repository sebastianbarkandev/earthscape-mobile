import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { theme } from '@/common/theme';
import { edgePadding, gridColumns } from '@/common/layout';
import { Icon } from '@/common/components/Icon';
import { EmptyState } from '@/common/components/EmptyState';
import { useOpenVideo } from '@/features/library/useOpenVideo';
import type { VideoListItem } from '@/features/library/librarySlice';
import { useAppSelector } from '@/store/hooks';
import type { DashboardPayload, DashboardWidgetType } from './api';
import { dashboardSubtitle, layoutHas, widgetOrder } from './dashboardModel';
import { useDashboard } from './useDashboard';
import { CoverageMap } from './components/CoverageMap';
import { ImageStrip } from './components/ImageStrip';
import { LiveHero } from './components/LiveHero';
import { SectionHeader } from './components/SectionHeader';
import { StatsSection } from './components/StatsSection';
import { VideoGrid } from './components/VideoGrid';

/**
 * Landing screen — the web DashboardPage (frontend/src/js/dashboard) on the phone: flight
 * stats, live streams, coverage map, recent uploads, categories, your uploads, recent
 * screenshots, in the order of the user's saved web layout (`user_layout`). The web's
 * "Edit layout" mode is web-only; the phone reads the layout, it never writes it.
 */
export function DashboardScreen() {
  const insets = useSafeAreaInsets(); // RESP-019: landscape gutters clear the sensor housing
  const cols = gridColumns(useWindowDimensions().width);
  const router = useRouter();
  const openVideo = useOpenVideo();
  const bootstrap = useAppSelector((s) => s.auth.bootstrap);
  const { data, status, error, refreshing, refresh, retry } = useDashboard();

  // A coverage track only knows its video id; useOpenVideo resolves the event with one GET /videos/{id}/event_id.
  const openById = useCallback((id: number) => openVideo({ id, event_id: undefined } as VideoListItem), [openVideo]);
  const goVideos = useCallback(() => router.push('/(tabs)/videos' as never), [router]);
  const goLive = useCallback(() => router.push('/(tabs)/live' as never), [router]);

  if (status === 'loading' && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  if (!data) {
    return <EmptyState title="Could not load the dashboard" detail={error ?? undefined} action={{ label: 'Retry', onPress: retry }} />;
  }

  const orgName = data.org_name || bootstrap?.settings?.website_name || '';
  const liveVisible = bootstrap?.features?.live_enabled !== false;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, edgePadding(insets, 12)]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}
    >
      <View style={styles.pageHead}>
        <Text style={styles.h1}>Dashboard</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {dashboardSubtitle(orgName)}
        </Text>
      </View>

      {/* UI-005: a failed refresh keeps the last payload on screen and says so. */}
      {error ? (
        <View style={styles.staleRow} accessibilityRole="alert">
          <Icon name="triangle-exclamation" size={12} color={theme.danger} />
          <Text style={styles.staleText} numberOfLines={2}>
            Showing the last loaded dashboard — refresh failed ({error})
          </Text>
          <Pressable onPress={retry} style={styles.staleRetryBtn} accessibilityRole="button" accessibilityLabel="Retry loading the dashboard">
            <Text style={styles.staleRetry}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {widgetOrder(data.user_layout).map((type) => (
        <Widget key={type} type={type} data={data} cols={cols} liveVisible={liveVisible} openVideo={openVideo} openById={openById} goVideos={goVideos} goLive={goLive} />
      ))}
    </ScrollView>
  );
}

interface WidgetProps {
  type: DashboardWidgetType;
  data: DashboardPayload;
  cols: number;
  liveVisible: boolean;
  openVideo: (item: VideoListItem) => void;
  openById: (id: number) => void;
  goVideos: () => void;
  goLive: () => void;
}

/** One `user_layout` entry → its section; widgets the server left empty render nothing (web parity), except the map. */
function Widget({ type, data, cols, liveVisible, openVideo, openById, goVideos, goLive }: WidgetProps) {
  switch (type) {
    case 'stats':
      return data.stats ? <StatsSection stats={data.stats} /> : null;
    case 'live_streams': {
      if (!liveVisible || data.live_streams.length === 0) return null;
      const [hero, ...rest] = data.live_streams;
      return (
        <View style={styles.section}>
          <SectionHeader icon="tower-broadcast" title="Live now" action={data.show_all_live_streams_link ? { label: 'See all', onPress: goLive } : undefined} />
          <LiveHero video={hero} onPress={openVideo} />
          {rest.length ? <VideoGrid videos={rest} columns={cols} live onPress={openVideo} /> : null}
        </View>
      );
    }
    case 'coverage_map':
      return <CoverageMap tracks={data.coverage_tracks} inLayout={layoutHas(data.user_layout, 'coverage_map')} onPressTrack={openById} />;
    case 'recent_videos':
      if (data.public_videos.length === 0) return null;
      return (
        <View style={styles.section}>
          <SectionHeader icon="video" title="Recent uploads" action={{ label: 'See all', onPress: goVideos }} />
          <VideoGrid videos={data.public_videos} columns={cols} onPress={openVideo} />
        </View>
      );
    case 'categories':
      return (
        <>
          {data.rows
            .filter((row) => row.videos.length > 0)
            .map((row) => (
              <View key={row.category_id} style={styles.section}>
                <SectionHeader icon="folder" title={row.value} />
                <VideoGrid videos={row.videos} columns={cols} onPress={openVideo} />
              </View>
            ))}
        </>
      );
    case 'user_uploads':
      if (data.user_videos.length === 0) return null;
      return (
        <View style={styles.section}>
          <SectionHeader icon="upload" title="Your uploads" />
          <VideoGrid videos={data.user_videos} columns={cols} onPress={openVideo} />
        </View>
      );
    case 'recent_images':
      if (data.recent_images.length === 0) return null;
      return (
        <View style={styles.section}>
          <SectionHeader icon="image" title="Recent screenshots" />
          <ImageStrip images={data.recent_images} />
        </View>
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { paddingTop: 12, paddingBottom: 24, gap: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
  pageHead: { gap: 2 },
  h1: { fontSize: 22, fontWeight: '700', color: theme.textPrimary },
  subtitle: { fontSize: 13, color: theme.textSecondary },
  section: { gap: 8 },
  staleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radiusSm, backgroundColor: theme.bgSubtle, borderWidth: 1, borderColor: theme.border },
  staleText: { flex: 1, fontSize: 11, color: theme.textSecondary },
  staleRetryBtn: { minHeight: 44, paddingHorizontal: 6, justifyContent: 'center' },
  staleRetry: { fontSize: 12, fontWeight: '700', color: theme.accentActive },
});
