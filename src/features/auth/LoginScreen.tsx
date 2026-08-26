import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { theme } from '@/common/theme';
import { getHostLabel } from '@/common/config';
import { chooseOrg, login } from './authSlice';

/**
 * Email + password only, matching the website's form. The org is not typed —
 * the backend resolves it from the credentials (see authSlice). The one case
 * that needs a second tap is an address registered in more than one org, since
 * email is unique per-org, not globally (User's UniqueConstraint).
 */
export function LoginScreen() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const status = useAppSelector((s) => s.auth.status);
  const error = useAppSelector((s) => s.auth.error);
  const organizations = useAppSelector((s) => s.auth.organizations);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const busy = status === 'loggingIn';
  const picking = status === 'choosingOrg';
  const canSubmit = email.length > 0 && password.length > 0;

  const submit = async () => {
    const result = await dispatch(login({ email, password }));
    if (login.fulfilled.match(result) && result.payload.kind === 'loggedIn') {
      router.replace('/(tabs)');
    }
  };

  const pick = async (subdomain: string) => {
    const result = await dispatch(chooseOrg({ subdomain, email, password }));
    if (chooseOrg.fulfilled.match(result)) router.replace('/(tabs)');
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.brand}>Earthscape</Text>
        <Text style={styles.tagline}>{picking ? 'Choose your organization' : 'Sign in'}</Text>

        {picking ? (
          <>
            {organizations.map((org) => (
              <Pressable
                key={org.subdomain}
                onPress={() => pick(org.subdomain)}
                disabled={busy}
                style={({ pressed }) => [styles.orgRow, pressed && styles.orgRowPressed]}
              >
                <Text style={styles.orgName}>{org.name}</Text>
                <Text style={styles.orgSubdomain}>{org.subdomain}</Text>
              </Pressable>
            ))}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={theme.textTertiary}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={theme.textTertiary}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={canSubmit ? submit : undefined}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              onPress={submit}
              disabled={!canSubmit || busy}
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
                (!canSubmit || busy) && styles.buttonDisabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={theme.textOnAccent} />
              ) : (
                <Text style={styles.buttonText}>Sign in</Text>
              )}
            </Pressable>
          </>
        )}

        {__DEV__ && <Text style={styles.devNote}>Backend: {getHostLabel()}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: theme.surface,
    borderRadius: theme.radiusLg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 24,
    gap: 12,
  },
  brand: { fontSize: 26, fontWeight: '700', color: theme.textPrimary },
  tagline: { fontSize: 13, color: theme.textSecondary, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: theme.borderStrong,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.textPrimary,
    backgroundColor: theme.surface,
  },
  orgRow: {
    borderWidth: 1,
    borderColor: theme.borderStrong,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  orgRowPressed: { backgroundColor: theme.accentTint, borderColor: theme.accent },
  orgName: { fontSize: 15, fontWeight: '600', color: theme.textPrimary },
  orgSubdomain: { fontSize: 12, color: theme.textTertiary, marginTop: 2 },
  error: { color: theme.danger, fontSize: 13 },
  button: {
    backgroundColor: theme.accent,
    borderRadius: theme.radiusPill,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonPressed: { backgroundColor: theme.accentActive },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: theme.textOnAccent, fontSize: 15, fontWeight: '600' },
  devNote: { fontSize: 11, color: theme.textTertiary, textAlign: 'center' },
});
