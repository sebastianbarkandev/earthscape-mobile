import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useGlobalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/common/theme';
import { Icon } from '@/common/components/Icon';
import { resolveMediaUrl } from '@/common/config';
import { initialsOf } from '@/common/lib/formatTime';
import { userDisplayName } from '@/features/auth/bootstrap';
import { logout } from '@/features/auth/authSlice';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { verticalTouchSlop } from '@/common/touchTarget';
import { edgePadding } from '@/common/layout';
import { DENSE_MAX_FONT_SCALE, denseText } from '@/common/typography';

/**
 * Mobile take on the web ShellHeader: logo (+ website name) · search bar ·
 * account button (the web's user dropdown: name, sign out). Page navigation
 * stays in the footer tab bar. Submitting the search opens the Search tab
 * with ?q=; the field mirrors the current query (web syncs with the URL).
 */
export function AppHeader() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const params = useGlobalSearchParams<{ q?: string }>();
  const bootstrap = useAppSelector((s) => s.auth.bootstrap);
  const websiteName = bootstrap?.settings?.website_name ?? 'Earthscape';
  const searchEnabled = bootstrap?.features?.search_enabled ?? true;
  const user = bootstrap?.current_user ?? null;
  const name = userDisplayName(user);
  const avatar = resolveMediaUrl(user?.profile_img_url);
  const [q, setQ] = useState(typeof params.q === 'string' ? params.q : '');

  useEffect(() => {
    if (typeof params.q === 'string') setQ(params.q);
  }, [params.q]);

  const submit = () => {
    router.push({ pathname: '/(tabs)/videos', params: q.trim() ? { q: q.trim() } : {} } as never);
  };

  const openAccount = () => {
    const title = user?.email ? `${name}\n${user.email}` : name;
    const signOut = () => Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => dispatch(logout()) }]);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title, options: ['Sign out', 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 }, (i) => { if (i === 0) signOut(); });
    } else {
      Alert.alert(name, user?.email ?? undefined, [{ text: 'Sign out', style: 'destructive', onPress: () => dispatch(logout()) }, { text: 'Cancel', style: 'cancel' }]);
    }
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      {/* RESP-019: landscape cut-out — the logo and the account button must stay tappable. */}
      <View style={[styles.row, edgePadding(insets, 12)]}>
        <Pressable onPress={() => router.push('/(tabs)' as never)} style={styles.brand}>
          <Image source={require('../../../assets/img/ShotoverLogo.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brandText} numberOfLines={1} {...denseText}>{websiteName}</Text>
        </Pressable>
        {searchEnabled && (
          <View style={styles.search}>
            <TextInput
              style={styles.input}
              value={q}
              onChangeText={setQ}
              placeholder="Search…"
              placeholderTextColor={theme.textTertiary}
              returnKeyType="search"
              onSubmitEditing={submit}
              autoCorrect={false}
              autoCapitalize="none"
              maxFontSizeMultiplier={DENSE_MAX_FONT_SCALE}
            />
            {q.length > 0 && (
              <Pressable onPress={() => setQ('')} style={styles.clearBtn} hitSlop={verticalTouchSlop(30)} accessibilityRole="button" accessibilityLabel="Clear search"><Icon name="xmark" size={12} color={theme.textTertiary} /></Pressable>
            )}
            <Pressable onPress={submit} hitSlop={verticalTouchSlop(30)} style={styles.searchBtn} accessibilityRole="button" accessibilityLabel="Search">
              <Icon name="magnifying-glass" size={13} color={theme.accent} />
            </Pressable>
          </View>
        )}
        <Pressable onPress={openAccount} style={[styles.avatar, bootstrap?.cross_org_admin && styles.avatarWarn]} hitSlop={6} accessibilityRole="button" accessibilityLabel="Account">
          {avatar ? <Image source={{ uri: avatar }} style={styles.avatarImg} /> : <Text style={styles.avatarText} {...denseText}>{initialsOf(name)}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border },
  // RESP-020: `minHeight`, never `height` — at AX sizes the capped labels still need the room.
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 52 },
  // UI-022: the content is a 20pt logo — the tappable box has to be stated (the row is 52pt).
  brand: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 150, minHeight: 44 },
  logo: { width: 34, height: 20 },
  brandText: { fontSize: 14, fontWeight: '700', color: theme.textPrimary, flexShrink: 1 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingLeft: 12, paddingRight: 4, borderRadius: theme.radiusPill, backgroundColor: theme.bgSubtle, borderWidth: 1, borderColor: theme.border },
  input: { flex: 1, fontSize: 14, color: theme.textPrimary, paddingVertical: 0 },
  // UI-024: 6pt from its neighbour inside the pill, so both use vertical-only slop.
  clearBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  searchBtn: { width: 30, height: 30, borderRadius: theme.radiusPill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface },
  avatar: { width: 32, height: 32, borderRadius: theme.radiusPill, backgroundColor: theme.accentTint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarWarn: { borderWidth: 2, borderColor: theme.danger },
  avatarImg: { width: 32, height: 32 },
  avatarText: { fontSize: 12, fontWeight: '700', color: theme.accentActive },
});
