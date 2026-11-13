import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMobile } from './context';
import type { OpenQueue } from './LibraryScreen';
import type { Continuation } from './local-data';

import { ui } from './ui';
export function ContinueCard({ visible, onOpen }: { visible: boolean; onOpen: OpenQueue }) {
  const { revision, store } = useMobile(); const { continuation, work } = store; const [items, setItems] = useState<(Continuation & { workTitle: string })[]>([]); const [error, setError] = useState(false); const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => { if (!visible) return; let alive = true; setError(false); setLoading(true); void continuation().then(async value => value ? [{ ...value, workTitle: (await work(value.session.ids[value.session.index]))?.title || '未命名作品' }] : []).then(values => { if (alive) setItems(values); }).catch(() => { if (alive) setError(true); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [visible, revision, retry]);
  if (error) return <Pressable onPress={() => setRetry(v => v + 1)}><Text style={ui.error}>继续观看读取失败 · 点按重试</Text></Pressable>;
  return <>{items.map(value => { const point = value.session.point; return <Pressable key={value.token} accessibilityRole="button" disabled={loading} onPress={() => onOpen(value.session, value.scope, value.title)} style={[styles.card, loading && { opacity: 0.5 }]}>
    <View style={{ flex: 1, gap: 5 }}><Text style={styles.heading}>继续观看 · {value.title}</Text><Text numberOfLines={1} style={ui.text}>{value.workTitle}</Text><Text style={ui.muted}>{point ? point.kind === 'gallery' ? `上次看到第 ${point.value + 1} 张` : `上次看到 ${Math.floor(point.value / 60)}:${String(Math.floor(point.value % 60)).padStart(2, '0')}` : '从上次的作品继续'}</Text></View><Text style={{ color: '#fff', fontSize: 22 }}>›</Text>
  </Pressable>; })}</>;
}
const styles = StyleSheet.create({ card: { marginHorizontal: 15, marginBottom: 16, padding: 15, borderRadius: 10, backgroundColor: '#2b2e3a', flexDirection: 'row', alignItems: 'center', gap: 12 }, heading: { color: '#ff99b0', fontSize: 13, fontWeight: '600' } });
