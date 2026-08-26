import { useMemo } from 'react';
import { useAppSelector } from '@/store/hooks';
import { createTimeMapper } from '@/common/lib/TimeMapper';

/**
 * Recreates the mapper from the plain spec stored in Redux (web pattern:
 * functions are never stored in state; the spec {startUtc, videoTimeUtcTimeMap}
 * is, and createTimeMapper is re-invoked at use sites).
 */
export function useTimeMapper(videoId: number | null) {
  const spec = useAppSelector((s) =>
    videoId != null ? s.player.timeMappers[videoId] : undefined,
  );
  return useMemo(() => {
    if (!spec) return null;
    try {
      return createTimeMapper(spec.startUtc, spec.videoTimeUtcTimeMap);
    } catch (e) {
      console.warn('TimeMapper validation failed; falling back to plain offset', e);
      return createTimeMapper(spec.startUtc, null);
    }
  }, [spec]);
}
