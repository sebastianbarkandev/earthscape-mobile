import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/features/auth/authSlice';
import libraryReducer from '@/features/library/librarySlice';
import playerReducer from '@/features/player/playerSlice';
import graphReducer from '@/features/player/graphSlice';
import broadcastReducer from '@/features/broadcast/broadcastSlice';

// Assembles feature slices — same pattern as the web repo's store file.
export const store = configureStore({
  reducer: {
    auth: authReducer,
    library: libraryReducer,
    player: playerReducer,
    graph: graphReducer,
    broadcast: broadcastReducer,
  },
  // Dev-only invariant checks walk the whole state on every action; flight series
  // are tens of thousands of numbers, so exclude them (they are plain arrays anyway).
  middleware: (getDefault) =>
    getDefault({
      serializableCheck: { ignoredPaths: ['player.mapData', 'graph.data'], warnAfter: 128 },
      immutableCheck: { ignoredPaths: ['player.mapData', 'graph.data'], warnAfter: 128 },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
