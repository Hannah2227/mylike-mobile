import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export function ReviewChrome({
  author, title, page, pages, gallery, live, note,
}: {
  author: string; title: string; page: number; pages: number; gallery: boolean; live: boolean; note?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = title.length > 32 || title.includes('\n');
  const label = gallery ? (live ? '实况' : '图文') : undefined;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View pointerEvents="none" style={styles.scrim} />
      {pages > 0 && <Text pointerEvents="none" style={styles.page} accessibilityLabel={`第 ${page + 1} 张，共 ${pages} 张`}>
        {page + 1} / {pages}
      </Text>}
      <View style={[styles.caption, pages > 0 && styles.galleryCaption]} pointerEvents="box-none">
        <View style={styles.byline} pointerEvents="none">
          <Text numberOfLines={1} style={styles.author}>@{author}</Text>
          {label && (
            <View style={styles.type}>
              <Ionicons name={live ? 'radio-outline' : 'albums'} size={13} color="#fff" />
              <Text style={styles.typeText}>{label}</Text>
            </View>
          )}
        </View>
        {expanded ? (
          <ScrollView style={styles.expanded}><Text style={styles.description}>{title}</Text></ScrollView>
        ) : <Text pointerEvents="none" numberOfLines={2} style={styles.description}>{title}</Text>}
        {canExpand && (
          <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
            hitSlop={8} style={styles.expand} onPress={() => setExpanded(!expanded)}>
            <Text style={styles.expandText}>{expanded ? '收起' : '展开'}</Text>
          </Pressable>
        )}
        {note ? <Text pointerEvents="none" style={styles.note}>{note}</Text> : null}
      </View>
      {pages > 1 && (
        <View style={styles.segments} pointerEvents="none">
          {Array.from({ length: Math.min(pages, 36) }, (_, segment) => (
            <View key={segment} style={[styles.segment,
              segment === Math.floor(page * Math.min(pages, 36) / pages) && styles.selectedSegment]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: '29%',
    backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.73), rgba(0,0,0,0))',
  },
  page: {
    position: 'absolute', right: 15, top: 12, color: '#fff', fontSize: 14,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: '#0003', overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  caption: { position: 'absolute', left: 13, right: 20, bottom: 42, gap: 5 },
  galleryCaption: { bottom: 23 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { flexShrink: 1, color: '#fff', fontSize: 17, fontWeight: '700', textShadowColor: '#000a', textShadowRadius: 4 },
  type: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ffffff32', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 },
  typeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  description: { color: '#fff', fontSize: 14, lineHeight: 21, textShadowColor: '#000a', textShadowRadius: 4 },
  expanded: { maxHeight: 166 },
  expand: { alignSelf: 'flex-start' },
  expandText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  note: { color: '#e2ded8', fontSize: 12 },
  segments: { position: 'absolute', left: 10, right: 10, bottom: 7, flexDirection: 'row', gap: 3 },
  segment: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: '#ffffff45' },
  selectedSegment: { backgroundColor: '#ffffffe0' },
});
