import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { mediaHeaders } from '../douyin';
import { useMobile } from './context';
import { ContinueCard } from './ContinueCard';
import type { OpenQueue } from './LibraryScreen';
import { pointFrom } from './local-data';
import type { HistoryWork } from './store';
import { Button, IconButton, PageHeader, ui } from './ui';

function Entry({ item, onOpen, onRemove }: { item: HistoryWork; onOpen: () => void; onRemove: () => void }) {
  const [failed, setFailed] = useState(false); const point = pointFrom(item.pointKind, item.pointValue);
  return <View style={styles.row}><Pressable accessibilityLabel={`继续播放 ${item.title}`} onPress={onOpen} style={styles.entry}>
    <View style={styles.cover}>{item.coverUrl && !failed ? <Image source={{ uri: item.coverUrl, headers: mediaHeaders }} onError={() => setFailed(true)} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Text style={ui.muted}>MyLike</Text>}</View>
    <View style={{ flex: 1, gap: 6 }}><Text numberOfLines={2} style={ui.text}>{item.title || '未命名作品'}</Text><Text numberOfLines={1} style={ui.muted}>@{item.author}</Text><Text style={ui.muted}>{new Date(item.watchedAt).toLocaleString()}{point ? point.kind === 'gallery' ? ` · 第 ${point.value + 1} 张` : ` · ${Math.floor(point.value)} 秒` : ''}</Text></View>
  </Pressable><IconButton name="close" label={`移除观看记录 ${item.title}`} size={19} onPress={onRemove} /></View>;
}
export function HistoryScreen({ onBack, onOpen }: { onBack: () => void; onOpen: OpenQueue }) {
  const focused = useIsFocused(); const { revision, changed, store } = useMobile(); const { history, historyIds, removeHistory } = store; const [rows, setRows] = useState<HistoryWork[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [exhausted, setExhausted] = useState(false); const [starting, setStarting] = useState(false);
  const generation = useRef(0); const more = useRef(false); const count = useRef(60); const list = useRef<FlatList<HistoryWork>>(null);
  useEffect(() => { if (!focused) return; const request = ++generation.current; setLoading(true); more.current = false; setError('');
    void history(0, count.current).then(value => { if (request === generation.current) { setRows(value); setExhausted(value.length < count.current); } }).catch(() => { if (request === generation.current) setError('历史读取失败，点按重试。'); }).finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [focused, revision]);
  async function loadMore() { if (loading || exhausted || more.current || !focused) return; const request = generation.current; more.current = true;
    try { const values = await history(rows.length); if (request === generation.current) { setRows(before => [...before, ...values]); count.current = rows.length + values.length; setExhausted(values.length < 60); } } catch { setError('历史加载失败，点按重试。'); } finally { if (request === generation.current) more.current = false; }
  }
  async function remove(id?: string) { try { await removeHistory(id); changed(); } catch { setError('删除失败，请重试。'); } }
  async function open(item: HistoryWork) {
    if (starting) return; const request = generation.current; setStarting(true);
    try { const ids = await historyIds(); const index = ids.indexOf(item.id); if (index < 0 || request !== generation.current) return; onOpen({ ids, index, mode: 'ordered', point: pointFrom(item.pointKind, item.pointValue) }, { source: 'all' }, '观看历史'); }
    catch { setError('无法打开观看记录，请重试。'); } finally { setStarting(false); }
  }
  return <View style={ui.screen}><PageHeader title="观看历史" back={onBack}><IconButton name="trash-outline" label="清空观看历史" size={22} onPress={() => Alert.alert('清空观看历史？', '同时移除继续观看入口，不删除作品、喜欢或收藏。重新播放后会产生新的观看记录。', [{ text: '取消', style: 'cancel' }, { text: '清空', style: 'destructive', onPress: () => { void remove(); } }])} /></PageHeader>
    <FlatList ref={list} data={rows} keyExtractor={item => item.id} initialNumToRender={10} maxToRenderPerBatch={8} windowSize={5} onEndReached={() => void loadMore()} onEndReachedThreshold={0.6}
      ListHeaderComponent={<><ContinueCard visible={focused} onOpen={onOpen} />{error && <Button title={error} onPress={changed} />}</>}
      ListEmptyComponent={loading ? <ActivityIndicator color="#fff" style={{ margin: 40 }} /> : <View style={ui.empty}><Text style={ui.muted}>暂无观看历史</Text></View>}
      renderItem={({ item }) => <Entry item={item} onOpen={() => { if (!loading) void open(item); }} onRemove={() => { void remove(item.id); }} />} />
  </View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', paddingHorizontal: 15, paddingVertical: 10, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#333743' }, entry: { flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center' }, cover: { width: 65, height: 88, borderRadius: 4, overflow: 'hidden', backgroundColor: '#313543', alignItems: 'center', justifyContent: 'center' } });
