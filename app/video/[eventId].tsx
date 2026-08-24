import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAppSelector } from '@/store/hooks';
import { PlayerScreen } from '@/features/player/PlayerScreen';

/**
 * One route for VOD AND live (web parity: LiveViewPage renders VideoPage).
 * Params: eventId (route), videoId (optional — selects within multi-video events).
 */
export default function VideoRoute() {
  const status = useAppSelector((s) => s.auth.status);
  const { eventId, videoId } = useLocalSearchParams<{ eventId: string; videoId?: string }>();

  if (status !== 'loggedIn') return <Redirect href="/login" />;
  if (!eventId) return <Redirect href="/(tabs)" />;

  return (
    <PlayerScreen
      eventId={eventId}
      videoIdHint={videoId ? Number(videoId) : undefined}
    />
  );
}
