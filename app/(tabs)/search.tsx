import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { SearchScreen } from '@/features/search/SearchScreen';

/** Video search (web /videos). Reached from the header search bar and the menu; hidden from the tab bar. */
export default function SearchRoute() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  return <SearchScreen initialQuery={typeof q === 'string' ? q : ''} />;
}
