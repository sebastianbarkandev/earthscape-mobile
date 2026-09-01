import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAppSelector } from '@/store/hooks';
import { GoLiveScreen } from '@/features/broadcast/GoLiveScreen';
import { parseId } from '@/common/routeParams';
import { canCreateLiveStream } from '@/features/broadcast/liveGates';
import { parseProgramLabels } from '@/features/broadcast/programLabel';

/**
 * Phone as a live source. `?eventId=&title=` joins that live event as an extra
 * program; without params it creates a brand-new live event.
 */
export default function GoLiveRoute() {
  const status = useAppSelector((s) => s.auth.status);
  const mayPublish = useAppSelector((s) => canCreateLiveStream(s.auth.bootstrap));
  const { eventId, title, programs } = useLocalSearchParams<{ eventId?: string; title?: string; programs?: string }>();
  if (status !== 'loggedIn') return <Redirect href="/login" />;
  if (!mayPublish) return <Redirect href="/(tabs)" />; // SEC-005: deep links can't bypass the Live tab's gate
  const id = parseId(eventId) ?? undefined; // `Number('')` / `Number(' ')` are 0 and would pass a finiteness check
  return <GoLiveScreen eventId={id} eventTitle={typeof title === 'string' ? title : undefined} programs={parseProgramLabels(programs)} />;
}
