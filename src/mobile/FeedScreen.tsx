import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, FlatList, Image, Modal, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommentSheet } from '../CommentSheet';
import { mediaHeaders } from '../douyin';
import { useMobile } from './context';
import { LibraryScreen, type OpenQueue } from './LibraryScreen';
import { MediaSlot, type MediaControl, type MediaInfo } from './Media';
import { rates, type Scope, type Session, type Source } from './model';
import { SeekRail } from './SeekRail';

import { FolderSheet } from './FolderSheet';
import { feedChrome, mediaAreaHeight } from './layout';
import { Button, IconButton, ui } from './ui';
import { useSession } from './useSession';
import { WorkPager, type PagerHandle } from './WorkPager';
import { ActionSheet } from './ActionSheet';
import { ShareActions } from './WorkActions';
import { usePrefetch } from './usePrefetch';
import { createPlaybackHandoff } from './playback';

type Side = 'feed' | 'author';
const emptyInfo: MediaInfo = { id: '', work: null, data: null, error: '', photos: 1, hasLive: false, musicUnavailable: false, livePhase: 'none' };
function QueueRow({ id, index, active, onPress }: { id: string; index: number; active: boolean; onPress: () => void }) {
  const { store } = useMobile(); const { work: readWork } = store;
  const [title, setTitle] = useState(id);
  useEffect(() => { let alive = true; void readWork(id).then(value => { if (alive && value) setTitle(value.title || id); }).catch(() => {}); return () => { alive = false; }; }, [id]);
  return <Pressable onPress={onPress} accessibilityState={{ selected: active }} style={[styles.queueItem, active && { backgroundColor: '#49313e' }]}><Text numberOfLines={1} style={ui.text}>{index + 1} · {title}</Text></Pressable>;
}
export function FeedScreen({ source = 'all', visible = true, initial, scope: suppliedScope, sessionKey, title, bottomInset = 0, onSource, onImport, onOpen, onBack, onOverlay, onTemporaryClear }: {
  source?: Source; visible?: boolean; initial?: Session; scope?: Scope; sessionKey?: string; title?: string; bottomInset?: number;
  onSource?: (value: Source) => void; onImport: () => void; onOpen: OpenQueue; onBack?: () => void; onOverlay?: (value: boolean) => void; onTemporaryClear?: (value: boolean) => void;
}) {
  const window = useWindowDimensions(); const insets = useSafeAreaInsets(); const focused = useIsFocused();
  const [viewport, setViewport] = useState({ width: 0, height: 0 }); const width = viewport.width || window.width; const height = viewport.height;
  const { preferences, setPreferences, revision, importing, marks, setMark } = useMobile();
  const playbackHeight = mediaAreaHeight(height, insets.bottom, bottomInset, preferences.clear);
  const chrome = feedChrome(playbackHeight, { ...insets, bottom: 0 });
  const captionLayout = { bottom: chrome.captionBottom, left: chrome.left, right: Math.max(70, insets.right + 62) };
  const toolbarLayout = { bottom: chrome.toolbarBottom, right: chrome.right, gap: chrome.gap };
  const scope = useMemo<Scope>(() => suppliedScope ?? { source }, [suppliedScope, source]);
  const playback = useSession(sessionKey ?? `home:${source}`, scope, initial, title || (source === 'all' ? '推荐' : source === 'likes' ? '喜欢' : '收藏'));
  const { session, version, loading, error, checkpoint, moveTo, refresh, reshuffle, watch, suspend } = playback;
  const id = session?.ids[session.index] ?? ''; const idRef = useRef(id); idRef.current = id;
  const [side, setSide] = useState<Side>('feed'); const [prepared, setPrepared] = useState(false);
  const [info, setInfo] = useState<MediaInfo>(emptyInfo); const [paused, setPaused] = useState(false); const [edgeHeld, setEdgeHeld] = useState(false); const [seeking, setSeeking] = useState(false); const [pinching, setPinching] = useState(false);
  const [boostLocked, setBoostLocked] = useState(false); const [boostTarget, setBoostTarget] = useState(false);
  const boostActive = useRef(false);
  const toggleBoostLock = useCallback((workId: string) => {
    if (idRef.current !== workId || !boostActive.current || AppState.currentState !== 'active') return;
    setPaused(false); setBoostLocked(value => !value);
  }, []);
  const [previews, setPreviews] = useState<Record<string, MediaInfo>>({});
  const [photoPage, setPhotoPage] = useState<{ id: string; index: number } | null>(null); const [time, setTime] = useState({ seconds: 0, duration: 0 }); const [readyId, setReadyId] = useState('');
  const [comments, setComments] = useState(false); const [panel, setPanel] = useState<'options' | 'queue' | 'share' | null>(null); const [avatarFailed, setAvatarFailed] = useState(false);
  const [commentsClosing, setCommentsClosing] = useState(false); const [commentCloseRequest, setCommentCloseRequest] = useState(0);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const x = useSharedValue(0); const photoX = useSharedValue(0); const mediaHeight = useSharedValue(height); const heart = useSharedValue(0);
  const mediaTargetHeight = comments && !commentsClosing ? height * 0.3 : playbackHeight;
  const mediaLayoutKey = `${width}:${height}:${mediaTargetHeight}`;
  const [settledMediaKey, setSettledMediaKey] = useState('');
  const allowZoom = !comments && settledMediaKey === mediaLayoutKey;
  const pager = useRef<PagerHandle | null>(null); const control = useRef<MediaControl | null>(null);
  const handoff = useMemo(createPlaybackHandoff, []);
  const pendingAuto = useRef<string | null>(null);
  const current = info.id === id ? info : previews[id] ?? emptyInfo;
  const requestedPhoto = photoPage?.id === id ? photoPage.index : session?.point?.kind === 'gallery' ? session.point.value : 0;
  const photo = current.data && 'images' in current.data ? Math.max(0, Math.min(current.photos - 1, requestedPhoto)) : requestedPhoto;
  const gallery = current.data ? 'images' in current.data : current.work?.kind !== 'video' && Boolean(current.work);
  const boostable = !gallery || current.hasLive;
  const boosted = (edgeHeld || boostLocked) && boostable;
  const mediaPaused = paused && !(edgeHeld && boostable);
  const chromeHidden = preferences.clear || edgeHeld;
  const playing = focused && visible && foreground && height > 0 && side === 'feed' && !importing && !loading && panel === null && !groupId;
  const interactive = playing && !comments && !seeking;
  boostActive.current = interactive && !pinching;
  usePrefetch(session?.ids, session?.index ?? 0, interactive && !pinching);
  useEffect(() => { if (!playing) suspend(); }, [playing, suspend]);
  useEffect(() => { if (playing && gallery && readyId === id && current.data && !current.error) watch(id, { kind: 'gallery', value: photo }); }, [playing, gallery, readyId, id, current.data, current.error, photo, watch]);
  const dataRevision = useRef(revision);
  useEffect(() => {
    if (dataRevision.current === revision) return;
    dataRevision.current = revision;
    if (session && !session.ids.length) void refresh();
  }, [revision, session, refresh]);
  useLayoutEffect(() => {
    setPaused(false); setEdgeHeld(false); setBoostLocked(false); setBoostTarget(false); setPinching(false); setSeeking(false); setReadyId(''); setAvatarFailed(false); setTime({ seconds: 0, duration: 0 });
    setPrepared(false);
  }, [id]);
  useEffect(() => { const subscription = AppState.addEventListener('change', state => { setForeground(state === 'active'); if (state !== 'active') { setEdgeHeld(false); setBoostLocked(false); setBoostTarget(false); setPinching(false); } }); return () => subscription.remove(); }, []);
  useEffect(() => { if (!visible || !focused) { setComments(false); setPanel(null); setEdgeHeld(false); setBoostLocked(false); setBoostTarget(false); setPinching(false); setGroupId(null); } }, [visible, focused]);
  useEffect(() => { onTemporaryClear?.(edgeHeld && visible && focused && foreground && side === 'feed'); return () => onTemporaryClear?.(false); }, [edgeHeld, visible, focused, foreground, side, onTemporaryClear]);
  useEffect(() => { onOverlay?.(side !== 'feed'); return () => onOverlay?.(false); }, [side, onOverlay]);
  const receiveInfo = useCallback((value: MediaInfo) => {
    setPreviews(previous => Object.fromEntries([...Object.entries(previous).filter(([key]) => key !== value.id).slice(-7), [value.id, value]]));
    if (value.id !== idRef.current) return;
    setInfo(value);
  }, []);
  const receiveTime = useCallback((workId: string, seconds: number, duration: number, force: boolean) => {
    if (workId !== idRef.current) return;
    setTime(previous => ({ seconds, duration: duration > 0 ? duration : previous.duration }));
    if (!force && seconds > 0) watch(workId, { kind: 'video', value: seconds });
    checkpoint(workId, { kind: 'video', value: seconds }, force);
  }, [checkpoint, watch]);
  const ready = useCallback((workId: string) => { if (idRef.current === workId) setReadyId(workId); }, []);
  const pause = useCallback(() => setPaused(true), []);
  const closeComments = useCallback(() => { setComments(false); setCommentsClosing(false); }, []);
  const beginCommentClose = useCallback(() => setCommentsClosing(true), []);
  function openComments() { setCommentsClosing(false); setCommentCloseRequest(0); setComments(true); }
  function closeSide() { x.value = withTiming(0, { duration: 210 }); setSide('feed'); setPrepared(false); }
  function openSide(value: 'author') { setPrepared(true); setSide(value); x.value = withTiming(-width, { duration: 210 }); }
  useEffect(() => {
    if (!visible || !focused) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (side !== 'feed') { closeSide(); return true; } return false;
    }); return () => subscription.remove();
  }, [side, visible, focused]);
  const authorPan = usePanGesture({ enabled: side === 'author', activeOffsetX: [-18, 18], failOffsetY: [-14, 14],
    onUpdate: e => { 'worklet'; x.value = -width + Math.max(0, Math.min(width, e.translationX)); },
    onDeactivate: e => { 'worklet'; if (!e.canceled && (e.translationX > width / 3 || e.velocityX > 750)) scheduleOnRN(closeSide); else x.value = withTiming(-width); },
  });
  const feedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const authorStyle = useAnimatedStyle(() => ({ transform: [{ translateX: width + x.value }] }));
  const heightStyle = useAnimatedStyle(() => ({ height: mediaHeight.value }));
  const heartStyle = useAnimatedStyle(() => ({ opacity: heart.value, transform: [{ scale: 0.7 + heart.value * 0.6 }, { rotate: '-15deg' }] }));
  const previousViewport = useRef('');
  useLayoutEffect(() => {
    const viewportKey = `${width}:${height}`;
    if (previousViewport.current !== viewportKey) { mediaHeight.value = mediaTargetHeight; setSettledMediaKey(mediaLayoutKey); }
    else { setSettledMediaKey(''); mediaHeight.value = withTiming(mediaTargetHeight, { duration: 250 }, done => { if (done) scheduleOnRN(setSettledMediaKey, mediaLayoutKey); }); }
    previousViewport.current = viewportKey;
  }, [width, height, mediaTargetHeight, mediaLayoutKey, mediaHeight]);
  useEffect(() => () => cancelAnimation(mediaHeight), [mediaHeight]);
  // Resize the same route without retaining an offset measured on the old screen.
  useLayoutEffect(() => { cancelAnimation(x); x.value = side === 'author' ? -width : 0; }, [width]);
  const liked = marks[id]?.liked ?? current.work?.liked ?? false;
  const saved = marks[id]?.saved ?? current.work?.saved ?? false;
  function like() { if (id && current.work) { if (!liked) setMark(id, 'liked', true); heart.value = 1; heart.value = withTiming(0, { duration: 750 }); } }
  function changePhoto(index: number) { setPhotoPage({ id, index }); checkpoint(id, { kind: 'gallery', value: index }, true); }
  function next() {
    if (!session || comments || panel || !playing) return false;
    if (pinching) { pendingAuto.current = id; return true; }
    if (session.index + 1 < session.ids.length) return pager.current?.go(session.index + 1) ?? false;
    if (!onBack && source === 'all') { void refresh(); return true; }
    return false;
  }
  useEffect(() => {
    if (pinching || !playing || !pendingAuto.current) return;
    const pending = pendingAuto.current; pendingAuto.current = null;
    if (pending === id && preferences.auto && !next()) setPaused(true);
  }, [pinching, playing, id, preferences.auto]);
  function retry() { setPaused(false); control.current?.retry(); }
  const author = current.data?.author || current.work?.author || '未知作者';
  const authorGroup = current.work?.author || author;
  const countLabel = (value: number | undefined, fallback: string) => value === undefined ? fallback : value >= 10000 ? `${(value / 10000).toFixed(1)}万` : String(value);
  function openAuthorWork(value: Session, selectedScope: Scope, label: string) { onOpen(value, selectedScope, label); }
  const renderChrome = (workId: string, active: boolean) => !active ? <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {!chromeHidden && previews[workId]?.work && <><View style={[styles.caption, captionLayout]}><Text style={styles.author}>@{previews[workId].work?.author}</Text><Text pointerEvents="none" numberOfLines={3} style={styles.description}>{previews[workId].work?.title}</Text></View>
      <View style={[styles.toolbar, toolbarLayout]}><View style={styles.avatar}><Text style={ui.text}>{previews[workId].work?.author.slice(0, 1)}</Text></View>
        <View style={styles.tool}><View style={ui.icon}><Ionicons name="heart" size={34} color={(marks[workId]?.liked ?? previews[workId].work?.liked) ? '#fc2f56' : '#fff'} /></View><Text style={styles.toolLabel}>{countLabel(previews[workId].data?.statistics?.likes, '喜欢')}</Text></View>
        <View style={styles.tool}><View style={ui.icon}><Ionicons name="chatbubble-ellipses" size={33} color="#fff" /></View><Text style={styles.toolLabel}>{countLabel(previews[workId].data?.statistics?.comments, '评论')}</Text></View>
        <View style={styles.tool}><View style={ui.icon}><Ionicons name="star" size={34} color={(marks[workId]?.saved ?? previews[workId].work?.saved) ? '#ffc345' : '#fff'} /></View><Text style={styles.toolLabel}>{countLabel(previews[workId].data?.statistics?.favorites, '收藏')}</Text></View>
        <View style={styles.tool}><View style={ui.icon}><Ionicons name="arrow-redo" size={33} color="#fff" /></View><Text style={styles.toolLabel}>{countLabel(previews[workId].data?.statistics?.shares, '分享')}</Text></View>
      </View></>}
  </View> : <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    {!comments && !chromeHidden && <>
      <View style={[styles.caption, captionLayout]} pointerEvents="box-none"><Pressable onPress={() => openSide('author')}><Text style={styles.author}>@{author}</Text></Pressable>
        <Text pointerEvents="none" numberOfLines={3} style={styles.description}>{current.work?.title || current.data?.title || '抖音作品'}</Text>
        {gallery && <Text pointerEvents="none" style={styles.note}>{current.livePhase === 'loading' ? '正在准备实况片段…' : current.hasLive ? '实况图集' : current.work?.kind === 'live-gallery' ? '当前页无可用实况片段' : '图集'}{current.musicUnavailable ? ' · 配乐暂不可用' : ''}</Text>}
      </View>
      <View style={[styles.toolbar, toolbarLayout]}>
        <Pressable accessibilityLabel="打开作者页" onPress={() => openSide('author')} style={styles.avatar}>{current.data?.authorAvatar && !avatarFailed ? <Image source={{ uri: current.data.authorAvatar, headers: mediaHeaders }} style={{ width: 42, height: 42, borderRadius: 21 }} onError={() => setAvatarFailed(true)} /> : <Text style={ui.text}>{author.slice(0, 1)}</Text>}</Pressable>
        <View style={styles.tool}><IconButton name="heart" label="切换本机喜欢" size={34} color={liked ? '#fc2f56' : '#fff'} onPress={() => { if (current.work) setMark(id, 'liked', !liked); }} /><Text style={styles.toolLabel}>{countLabel(current.data?.statistics?.likes, '喜欢')}</Text></View>
        <View style={styles.tool}><IconButton name="chatbubble-ellipses" label="打开游客评论预览" size={33} onPress={openComments} /><Text style={styles.toolLabel}>{countLabel(current.data?.statistics?.comments, '评论')}</Text></View>
        <View style={styles.tool}><IconButton name="star" label="切换本机收藏，长按管理收藏夹" size={34} color={saved ? '#ffc345' : '#fff'} onPress={() => { if (current.work) setMark(id, 'saved', !saved); }} onLongPress={() => { if (current.work) setGroupId(id); }} /><Text style={styles.toolLabel}>{countLabel(current.data?.statistics?.favorites, '收藏')}</Text></View>
        <View style={styles.tool}><IconButton name="arrow-redo" label="分享公开作品链接" size={33} onPress={() => setPanel('share')} /><Text style={styles.toolLabel}>{countLabel(current.data?.statistics?.shares, '分享')}</Text></View>
      </View>
      {gallery && current.photos > 1 && <Text style={[styles.photo, { top: chrome.top + 70, right: Math.max(20, insets.right) }]}>{photo + 1} / {current.photos}</Text>}
      {gallery && current.photos > 1 && <View pointerEvents="none" style={[styles.segments, { bottom: chrome.bottom + 7 }]}>{Array.from({ length: Math.min(current.photos, 20) }, (_, index) => <View key={index} style={[styles.segment, index <= photo && styles.segmentActive]} />)}</View>}
    </>}
    {paused && !edgeHeld && !comments && <View pointerEvents="none" style={styles.pause}><Ionicons name="play" size={68} color="#ffffffbb" /></View>}
    {edgeHeld && boostable && <View pointerEvents="none" style={[styles.boostDrop, boostTarget && styles.boostDropArmed]}><Ionicons name={boostLocked ? 'lock-open-outline' : 'lock-closed-outline'} size={24} color="#fff" /><Text style={ui.text}>{boostTarget ? boostLocked ? '松手恢复正常' : '松手锁定 2×' : boostLocked ? '下滑恢复正常' : '下滑锁定 2×'}</Text></View>}
    {boostLocked && boostable && !edgeHeld && !comments && !chromeHidden && <Pressable accessibilityRole="button" accessibilityLabel="解除二倍速锁定" onPress={() => setBoostLocked(false)} style={[styles.boostBadge, { top: chrome.top + 52 }]}><Ionicons name="lock-closed" size={11} color="#ffffffc9" /><Text style={styles.boostLabel}>2× 已锁定</Text></Pressable>}
    {current.error && !edgeHeld && <View style={styles.failure}><Text style={ui.text}>{current.error}</Text><Button title="重试取链" onPress={retry} /></View>}
    {!gallery && <SeekRail enabled={playing && !comments && !pinching && !edgeHeld} seconds={time.seconds} duration={time.duration} paused={paused} clear={chromeHidden} bottom={chrome.bottom}
      onBegin={() => { setSeeking(true); setEdgeHeld(false); }} onCancel={() => setSeeking(false)}
      onCommit={seconds => { control.current?.seek?.(seconds); setPaused(false); setSeeking(false); }} />}
  </View>;
  return <View style={styles.root} onLayout={event => { const { width, height } = event.nativeEvent.layout; setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height }); }}>
    {focused && visible && <StatusBar barStyle="light-content" hidden={chromeHidden} />}
    <Animated.View style={[StyleSheet.absoluteFill, styles.feed, feedStyle]}>
      {session?.ids.length ? <WorkPager key={version} ref={pager} ids={session.ids} index={session.index} width={width} height={playbackHeight}
        enabled={interactive} gallery={gallery} boostable={boostable} photo={photo} photos={current.photos} photoX={photoX} x={x}
        onCommit={moveTo} onPhoto={changePhoto} onSide={setSide} onPrepare={setPrepared} onBoundary={step => { if (step < 0 && !onBack || step > 0 && !onBack && source === 'all') void refresh(); }}
        onTap={() => setPaused(value => !value)} onLike={like} onHold={() => setPanel('options')} onBoost={setEdgeHeld} onBoostTarget={setBoostTarget} onBoostLock={toggleBoostLock} onPinch={setPinching}
        renderMedia={(workId, active, warm) => <Animated.View style={[styles.media, heightStyle]}><MediaSlot id={workId} current={active} retained={active && focused && visible} preserve={focused && visible && foreground} active={active && playing} warm={warm && playing && readyId === id}
          paused={mediaPaused} boosted={boosted} seeking={seeking} auto={preferences.auto} rate={preferences.rate} point={active ? session.point : null}
          photo={active ? photo : 0} photoX={photoX} width={width} height={mediaTargetHeight} allowZoom={allowZoom} revision={revision} control={control} handoff={handoff} onInfo={receiveInfo} onTime={receiveTime} onReady={ready} onEnd={next} onPause={pause} /></Animated.View>}
        renderChrome={renderChrome} /> : <View style={styles.empty}>
          {loading ? <ActivityIndicator color="#fff" /> : <><Ionicons name="heart-outline" size={65} color="#fc2f56" /><Text style={[ui.title, { fontSize: 23 }]}>把喜欢，再喜欢一遍。</Text><Text style={ui.muted}>当前频道暂无作品</Text><Button title="导入清单" selected onPress={onImport} /><Button title="刷新当前频道" onPress={() => void refresh()} />{preferences.clear && <Button title="退出清屏" onPress={() => setPreferences({ clear: false })} />}</>}
        </View>}
      {!comments && !chromeHidden && <View pointerEvents="box-none" style={[styles.header, { top: chrome.top, left: Math.max(5, insets.left), right: Math.max(5, insets.right) }]}>
        {onBack ? <IconButton name="chevron-back" size={22} color="#ffffffb3" label="返回内容库" onPress={onBack} /> : <View style={ui.icon} />}
        {onSource ? <View style={styles.channels}>{([['all','推荐'],['likes','喜欢'],['favorites','收藏']] as const).map(([key, label]) => <Pressable key={key} style={styles.channelTab} onPress={() => { if (key !== source) onSource(key); else void refresh(); }}><Text style={[styles.channel, key === source && styles.channelActive]}>{label}</Text>{key === source && <View style={styles.channelUnderline} />}</Pressable>)}</View> : <Text style={ui.text}>{title || '回看'}</Text>}
        <View style={ui.icon} />
      </View>}
      {error && !chromeHidden && <Pressable style={[styles.error, { top: chrome.top + 65 }]} onPress={() => void refresh()}><Text style={ui.error}>{error} · 点按重试</Text></Pressable>}
      {!chromeHidden && <Animated.View pointerEvents="none" style={[styles.heart, heartStyle]}><Ionicons name="heart" size={110} color="#fc2f56" /></Animated.View>}
    </Animated.View>
    <GestureDetector gesture={authorPan}><Animated.View pointerEvents={side === 'author' ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, ui.screen, { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }, authorStyle]}>
      <View style={styles.authorHeader}><IconButton name="chevron-back" label="返回播放" onPress={closeSide} /><Text style={ui.text}>作者</Text><View style={ui.icon} /></View>
      <LibraryScreen key={`${authorGroup}:${current.data?.authorSecUid ?? ''}`} author={authorGroup} authorSecUid={current.data?.authorSecUid} visible={focused && visible && (side === 'author' || prepared)} onOpen={openAuthorWork} />
    </Animated.View></GestureDetector>
    <Modal transparent visible={comments} animationType="none" onRequestClose={() => setCommentCloseRequest(value => value + 1)}>
      <GestureHandlerRootView style={{ flex: 1 }}><Pressable accessibilityLabel="关闭评论" style={StyleSheet.absoluteFill} onPress={() => setCommentCloseRequest(value => value + 1)} />
        {comments && id && <CommentSheet key={id} workId={id} height={height * 0.7} closeRequest={commentCloseRequest} onClosing={beginCommentClose} onClose={closeComments} />}
      </GestureHandlerRootView>
    </Modal>
    <ActionSheet visible={panel !== null} title={panel === 'queue' ? '播放队列' : panel === 'share' ? '分享作品' : '播放选项'} onClose={() => setPanel(null)}>
          {panel === 'queue' ? <><View style={styles.panelHeading}><Text style={ui.title}>播放队列 · {session?.ids.length ?? 0}</Text><Button title="返回" onPress={() => setPanel('options')} /></View>
            <FlatList data={session?.ids ?? []} initialNumToRender={12} keyExtractor={item => item} style={{ maxHeight: height * 0.5 }}
              renderItem={({ item, index }) => <QueueRow id={item} index={index} active={index === session?.index} onPress={() => { setPanel(null); if (session && Math.abs(index - session.index) === 1) pager.current?.go(index); else moveTo(index); }} />} />
          </> : panel === 'share' ? <ShareActions key={id} id={id} title={current.work?.title || current.data?.title || '抖音作品'} gallery={gallery} onShared={() => setPanel(null)} /> : <><View style={styles.options}>
            <Button title={preferences.auto ? '自动连播：开' : '自动连播：关'} selected={preferences.auto} onPress={() => setPreferences({ auto: !preferences.auto })} />
            <Button title={preferences.clear ? '退出清屏' : '清屏'} selected={preferences.clear} onPress={() => setPreferences({ clear: !preferences.clear })} />
            <Button title="播放队列" onPress={() => setPanel('queue')} /><Button title="重新打乱" onPress={() => { setPanel(null); reshuffle(); }} /><Button title="重新取链" onPress={() => { setPanel(null); retry(); }} />
          </View><Text style={ui.muted}>播放速度</Text><View style={styles.options}>{rates.map(rate => <Button key={rate} title={`${rate}×`} selected={preferences.rate === rate} onPress={() => { setBoostLocked(false); setPreferences({ rate }); }} />)}</View>
            <Text style={ui.muted}>喜欢和收藏仅修改本机。评论目前只提供游客有限预览。</Text><Button title="继续播放" onPress={() => setPanel(null)} />
          </>}
    </ActionSheet>
    {groupId && <FolderSheet workId={groupId} onClose={() => setGroupId(null)} />}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#151723', overflow: 'hidden' }, feed: { backgroundColor: '#000' }, media: { position: 'absolute', left: 0, right: 0, top: 0 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20, padding: 30 },
  header: { position: 'absolute', top: 0, left: 5, right: 5, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 5 },
  channels: { flexDirection: 'row', alignItems: 'center', gap: 22 }, channelTab: { height: 44, justifyContent: 'center', paddingBottom: 5 },
  channel: { color: '#ffffff70', fontSize: 14.5, lineHeight: 20, fontWeight: '500', textShadowColor: '#0003', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }, channelActive: { color: '#ffffffd9', fontSize: 15, fontWeight: '600' },
  channelUnderline: { position: 'absolute', bottom: 5, alignSelf: 'center', width: 18, height: 2, borderRadius: 2, backgroundColor: '#ffffffbf' },
  caption: { position: 'absolute', left: 12, right: 78, zIndex: 2 },
  author: { color: '#fff', fontSize: 17, lineHeight: 23, fontWeight: '600', marginBottom: 8, textShadowColor: '#0005', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  description: { color: '#ffffffe6', fontSize: 15.5, lineHeight: 22, textShadowColor: '#0005', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 }, note: { color: '#ddd', fontSize: 10, marginTop: 5 },
  toolbar: { position: 'absolute', right: 7, alignItems: 'center', zIndex: 2 }, avatar: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', backgroundColor: '#52626a', marginBottom: 6 },
  tool: { alignItems: 'center' }, toolLabel: { color: '#ffffffe6', fontSize: 12, lineHeight: 17, fontWeight: '400', textShadowColor: '#0005', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  pause: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  boostDrop: { position: 'absolute', bottom: 8, left: '22%', right: '22%', minHeight: 68, borderRadius: 18, backgroundColor: '#ffffff1a', alignItems: 'center', justifyContent: 'center', gap: 5 }, boostDropArmed: { backgroundColor: '#ffffff40', borderWidth: 1, borderColor: '#ffffff80' },
  boostBadge: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 12, paddingVertical: 5, paddingHorizontal: 9, backgroundColor: '#0005', zIndex: 4 }, boostLabel: { color: '#ffffffc9', fontSize: 12 }, photo: { position: 'absolute', top: 70, right: 20, color: '#fff' },
  segments: { position: 'absolute', bottom: 7, left: 12, right: 12, flexDirection: 'row', gap: 4 }, segment: { height: 3, borderRadius: 2, backgroundColor: '#ffffff44', flex: 1 }, segmentActive: { backgroundColor: '#ffffffbb' },
  failure: { position: 'absolute', top: '37%', left: 35, right: 35, alignItems: 'center', gap: 18 }, error: { position: 'absolute', top: 65, alignSelf: 'center', backgroundColor: '#222d', zIndex: 8 }, heart: { position: 'absolute', top: '40%', alignSelf: 'center', zIndex: 6 },
  authorHeader: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, panelHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, queueItem: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, marginBottom: 3, borderRadius: 5 },
});
