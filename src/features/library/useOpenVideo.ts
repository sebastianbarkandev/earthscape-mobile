import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { getEventId } from './api';
import type { VideoListItem } from './librarySlice';

/** Library + Live share one navigation path: item -> /video/[eventId]?videoId=. */
export function useOpenVideo() {
  const router = useRouter();
  return useCallback(
    async (item: VideoListItem) => {
      let eventId = item.event_id;
      if (!eventId) {
        try {
          eventId = (await getEventId(item.id)).event_id;
        } catch (e) {
          Alert.alert('Could not open video', e instanceof Error ? e.message : 'Unknown error');
          return;
        }
      }
      router.push({
        pathname: '/video/[eventId]',
        params: { eventId: String(eventId), videoId: String(item.id) },
      });
    },
    [router],
  );
}
