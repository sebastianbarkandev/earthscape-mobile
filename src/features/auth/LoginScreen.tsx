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
import { login } from './authSlice';

/**
 * Subdomain + email + password -> Flask-Security session.
 * Subdomain first: it IS the tenant (CLAUDE.md rule 1) — customers already
 * know their org URL, so the field mirrors how they reach the website.
 */
export function LoginScreen() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const status = useAppSelector((s) => s.auth.status);
  const error = useAppSelector((s) => s.auth.error);
  const savedSubdomain = useAppSelector((s) => s.auth.subdomain);

  const [subdomain, setSubdomain] = useState(savedSubdomain);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const busy = status === 'loggingIn';
  const canSubmit = email.length > 0 && password.length > 0 && (__DEV__ || subdomain.length > 0);

  const submit = async () => {
    const result = await dispatch(login({ subdomain, email, password }));
    if (login.fulfilled.match(result)) router.replace('/(tabs)');
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.brand}>Earthscape</Text>
        <Text style={styles.tagline}>Sign in to your organization</Text>

        <View style={styles.subdomainRow}>
          <TextInput
            style={[styles.input, styles.subdomainInput]}
            placeholder="organization"
            placeholderTextColor={theme.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            value={subdomain}
            onChangeText={setSubdomain}
          />
          <Text style={styles.domainSuffix}>.earthscape.com</Text>
        </View>

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

        {__DEV__ && (
          <Text style={styles.devNote}>Dev build: requests go to the LAN API in config.ts</Text>
        )}
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
  subdomainRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subdomainInput: { flex: 1 },
  domainSuffix: { fontSize: 13, color: theme.textTertiary },
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
