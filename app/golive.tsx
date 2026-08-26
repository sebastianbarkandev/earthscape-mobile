import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAppSelector } from '@/store/hooks';
import { GoLiveScreen } from '@/features/broadcast/GoLiveScreen';

/**
 * Phone as a live source. `?eventId=&title=` joins that live event as an extra
 * program; without params it creates a brand-new live event.
 */
export default function GoLiveRoute() {
  const status = useAppSelector((s) => s.auth.status);
  const { eventId, title } = useLocalSearchParams<{ eventId?: string; title?: string }>();
  if (status !== 'loggedIn') return <Redirect href="/login" />;
  const id = eventId ? Number(eventId) : undefined;
  return <GoLiveScreen eventId={Number.isFinite(id) ? id : undefined} eventTitle={typeof title === 'string' ? title : undefined} />;
}
