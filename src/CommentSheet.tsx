import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, GestureStateManager, useNativeGesture, usePanGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { mediaHeaders } from './douyin';
import { cachedGuestComments, fetchGuestCommentPreview, type GuestComment, type GuestCommentPreview } from './guest-comments';

const CommentRow = memo(function CommentRow({ item }: { item: GuestComment }) {
  const [failed, setFailed] = useState(false); const [expanded, setExpanded] = useState(false);
  useEffect(() => { setFailed(false); }, [item.avatar]);
  const meta = [item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '', item.region].filter(Boolean).join(' · ');
  return <View style={styles.row}>
    {item.avatar && !failed ? <Image source={{ uri: item.avatar, headers: mediaHeaders }} style={styles.avatar} onError={() => setFailed(true)} /> : <View style={styles.avatar} />}
    <View style={styles.body}><Text style={styles.name}>{item.nickname}</Text><Text selectable numberOfLines={expanded ? undefined : 6} style={styles.text}>{item.text}</Text>
      {item.text.length > 160 && <Pressable accessibilityRole="button" onPress={() => setExpanded(value => !value)} hitSlop={5}><Text style={styles.reply}>{expanded ? '收起' : '展开'}</Text></Pressable>}
      {!!meta && <Text style={styles.meta}>{meta}</Text>}
      {!!item.replyCount && <Text style={styles.reply}>{item.replyCount} 条回复 · 游客暂不可读取</Text>}
    </View>{item.likes !== null && <Text accessibilityLabel={`${item.likes} 个赞`} style={styles.likes}>♡ {item.likes}</Text>}
  </View>;
});
export function CommentSheet({ workId, height, onClose, onClosing, closeRequest = 0 }: { workId: string; height: number; onClose: () => void; onClosing?: () => void; closeRequest?: number }) {
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<GuestCommentPreview | null>(() => cachedGuestComments(workId));
  const [error, setError] = useState(''); const [refreshing, setRefreshing] = useState(false); const [attempt, setAttempt] = useState(0);
  const offset = useSharedValue(height); const closing = useSharedValue(false); const previousClose = useRef(closeRequest);
  const scrollY = useSharedValue(0); const start = useSharedValue({ x: 0, y: 0 }); const [dragging, setDragging] = useState(false);
  const current = result?.workId === workId ? result : null;
  useEffect(() => {
    let alive = true; const abort = new AbortController();
    setError(''); const cached = cachedGuestComments(workId); setResult(cached); setRefreshing(true);
    void fetchGuestCommentPreview(workId, abort.signal, attempt > 0).then(page => { if (alive) setResult(page); })
      .catch(failure => { if (alive) setError(failure instanceof Error ? failure.message : '读取失败。'); }).finally(() => { if (alive) setRefreshing(false); });
    return () => { alive = false; abort.abort(); };
  }, [workId, attempt]);
  useEffect(() => {
    closing.value = false; offset.value = height; offset.value = withTiming(0, { duration: 250 });
    return () => cancelAnimation(offset);
  }, [workId, height, closing, offset]);
  const close = useCallback(() => {
    if (closing.value) return; closing.value = true; onClosing?.();
    offset.value = withTiming(height, { duration: 250 }, done => { if (done) scheduleOnRN(onClose); });
  }, [height, closing, offset, onClose, onClosing]);
  useEffect(() => { if (previousClose.current !== closeRequest) { previousClose.current = closeRequest; close(); } }, [closeRequest, close]);
  const pan = usePanGesture({ activeOffsetY: [-12, 12], failOffsetX: [-18, 18],
    onUpdate: event => { 'worklet'; if (!closing.value) offset.value = Math.max(0, event.translationY); },
    onDeactivate: event => { 'worklet'; if (!event.canceled && event.translationY > 0 && (event.translationY > 85 || event.velocityY > 900)) scheduleOnRN(close); else if (!closing.value) offset.value = withTiming(0, { duration: 180 }); },
  });
  const listPan = usePanGesture({ manualActivation: true, maxPointers: 1,
    onTouchesDown: event => { 'worklet'; const touch = event.allTouches[0]; if (!touch || event.numberOfTouches !== 1 || scrollY.value > 1 || closing.value) GestureStateManager.fail(event.handlerTag); else start.value = { x: touch.absoluteX, y: touch.absoluteY }; },
    onTouchesMove: event => {
      'worklet'; const touch = event.allTouches[0]; if (!touch || event.numberOfTouches !== 1) { GestureStateManager.fail(event.handlerTag); return; }
      const y = touch.absoluteY - start.value.y; const x = touch.absoluteX - start.value.x;
      if (Math.abs(x) > 18 || y < -8 || scrollY.value > 1 || closing.value) GestureStateManager.fail(event.handlerTag);
      else if (y > 12) GestureStateManager.activate(event.handlerTag);
    },
    onActivate: () => { 'worklet'; scheduleOnRN(setDragging, true); },
    onUpdate: event => { 'worklet'; if (!closing.value) offset.value = Math.max(0, event.translationY); },
    onDeactivate: event => { 'worklet'; if (!event.canceled && event.translationY > 0 && (event.translationY > 85 || event.velocityY > 900)) scheduleOnRN(close); else if (!closing.value) offset.value = withTiming(0, { duration: 180 }); },
    onFinalize: () => { 'worklet'; scheduleOnRN(setDragging, false); },
  });
  const native = useNativeGesture(); const listGesture = useSimultaneousGestures(listPan, native);
  const scroll = useAnimatedScrollHandler({ onScroll: event => { scrollY.value = Math.max(0, event.contentOffset.y); } });
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  const retry = () => { if (!refreshing) setAttempt(value => value + 1); };
  return <Animated.View accessibilityViewIsModal style={[styles.sheet, { height }, style]}>
    <GestureDetector gesture={pan}><View style={styles.header}><View style={styles.grip} /><Text style={styles.title}>评论预览{current ? ` · ${current.items.length} 条` : ''}</Text><Pressable accessibilityLabel="关闭评论" onPress={close} hitSlop={15} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable></View></GestureDetector>
    <View style={styles.notice}><Text style={styles.noticeText}>游客有限预览 · 暂不支持完整分页和回复</Text><Pressable accessibilityRole="button" accessibilityLabel="刷新评论预览" disabled={refreshing} onPress={retry} hitSlop={8}><Text style={styles.retry}>{refreshing ? '读取中' : '刷新'}</Text></Pressable></View>
    {!current && refreshing && <ActivityIndicator color="#888" style={styles.loading} />}
    {!!error && <Pressable onPress={retry} style={styles.error}><Text style={styles.meta}>{error}</Text><Text style={styles.retry}>点按重试</Text></Pressable>}
    {current && <GestureDetector gesture={listGesture}><Animated.FlatList data={current.items} keyExtractor={item => item.id} contentContainerStyle={[styles.list, { paddingBottom: Math.max(16, insets.bottom) }]} style={{ flex: 1 }}
      initialNumToRender={10} maxToRenderPerBatch={8} windowSize={5} scrollEnabled={!dragging} onScroll={scroll} scrollEventThrottle={16} bounces={false} overScrollMode="never"
      ListEmptyComponent={<Text style={styles.meta}>分享接口未提供预览，无法据此判断作品是否无评论。</Text>}
      ListFooterComponent={current.items.length ? <Text style={styles.footer}>仅展示游客可读取的预览，不代表全部评论。</Text> : undefined}
      renderItem={({ item }) => <CommentRow item={item} />} /></GestureDetector>}
  </Animated.View>;
}
const styles = StyleSheet.create({
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden' },
  header: { height: 56, alignItems: 'center', justifyContent: 'center' }, grip: { width: 32, height: 3, borderRadius: 2, backgroundColor: '#ddd', position: 'absolute', top: 8 },
  title: { color: '#161823', fontWeight: '600', fontSize: 14 }, close: { position: 'absolute', right: 20, top: 14 }, closeText: { color: '#222', fontSize: 25 },
  notice: { backgroundColor: '#fff7e7', paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, noticeText: { color: '#8b651c', fontSize: 11, flex: 1 },
  list: { padding: 16 }, loading: { padding: 28 }, error: { padding: 16, gap: 9, alignItems: 'center' },
  row: { flexDirection: 'row', gap: 11, marginBottom: 25 }, avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#eee' }, body: { flex: 1, gap: 6 },
  name: { color: '#777', fontSize: 12 }, text: { color: '#161823', fontSize: 15, lineHeight: 22 }, meta: { color: '#888', fontSize: 11 }, reply: { color: '#777', fontSize: 12 }, likes: { color: '#999', fontSize: 11, paddingTop: 2, maxWidth: 58 },
  footer: { color: '#999', textAlign: 'center', fontSize: 12, padding: 12 }, retry: { color: '#fc2f56', fontSize: 12 },
});
