import { useCallback } from 'react';
import { useAppDispatch } from '@/store/hooks';
import { requestSeek } from '../playerSlice';
import { useTimeMapper } from './useTimeMapper';

/** Web updateSeek: UTC -> video seconds through the TimeMapper, then the one-shot seek. */
export function useSeek(videoId: number | null) {
  const dispatch = useAppDispatch();
  const mapper = useTimeMapper(videoId);
  const toVideo = useCallback((t: number) => {
    if (Number.isFinite(t)) dispatch(requestSeek(Math.max(0, t)));
  }, [dispatch]);
  const toUtc = useCallback(
    (utc: number) => {
      if (!mapper) return;
      const v = mapper.utcToVideo(utc);
      if (v != null && Number.isFinite(v)) dispatch(requestSeek(Math.max(0, v)));
    },
    [dispatch, mapper],
  );
  return { toUtc, toVideo, mapper };
}
