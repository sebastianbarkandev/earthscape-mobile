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
};

export const fetchVideos = createAsyncThunk(
  'library/fetchVideos',
  async (args: { page: number; sort: SortKey }) => {
    const q = `page=${args.page}&per_page=24&sort=${encodeURIComponent(args.sort)}`;
    return api<Page>(`/api/v1/videos/list?${q}`);
  },
);

export const fetchLive = createAsyncThunk('library/fetchLive', async () => {
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
      s.items = meta.arg.page === 1 ? payload.items : s.items.concat(payload.items);
      s.page = payload.page;
      s.hasNext = payload.has_next;
      s.total = payload.total;
    });
    b.addCase(fetchVideos.rejected, (s, a) => {
      s.status = 'error';
      s.error = a.error.message ?? 'Failed to load videos.';
    });
    b.addCase(fetchLive.pending, (s) => {
      s.liveStatus = 'loading';
    });
    b.addCase(fetchLive.fulfilled, (s, { payload }) => {
      s.liveStatus = 'idle';
      s.liveItems = payload.items;
    });
    b.addCase(fetchLive.rejected, (s) => {
      s.liveStatus = 'error';
    });
  },
});

export const { setSort } = librarySlice.actions;
export default librarySlice.reducer;
