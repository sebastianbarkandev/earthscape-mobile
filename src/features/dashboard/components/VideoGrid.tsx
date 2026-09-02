import React from 'react';
import { StyleSheet, View } from 'react-native';
import { VideoCard } from '@/common/components/VideoCard';
import type { VideoListItem } from '@/features/library/librarySlice';
import type { DashboardVideo } from '../api';
import { chunk, toListItem } from '../dashboardModel';

interface Props {
  videos: DashboardVideo[];
  columns: number;
  live?: boolean;
  onPress: (item: VideoListItem) => void;
}

/**
 * The Library grid's look without a nested FlatList (UI-002: a virtualized list inside the
 * page ScrollView cannot scroll): rows of `columns` cards, the last row capped by
 * `VideoCard`'s own `gridItemMaxWidth` so a lone card never stretches (UI-003).
 */
export function VideoGrid({ videos, columns, live, onPress }: Props) {
  return (
    <View style={styles.grid}>
      {chunk(videos, columns).map((row, i) => (
        <View key={row.map((v) => v.id).join('-') || i} style={styles.row}>
          {row.map((v) => (
            <VideoCard key={v.id} item={toListItem(v)} live={live} columns={columns} onPress={onPress} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // VideoCard carries its own 6pt margin; -6 here lines the outer cards up with the section gutter.
  grid: { marginHorizontal: -6 },
  row: { flexDirection: 'row' },
});
