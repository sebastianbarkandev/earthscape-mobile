/**
 * LIVE-021: `POST /videos/{id}/screenshot` 404s for a video with no `duration`, which is every
 * live program (the backend fills duration in when the recording is transcoded), so the action
 * must explain itself instead of dispatching a request that can only fail.
 */
import React from 'react';
import { Alert, Pressable } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ActionRow } from '../ActionRow';
import { videoCapabilities } from '../../videoCapabilities';
import type { EventVideo } from '../../api';
import { makeStore, permissions, primaryVideo } from '../../__tests__/fixtures';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/common/components/LiveBadge', () => ({ LiveBadge: () => null }));

const livePhone: EventVideo = {
  ...primaryVideo,
  id: 7,
  is_primary: false,
  program_type: 'Mobile · Ana',
  live_stream_state: 'live',
  status: 'live',
  duration: null,
  end: null,
  download_url: null,
};

function renderRow(video: EventVideo) {
  const store = makeStore();
  const caps = videoCapabilities(video, permissions, null, true);
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <Provider store={store}>
        <ActionRow video={video} caps={caps} layout="split" layoutLocked={false} clipmarkCount={0} onShare={() => undefined} />
      </Provider>,
    );
  });
  const button = (label: string) =>
    r.root.findAll((n) => n.type === Pressable && n.props.accessibilityLabel === label)[0] ?? null;
  return { store, r, button };
}

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  mounted.splice(0).forEach((r) => act(() => r.unmount()));
  (Alert.alert as unknown as jest.Mock).mockClear?.();
});

describe('ActionRow screenshot action (LIVE-021)', () => {
  it('a live program shows the action muted with an explanation and never posts a screenshot', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { store, r, button } = renderRow(livePhone);
    mounted.push(r);
    const shot = button('Screenshot');
    expect(shot).not.toBeNull();
    expect(shot!.props.accessibilityHint).toBe('Unavailable while this program is live');
    act(() => { shot!.props.onPress(); });
    expect(alert).toHaveBeenCalledWith('Not available while live', expect.stringContaining('once the live recording is ready'));
    expect(store.getState().player.op.busy).toBeNull();
    alert.mockRestore();
  });

  // LIVE-021 (2nd pass): the backend rule is `duration`, not liveness. A program that stopped
  // publishing is `processing` with duration still NULL for the whole transcode window, so gating
  // on `caps.isLive` re-enabled a button that can only 404. Reverting to `caps.isLive` fails this.
  it('a program that stopped publishing (processing, duration still NULL) keeps the action muted', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const processing: EventVideo = { ...livePhone, live_stream_state: 'processing', status: 'processing' };
    const caps = videoCapabilities(processing, permissions, null, true);
    expect(caps.isLive).toBe(false);
    expect(caps.canScreenshot).toBe(false);
    const { store, r, button } = renderRow(processing);
    mounted.push(r);
    const shot = button('Screenshot');
    expect(shot!.props.accessibilityHint).toBe('Unavailable until the recording is ready');
    act(() => { shot!.props.onPress(); });
    expect(alert).toHaveBeenCalledWith('Not available yet', expect.stringContaining('once the live recording is ready'));
    expect(store.getState().player.op.busy).toBeNull();
    alert.mockRestore();
  });

  it('the recording-ready program the transcode produced (duration set) gets the real button', () => {
    const ready: EventVideo = { ...livePhone, live_stream_state: 'recording_ready', status: 'ready', duration: 312 };
    expect(videoCapabilities(ready, permissions, null, true).canScreenshot).toBe(true);
    const { r, button } = renderRow(ready);
    mounted.push(r);
    expect(button('Screenshot')!.props.accessibilityHint).toBeUndefined();
  });

  it('a VOD program keeps the normal, un-hinted screenshot button', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { r, button } = renderRow(primaryVideo);
    mounted.push(r);
    const shot = button('Screenshot');
    expect(shot).not.toBeNull();
    expect(shot!.props.accessibilityHint).toBeUndefined();
    act(() => { shot!.props.onPress(); });
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
