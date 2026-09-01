import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { api } from '@/common/api/client';

/** Item shape from GET /api/v1/videos/list (videos_list_api.py). */
export interface VideoListItem {
  id: number;
  title: string;
  status: string;
  duration: number | null;
  uploaded_filesize: number | null;
  date_posted: string | null; // ISO, may lack 'Z'
  start: string | null; // ISO, may lack 'Z'
  thumbnail_url: string | null;
  deleted_at: string | null;
  tail?: string | null; // omitted when falsy in /videos/list, always present (nullable) in /live/list
  /** Present on the earthscape-mobile backend branch (additive); absent on older backends -> useOpenVideo falls back to GET /videos/{id}/event_id. */
  event_id?: number;
  /** /live/list only. */
  live_stream_id?: number | null;
  /** /live/list only: raw LiveStream.status (NOT the derived live_stream_state of the event payload). */
  live_stream_status?: string | null;
  user: {
    id: number;
    username: string;
    full_name: string;
    profile_img_url: string | null;
  } | null;
}

/** GET /api/v1/videos/list envelope. */
interface Page {
  items: VideoListItem[];
  page: number;
  pages: number;
  total: number;
  has_next: boolean;
}

/** GET /api/v1/live/list envelope — different from Page: no has_next/has_prev/sort, per_page fixed at 24. */
interface LivePage {
  items: VideoListItem[];
  page: number;
  pages: number;
  total: number;
  per_page: number;
}

export type SortKey =
  | 'recently-uploaded'
  | 'recently-recorded'
  | 'title-asc'
  | 'title-desc'
  | 'shortest'
  | 'longest';

/**
 * Concatenate a page onto the loaded list, dropping ids already present (UI-019). Paging is
 * offset-based on a table that keeps changing (uploads finish, live streams end), so page 2
 * can legitimately repeat an item from page 1 — which React sees as a duplicate FlatList key
 * ("Encountered two children with the same key"), silently dropping one of the two rows.
 * The FIRST copy wins so the visible list never reshuffles under the user.
 */
export function mergeById(loaded: VideoListItem[], page: VideoListItem[]): VideoListItem[] {
  const seen = new Set(loaded.map((v) => v.id));
  const out = loaded.slice();
  for (const item of page) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

interface LibraryState {
  items: VideoListItem[];
  page: number;
  hasNext: boolean;
  total: number;
  sort: SortKey;
  status: 'idle' | 'loading' | 'loadingMore' | 'error';
  error: string | null;

  liveItems: VideoListItem[];
  liveStatus: 'idle' | 'loading' | 'error';
  /** Last /live/list failure — shown as a retryable error when empty, a stale banner otherwise. */
  liveError: string | null;
}

const initialState: LibraryState = {
  items: [],
  page: 0,
  hasNext: true,
  total: 0,
  sort: 'recently-uploaded',
  status: 'idle',
  error: null,
  liveItems: [],
  liveStatus: 'idle',
  liveError: null,
};

export const fetchVideos = createAsyncThunk(
  'library/fetchVideos',
  async (args: { page: number; sort: SortKey }) => {
    const q = `page=${args.page}&per_page=24&sort=${encodeURIComponent(args.sort)}`;
    return api<Page>(`/api/v1/videos/list?${q}`);
  },
);

/** `silent`: background 20s refresh — must not drive the pull-to-refresh spinner (LIVE-016). */
export const fetchLive = createAsyncThunk('library/fetchLive', async (_args: { silent?: boolean } | undefined) => {
  return api<LivePage>('/api/v1/live/list?page=1');
});

const librarySlice = createSlice({
  name: 'library',
  initialState,
  reducers: {
    setSort(state, { payload }: PayloadAction<SortKey>) {
      state.sort = payload;
      state.items = [];
      state.page = 0;
      state.hasNext = true;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchVideos.pending, (s, a) => {
      s.status = a.meta.arg.page === 1 ? 'loading' : 'loadingMore';
      s.error = null;
    });
    b.addCase(fetchVideos.fulfilled, (s, { payload, meta }) => {
      s.status = 'idle';
      s.items = meta.arg.page === 1 ? payload.items : mergeById(s.items, payload.items);
      s.page = payload.page;
      s.hasNext = payload.has_next;
      s.total = payload.total;
    });
    b.addCase(fetchVideos.rejected, (s, a) => {
      // UI-029: a page-2+ failure must not read as "the library is broken" — the loaded items
      // are still valid, so the list stays and the error is surfaced in the list FOOTER (the
      // same split the live list makes). Only an empty list becomes the full error state.
      // The status returns to 'idle' so a retry can run; `error` is what stops the automatic
      // `onEndReached` from re-requesting the failed page in a loop.
      s.error = a.error.message ?? 'Failed to load videos.';
      s.status = s.items.length === 0 ? 'error' : 'idle';
    });
    b.addCase(fetchLive.pending, (s, a) => {
      if (!a.meta.arg?.silent || s.liveItems.length === 0) s.liveStatus = 'loading';
    });
    b.addCase(fetchLive.fulfilled, (s, { payload }) => {
      s.liveStatus = 'idle';
      s.liveError = null;
      s.liveItems = payload.items;
    });
    b.addCase(fetchLive.rejected, (s, a) => {
      // UI-005: a failed poll must never wipe the streams already on screen — the list stays
      // and the error is surfaced as a stale banner. Only an empty list becomes an error state
      // (otherwise every failed /live/list looked exactly like "No live streams").
      s.liveError = a.error.message ?? 'Failed to load live streams.';
      s.liveStatus = s.liveItems.length === 0 ? 'error' : 'idle';
    });
  },
});

export const { setSort } = librarySlice.actions;
export default librarySlice.reducer;
