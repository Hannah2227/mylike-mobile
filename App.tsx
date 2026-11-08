import * as DocumentPicker from 'expo-document-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { File, Paths } from 'expo-file-system';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS, ActivityIndicator, Alert, BackHandler, FlatList, Image, Keyboard, Modal, PanResponder, PixelRatio, Platform,
  Pressable, StatusBar, StyleSheet,
  Text, TextInput, useWindowDimensions, View, type FlatListProps,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { PublicationSheet } from './src/PublicationSheet';
import ReviewScreen from './src/ReviewScreen';
import { useReview } from './src/use-review';
import {
  decodeLibrary, MAX_LIBRARY_BYTES, type LibraryFilter, type LibraryImport, type LibraryWork,
} from './src/library-format';
import { publicationLabel, type PublicationPeriod } from './src/library-period';
import { duplicateCount, mergeLibrary, readLibraryPage, type LibraryScope } from './src/library-store';

const types = { video: '视频', gallery: '图集', 'live-gallery': '实况图集' } as const;
const filters: [LibraryFilter, string][] = [['all', '全部'], ['video', '视频'], ['gallery', '图集']];

function Button({ label, onPress, primary, disabled }: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={[styles.button, primary && styles.primary, disabled && styles.disabled]}>
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </Pressable>
  );
}

const WorkCard = memo(function WorkCard({ work, showCover, width, height, onOpen }: {
  work: LibraryWork;
  showCover: boolean;
  width: number;
  height: number;
  onOpen: (id: string) => void;
}) {
  const [coverFailed, setCoverFailed] = useState(false);
  const [requested, setRequested] = useState(showCover);
  useEffect(() => { if (showCover) setRequested(true); }, [showCover]);
  const hasCover = (showCover || requested) && work.coverUrl && !coverFailed;
  const title = work.title || '未命名作品';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}，${work.author || '未知作者'}，${types[work.kind]}`}
      onPress={() => onOpen(work.id)} style={[styles.work, { width, height }]}>
      {hasCover && work.coverUrl ? (
        <Image accessibilityIgnoresInvertColors resizeMode="cover" style={StyleSheet.absoluteFill}
          source={{ uri: work.coverUrl, headers: { Referer: 'https://www.douyin.com/' } }}
          onError={() => setCoverFailed(true)} />
      ) : (
        <View style={styles.posterPlaceholder}>
          <Ionicons name={work.kind === 'video' ? 'play-outline' : 'image-outline'} size={24} color="#fff8" />
          <Text numberOfLines={2} style={styles.posterTitle}>{title}</Text>
        </View>
      )}
      <Ionicons name={work.kind === 'video' ? 'play' : work.kind === 'live-gallery' ? 'radio-outline' : 'albums'}
        size={19} color="#fff" style={styles.posterKind} />
    </Pressable>
  );
});

function GridDivider() { return <View style={styles.gridDivider} />; }

export default function App() {
  const review = useReview();
  const { showLibrary } = review;
  const [clear, setClear] = useState(false);
  const [auto, setAuto] = useState(false);
  const [rate, setRate] = useState(1);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [query, setQuery] = useState('');
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [period, setPeriod] = useState<PublicationPeriod>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const scope = useMemo<LibraryScope>(() => ({ search: query, filter, period }), [query, filter, period]);
  const [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState<LibraryWork[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');
  const [importError, setImportError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ file: LibraryImport; existing: number } | null>(null);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const list = useRef<FlatList<LibraryWork>>(null);
  const displayedScope = useRef<LibraryScope | null>(null);
  const generation = useRef(0);
  const morePending = useRef(false);
  const importing = useRef(false);
  const reviewing = review.tab === 'review' && review.selection !== null;
  const listReady = !loading && displayedScope.current === scope;
  const canStart = listReady && !review.starting && !busy;
  const posterWidth = (width - 2 * StyleSheet.hairlineWidth) / 3;
  const rowHeight = PixelRatio.roundToNearestPixel(posterWidth / 0.76);
  const navigation = useRef({ enabled: false, open: () => {} });
  navigation.current = {
    enabled: !reviewing && !review.starting && !searchFocused && !busy && !preview && !dateOpen,
    open: () => { Keyboard.dismiss(); review.showReview(scope); },
  };
  const librarySwipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, { dx, dy }) =>
      navigation.current.enabled && dx > 12 && dx > Math.abs(dy) * 1.35,
    onPanResponderRelease: (_, { dx, vx }) => {
      if (navigation.current.enabled && (dx > 45 || (dx > 20 && vx > 0.5))) navigation.current.open();
    },
  }), []);
  const viewability = useRef({ itemVisiblePercentThreshold: 5 }).current;
  const viewChanged = useRef<NonNullable<FlatListProps<LibraryWork>['onViewableItemsChanged']>>(({ viewableItems }) => {
    const next = new Set(viewableItems.filter((token) => token.isViewable).map((token) => token.item.id));
    setVisible((current) => current.size === next.size && [...next].every((id) => current.has(id)) ? current : next);
  }).current;

  useEffect(() => {
    if (Platform.OS !== 'android' || !reviewing) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      showLibrary();
      return true;
    });
    return () => subscription.remove();
  }, [reviewing, showLibrary]);

  useEffect(() => {
    const request = ++generation.current;
    morePending.current = false;
    setLoadingMore(false);
    setLoading(true);
    setListError('');
    void readLibraryPage(scope, 0).then((page) => {
      if (request !== generation.current) return;
      if (displayedScope.current !== scope) list.current?.scrollToOffset({ offset: 0, animated: false });
      displayedScope.current = scope;
      setRows(page.items);
      setTotal(page.total ?? 0);
    }).catch(() => {
      if (request !== generation.current) return;
      displayedScope.current = null;
      setRows([]);
      setTotal(0);
      setListError('无法读取内容库，请重试。');
    }).finally(() => {
      if (request === generation.current) setLoading(false);
    });
    return () => { generation.current++; };
  }, [scope, refresh]);

  async function loadMore() {
    if (loading || displayedScope.current !== scope || morePending.current || !rows.length || rows.length >= total) return;
    const request = generation.current;
    morePending.current = true;
    setLoadingMore(true);
    setListError('');
    try {
      const page = await readLibraryPage(scope, rows.length);
      if (request === generation.current) setRows((previous) => [...previous, ...page.items]);
    } catch {
      if (request === generation.current) setListError('无法加载更多作品，请重试。');
    } finally {
      if (request === generation.current) {
        morePending.current = false;
        setLoadingMore(false);
      }
    }
  }

  async function pick() {
    if (importing.current) return;
    importing.current = true;
    setBusy(true);
    setImportError('');
    setNotice('');
    let localFile: File | undefined;
    try {
      const selected = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (selected.canceled) return;
      const asset = selected.assets[0];
      localFile = new File(asset.uri);
      if ((asset.size ?? 0) > MAX_LIBRARY_BYTES || localFile.size > MAX_LIBRARY_BYTES)
        throw new Error('清单超过 64 MiB，请选择较小的文件。');
      if (!localFile.exists) throw new Error('无法读取选中的文件。');
      const file = decodeLibrary(await localFile.text());
      setPreview({ file, existing: await duplicateCount(file) });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '未能读取清单。');
    } finally {
      // Only delete the picker-created cache copy, never the user's original file.
      const cachePrefix = Paths.cache.uri.replace(/\/?$/, '/');
      if (localFile?.uri.startsWith(cachePrefix)) {
        try { localFile.delete(); } catch { /* Cache cleanup is optional. */ }
      }
      importing.current = false;
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (importing.current || !preview) return;
    importing.current = true;
    setBusy(true);
    setImportError('');
    try {
      await mergeLibrary(preview.file);
      setNotice(`已合并 ${preview.file.works.length} 条作品，其中新增 ${preview.file.works.length - preview.existing} 条。`);
      setPreview(null);
      generation.current++;
      setRefresh((value) => value + 1);
    } catch {
      setImportError('导入失败，原有内容库已保留。请重试。');
    } finally {
      importing.current = false;
      setBusy(false);
    }
  }

  const startQueue = review.start;
  const startReview = useCallback((mode: 'ordered' | 'shuffle', id?: string) => {
    Keyboard.dismiss();
    setClear(false);
    void startQueue(scope, mode, id);
  }, [scope, startQueue]);
  const openWork = useCallback((id: string) => {
    if (canStart) startReview('ordered', id);
  }, [canStart, startReview]);

  function showLibraryMenu() {
    Keyboard.dismiss();
    if (Platform.OS !== 'ios') {
      Alert.alert('内容库', undefined, [
        { text: '取消', style: 'cancel' },
        { text: '导入清单', onPress: () => { void pick(); } },
      ], { cancelable: true });
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions({ options: ['导入清单', '取消'], cancelButtonIndex: 1 }, (index) => {
      if (index === 0) void pick();
    });
  }

  return (
    <SafeAreaProvider>
      <View style={styles.screen}>
        <StatusBar barStyle={reviewing ? 'light-content' : 'dark-content'} hidden={reviewing && clear} />
        <View style={styles.screen}>
          <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.screen}
            pointerEvents={reviewing ? 'none' : 'auto'} accessibilityElementsHidden={reviewing} {...librarySwipe.panHandlers}>
            <View style={styles.controls}>
              <View style={styles.libraryHeader}>
                <Text accessibilityRole="header" style={styles.brand}
                  accessibilityActions={[{ name: 'review', label: '进入回看' }]}
                  onAccessibilityAction={() => { if (navigation.current.enabled) navigation.current.open(); }}>
                  MyLike
                </Text>
                <View style={styles.searchBox}>
                  <Ionicons name="search" size={18} color="#707074" />
                  <TextInput
                    accessibilityLabel="搜索标题或作者" autoCorrect={false} autoCapitalize="none"
                    placeholder="搜索我的内容" placeholderTextColor="#707074"
                    value={search} onChangeText={setSearch} maxLength={160}
                    onSubmitEditing={({ nativeEvent }) => setQuery(nativeEvent.text.trim())}
                    onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
                    clearButtonMode="while-editing" returnKeyType="search" style={styles.search}
                  />
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="内容库菜单"
                  disabled={busy} style={styles.menu} onPress={showLibraryMenu}>
                  {busy && !preview ? <ActivityIndicator color="#202022" /> : <Ionicons name="menu" size={28} color="#202022" />}
                </Pressable>
              </View>
              <View style={styles.libraryTabs}>
                <View pointerEvents="none" style={styles.centerTab}>
                  <View style={styles.likesTab}>
                    <Text accessibilityRole="header" style={styles.likesTitle}>喜欢</Text>
                  </View>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`发布时间，${publicationLabel(period)}`}
                  accessibilityState={{ selected: period !== null }}
                  style={[styles.libraryAction, period !== null && styles.periodSelected]}
                  onPress={() => { Keyboard.dismiss(); setDateOpen(true); }}>
                  <Ionicons name="calendar-outline" size={17} color="#29292e" />
                  <Text style={styles.libraryActionText}>{publicationLabel(period)}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={!canStart || total === 0}
                  accessibilityState={{ disabled: !canStart || total === 0 }}
                  style={[styles.libraryAction, (!canStart || total === 0) && styles.disabled]}
                  onPress={() => startReview('shuffle')}>
                  <Ionicons name="shuffle" size={19} color="#29292e" />
                  <Text style={styles.libraryActionText}>随机播放</Text>
                </Pressable>
              </View>
              <View style={styles.filterBar}>
                <View style={styles.actions}>
                  {filters.map(([key, label]) => (
                    <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: filter === key }}
                      style={[styles.filter, filter === key && styles.filterSelected]} onPress={() => setFilter(key)}>
                      <Text style={[styles.filterText, filter === key && styles.filterTextSelected]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.note}>{listReady || listError ? `${total} 条` : '读取中…'}</Text>
              </View>
              {!preview && importError ? <Text style={[styles.error, styles.libraryMessage]}>{importError}</Text> : null}
              {review.error ? <Text style={[styles.error, styles.libraryMessage]}>{review.error}</Text> : null}
              {notice ? <Text accessibilityLiveRegion="polite" style={[styles.note, styles.libraryMessage]}>{notice}</Text> : null}
              {listError ? (
                <View style={[styles.row, styles.libraryMessage]}>
                  <Text style={styles.error}>{listError}</Text>
                  <Button label="重试" onPress={() => rows.length ? void loadMore() : setRefresh((n) => n + 1)} />
                </View>
              ) : null}
            </View>
            <FlatList
              key="poster-grid"
              ref={list}
              data={rows}
              numColumns={3}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <WorkCard key={item.coverUrl ?? item.id} work={item} showCover={visible.has(item.id)}
                  width={posterWidth} height={rowHeight} onOpen={openWork} />
              )}
              columnWrapperStyle={styles.columns}
              ItemSeparatorComponent={GridDivider}
              getItemLayout={(_, index) => ({ length: rowHeight, offset: index * (rowHeight + StyleSheet.hairlineWidth), index })}
              extraData={visible}
              initialNumToRender={6}
              windowSize={5}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              onViewableItemsChanged={viewChanged}
              viewabilityConfig={viewability}
              onEndReached={() => { if (!reviewing && !listError) void loadMore(); }}
              onEndReachedThreshold={0.5}
              ListFooterComponent={loadingMore ? <ActivityIndicator /> : undefined}
              ListEmptyComponent={!listReady && !listError ? <ActivityIndicator /> : listError ? undefined : (
                <View style={styles.empty}>
                  <Text style={styles.note}>{query || filter !== 'all' || period !== null ? '没有匹配的作品。' : '在桌面版导出喜欢清单，再从这里导入。'}</Text>
                  {!query && filter === 'all' && period === null && (
                    <Button label="导入清单" onPress={() => void pick()} disabled={busy} primary />
                  )}
                </View>
              )}
            />
          </SafeAreaView>
          {review.tab === 'review' && review.selection && (
            <View style={StyleSheet.absoluteFill}>
              <ReviewScreen selection={review.selection} stopPlayback={review.stopPlayback} move={review.move}
                checkpoint={review.checkpoint} clear={clear} setClear={setClear} auto={auto} setAuto={setAuto}
                rate={rate} setRate={setRate} saveError={review.error} onLibrary={showLibrary} reshuffle={review.reshuffle} />
            </View>
          )}
        </View>
        {dateOpen && <PublicationSheet scope={scope}
          onApply={(value) => {
            setPeriod((current) => publicationLabel(current) === publicationLabel(value) ? current : value);
            setDateOpen(false);
          }} onClose={() => setDateOpen(false)} />}
        <Modal animationType="fade" transparent visible={preview !== null} onRequestClose={() => { if (!busy) setPreview(null); }}>
          {preview && (
            <View style={styles.overlay}>
              <View style={styles.preview}>
                <Text style={styles.title}>导入预览</Text>
                <Text style={styles.workTitle}>{preview.file.sourceLabel || '喜欢清单'}</Text>
                <Text style={styles.note}>导出于 {new Date(preview.file.exportedAt).toLocaleString()} · v{preview.file.version}</Text>
                <Text style={styles.note}>
                  {`${preview.file.works.length} 条作品 · 新增 ${preview.file.works.length - preview.existing} 条 · 库中已存在 ${preview.existing} 条`}
                </Text>
                {preview.file.duplicateRows > 0 && <Text style={styles.note}>文件内另有 {preview.file.duplicateRows} 条重复记录。</Text>}
                {importError ? <Text style={styles.error}>{importError}</Text> : null}
                <View style={styles.actions}>
                  <Button label="取消" disabled={busy} onPress={() => { setPreview(null); setImportError(''); }} />
                  <Button label={busy ? '正在合并…' : '合并导入'} disabled={busy} onPress={() => void confirmImport()} primary />
                </View>
              </View>
            </View>
          )}
        </Modal>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  controls: { backgroundColor: '#fff' },
  libraryHeader: { paddingLeft: 16, paddingRight: 10, minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10 },
  brand: { flex: 1, color: '#151518', fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#f2f2f3', borderRadius: 22, paddingHorizontal: 11, width: '44%', minHeight: 38 },
  search: { flex: 1, color: '#171719', fontSize: 14, minHeight: 38 },
  menu: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  libraryTabs: { height: 44, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e8e8e9', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  centerTab: { ...StyleSheet.absoluteFill, alignItems: 'center' },
  libraryAction: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 40, paddingHorizontal: 6, borderRadius: 7 },
  libraryActionText: { color: '#25252a', fontSize: 13, fontWeight: '600' },
  periodSelected: { backgroundColor: '#f0f0f2' },
  likesTab: { width: 78, height: '100%', borderBottomWidth: 2.5, borderColor: '#161618', alignItems: 'center', justifyContent: 'center' },
  likesTitle: { color: '#151518', fontSize: 17, fontWeight: '700' },
  filterBar: { paddingHorizontal: 16, paddingVertical: 9, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  filter: { minHeight: 34, minWidth: 52, borderRadius: 6, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' },
  filterSelected: { backgroundColor: '#ebebed' },
  filterText: { color: '#68686a', fontSize: 13 },
  filterTextSelected: { color: '#18181a', fontWeight: '700' },
  libraryMessage: { paddingHorizontal: 16, paddingBottom: 7 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  title: { fontSize: 25, fontWeight: '700', color: '#151518' },
  note: { color: '#626266', fontSize: 13, lineHeight: 18 },
  button: { minHeight: 44, borderRadius: 9, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#f0f0f1' },
  primary: { backgroundColor: '#222225' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#232326', fontSize: 14, fontWeight: '600' },
  primaryText: { color: '#fff' },
  gridDivider: { height: StyleSheet.hairlineWidth },
  columns: { gap: StyleSheet.hairlineWidth },
  work: { overflow: 'hidden', backgroundColor: '#252528' },
  workTitle: { color: '#232326', fontSize: 14, lineHeight: 19, fontWeight: '600' },
  posterPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 8 },
  posterTitle: { color: '#fff', textAlign: 'center', fontSize: 12 },
  posterKind: { position: 'absolute', top: 8, right: 8, textShadowColor: '#000c', textShadowRadius: 4 },
  empty: { alignItems: 'center', gap: 12, padding: 18 },
  error: { color: '#a22621', fontSize: 14 },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#0007' },
  preview: { width: '100%', maxWidth: 420, padding: 18, borderRadius: 14, backgroundColor: '#fff', gap: 12 },
});
