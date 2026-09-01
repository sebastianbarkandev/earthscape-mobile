import { useDispatch, useSelector, useStore, type TypedUseSelectorHook } from 'react-redux';
import type { AppDispatch, RootState, store } from './index';

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
/**
 * The store itself — for values a component must READ but must not RE-RENDER on
 * (RESP-024: the 2 Hz playback clock inside a button's onPress). Never use it to render.
 */
export const useAppStore: () => typeof store = useStore;
