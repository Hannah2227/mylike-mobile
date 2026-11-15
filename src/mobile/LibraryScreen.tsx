import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { PublicationSheet } from '../PublicationSheet';
import { mediaHeaders } from '../douyin';
import type { LibraryFilter, LibraryFolder } from '../library-format';
import { publicationLabel, type PublicationPeriod } from '../library-period';
import { useMobile } from './context';

import { shuffled, type Scope, type Session, type Source, type Work } from './model';
import { Button, IconButton, PageHeader, ui } from './ui';
import { FolderSheet } from './FolderSheet';
import { gridCellWidth } from './layout';
import { AuthorProfile } from './AuthorProfile';
import Animated, { useAnimatedScrollHandler, type AnimatedRef, type SharedValue } from 'react-native-reanimated';
import { MyProfile } from './MyProfile';
import { headerCollapse } from './motion';
import type { Folder } from './local-data';
import { meColors as c } from './me-theme';

export type OpenQueue = (session: Session, scope: Scope, title: string) => void;
export type LibraryPagerState = { page: number; enabled: boolean; list: AnimatedRef<FlatList<Work>>; offsets: SharedValue<number[]>; collapses: SharedValue<number[]>; leader: SharedValue<number>; headerY: SharedValue<number>; header: number; viewport: number; onDrag: () => void; onMetrics: (height: number) => void; onHorizontalLock: (locked: boolean) => void };
function Card({ work, width, last, onPress }: { work: Work; width: number; last: boolean; onPress: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [work.coverUrl]);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${work.title}，${work.author}`} onPress={onPress} style={({ pressed }) => [{ width, height: width / 0.76, marginRight: last ? 0 : 1, marginBottom: 1, backgroundColor: c.surface }, pressed && styles.pressed]}>
    {work.coverUrl && !failed ? <Image source={{ uri: work.coverUrl, headers: mediaHeaders }} onError={() => setFailed(true)} fadeDuration={0} resizeMode="cover" style={StyleSheet.absoluteFill} /> :
      <View style={styles.placeholder}><Ionicons name="image-outline" size={24} color="#5e6375" /><Text numberOfLines={3} style={styles.placeholderTitle}>{work.title || '未命名作品'}</Text></View>}
    <View pointerEvents="none" style={styles.type}><Ionicons name={work.kind === 'video' ? 'play' : work.kind === 'live-gallery' ? 'radio-outline' : 'albums-outline'} color="#fff" size={14} /></View>
  </Pressable>;
}
export function LibraryScreen({ visible = true, onOpen, onImport, searchOnly, onBack, author, authorSecUid, onSearch, onMore, collection, pager }: {
  visible?: boolean; onOpen: OpenQueue; onImport?: () => void; searchOnly?: boolean; onBack?: () => void; author?: string; authorSecUid?: string; onSearch?: () => void; onMore?: () => void;
  collection?: Source; pager?: LibraryPagerState;
}) {
  const { width } = useWindowDimensions(); const { revision, store } = useMobile(); const { addSearch, counts, dates, folders, page, queueIds, removeSearch, searches } = store;
  const [measuredWidth, setMeasuredWidth] = useState(0); const cardWidth = gridCellWidth(measuredWidth || width);
  const [localSource, setSource] = useState<Source>('all'); const source = collection ?? localSource; const [draft, setDraft] = useState(''); const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all'); const [period, setPeriod] = useState<PublicationPeriod>(null);
  const [folder, setFolder] = useState<LibraryFolder | null>(null); const [folderOpen, setFolderOpen] = useState(false); const [periodOpen, setPeriodOpen] = useState(false);
  const [terms, setTerms] = useState<string[]>([]);
  const [folderItems, setFolderItems] = useState<Folder[]>([]);
  const [rows, setRows] = useState<Work[]>([]); const [total, setTotal] = useState(0); const [totals, setTotals] = useState({ all: 0, likes: 0, favorites: 0 });
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [refresh, setRefresh] = useState(0); const [starting, setStarting] = useState(false);
  const scope = useMemo<Scope>(() => ({ source, search: query, filter, period, folderId: source === 'favorites' ? folder?.id : null, author }), [source, query, filter, period, folder, author]);
  const scopeKey = JSON.stringify(scope); const loaded = useRef(''); const generation = useRef(0); const more = useRef(false); const localList = useRef<FlatList<Work>>(null); const list = pager?.list ?? localList;
  const offsets = pager?.offsets; const collapses = pager?.collapses; const leader = pager?.leader; const headerY = pager?.headerY; const pageIndex = pager?.page ?? -1; const profileHeight = (pager?.header ?? 50) - 50;
  const scroll = useAnimatedScrollHandler({ onScroll: event => {
    if (!offsets || !collapses || !leader || !headerY) return; const value = Math.max(0, event.contentOffset.y); const previous = offsets.value[pageIndex];
    const next = [...offsets.value]; next[pageIndex] = value; offsets.value = next;
    const c = [...collapses.value]; c[pageIndex] = leader.value === pageIndex ? headerCollapse(headerY.value, previous, value, profileHeight) : Math.min(c[pageIndex], value); collapses.value = c;
    if (leader.value === pageIndex) headerY.value = c[pageIndex];
  } });
  const rowCount = useRef(rows.length); rowCount.current = rows.length;
  const previousScope = useRef('');
  useEffect(() => {
    const key = `${scopeKey}:${revision}:${refresh}`;
    if (!visible || loaded.current === key) return;
    const request = ++generation.current; more.current = false; setLoading(true); setError('');
    const limit = previousScope.current === scopeKey ? Math.max(60, rowCount.current) : 60;
    void Promise.all([page(scope, 0, limit), counts()]).then(([result, values]) => {
      if (request !== generation.current) return;
      if (previousScope.current !== scopeKey) list.current?.scrollToOffset({ offset: pager ? pager.collapses.value[pager.page] : 0, animated: false });
      previousScope.current = scopeKey; loaded.current = key; setRows(result.items); setTotal(result.total ?? 0); setTotals(values);
    }).catch(() => { if (request === generation.current) setError('无法读取内容库，请重试。'); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [scope, scopeKey, revision, refresh, visible]);
  useEffect(() => { if (!visible) return; let alive = true; void searches().then(value => { if (alive) setTerms(value); }).catch(() => setError('搜索历史读取失败。')); return () => { alive = false; }; }, [visible]);
  useEffect(() => { if (!visible || source !== 'favorites') return; let alive = true; void folders().then(values => { if (!alive) return; setFolderItems(values); setFolder(previous => { if (!previous || previous.id === 'unfiled') return previous; const next = values.find(row => row.id === previous.id); return next ? { id: next.id, title: next.title } : null; }); }).catch(() => setError('收藏夹读取失败。')); return () => { alive = false; }; }, [visible, revision, source, folders]);
  function submit(text: string) { const value = text.trim(); setDraft(text); setQuery(value); Keyboard.dismiss(); if (value) void addSearch(value).then(searches).then(setTerms).catch(() => setError('关键词历史未保存，搜索结果不受影响。')); }
  async function deleteTerm(term?: string) { try { await removeSearch(term); setTerms(await searches()); } catch { setError('关键词删除失败，请重试。'); } }
  async function loadMore() {
    if (!visible || loading || more.current || rows.length >= total || !loaded.current.startsWith(scopeKey + ':')) return;
    const request = generation.current; more.current = true;
    try { const result = await page(scope, rows.length); if (request === generation.current) setRows(previous => [...previous, ...result.items]); }
    catch { if (request === generation.current) setError('加载失败，可点按重试。'); }
    finally { if (request === generation.current) more.current = false; }
  }
  async function open(mode: Session['mode'], id?: string) {
    if (starting || loading) return; const request = generation.current; setStarting(true); Keyboard.dismiss();
    try {
      const pool = await queueIds(scope); const ids = mode === 'shuffle' ? shuffled(pool) : pool; const index = id ? ids.indexOf(id) : 0;
      if (request !== generation.current) return;
      if (!ids.length || index < 0) { setError('当前结果没有可播放的作品。'); return; }
      onOpen({ ids, index, mode, point: null }, scope, author ? '作者作品' : source === 'all' ? '全部作品' : source === 'likes' ? '喜欢' : folder?.title || '收藏');
    } catch { setError('无法建立播放队列。'); }
    finally { setStarting(false); }
  }
  const loadDates = useCallback(() => dates(scope), [scope]);
  const dateScope = useMemo(() => ({ source: source === 'all' ? 'likes' as const : source, search: query, filter, period, folderId: folder?.id ?? null }), [source, query, filter, period, folder]);
  const head = <View>
    {pager ? <View style={{ height: pager.header }} /> : searchOnly ? <PageHeader title="搜索我的内容" back={onBack} /> : author ? <AuthorProfile author={author} secUid={authorSecUid} visible={visible} total={total} /> : <MyProfile totals={totals} onSource={value => { setSource(value); setFolder(null); }} />}
    {(searchOnly || author) && <View style={styles.searchRow}><Ionicons name="search" size={17} color="#aaa" /><TextInput autoFocus={searchOnly} placeholder="搜索标题或作者" placeholderTextColor="#999" value={draft} onChangeText={setDraft}
      maxLength={200} onSubmitEditing={() => submit(draft)} returnKeyType="search" style={styles.search} /><IconButton name="arrow-forward" label="执行搜索" size={18} onPress={() => submit(draft)} /></View>}
    {searchOnly && !query && terms.length > 0 && <View style={{ padding: 15, gap: 12 }}><View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text style={ui.text}>搜索历史</Text><Button title="清空" onPress={() => Alert.alert('清空搜索历史？', '不会清除作品或观看历史。', [{ text: '取消', style: 'cancel' }, { text: '清空', style: 'destructive', onPress: () => { void deleteTerm(); } }])} /></View>{terms.map(term => <View key={term} style={ui.row}><Pressable style={{ flex: 1, paddingVertical: 8 }} onPress={() => submit(term)}><Text numberOfLines={1} style={ui.text}>{term}</Text></Pressable><IconButton name="close" label={`删除关键词 ${term}`} size={18} onPress={() => { void deleteTerm(term); }} /></View>)}</View>}
    {!author && !pager && <View style={styles.tabs}>{([['all','全部'],['likes','喜欢'],['favorites','收藏']] as const).map(([key, label]) => <Pressable key={key} onPress={() => { setSource(key); setFolder(null); }} style={[styles.tab, source === key && styles.selectedTab]}><Text style={[styles.tabText, source === key && { color: '#fff', fontWeight: '700' }]}>{label}</Text></Pressable>)}</View>}
    {source === 'favorites' && <View style={styles.folderRow}><ScrollView horizontal nestedScrollEnabled directionalLockEnabled showsHorizontalScrollIndicator={false} contentContainerStyle={styles.folderTabs}
      onTouchStart={() => pager?.onHorizontalLock(true)} onTouchEnd={() => pager?.onHorizontalLock(false)} onTouchCancel={() => pager?.onHorizontalLock(false)} onScrollBeginDrag={() => pager?.onHorizontalLock(true)} onScrollEndDrag={() => pager?.onHorizontalLock(false)}>
      {[{ id: null, title: '全部收藏夹', count: totals.favorites }, ...folderItems, { id: 'unfiled', title: '未分组', count: null }].map(item => {
        const selected = (folder?.id ?? null) === item.id;
        return <Pressable key={item.id ?? 'all'} accessibilityRole="tab" accessibilityState={{ selected }} hitSlop={{ top: 5, bottom: 5 }} onPress={() => setFolder(item.id ? { id: item.id, title: item.title } : null)} style={({ pressed }) => [styles.folderTab, selected && styles.folderSelected, pressed && styles.pressed]}>
          <Ionicons name={item.id === null ? 'grid-outline' : item.id === 'unfiled' ? 'file-tray-outline' : 'folder-outline'} size={14} color={selected ? c.accentText : c.muted} />
          <Text numberOfLines={1} style={[styles.folderText, selected && styles.folderSelectedText]}>{item.title}</Text>
          {item.count !== null && <Text style={[styles.folderCount, selected && styles.folderSelectedText]}>{item.count.toLocaleString()}</Text>}
        </Pressable>;
      })}
    </ScrollView><IconButton name="folder-open-outline" label="管理收藏夹" size={20} color={c.secondary} onPress={() => setFolderOpen(true)} /></View>}
    <View style={styles.filters}><View style={styles.segmented}>{([['all','全部'],['video','视频'],['gallery','图集']] as const).map(([key, label]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: filter === key }} hitSlop={{ top: 3, bottom: 3 }} onPress={() => setFilter(key)} style={({ pressed }) => [styles.filter, filter === key && styles.filterSelected, pressed && styles.pressed]}><Text style={[styles.filterText, filter === key && styles.filterSelectedText]}>{label}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={`按年月筛选，当前${publicationLabel(period)}`} accessibilityState={{ selected: Boolean(period) }} onPress={() => setPeriodOpen(true)} style={({ pressed }) => [styles.date, Boolean(period) && styles.dateSelected, pressed && styles.pressed]}>
        <Ionicons name="calendar-outline" size={15} color={period ? c.accentText : c.muted} /><Text numberOfLines={1} style={[styles.dateText, Boolean(period) && styles.dateTextSelected]}>{publicationLabel(period)}</Text>
      </Pressable></View>
    <View style={styles.queueRow}><Text numberOfLines={1} style={styles.total}>{loading ? '正在读取…' : `${total.toLocaleString()} 条作品`}</Text><View style={styles.playActions}>
      <Pressable accessibilityRole="button" accessibilityLabel="顺序播放" accessibilityState={{ disabled: starting || loading || !total }} disabled={starting || loading || !total} onPress={() => void open('ordered')} style={({ pressed }) => [styles.playAction, (starting || loading || !total) && styles.disabled, pressed && styles.pressed]}><Ionicons name="play-outline" size={14} color={c.secondary} /><Text style={styles.playText}>顺序播放</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="随机播放" accessibilityState={{ disabled: starting || loading || !total }} disabled={starting || loading || !total} onPress={() => void open('shuffle')} style={({ pressed }) => [styles.playAction, styles.primaryPlay, (starting || loading || !total) && styles.disabled, pressed && styles.pressed]}><Ionicons name="shuffle" size={16} color="#fff" /><Text style={[styles.playText, styles.primaryPlayText]}>{starting ? '准备中…' : '随机播放'}</Text></Pressable>
    </View></View>
    {error && <Pressable onPress={() => { setRefresh(v => v + 1); }}><Text style={ui.error}>{error}</Text></Pressable>}
  </View>;
  return <View style={ui.screen} onLayout={event => { if (event.nativeEvent.layout.width > 0) setMeasuredWidth(event.nativeEvent.layout.width); }}>
    {!author && !searchOnly && !pager && <View style={styles.topbar}><View style={{ flex: 1 }} /><IconButton name="search-outline" label="搜索我的内容" size={25} onPress={() => onSearch?.()} /><IconButton name="menu-outline" label="更多" size={27} onPress={() => onMore?.()} /></View>}
    <Animated.FlatList ref={list} data={rows} numColumns={3} keyExtractor={item => item.id} ListHeaderComponent={head} onEndReached={() => void loadMore()} onEndReachedThreshold={1}
      initialNumToRender={15} maxToRenderPerBatch={9} windowSize={5} keyboardShouldPersistTaps="handled" onScroll={pager ? scroll : undefined} scrollEnabled={pager ? pager.enabled : true} scrollEventThrottle={16} onScrollBeginDrag={pager?.onDrag} onContentSizeChange={(_, height) => pager?.onMetrics(height)} bounces={!pager} nestedScrollEnabled contentContainerStyle={pager ? { minHeight: pager.viewport + pager.header } : undefined}
      renderItem={({ item, index }) => <Card work={item} width={cardWidth} last={index % 3 === 2} onPress={() => void open('ordered', item.id)} />}
      ListEmptyComponent={loading ? <ActivityIndicator color="#fff" style={{ padding: 30 }} /> : <View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name={query || filter !== 'all' || period || folder ? 'search-outline' : 'albums-outline'} size={30} color={c.muted} /></View><Text style={styles.emptyTitle}>{query || filter !== 'all' || period || folder ? '没有匹配的作品' : '尚无内容，先导入一份清单'}</Text>{onImport && <Button title="导入清单" selected style={styles.importButton} onPress={onImport} />}</View>} />
    {periodOpen && <PublicationSheet scope={dateScope} loadDates={loadDates} onClose={() => setPeriodOpen(false)} onApply={value => { setPeriod(value); setPeriodOpen(false); }} />}
    {folderOpen && <FolderSheet manage onClose={() => setFolderOpen(false)} />}


  </View>;
}
const styles = StyleSheet.create({
  topbar: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  folderRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8, paddingTop: 12 }, folderTabs: { gap: 8, paddingVertical: 5 },
  folderTab: { minHeight: 34, maxWidth: 220, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 17, backgroundColor: c.soft, borderWidth: 1, borderColor: c.line, flexDirection: 'row', alignItems: 'center', gap: 6 },
  folderSelected: { backgroundColor: c.accentSoft, borderColor: '#fc2f5633' }, folderText: { flexShrink: 1, color: c.secondary, fontSize: 12 }, folderCount: { color: c.muted, fontSize: 11, fontVariant: ['tabular-nums'] }, folderSelectedText: { color: c.accentText, fontWeight: '600' },
  searchRow: { marginHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', paddingLeft: 12 }, search: { flex: 1, height: 44, color: c.text, fontSize: 14, marginLeft: 8 },
  tabs: { flexDirection: 'row', height: 50, marginTop: 6 }, tab: { flex: 1, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' }, selectedTab: { borderBottomColor: c.accent }, tabText: { color: c.muted, fontSize: 16 },
  filters: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: c.surface }, filter: { minHeight: 38, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, filterSelected: { backgroundColor: '#3a3e4c' },
  filterText: { color: c.muted, fontSize: 13, lineHeight: 18 }, filterSelectedText: { color: c.text, fontWeight: '600' },
  date: { flexShrink: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.soft }, dateSelected: { backgroundColor: c.accentSoft, borderColor: '#fc2f5633' }, dateText: { flexShrink: 1, color: c.secondary, fontSize: 12, lineHeight: 18, fontVariant: ['tabular-nums'] }, dateTextSelected: { color: c.accentText },
  queueRow: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 12, alignItems: 'center', gap: 8 }, total: { flex: 1, minWidth: 0, color: c.muted, fontSize: 12, fontVariant: ['tabular-nums'] }, playActions: { flexDirection: 'row', gap: 4 },
  playAction: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 22 }, primaryPlay: { backgroundColor: c.accent, paddingHorizontal: 12 }, playText: { color: c.secondary, fontSize: 12, lineHeight: 18 }, primaryPlayText: { color: '#fff', fontWeight: '600' },
  pressed: { opacity: 0.65 }, disabled: { opacity: 0.35 }, placeholder: { flex: 1, padding: 12, gap: 10, alignItems: 'center', justifyContent: 'center' }, placeholderTitle: { color: c.muted, textAlign: 'center', fontSize: 11, lineHeight: 17 },
  type: { position: 'absolute', top: 7, right: 7, minWidth: 25, height: 25, borderRadius: 8, backgroundColor: '#00000080', alignItems: 'center', justifyContent: 'center' },
  empty: { paddingHorizontal: 28, paddingVertical: 42, alignItems: 'center', gap: 18 }, emptyIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: c.soft, alignItems: 'center', justifyContent: 'center' }, emptyTitle: { color: c.secondary, fontSize: 14, lineHeight: 22, textAlign: 'center' }, importButton: { minHeight: 44, borderRadius: 22, paddingHorizontal: 24 },
});
