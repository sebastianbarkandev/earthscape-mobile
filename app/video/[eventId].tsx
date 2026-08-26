import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAppSelector } from '@/store/hooks';
import { PlayerScreen } from '@/features/player/PlayerScreen';

/**
 * One route for VOD AND live (web parity: LiveViewPage renders VideoPage).
 * Params: eventId (route), videoId (optional — selects within multi-video events),
 * layout (optional 'video'|'split'|'map' — preselects the dashboard layout, e.g. for
 * deep links / QA), graphs (DEV only: 'Category/Name,Category/Name' pre-activates series).
 */
export default function VideoRoute() {
  const status = useAppSelector((s) => s.auth.status);
  const { eventId, videoId, layout, graphs } = useLocalSearchParams<{ eventId: string; videoId?: string; layout?: string; graphs?: string }>();

  if (status !== 'loggedIn') return <Redirect href="/login" />;
  if (!eventId) return <Redirect href="/(tabs)" />;

  return (
    <PlayerScreen
      eventId={eventId}
      videoIdHint={videoId ? Number(videoId) : undefined}
      initialLayout={layout === 'video' || layout === 'split' || layout === 'map' ? layout : undefined}
      initialGraphs={__DEV__ && graphs ? String(graphs).split(',') : undefined}
    />
  );
}
