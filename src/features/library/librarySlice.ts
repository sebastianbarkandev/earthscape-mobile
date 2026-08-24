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
  tail?: string;
  event_id?: number; // ⚠ UNVERIFIED in list payload — see CLAUDE.md; needed for player navigation
  live_stream_id?: number; // ⚠ UNVERIFIED in /live/list payload
  user: {
    id: number;
    username: string;
    full_name: string;
    profile_img_url: string | null;
  } | null;
}

interface Page {
  items: VideoListItem[];
  page: number;
  pages: number;
  total: number;
  has_next: boolean;
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
  return api<Page>('/api/v1/live/list?page=1');
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
