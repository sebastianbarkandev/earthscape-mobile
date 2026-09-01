import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { theme } from '@/common/theme';
import { getHostLabel } from '@/common/config';
import { edgePadding } from '@/common/layout';
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
  const insets = useSafeAreaInsets();
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
      {/* RESP-023: the card must SCROLL. Landscape + keyboard leaves ~213pt for a ~290pt card,
          and a multi-org picker (an email in >1 org) is taller than an SE screen — without a
          scroll region the Sign in button / the last organizations are simply unreachable. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, edgePadding(insets, 24), { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
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
                style={({ pressed }) => [styles.orgRow, pressed && styles.orgRowPressed, busy && styles.orgRowDisabled]}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy }}
                accessibilityLabel={`${org.name} (${org.subdomain})`}
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  scroll: { flex: 1 },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  /** UI-019: a disabled row that looks enabled reads as a dead tap during the second sign-in. */
  orgRowDisabled: { opacity: 0.5 },
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
