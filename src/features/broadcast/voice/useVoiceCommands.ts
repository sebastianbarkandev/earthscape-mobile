import { useCallback, useEffect, useRef } from 'react';
import { Alert, Linking } from 'react-native';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { EarthscapeLive, addLiveListener, type VoiceTranscriptEvent } from '../../../../modules/earthscape-live';
import {
  voiceAddMark,
  voiceCancelClip,
  voiceClipIn,
  voiceClipOut,
  voiceFeedback,
  voiceLabelLast,
  voiceListenChanged,
  voicePermission,
  voiceSetMode,
  voiceTouch,
  voiceTranscript,
  voiceUndoLast,
  type VoiceMode,
  type VoiceProvenance,
} from '../broadcastSlice';
import { containsWakePhrase, parseUtterance, VOICE_CONTEXTUAL_STRINGS, type VoiceCommand } from './grammar';
import { commandTimeUnix, streamStartUnix, utteranceStartUnix, VOICE_IDLE_MS } from './voiceTiming';

/**
 * Voice commands on the Go Live screen: subscribes to the native recognizer, runs each
 * FINAL utterance through the strict grammar and dispatches the clipmark thunks.
 *
 *  - `mode` (Redux) is the policy: off → nothing is recognized; standby → only the wake
 *    phrase; active → the command table. Partials are only shown, never acted on: acting on
 *    a hypothesis that the recognizer later revises would double-fire or misfire, and the
 *    mark time does not depend on how fast we react (it is back-dated to the utterance start).
 *  - Standby arms itself once live when `wakeEnabled` (the spoken way in); the button is the
 *    other way in and goes straight to active. Two ways in, one strict vocabulary.
 *  - Every request id is acted on at most once (the native side emits exactly one final per id).
 */
export function useVoiceCommands() {
  const dispatch = useAppDispatch();
  const voice = useAppSelector((s) => s.broadcast.voice);
  const phase = useAppSelector((s) => s.broadcast.phase);
  const createdAt = useAppSelector((s) => s.broadcast.stream?.created_at ?? null);
  const supported = EarthscapeLive.isVoiceSupported;

  // Latest values for the event handler (subscribed once).
  const modeRef = useRef<VoiceMode>(voice.mode);
  modeRef.current = voice.mode;
  const offsetRef = useRef(voice.reactionOffsetSec);
  offsetRef.current = voice.reactionOffsetSec;
  const floorRef = useRef<number | null>(null);
  floorRef.current = streamStartUnix(createdAt);
  const handled = useRef(new Set<number>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const runCommands = useCallback((commands: VoiceCommand[], atUnix: number, provenance: VoiceProvenance) => {
    for (const c of commands) {
      switch (c.kind) {
        case 'activate':
          dispatch(voiceFeedback({ text: 'Voice commands already active', tone: 'ok' }));
          break;
        case 'deactivate':
          dispatch(voiceSetMode('standby'));
          EarthscapeLive.haptic('light');
          break;
        case 'mark':
          dispatch(voiceAddMark({ atUnix, provenance }));
          EarthscapeLive.haptic('success');
          break;
        case 'clip_in':
          dispatch(voiceClipIn({ atUnix }));
          EarthscapeLive.haptic('medium');
          break;
        case 'clip_out':
          dispatch(voiceClipOut({ atUnix, provenance }));
          EarthscapeLive.haptic('success');
          break;
        case 'cancel_clip':
          dispatch(voiceCancelClip());
          EarthscapeLive.haptic('light');
          break;
        case 'undo':
          dispatch(voiceUndoLast());
          EarthscapeLive.haptic('warning');
          break;
        case 'label':
          dispatch(voiceLabelLast({ text: c.text }));
          EarthscapeLive.haptic('light');
          break;
      }
    }
  }, [dispatch]);

  const onTranscript = useCallback((ev: VoiceTranscriptEvent) => {
    if (!alive.current) return;
    const mode = modeRef.current;
    if (mode === 'off') return;
    dispatch(voiceTranscript({ text: ev.text, isFinal: ev.isFinal }));
    if (!ev.isFinal) return;
    if (handled.current.has(ev.requestId)) return;
    handled.current.add(ev.requestId);
    if (handled.current.size > 500) handled.current.clear();
    const text = ev.text.trim();
    if (!text) return;
    if (mode === 'standby') {
      if (containsWakePhrase(text)) {
        dispatch(voiceSetMode('active'));
        EarthscapeLive.haptic('success');
      }
      return;
    }
    const commands = parseUtterance(text);
    if (!commands.length) {
      dispatch(voiceFeedback({ text: `Didn't catch that: “${text.slice(0, 60)}”`, tone: 'warn' }));
      return;
    }
    dispatch(voiceTouch());
    const atUnix = commandTimeUnix(utteranceStartUnix(ev, Date.now()), offsetRef.current, floorRef.current);
    const confidences = ev.segments.map((s) => s.confidence).filter((c) => c > 0);
    const confidence = confidences.length ? Math.min(...confidences) : undefined;
    runCommands(commands, atUnix, { transcript: text, confidence });
  }, [dispatch, runCommands]);

  useEffect(() => {
    if (!supported) return;
    const subs = [
      addLiveListener('onVoiceState', (e) => dispatch(voiceListenChanged(e))),
      addLiveListener('onVoiceTranscript', onTranscript),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [supported, dispatch, onTranscript]);

  /** Permission gate; returns true when speech recognition may run. */
  const ensurePermission = useCallback(async (): Promise<boolean> => {
    let p = await EarthscapeLive.getSpeechPermission();
    if (p === 'undetermined') p = await EarthscapeLive.requestSpeechPermission();
    if (!alive.current) return false;
    dispatch(voicePermission(p));
    return p === 'granted';
  }, [dispatch]);

  /** Start the recognizer and enter `mode`; false if it could not (permission / native). */
  const arm = useCallback(async (mode: Exclude<VoiceMode, 'off'>, opts: { prompt: boolean }): Promise<boolean> => {
    if (!supported) return false;
    const ok = await ensurePermission();
    if (!ok) {
      if (opts.prompt) {
        Alert.alert('Speech recognition needed', 'Allow speech recognition in Settings to use voice commands. Speech is processed on this device.', [
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
          { text: 'Cancel', style: 'cancel' },
        ]);
      }
      return false;
    }
    if (!alive.current) return false;
    try {
      await EarthscapeLive.setVoiceListening(true, VOICE_CONTEXTUAL_STRINGS);
    } catch (e) {
      dispatch(voiceFeedback({ text: e instanceof Error ? e.message : 'Could not start voice recognition', tone: 'err' }));
      return false;
    }
    if (!alive.current) {
      EarthscapeLive.setVoiceListening(false).catch(() => undefined);
      return false;
    }
    dispatch(voiceSetMode(mode));
    return true;
  }, [supported, ensurePermission, dispatch]);

  const disarm = useCallback(async () => {
    dispatch(voiceSetMode('off'));
    await EarthscapeLive.setVoiceListening(false).catch(() => undefined);
  }, [dispatch]);

  /** The voice button: off → active; standby/active → off. */
  const toggle = useCallback(async () => {
    if (modeRef.current === 'off') {
      const ok = await arm('active', { prompt: true });
      if (ok) EarthscapeLive.haptic('success');
    } else {
      await disarm();
    }
  }, [arm, disarm]);

  // Spoken way in: once live, listen for the wake phrase (if allowed — never prompt from here).
  const live = phase === 'live';
  useEffect(() => {
    if (!supported || !live || !voice.wakeEnabled || voice.mode !== 'off') return;
    let cancelled = false;
    (async () => {
      const p = await EarthscapeLive.getSpeechPermission();
      if (cancelled || !alive.current || p !== 'granted') {
        if (!cancelled && alive.current) dispatch(voicePermission(p));
        return;
      }
      await arm('standby', { prompt: false });
    })();
    return () => {
      cancelled = true;
    };
    // Re-armed only when the stream goes live or the wake setting flips — not on every mode change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, live, voice.wakeEnabled]);

  // Stream over → stop listening (the native side also stops on stopPreview).
  useEffect(() => {
    if (!supported) return;
    if ((phase === 'ended' || phase === 'error' || phase === 'idle') && voice.mode !== 'off') {
      disarm().catch(() => undefined);
    }
  }, [supported, phase, voice.mode, disarm]);

  // Idle: active → standby (wake phrase still works) or off when the wake phrase is disabled.
  useEffect(() => {
    if (voice.mode !== 'active') return;
    const timer = setInterval(() => {
      const last = voice.lastActivityAt ?? 0;
      if (Date.now() - last < VOICE_IDLE_MS) return;
      if (voice.wakeEnabled) dispatch(voiceSetMode('standby'));
      else disarm().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [voice.mode, voice.lastActivityAt, voice.wakeEnabled, dispatch, disarm]);

  // Unmount: never leave the recognizer running behind the screen.
  useEffect(() => () => {
    if (supported) EarthscapeLive.setVoiceListening(false).catch(() => undefined);
  }, [supported]);

  return { voice, supported, toggle, arm, disarm };
}
