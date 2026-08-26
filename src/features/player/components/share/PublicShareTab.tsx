import React, { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { theme } from '@/common/theme';
import { Icon } from '@/common/components/Icon';
import { getApiHost } from '@/common/config';
import { formatDate } from '@/common/lib/formatTime';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { ShareToken } from '../../api';
import { createShareToken } from '../../eventThunks';

/** Web PublicShareTab expiration ladder (days; 0 = never). */
const EXPIRATION_DAYS = [0, 1, 2, 3, 5, 7, 14, 30, 60, 90];
const expirationLabel = (d: number) => (d === 0 ? 'Does not expire' : `In ${d} day${d === 1 ? '' : 's'}`);

/** Public share links are served by the org host's /v/<token> view. */
export const publicShareUrl = (token: string) => `${getApiHost()}/v/${token}`;

/**
 * Port of the web PublicShareTab: creation form (expiration / recipients /
 * allow download) → success banner + link bar + settings summary. No revoke:
 * the web's "Revoke link" posts to an endpoint that does not exist.
 */
export function PublicShareTab() {
  const dispatch = useAppDispatch();
  const canShare = useAppSelector((s) => !!s.player.permissions?.videos.share);
  const canDownloadPerm = useAppSelector((s) => !!s.player.permissions?.videos.download);
  const busy = useAppSelector((s) => s.player.op.busy === 'share');
  const tz = useAppSelector((s) => s.auth.bootstrap?.settings?.tz ?? null);
  const [days, setDays] = useState(5);
  const [canDownload, setCanDownload] = useState(false);
  const [sharedWith, setSharedWith] = useState('');
  const [created, setCreated] = useState<ShareToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canShare) return <Text style={styles.muted}>You don’t have permission to share this video publicly.</Text>;

  const pickExpiration = () => {
    const labels = EXPIRATION_DAYS.map(expirationLabel);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title: 'Link expiration', options: [...labels, 'Cancel'], cancelButtonIndex: labels.length }, (i) => { if (i < EXPIRATION_DAYS.length) setDays(EXPIRATION_DAYS[i]); });
    } else {
      Alert.alert('Link expiration', undefined, [...EXPIRATION_DAYS.map((d) => ({ text: expirationLabel(d), onPress: () => setDays(d) })), { text: 'Cancel', style: 'cancel' }]);
    }
  };
  const expiresAt = days ? Math.floor(Date.now() / 1000) + days * 86400 : null;

  const create = async () => {
    setError(null);
    const res = await dispatch(createShareToken({ expiresAt, canDownload: canDownloadPerm && canDownload, sharedWith: sharedWith.trim() }));
    if (createShareToken.fulfilled.match(res)) setCreated(res.payload);
    else setError((res.payload as string) ?? 'Could not create a share link.');
  };

  if (created) {
    const url = publicShareUrl(created.token);
    const copy = async () => {
      await Clipboard.setStringAsync(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    const exp = created.expires_at != null ? Number(created.expires_at) : null;
    return (
      <View style={styles.wrap}>
        <View style={styles.banner}>
          <Icon name="circle-check" size={16} color={theme.success} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Share link created</Text>
            <Text style={styles.bannerSub}>Anyone with the link can view this video. Copy it below or send it with the share sheet.</Text>
          </View>
        </View>
        <Text style={styles.label}>Share link</Text>
        <View style={styles.linkBar}>
          <Text style={styles.linkText} numberOfLines={1} selectable>{url}</Text>
          <Pressable onPress={copy} style={[styles.copyBtn, copied && styles.copyBtnDone]} hitSlop={4}>
            <Icon name={copied ? 'check' : 'copy'} size={12} color={theme.textOnAccent} />
            <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
          </Pressable>
        </View>
        <View style={styles.settings}>
          <Setting icon="infinity" label="Expires" value={exp ? formatDate(exp, tz) : 'Does not expire'} />
          <Setting icon="download" label="Download" value={created.can_download ? 'Enabled' : 'Disabled'} />
          {created.shared_with ? <Setting icon="envelope" label="Sent to" value={String(created.shared_with)} /> : null}
        </View>
        <View style={styles.actions}>
          <Pressable onPress={() => Share.share({ url, message: url }).catch(() => undefined)} style={styles.secondary}>
            <Icon name="share" size={12} color={theme.textPrimary} />
            <Text style={styles.secondaryText}>Share…</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => setCreated(null)} style={styles.primary}>
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </View>
        <Text style={styles.muted}>Public links cannot be revoked from the app.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.warning}>
        <Icon name="triangle-exclamation" size={14} color={theme.accentActive} />
        <View style={{ flex: 1 }}>
          <Text style={styles.warningTitle}>Use caution</Text>
          <Text style={styles.warningText}>Sharing creates a publicly-available URL for this video. Anyone with the link can view it.</Text>
        </View>
      </View>

      <Text style={styles.label}>Link expiration</Text>
      <Pressable onPress={pickExpiration} style={styles.select}>
        <Text style={styles.selectText}>{expirationLabel(days)}</Text>
        <Icon name="chevron-down" size={10} color={theme.textTertiary} />
      </Pressable>
      <Text style={styles.help}>{expiresAt ? `Will expire on ${formatDate(expiresAt, tz)}.` : 'Will never expire.'}</Text>

      <Text style={styles.label}>Shared with (optional)</Text>
      <TextInput style={styles.input} value={sharedWith} onChangeText={setSharedWith} placeholder="Add recipient email or name" placeholderTextColor={theme.textTertiary} autoCapitalize="none" />

      {canDownloadPerm && (
        <Pressable onPress={() => setCanDownload((v) => !v)} style={styles.checkRow}>
          <Switch value={canDownload} onValueChange={setCanDownload} trackColor={{ true: theme.accent }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.checkTitle}>Allow download</Text>
            <Text style={styles.help}>Recipients can download the original video file and its data. They may keep a copy indefinitely — double-check recipients before sharing.</Text>
          </View>
        </Pressable>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable onPress={create} disabled={busy} style={[styles.primary, styles.primaryWide, busy && { opacity: 0.6 }]}>
        <Icon name="globe" size={12} color={theme.textOnAccent} />
        <Text style={styles.primaryText}>Create share link</Text>
      </Pressable>
    </View>
  );
}

function Setting({ icon, label, value }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; value: string }) {
  return (
    <View style={styles.setting}>
      <Icon name={icon} size={11} color={theme.textTertiary} />
      <Text style={styles.settingLabel}>{label}:</Text>
      <Text style={styles.settingValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  muted: { fontSize: 12, color: theme.textTertiary },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: theme.radiusMd, backgroundColor: '#EAF4EA', borderWidth: 1, borderColor: '#CFE6CF' },
  bannerTitle: { fontSize: 13, fontWeight: '700', color: theme.success },
  bannerSub: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
  label: { fontSize: 11, fontWeight: '700', color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  linkBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: theme.borderStrong, borderRadius: theme.radiusSm, paddingLeft: 10, paddingRight: 4, height: 40 },
  linkText: { flex: 1, fontSize: 13, color: theme.textPrimary },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: theme.radiusSm, backgroundColor: theme.accent },
  copyBtnDone: { backgroundColor: theme.success },
  copyText: { color: theme.textOnAccent, fontSize: 12, fontWeight: '700' },
  settings: { gap: 6 },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingLabel: { fontSize: 12, color: theme.textSecondary, width: 70 },
  settingValue: { flex: 1, fontSize: 12, color: theme.textPrimary, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, paddingHorizontal: 18, borderRadius: theme.radiusPill, backgroundColor: theme.accent },
  primaryWide: { alignSelf: 'stretch' },
  primaryText: { color: theme.textOnAccent, fontWeight: '700', fontSize: 13 },
  secondary: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 14, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border },
  secondaryText: { color: theme.textPrimary, fontWeight: '600', fontSize: 13 },
  warning: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: theme.radiusMd, backgroundColor: theme.accentTint, borderWidth: 1, borderColor: '#FFD9BF' },
  warningTitle: { fontSize: 13, fontWeight: '700', color: theme.accentActive },
  warningText: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 40, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.borderStrong, borderRadius: theme.radiusSm },
  selectText: { fontSize: 14, color: theme.textPrimary },
  help: { fontSize: 11, color: theme.textTertiary, marginTop: -4 },
  input: { height: 40, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.borderStrong, borderRadius: theme.radiusSm, fontSize: 14, color: theme.textPrimary },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 4 },
  checkTitle: { fontSize: 13, fontWeight: '700', color: theme.textPrimary, marginBottom: 2 },
  error: { fontSize: 12, color: theme.danger },
});
