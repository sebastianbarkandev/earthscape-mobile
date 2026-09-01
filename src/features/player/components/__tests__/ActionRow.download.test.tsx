/**
 * LIVE-034 — Download, the sibling of the LIVE-021 Screenshot gate.
 *
 * `processing` means "the recording does not exist yet" (backend models/video.py: the state is
 * `status in (ending, ended) and not hls_stream`), and for cloud orgs `Video.download_url` is
 * returned unconditionally — a presigned GET for the uploads key the transcode chain has not
 * written — so a Download offered in that window can only fail with a 404 banner. The app already
 * computed the right rule (`isLiveish`, documented as the web DownloadButton rule) and never used
 * it: the button was gated on `isLive` alone and so reappeared the moment a phone stopped
 * publishing, minutes before the recording was ready.
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

/** A phone program that joined the event via "Add my camera", with a download URL from the API. */
const phone = (over: Partial<EventVideo>): EventVideo => ({
  ...primaryVideo,
  id: 9,
  is_primary: false,
  program_type: 'Mobile · Ana',
  live_stream_state: 'live',
  status: 'live',
  duration: null,
  end: null,
  download_url: '/videos/9/download',
  ...over,
});

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  mounted.splice(0).forEach((r) => act(() => r.unmount()));
  (Alert.alert as unknown as jest.Mock).mockClear?.();
});

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
  mounted.push(r);
  const download = () =>
    r.root.findAll((n) => n.type === Pressable && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Download'))[0] ?? null;
  return { store, caps, download };
}

describe('ActionRow download action (LIVE-034)', () => {
  it('a program that stopped publishing (processing, duration still NULL) offers no Download', () => {
    const processing = phone({ live_stream_state: 'processing', status: 'processing' });
    const { caps, download } = renderRow(processing);
    expect(caps.isLive).toBe(false); // the flip the 20s refreshEvent produces
    expect(caps.showDownload).toBe(false);
    expect(download()).toBeNull();
  });

  it('a live program offers no Download (unchanged)', () => {
    const { caps, download } = renderRow(phone({}));
    expect(caps.showDownload).toBe(false);
    expect(download()).toBeNull();
  });

  it('the recording the transcode produced (recording_ready + duration) gets the button back', () => {
    const ready = phone({ live_stream_state: 'recording_ready', status: 'ready', duration: 312, end: (primaryVideo.start ?? 0) + 312 });
    const { caps, download } = renderRow(ready);
    expect(caps.showDownload).toBe(true);
    expect(download()).not.toBeNull();
  });

  it('a plain VOD program (no live state at all) keeps its Download button', () => {
    const vod: EventVideo = { ...primaryVideo, download_url: '/videos/6/download' };
    const { caps, download } = renderRow(vod);
    expect(caps.isLiveish).toBe(false);
    expect(caps.showDownload).toBe(true);
    expect(download()).not.toBeNull();
  });
});
