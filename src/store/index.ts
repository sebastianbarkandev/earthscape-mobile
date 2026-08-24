import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/features/auth/authSlice';
import libraryReducer from '@/features/library/librarySlice';
import playerReducer from '@/features/player/playerSlice';

// Assembles feature slices — same pattern as the web repo's store file.
export const store = configureStore({
  reducer: {
    auth: authReducer,
    library: libraryReducer,
    player: playerReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
