import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { denseText } from '@/common/typography';
import { Icon } from '@/common/components/Icon';
import { formatTime } from '@/common/lib/formatTime';
import type { VoiceState } from '../broadcastSlice';
import { COMMAND_HELP } from './grammar';

/** How long a feedback line ("Mark added") stays before the HUD goes back to the transcript. */
const FEEDBACK_MS = 4000;

/**
 * What the phone hears and does, on the Go Live overlay. Voice has NO spoken feedback (it
 * would go out on the published audio track), so this line plus haptics is the whole
 * acknowledgement — it must always say whether a command was taken.
 */
export function VoiceHud({ voice }: { voice: VoiceState }) {
  const [help, setHelp] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // 1 Hz: open-clip elapsed + feedback fade.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const headline = describe(voice);
  const feedbackFresh = voice.feedback && now - voice.feedback.at < FEEDBACK_MS ? voice.feedback : null;
  const line = feedbackFresh
    ? { text: feedbackFresh.text, style: feedbackFresh.tone === 'ok' ? styles.ok : feedbackFresh.tone === 'warn' ? styles.warn : styles.err }
    : voice.transcript
      ? { text: `“${voice.transcript}”`, style: voice.transcriptFinal ? styles.transcript : styles.partial }
      : null;
  const openFor = voice.openClipStart != null ? Math.max(0, now / 1000 - voice.openClipStart) : null;

  return (
    <Pressable
      testID="golive-voice-hud"
      onPress={() => setHelp((v) => !v)}
      style={styles.box}
      accessibilityRole="button"
      accessibilityLabel={`Voice commands: ${headline.text}${line ? `. ${line.text}` : ''}`}
      accessibilityHint={help ? 'Hides the list of commands' : 'Shows the list of commands'}
    >
      <View style={styles.head}>
        <Icon name={headline.icon} size={13} color={headline.color} />
        <Text style={[styles.headText, { color: headline.color }]} numberOfLines={1} {...denseText}>{headline.text}</Text>
        {openFor != null && (
          <View style={styles.clipBadge}>
            <View style={styles.clipDot} />
            <Text style={styles.clipText} {...denseText}>Clip {formatTime(openFor, false)}</Text>
          </View>
        )}
        {voice.marks.length > 0 && <Text style={styles.count} {...denseText}>{voice.marks.length} mark{voice.marks.length === 1 ? '' : 's'}</Text>}
        {voice.busy > 0 && <Text style={styles.count} {...denseText}>saving…</Text>}
      </View>
      {line && <Text style={[styles.line, line.style]} numberOfLines={2}>{line.text}</Text>}
      {help && (
        <View style={styles.help}>
          {COMMAND_HELP.map((h) => (
            <Text key={h.say} style={styles.helpLine}><Text style={styles.helpSay}>{h.say}</Text> {h.does}</Text>
          ))}
        </View>
      )}
    </Pressable>
  );
}

function describe(voice: VoiceState): { text: string; icon: string; color: string } {
  if (voice.listen === 'paused_muted') return { text: 'Voice paused — microphone muted', icon: 'microphone-slash', color: theme.warningText };
  if (voice.listen === 'unavailable') return { text: voice.listenReason ?? 'Speech recognition unavailable', icon: 'triangle-exclamation', color: theme.warningText };
  if (voice.listen === 'error') return { text: voice.listenReason ?? 'Speech recognition error — retrying', icon: 'triangle-exclamation', color: theme.warningText };
  if (voice.mode === 'active') return { text: `Voice commands active${voice.onDevice ? '' : ' (online recognition)'}`, icon: 'microphone-lines', color: theme.successText };
  return { text: 'Say “activate voice commands”', icon: 'ear-listen', color: theme.overlayTextMuted };
}

const styles = StyleSheet.create({
  box: { minHeight: 44, justifyContent: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: theme.radiusSm, backgroundColor: theme.overlayControl },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headText: { flex: 1, fontSize: 12, fontWeight: '700' },
  clipBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, minHeight: 18, borderRadius: theme.radiusPill, backgroundColor: theme.liveRed },
  clipDot: { width: 6, height: 6, borderRadius: theme.radiusPill, backgroundColor: theme.overlayText },
  clipText: { color: theme.overlayText, fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'] },
  count: { color: theme.overlayTextMuted, fontSize: 10, fontWeight: '600' },
  line: { fontSize: 12, lineHeight: 16 },
  transcript: { color: theme.overlayText },
  partial: { color: theme.overlayTextMuted, fontStyle: 'italic' },
  ok: { color: theme.successText, fontWeight: '600' },
  warn: { color: theme.warningText, fontWeight: '600' },
  err: { color: theme.warningText, fontWeight: '700' },
  help: { gap: 2, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.overlayHairline },
  helpLine: { color: theme.overlayTextMuted, fontSize: 11, lineHeight: 15 },
  helpSay: { color: theme.overlayText, fontWeight: '600' },
});
