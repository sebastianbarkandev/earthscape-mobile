import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { useAppSelector } from '@/store/hooks';
import { theme } from '@/common/theme';
import { AppHeader } from '@/common/components/AppHeader';
import { Icon, type IconName } from '@/common/components/Icon';
import { TabLabel } from '@/common/components/TabLabel';

function TabIcon({ name, color }: { name: IconName; color: string }) {
  return <Icon name={name} size={18} color={color} />;
}

/** Footer tab bar is the primary navigation (Home · Videos · Live); the header carries logo, search and account. */
export default function TabsLayout() {
  const status = useAppSelector((s) => s.auth.status);
  const bootstrap = useAppSelector((s) => s.auth.bootstrap);
  if (status !== 'loggedIn') return <Redirect href="/login" />;

  const features = bootstrap?.features ?? {};
  const nav = bootstrap?.nav_permissions ?? {};
  // Web Sidebar gate for Live minus its on_premise exclusion (the dev org is on-premise and /live/list works there).
  const showLive = !bootstrap || (features.live_enabled !== false && nav.can_read_livestreams !== false);

  return (
    <Tabs
      screenOptions={{
        header: () => <AppHeader />,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textTertiary,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        tabBarLabel: ({ color, children }) => <TabLabel color={color}>{children}</TabLabel>,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ color }) => <TabIcon name="house" color={color} /> }}
      />
      <Tabs.Screen
        name="videos"
        options={{ title: 'Videos', tabBarIcon: ({ color }) => <TabIcon name="video" color={color} /> }}
      />
      <Tabs.Screen
        name="live"
        options={{ title: 'Live', href: showLive ? undefined : null, tabBarIcon: ({ color }) => <TabIcon name="tower-broadcast" color={color} /> }}
      />
    </Tabs>
  );
}
