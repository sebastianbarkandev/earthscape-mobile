import React from 'react';
import { Text } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { useAppSelector } from '@/store/hooks';
import { theme } from '@/common/theme';

function TabGlyph({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const status = useAppSelector((s) => s.auth.status);
  if (status !== 'loggedIn') return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textTertiary,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.textPrimary,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Library',
          tabBarIcon: ({ color }) => <TabGlyph glyph="▦" color={color} />,
        }}
      />
      <Tabs.Screen
        name="live"
        options={{
          title: 'Live',
          tabBarIcon: ({ color }) => <TabGlyph glyph="◉" color={color} />,
        }}
      />
    </Tabs>
  );
}
