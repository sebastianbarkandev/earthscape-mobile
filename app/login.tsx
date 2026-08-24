import React from 'react';
import { Redirect } from 'expo-router';
import { useAppSelector } from '@/store/hooks';
import { LoginScreen } from '@/features/auth/LoginScreen';

export default function LoginRoute() {
  const status = useAppSelector((s) => s.auth.status);
  if (status === 'loggedIn') return <Redirect href="/(tabs)" />;
  return <LoginScreen />;
}
