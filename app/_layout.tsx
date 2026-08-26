import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Provider } from 'react-redux';
import { store } from '@/store';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { restoreSession, sessionExpired } from '@/features/auth/authSlice';
import { setUnauthorizedHandler } from '@/common/api/client';
import { theme } from '@/common/theme';

/**
 * Root layout: Redux Provider + session restore gate + Stack.
 * Route files stay THIN (structure decision) — screens live in src/features.
 */
function Root() {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.auth.status);

  useEffect(() => {
    setUnauthorizedHandler(() => dispatch(sessionExpired()));
    dispatch(restoreSession());
    return () => setUnauthorizedHandler(null);
  }, [dispatch]);

  if (status === 'restoring') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerTintColor: theme.textPrimary,
        headerStyle: { backgroundColor: theme.surface },
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="video/[eventId]" options={{ title: 'Video' }} />
      <Stack.Screen name="golive" options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <Provider store={store}>
      <StatusBar style="dark" />
      <Root />
    </Provider>
  );
}
