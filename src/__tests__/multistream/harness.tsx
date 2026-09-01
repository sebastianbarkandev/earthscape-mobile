/**
 * Shared harness for the multi-stream scenario suites: a real store, a fake
 * expo-video engine (so player churn is observable), timer helpers and a
 * bootstrap payload builder.
 *
 * Only native boundaries are faked here. Reducers, thunks, hooks and components
 * are the real ones; the network is the FakeBackend in ./fakeBackend.ts.
 */
import React from 'react';
import { act } from 'react-test-renderer';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { restoreSession } from '@/features/auth/authSlice';
import libraryReducer from '@/features/library/librarySlice';
import broadcastReducer from '@/features/broadcast/broadcastSlice';
import playerReducer from '@/features/player/playerSlice';
import graphReducer from '@/features/player/graphSlice';
import type { Bootstrap } from '@/features/auth/bootstrap';
import { setSubdomain } from '@/common/config';

/**
 * A store with the app's real slices. Auth state is seeded through the REAL
 * `restoreSession.fulfilled` reducer (see `signedIn`) rather than preloadedState,
 * so the shape can never drift from the slice.
 */
export function makeScenarioStore() {
  setSubdomain('demo'); // resolveMediaUrl composes real-looking origins for the tile sources
  return configureStore({
    reducer: { auth: authReducer, library: libraryReducer, player: playerReducer, graph: graphReducer, broadcast: broadcastReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
  });
}
export type ScenarioStore = ReturnType<typeof makeScenarioStore>;

export function bootstrap(over: Partial<Bootstrap> = {}): Bootstrap {
  return {
    current_user: { id: 1, email: 'ana@example.com', username: 'ana', first_name: 'Ana', last_name: 'Ng', profile_img_url: null },
    is_admin: false,
    is_superadmin: false,
    cross_org_admin: false,
    csrf_token: 'x',
    urls: { api: 'https://demo.earthscape.com', static: '', www: 'https://demo.earthscape.com', logout: '/signout', login: '/signin' },
    settings: { website_name: 'Demo' },
    features: { live_enabled: true, show_multiprogram: true },
    nav_permissions: { can_read_livestreams: true },
    ...over,
  };
}

/** Seed a signed-in (or signed-out) session the way a cold launch does. */
export function signedIn(store: ScenarioStore, over: Partial<Bootstrap> = {}, loggedIn = true): void {
  store.dispatch(
    restoreSession.fulfilled({ subdomain: 'demo', loggedIn, bootstrap: loggedIn ? bootstrap(over) : null }, 'restore', undefined),
  );
}

/** Store + session in one call — what every scenario starts from. */
export function makeSignedInStore(over: Partial<Bootstrap> = {}, loggedIn = true): ScenarioStore {
  const store = makeScenarioStore();
  signedIn(store, over, loggedIn);
  return store;
}

// ── fake expo-video engine ─────────────────────────────────────────────────────
export interface FakePlayer {
  source: string;
  /** Defined with a getter/setter so writes are recorded in `currentTimeSets`. */
  currentTime: number;
  playing: boolean;
  muted: boolean;
  loop: boolean;
  duration: number;
  playbackRate: number;
  timeUpdateEventInterval: number;
  currentTimeSets: number[];
  seekBys: number[];
  replaced: string[];
  play(): void;
  pause(): void;
  seekBy(s: number): void;
  replaceAsync(source: string): Promise<void>;
  addListener(name: string, fn: (e: never) => void): { remove(): void };
  /** Test-side event pump (what the native player would emit). */
  emit(name: string, e: unknown): void;
}

export const videoPlayers: FakePlayer[] = [];
export function resetVideoPlayers(): void {
  videoPlayers.length = 0;
}
/** Players created for a source containing `needle` (e.g. a live playlist id). */
export function playersFor(needle: string): FakePlayer[] {
  return videoPlayers.filter((p) => p.source.includes(needle));
}

function makeFakePlayer(source: string): FakePlayer {
  const listeners = new Map<string, Array<(e: never) => void>>();
  let time = 0;
  const p: Omit<FakePlayer, 'currentTime'> = {
    source,
    playing: false,
    muted: false,
    loop: false,
    duration: 0,
    playbackRate: 1,
    timeUpdateEventInterval: 0,
    currentTimeSets: [],
    seekBys: [],
    replaced: [],
    play() {
      p.playing = true;
      p.emit('playingChange', { isPlaying: true });
    },
    pause() {
      p.playing = false;
      p.emit('playingChange', { isPlaying: false });
    },
    seekBy(s: number) {
      p.seekBys.push(s);
    },
    async replaceAsync(next: string) {
      p.replaced.push(next);
    },
    addListener(name, fn) {
      const list = listeners.get(name) ?? [];
      list.push(fn);
      listeners.set(name, list);
      return {
        remove() {
          listeners.set(name, (listeners.get(name) ?? []).filter((f) => f !== fn));
        },
      };
    },
    emit(name, e) {
      (listeners.get(name) ?? []).slice().forEach((fn) => fn(e as never));
    },
  };
  Object.defineProperty(p, 'currentTime', {
    get: () => time,
    set: (v: number) => {
      time = v;
      p.currentTimeSets.push(v);
    },
  });
  return p as FakePlayer;
}

/**
 * `jest.mock('expo-video', () => require('./harness').expoVideoMock())`.
 * Mirrors the real hook's identity contract: ONE player per source per component
 * instance, recreated only when the source changes — which is what makes
 * "no player churn across refreshes" an observable assertion.
 */
export function expoVideoMock() {
  const ReactLocal = require('react') as typeof React;
  const { View } = require('react-native');
  return {
    useVideoPlayer: (source: string, setup?: (p: FakePlayer) => void) => {
      const ref = ReactLocal.useRef<FakePlayer | null>(null);
      if (!ref.current || ref.current.source !== source) {
        const p = makeFakePlayer(source);
        setup?.(p);
        videoPlayers.push(p);
        ref.current = p;
      }
      return ref.current;
    },
    VideoView: ReactLocal.forwardRef((props: { player?: FakePlayer }, ref: unknown) => {
      ReactLocal.useImperativeHandle(ref as never, () => ({ enterFullscreen: () => Promise.resolve() }));
      return ReactLocal.createElement(View, { testID: 'video-view', accessibilityLabel: props.player?.source });
    }),
  };
}

// ── timing ────────────────────────────────────────────────────────────────────
/** Let every pending microtask (thunks, awaited fetches) settle inside act(). */
export async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Advance fake timers in 500 ms slices, settling promises between them. */
export async function advance(ms: number, step = 500): Promise<void> {
  let left = ms;
  while (left > 0) {
    const slice = Math.min(step, left);
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      jest.advanceTimersByTime(slice);
      await Promise.resolve();
    });
    // eslint-disable-next-line no-await-in-loop
    await settle(2);
    left -= slice;
  }
}
