import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentRef } from 'react';
import { AppState, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, interpolateColor, scrollTo, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withDecay, type SharedValue } from 'react-native-reanimated';
import { useMobile } from './context';
import { LibraryScreen, type OpenQueue } from './LibraryScreen';
import { MyProfile } from './MyProfile';
import { libraryOffset } from './motion';
import type { Source, Work } from './model';
import { IconButton, ui } from './ui';

const sources: Source[] = ['all', 'likes', 'favorites']; const labels = ['全部', '喜欢', '收藏']; const TAB_HEIGHT = 50;
function Category({ index, selected, position, onPress }: { index: number; selected: boolean; position: SharedValue<number>; onPress: () => void }) {
  const style = useAnimatedStyle(() => ({ color: interpolateColor(Math.max(0, 1 - Math.abs(position.value - index)), [0, 1], ['#999ba4', '#ffffff']) }));
  return <Pressable style={styles.category} accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress}><Animated.Text style={[styles.label, style]}>{labels[index]}</Animated.Text></Pressable>;
}
export function MeScreen({ visible, onOpen, onImport, onSearch, onMore }: { visible: boolean; onOpen: OpenQueue; onImport: () => void; onSearch: () => void; onMore: () => void }) {
  const { store, revision } = useMobile(); const [selected, setSelected] = useState(0); const [prepared, setPrepared] = useState(false); const [horizontalLocked, setHorizontalLocked] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive'); const interactive = visible && foreground;
  useEffect(() => { const subscription = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => subscription.remove(); }, []);
  const [size, setSize] = useState({ width: 0, height: 0 }); const [profile, setProfile] = useState(0);
  const [totals, setTotals] = useState({ all: 0, likes: 0, favorites: 0 }); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const horizontal = useAnimatedRef<ComponentRef<typeof ScrollView>>();
  const all = useAnimatedRef<FlatList<Work>>(); const likes = useAnimatedRef<FlatList<Work>>(); const favorites = useAnimatedRef<FlatList<Work>>(); const lists = [all, likes, favorites];
  const offsets = useSharedValue([0, 0, 0]); const collapses = useSharedValue([0, 0, 0]); const leader = useSharedValue(0); const headerY = useSharedValue(0); const position = useSharedValue(0);
  const limits = useSharedValue([0, 0, 0]); const driving = useSharedValue(false); const drive = useSharedValue(0); const origin = useSharedValue(0);
  const previous = useRef({ width: 0, profile: 0 }); const target = useRef<number | null>(null);
  useEffect(() => { if (!visible) return; let alive = true; void store.counts().then(value => { if (alive) { setTotals(value); setError(''); } }).catch(() => { if (alive) setError('统计读取失败，点按重试'); }); return () => { alive = false; }; }, [store, revision, visible, retry]);
  const cancelDrive = useCallback(() => { driving.value = false; cancelAnimation(drive); }, [driving, drive]);
  useEffect(() => {
    if (!interactive) {
      cancelDrive(); setHorizontalLocked(false); setPrepared(false); target.current = null;
      horizontal.current?.scrollTo({ x: leader.value * size.width, animated: false }); position.value = leader.value;
      lists.forEach((ref, index) => ref.current?.scrollToOffset({ offset: offsets.value[index], animated: false }));
    }
    return cancelDrive;
  }, [interactive, cancelDrive, size.width, leader, offsets, horizontal, position]);
  useLayoutEffect(() => {
    if (!size.width || !profile) return;
    cancelDrive();
    const old = previous.current;
    if (old.profile && old.profile !== profile) {
      const collapse = Math.min(headerY.value, profile);
      const next = offsets.value.map((value, index) => libraryOffset(value, collapses.value[index], collapse)); offsets.value = next; collapses.value = [collapse, collapse, collapse]; headerY.value = collapse;
      lists.forEach((ref, index) => ref.current?.scrollToOffset({ offset: next[index], animated: false }));
    }
    if (old.width !== size.width) { horizontal.current?.scrollTo({ x: selected * size.width, animated: false }); position.value = selected; }
    previous.current = { width: size.width, profile };
  }, [size.width, profile, selected, headerY, offsets, collapses, leader, horizontal, position, cancelDrive]);
  function align() {
    cancelDrive(); const collapse = Math.min(profile, headerY.value); const active = leader.value;
    const next = offsets.value.map((value, index) => index === active ? value : Math.min(Math.max(profile + TAB_HEIGHT, limits.value[index]), libraryOffset(value, collapses.value[index], collapse))); offsets.value = next;
    collapses.value = next.map((value, index) => index === active ? collapses.value[index] : Math.min(value, collapse));
    lists.forEach((ref, index) => { if (index !== active) ref.current?.scrollToOffset({ offset: next[index], animated: false }); });
  }
  function select(index: number) {
    const arrived = Math.abs(position.value - index) < 0.002;
    if (index === selected && target.current === null && arrived) return;
    align(); target.current = arrived ? null : index; setPrepared(!arrived); horizontal.current?.scrollTo({ x: index * size.width, animated: !arrived }); if (arrived) commit(index * size.width, true);
  }
  function commit(x: number, finished: boolean) {
    if (!interactive || !size.width) return; const index = Math.max(0, Math.min(2, Math.round(x / size.width)));
    if (finished && target.current !== null && Math.abs(x - target.current * size.width) > 1) return;
    if (finished) target.current = null;
    leader.value = index; headerY.value = collapses.value[index]; setSelected(index); if (finished) setPrepared(false);
  }
  const horizontalScroll = useAnimatedScrollHandler({ onScroll: event => { if (size.width) position.value = event.contentOffset.x / size.width; } });
  useAnimatedReaction(() => drive.value, value => {
    if (!driving.value) return;
    if (leader.value === 0) scrollTo(all, 0, value, false); else if (leader.value === 1) scrollTo(likes, 0, value, false); else scrollTo(favorites, 0, value, false);
  });
  const headerPan = usePanGesture({ enabled: interactive && profile > 0, activeOffsetY: [-12, 12], failOffsetX: [-14, 14], maxPointers: 1,
    onBegin: () => { 'worklet'; cancelAnimation(drive); driving.value = false; const y = offsets.value[leader.value]; if (leader.value === 0) scrollTo(all, 0, y, false); else if (leader.value === 1) scrollTo(likes, 0, y, false); else scrollTo(favorites, 0, y, false); },
    onActivate: event => { 'worklet'; cancelAnimation(drive); driving.value = true; origin.value = offsets.value[leader.value] + event.translationY; drive.value = offsets.value[leader.value]; },
    onUpdate: event => { 'worklet'; drive.value = Math.max(0, Math.min(limits.value[leader.value], origin.value - event.translationY)); },
    onDeactivate: event => { 'worklet'; if (event.canceled) driving.value = false; else drive.value = withDecay({ velocity: -event.velocityY, clamp: [0, limits.value[leader.value]], deceleration: 0.998 }, () => { driving.value = false; }); },
  });
  const headerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.min(profile, headerY.value) }] }));
  const underline = useAnimatedStyle(() => ({ width: size.width / 3 * 0.4, transform: [{ translateX: (Math.max(0, Math.min(2, position.value)) + 0.3) * size.width / 3 }] }));
  return <View style={ui.screen}>
    <View style={styles.topbar}><View style={{ flex: 1 }} /><IconButton name="search-outline" label="搜索我的内容" size={25} onPress={onSearch} /><IconButton name="menu-outline" label="更多" size={27} onPress={onMore} /></View>
    <View style={styles.viewport} onLayout={event => { const { width, height } = event.nativeEvent.layout; if (width > 0 && height > 0) setSize(before => before.width === width && before.height === height ? before : { width, height }); }}>
      {profile > 0 && size.width > 0 && <Animated.ScrollView ref={horizontal} horizontal pagingEnabled directionalLockEnabled bounces={false} showsHorizontalScrollIndicator={false} scrollEnabled={interactive && !horizontalLocked} scrollEventThrottle={16} onScroll={horizontalScroll}
        onScrollBeginDrag={() => { target.current = null; align(); setPrepared(true); }} onScrollEndDrag={event => { const x = event.nativeEvent.contentOffset.x; if (Math.abs(x / size.width - Math.round(x / size.width)) < 0.002) commit(x, false); }} onMomentumScrollEnd={event => commit(event.nativeEvent.contentOffset.x, true)}>
        {sources.map((source, index) => <View key={source} style={{ width: size.width, height: size.height }}><LibraryScreen collection={source} visible={visible && (selected === index || prepared)} onOpen={onOpen} onImport={onImport}
          pager={{ page: index, enabled: interactive && selected === index, list: lists[index], offsets, collapses, leader, headerY, header: profile + TAB_HEIGHT, viewport: size.height, onDrag: cancelDrive, onMetrics: height => { const next = [...limits.value]; next[index] = Math.max(0, height - size.height); limits.value = next; }, onHorizontalLock: locked => { setHorizontalLocked(locked); if (!locked) select(index); } }} /></View>)}
      </Animated.ScrollView>}
      <GestureDetector gesture={headerPan}><Animated.View style={[styles.header, headerStyle]}>
        <View onLayout={event => { const height = event.nativeEvent.layout.height; if (height > 0) setProfile(height); }}><MyProfile totals={totals} onSource={source => select(sources.indexOf(source))} />{error && <Pressable onPress={() => setRetry(value => value + 1)}><Text style={ui.error}>{error}</Text></Pressable>}</View>
        <View style={styles.tabs}>{sources.map((source, index) => <Category key={source} index={index} selected={selected === index} position={position} onPress={() => select(index)} />)}<Animated.View pointerEvents="none" style={[styles.underline, underline]} /></View>
      </Animated.View></GestureDetector>
    </View>
  </View>;
}
const styles = StyleSheet.create({ topbar: { height: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }, viewport: { flex: 1, overflow: 'hidden' }, header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5, backgroundColor: '#151723' }, tabs: { height: TAB_HEIGHT, flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ffffff12' }, category: { flex: 1, alignItems: 'center', justifyContent: 'center' }, label: { fontSize: 16, fontWeight: '600' }, underline: { position: 'absolute', left: 0, bottom: 0, height: 2, borderRadius: 2, backgroundColor: '#fff' } });
