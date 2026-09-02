import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SearchScreen } from '@/features/search/SearchScreen';

/**
 * Videos tab = the web /videos page: every upload, newest first, plus keyword search,
 * Filters and Sort. The header search bar lands here with `?q=`.
 */
export default function VideosRoute() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  return <SearchScreen initialQuery={typeof q === 'string' ? q : ''} />;
}
